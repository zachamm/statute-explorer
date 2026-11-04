#!/bin/zsh
# Double-click to run the app. Keep this window open while you use it;
# closing it stops the app.
cd "$(dirname "$0")"
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
if lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1; then
  open http://localhost:5173
  exit 0
fi
(sleep 2 && open http://localhost:5173) &
exec npm run dev -- --port 5173 --strictPort
