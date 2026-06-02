#!/bin/bash
set -e

echo "=== Killing old processes ==="
pkill -f "Xvfb :98" 2>/dev/null || true
pkill -f "x11vnc.*5900" 2>/dev/null || true
pkill -f chrome_crashpad 2>/dev/null || true
sleep 2

echo "=== Starting Xvfb ==="
Xvfb :98 -screen 0 2560x1440x24 &
sleep 2

echo "=== Starting fluxbox ==="
fluxbox &>/dev/null &
sleep 1

echo "=== Starting x11vnc on 5900 ==="
x11vnc -display :98 -rfbauth ~/.vnc/passwd -forever -shared -rfbport 5900 -noxdamage &>/dev/null &
sleep 1

echo "=== Launching Chrome ==="
DISPLAY=:98 /opt/gailray/venv/bin/python3 /opt/gailray/run_chrome.py

echo "=== Chrome exited ==="
