#!/usr/bin/env bash
# Deploys aparat: the static frontend to WEB_DIR, the API service to APP_DIR,
# the nginx config to NGINX_DIR, all on DEPLOY_HOST, and (re)starts the API as a systemd user service.
# Settings come from deploy.env (see deploy.env.example).
#
#   ./deploy.sh          test, deploy, restart, check
#   ./deploy.sh -n       dry run: show what would be copied, change nothing
#
# nginx: the config goes to NGINX_DIR; the symlink into sites-enabled and the
# include in the site are set up once by hand, see the script's output.

set -euo pipefail
cd "$(dirname "$0")"

DRY=
case ${1:-} in
  -n) DRY=-n ;;
  '') ;;
  *) echo "usage: $0 [-n]   (-n: dry run)" >&2; exit 2 ;;
esac

[[ -f deploy.env ]] || { echo "no deploy.env, copy deploy.env.example and adjust it" >&2; exit 1; }
set -a
. ./deploy.env
set +a
for v in DEPLOY_HOST WEB_DIR APP_DIR NGINX_DIR PATCHES_DIR API_HOST API_PORT PUBLIC_URL; do
  [[ -n ${!v:-} ]] || { echo "deploy.env: $v is not set" >&2; exit 1; }
  [[ $v != *_DIR || ${!v} == /* ]] || { echo "deploy.env: $v must be an absolute path" >&2; exit 1; }
  declare "$v=${!v%/}"
done

# rsync --delete must never reach stored patches or the other directory
within() { [[ $1 == "$2" || $1 == "$2"/* ]]; }
fail() { echo "deploy.env: $*" >&2; exit 1; }
if within "$WEB_DIR" "$APP_DIR" || within "$APP_DIR" "$WEB_DIR"; then fail "WEB_DIR and APP_DIR must not contain each other"; fi
if within "$PATCHES_DIR" "$WEB_DIR"; then fail "PATCHES_DIR must not be inside WEB_DIR"; fi
if within "$PATCHES_DIR" "$APP_DIR" && ! within "$PATCHES_DIR" "$APP_DIR/data"; then
  fail "PATCHES_DIR inside APP_DIR must be under APP_DIR/data, which deploys keep"
fi

step() { printf '\n== %s\n' "$*"; }
RSYNC=(rsync -rlptz --mkpath --delete --itemize-changes $DRY)

step "tests"
(cd server && npm test --silent >/dev/null) || { echo "tests fail, not deploying (cd server && npm test)" >&2; exit 1; }
echo ok
[[ -z $(git status --porcelain) ]] || echo "note: deploying uncommitted changes"

step "directories on $DEPLOY_HOST"
[[ -n $DRY ]] || ssh "$DEPLOY_HOST" mkdir -p "$WEB_DIR" "$APP_DIR" "$PATCHES_DIR" "$NGINX_DIR"
echo "$WEB_DIR $APP_DIR $NGINX_DIR"

step "frontend -> $DEPLOY_HOST:$WEB_DIR"
"${RSYNC[@]}" --exclude /test/ web/ "$DEPLOY_HOST:$WEB_DIR/"

# P protects stored patches, the env file and the service unit from --delete
step "api -> $DEPLOY_HOST:$APP_DIR"
"${RSYNC[@]}" --exclude /test/ --exclude node_modules/ \
  --filter='P /data/' --filter='P /.env' --filter='P /systemd/' \
  server/ "$DEPLOY_HOST:$APP_DIR/"
"${RSYNC[@]}" systemd/aparat.service "$DEPLOY_HOST:$APP_DIR/systemd/"

# nginx config, aparat.conf with the paths and port from deploy.env. Compared
# by content only (no -t), so an unchanged config prints nothing.
step "nginx config -> $DEPLOY_HOST:$NGINX_DIR"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
sed -e "s|@WEB_DIR@|$WEB_DIR|g" -e "s|@API@|$API_HOST:$API_PORT|g" nginx/aparat.conf > "$tmp/aparat.conf"
cp nginx/aparat-locations.conf "$tmp/"
NGINX_CHANGED=$(rsync -rlpz --checksum --mkpath --itemize-changes $DRY \
  "$tmp/aparat.conf" "$tmp/aparat-locations.conf" "$DEPLOY_HOST:$NGINX_DIR/")
if [[ -n $NGINX_CHANGED ]]; then echo "$NGINX_CHANGED"; else echo unchanged; fi

if [[ -n $DRY ]]; then
  step "dry run, nothing changed"
  exit 0
fi

# The service's env file is written from deploy.env and the unit installed from
# systemd/aparat.service on every deploy.
step "service"
ssh "$DEPLOY_HOST" bash -s -- "$APP_DIR" "$PATCHES_DIR" "$API_HOST" "$API_PORT" <<'REMOTE'
set -euo pipefail
APP_DIR=$1 PATCHES_DIR=$2 API_HOST=$3 API_PORT=$4

cat > "$APP_DIR/.env" <<ENV
# written by deploy.sh from deploy.env
HOST=$API_HOST
PORT=$API_PORT
PATCHES_DIR=$PATCHES_DIR
ENV

# the unit from systemd/aparat.service, with this host's paths
node=$(command -v node) || { echo "node not found in the PATH of a non-interactive shell" >&2; exit 1; }
unit=~/.config/systemd/user/aparat.service
mkdir -p "$(dirname "$unit")"
sed -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@NODE@|$node|g" \
  "$APP_DIR/systemd/aparat.service" > "$unit"

systemctl --user daemon-reload
systemctl --user enable --quiet aparat.service
systemctl --user restart aparat.service
sleep 1
systemctl --user is-active aparat.service
if curl -fsS -o /dev/null "http://$API_HOST:$API_PORT/api/patches"; then
  echo "api answers on $API_HOST:$API_PORT"
else
  echo "api does not answer, see: journalctl --user -u aparat -n 50" >&2
  exit 1
fi

if [[ $(loginctl show-user "$USER" -p Linger --value) != yes ]]; then
  echo "warning: lingering is off, so the service stops when you log out and"
  echo "         does not start at boot. Once: sudo loginctl enable-linger $USER"
fi
REMOTE

# The symlink and the include line need root, so they are set up once by hand.
# After that, a changed config is reloaded here if sudo works without a password.
step "nginx"
LINK=/etc/nginx/sites-enabled/aparat.conf
INCLUDE="include $NGINX_DIR/aparat-locations.conf;"
linked=$(ssh "$DEPLOY_HOST" "readlink $LINK" || true)
included=$(ssh "$DEPLOY_HOST" "grep -lsE '^[[:space:]]*include[[:space:]]+$NGINX_DIR/aparat-locations.conf;' /etc/nginx/sites-enabled/*" || true)
if [[ $linked == "$NGINX_DIR/aparat.conf" && -n $included ]]; then
  if [[ -z $NGINX_CHANGED ]]; then
    echo "set up, config unchanged"
  elif ssh "$DEPLOY_HOST" 'sudo -n nginx -t -q && sudo -n systemctl reload nginx' 2>/dev/null; then
    echo "config changed, nginx reloaded"
  else
    echo "config changed, reload nginx:"
    echo "  ssh -t $DEPLOY_HOST 'sudo nginx -t && sudo systemctl reload nginx'"
  fi
else
  echo "not set up yet. Once, on $DEPLOY_HOST:"
  [[ $linked == "$NGINX_DIR/aparat.conf" ]] || echo "
  sudo ln -s $NGINX_DIR/aparat.conf $LINK"
  [[ -n $included ]] || echo "
  add to the server { listen 443 ... } block of the site (velak.klingt.org.conf):
      $INCLUDE"
  echo "
  then: sudo nginx -t && sudo systemctl reload nginx
  (the symlink first: the locations need what aparat.conf defines)"
fi

step "check $PUBLIC_URL"
for path in "" api/patches; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL$path") || code=failed
  echo "$code $PUBLIC_URL$path"
done
