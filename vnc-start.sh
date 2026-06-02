#!/bin/bash
export DISPLAY=:98

# Cleanup previous
kill $(lsof -ti :98) 2>/dev/null

# Start Xvfb
Xvfb :98 -screen 0 2560x1440x24 &
XVFB_PID=$!
sleep 1

# Start fluxbox
fluxbox &>/dev/null &

# Start x11vnc
x11vnc -display :98 -rfbauth /root/.vnc/passwd -forever -shared -rfbport 5900 -noxdamage -ncache 10 &
VNC_PID=$!

# Wait for VNC
sleep 1

# Launch Chrome
cd /opt/gailray
DISPLAY=:98 venv/bin/python3 -c "
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(headless=False, args=['--no-sandbox'])
    page = b.new_page(viewport={'width': 2560, 'height': 1440})
    page.goto('http://localhost:8000/gallery', wait_until='load')
    import time
    time.sleep(3600)
" 2>/dev/null

# Cleanup
kill $XVFB_PID $VNC_PID 2>/dev/null
