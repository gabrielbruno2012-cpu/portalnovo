#!/usr/bin/env bash
set -e
export PORT=${PORT:-3001}
# instala deps se faltando
if [ ! -d node_modules ]; then
  echo "[boot] Installing npm dependencies..."
  npm install --no-audit --no-fund
fi
# sobe
echo "[boot] Starting server on port $PORT"
node server.js
