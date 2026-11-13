# Aparat

A modular synthesizer in the browser.

## Run locally

Needs node 18+ and nginx. From the repository root, in two terminals:

```sh
# patch API on 127.0.0.1:8001, stored patches go to data/patches/
node server/server.js

# nginx serves web/ and forwards /aparat/api/ to the API
mkdir -p data/nginx
nginx -p "$PWD" -c nginx/dev.conf
```

Open <http://localhost:8000/aparat/>.
nginx runs in the foreground, ctrl-c stops it.

## Tests

```sh
(cd server && npm test)   # the patch API
node --test web/test/     # the audio engine and the modules, without a browser
```

`web/test/index.html` is a page that measures what a browser and sound card
can do (channels, latency, cpu budget).

## Deploy

`./deploy.sh` copies the frontend, the API and the nginx config to a server
and (re)starts the API as a systemd user service. `./deploy.sh -n` only shows
what would be copied.

1. Copy `deploy.env.example` to `deploy.env` and set the host and the paths.
2. Run `./deploy.sh`. The first time it prints what is left to do once by
   hand on the server, as root:
   - link the nginx config into `sites-enabled`,
   - include `aparat-locations.conf` in the `server { }` block of the site,
   - `loginctl enable-linger <user>`, so the API runs without a login.
3. After that, every `./deploy.sh` runs the tests, deploys, restarts the API
   and checks that the site answers. A changed nginx config is reloaded if
   `sudo` works without a password, otherwise the script prints the command.

Stored patches live in `PATCHES_DIR` on the server; deploys never touch them.

## Files in the browser

Unsaved changes, copied modules and the audio files of samplers are kept in
the browser (localStorage and IndexedDB), not on the server. A patch only
names its audio files, so on another computer they have to be loaded again.
