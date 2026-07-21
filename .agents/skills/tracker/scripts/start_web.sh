#!/bin/sh
# CoForce console — the ONLY entry point skills use to launch the local web.
#
#   ./start_web.sh            # serve the built console on :4517 (builds once if needed)
#   ./start_web.sh --dev      # API on :4517 + Vite dev server with HMR on :5173
#   PORT=4600 ./start_web.sh  # custom port
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
WEB="$DIR/../web"
PORT="${PORT:-4517}"

PM=""
command -v bun >/dev/null 2>&1 && PM=bun
[ -z "$PM" ] && command -v npm >/dev/null 2>&1 && PM=npm

build() {
  [ -z "$PM" ] && return 0   # no package manager: rely on committed dist / legacy page
  ( cd "$WEB" \
    && { [ -d node_modules ] || $PM install --silent; } \
    && $PM run build )
}

if [ "$1" = "--dev" ]; then
  [ -z "$PM" ] && { echo "dev mode needs bun or npm"; exit 1; }
  node "$DIR/board.mjs" --serve "$PORT" &
  API_PID=$!
  trap 'kill $API_PID 2>/dev/null' EXIT INT TERM
  cd "$WEB"
  [ -d node_modules ] || $PM install --silent
  exec $PM run dev
fi

# production: build when dist is missing or older than the sources
if [ ! -f "$WEB/dist/index.html" ] || [ -n "$(find "$WEB/src" "$WEB/index.html" -newer "$WEB/dist/index.html" 2>/dev/null | head -1)" ]; then
  build || true
fi
exec node "$DIR/board.mjs" --serve "$PORT"
