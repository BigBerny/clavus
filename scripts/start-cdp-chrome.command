#!/bin/zsh
set -euo pipefail

APP="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE="/private/tmp/clavus-cdp-chrome"
URL="${1:-http://127.0.0.1:5183/}"

if [[ ! -x "$APP" ]]; then
  echo "Google Chrome was not found at $APP"
  exit 1
fi

mkdir -p "$PROFILE"

exec "$APP" \
  --remote-debugging-port=9222 \
  --user-data-dir="$PROFILE" \
  --no-first-run \
  --no-default-browser-check \
  "$URL"
