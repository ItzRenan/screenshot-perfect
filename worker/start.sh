#!/bin/sh
set -eu
Xvfb :99 -screen 0 1440x1000x24 -ac +extension RANDR &
sleep 1
x11vnc -display :99 -forever -shared -localhost -rfbport 5900 -nopw &
websockify --web=/usr/share/novnc 6080 localhost:5900 &
exec node /app/src/server.js
