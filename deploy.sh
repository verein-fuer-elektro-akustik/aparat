#!/usr/bin/env bash
# Deploys aparat: the static frontend to WEB_DIR, the API service to APP_DIR,
# both on DEPLOY_HOST, and (re)starts the API as a systemd user service.
# Settings come from deploy.env (see deploy.env.example).
#
#   ./deploy.sh          test, deploy, restart, check
#   ./deploy.sh -n       dry run: show what would be copied, change nothing
#
# nginx is set up once by hand, see the end of this script's output.

set -euo pipefail
cd "$(dirname "$0")"

DRY=
[[ ${1:-} == -n ]] && DRY=-n

[[ -f deploy.env ]] || { echo "no deploy.env, copy deploy.env.example and adjust it" >&2; exit 1; }
set -a
. ./deploy.env
set +a
for v in DEPLOY_HOST WEB_DIR APP_DIR PRESETS_DIR API_HOST API_PORT PUBLIC_URL; do
  [[ -n ${!v:-} ]] || { echo "deploy.env: $v is not set" >&2; exit 1; }
done

step() { printf '\n== %s\n' "$*"; }
RSYNC=(rsync -rlptz --mkpath --delete --itemize-changes $DRY)

step "tests"
(cd server && npm test --silent >/dev/null) || { echo "tests fail, not deploying (cd server && npm test)" >&2; exit 1; }
echo ok
[[ -z $(git status --porcelain) ]] || echo "note: deploying uncommitted changes"

step "directories on $DEPLOY_HOST"
[[ -n $DRY ]] || ssh "$DEPLOY_HOST" mkdir -p "$WEB_DIR" "$APP_DIR" "$PRESETS_DIR"
echo "$WEB_DIR $APP_DIR"

step "frontend -> $DEPLOY_HOST:$WEB_DIR"
"${RSYNC[@]}" --exclude /test/ web/ "$DEPLOY_HOST:$WEB_DIR/"

# P protects stored presets, the env file, the nginx include and the service
# unit from --delete
step "api -> $DEPLOY_HOST:$APP_DIR"
"${RSYNC[@]}" --exclude /test/ --exclude node_modules/ \
  --filter='P /data/' --filter='P /.env' --filter='P /nginx/' --filter='P /systemd/' \
  server/ "$DEPLOY_HOST:$APP_DIR/"
"${RSYNC[@]}" systemd/aparat.service "$DEPLOY_HOST:$APP_DIR/systemd/aparat.service" 2>/dev/null \
  || [[ -n $DRY ]]

# the include, with the port from deploy.env
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
sed "s|http://127.0.0.1:8001/|http://$API_HOST:$API_PORT/|" nginx/aparat.conf > "$tmp/aparat.conf"
# (a dry run of the first deploy cannot copy into the missing nginx/ directory)
if ! NGINX_CHANGED=$("${RSYNC[@]}" --checksum "$tmp/aparat.conf" "$DEPLOY_HOST:$APP_DIR/nginx/aparat.conf" 2>/dev/null); then
  [[ -n $DRY ]] || exit 1
  NGINX_CHANGED="would install nginx/aparat.conf"
fi
if [[ -n $NGINX_CHANGED ]]; then echo "$NGINX_CHANGED"; fi

if [[ -n $DRY ]]; then
  step "dry run, nothing changed"
  exit 0
fi

# The service's env file is written from deploy.env and the unit installed from
# systemd/aparat.service on every deploy.
step "service"
ssh "$DEPLOY_HOST" bash -s -- "$APP_DIR" "$PRESETS_DIR" "$API_HOST" "$API_PORT" <<'REMOTE'
set -euo pipefail
APP_DIR=$1 PRESETS_DIR=$2 API_HOST=$3 API_PORT=$4

cat > "$APP_DIR/.env" <<ENV
# written by deploy.sh from deploy.env
HOST=$API_HOST
PORT=$API_PORT
PRESETS_DIR=$PRESETS_DIR
ENV

# the unit from systemd/aparat.service, with this host's paths
unit=~/.config/systemd/user/aparat.service
mkdir -p "$(dirname "$unit")"
sed -e "s|@APP_DIR@|$APP_DIR|g" -e "s|@NODE@|$(command -v node)|g" \
  "$APP_DIR/systemd/aparat.service" > "$unit"

systemctl --user daemon-reload
systemctl --user enable --quiet aparat.service
systemctl --user restart aparat.service
sleep 1
systemctl --user is-active aparat.service
curl -fsS -o /dev/null "http://$API_HOST:$API_PORT/api/presets" && echo "api answers on $API_HOST:$API_PORT"

if [[ $(loginctl show-user "$USER" -p Linger --value) != yes ]]; then
  echo "warning: lingering is off, so the service stops when you log out and"
  echo "         does not start at boot. Once: sudo loginctl enable-linger $USER"
fi
REMOTE

step "nginx"
if ssh "$DEPLOY_HOST" "grep -qs '$APP_DIR/nginx/aparat.conf' /etc/nginx/sites-enabled/*"; then
  if [[ -n $NGINX_CHANGED ]]; then
    echo "the include changed, reload nginx:"
    echo "  ssh -t $DEPLOY_HOST 'sudo nginx -t && sudo systemctl reload nginx'"
  else
    echo "include in place, unchanged"
  fi
else
  cat <<MSG
not set up yet. Once, add to the server block of the site in
/etc/nginx/sites-enabled/ on $DEPLOY_HOST:

    set \$aparat_web $WEB_DIR;
    include $APP_DIR/nginx/aparat.conf;

then: ssh -t $DEPLOY_HOST 'sudo nginx -t && sudo systemctl reload nginx'
MSG
fi

step "check $PUBLIC_URL"
for path in "" api/presets; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL$path") || code=failed
  echo "$code $PUBLIC_URL$path"
done
