#!/usr/bin/env bash
set -euo pipefail

cd /home/elijah/Desktop/3D-Model-Pi-Display

# Start http-server (local dev dependency) in background
./node_modules/.bin/http-server -p 8080 &
SERVER_PID=$!

# Start your python gate script in background
python3 /home/elijah/Desktop/screen_gate.py &
GATE_PID=$!

# Wait until the server is actually responding
until curl -sSf http://127.0.0.1:8080/ >/dev/null; do
  sleep 0.2
done

# Launch Chromium kiosk (Pi OS typically uses "chromium", not "chromium-browser") 
chromium \
  --noerrdialogs \
  --disable-infobars \
  --kiosk \
  http://127.0.0.1:8080/Code/pi.html &

# Keep the script alive as long as the server + gate are alive
wait "$SERVER_PID" "$GATE_PID"
