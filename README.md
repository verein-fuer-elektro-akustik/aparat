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
