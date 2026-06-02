#!/bin/bash
# Test environment: VNC + Chrome at 2012
# Run: bash test-env.sh

echo "[$(date +%H:%M:%S)] Cleaning old processes..."
kill -9 $(lsof -ti :98) 2>/dev/null
kill -9 $(lsof -ti :5900) 2>/dev/null
pkill -f chrome_crashpad 2>/dev/null
pkill -f "run_chrome" 2>/dev/null
pkill -f fluxbox 2>/dev/null
sleep 2

echo "[$(date +%H:%M:%S)] Starting Xvfb..."
Xvfb :98 -screen 0 2560x1440x24 &
sleep 2

echo "[$(date +%H:%M:%S)] Starting fluxbox..."
fluxbox &>/dev/null &

echo "[$(date +%H:%M:%S)] Starting x11vnc..."
x11vnc -display :98 -rfbauth ~/.vnc/passwd -forever -shared -rfbport 5900 -noxdamage &>/dev/null &
sleep 2

echo "[$(date +%H:%M:%S)] VNC ready on $(hostname -I | awk '{print $1}'):5900 password: 123"

echo "[$(date +%H:%M:%S)] Launching Chrome at 2012..."
cd /opt/gailray
DISPLAY=:98 venv/bin/python3 -u -c "
from playwright.sync_api import sync_playwright
import time, sys

with sync_playwright() as p:
    b = p.chromium.launch(headless=False, args=['--no-sandbox'])
    page = b.new_page(viewport={'width': 2560, 'height': 1440})
    
    logs = []
    page.on('console', lambda msg: logs.append('[CONSOLE] ' + msg.text))
    page.on('pageerror', lambda err: logs.append('[ERROR] ' + str(err)))
    
    print('[CHROME] Loading gallery...', flush=True)
    page.goto('http://localhost:8000/gallery', wait_until='load')
    time.sleep(3)
    
    print('[CHROME] Navigating to 2012 via hash...', flush=True)
    page.goto('http://localhost:8000/gallery#2012-10-04', wait_until='load')
    time.sleep(3)
    
    print('[CHROME] Ready! VNC connected users can see the gallery.', flush=True)
    print('[CHROME] Checking for faces...', flush=True)
    faces = page.evaluate('document.querySelectorAll(\".lazy-face\").length')
    print(f'[CHROME] Lazy-face elements: {faces}', flush=True)
    
    # Print logs every 5 seconds
    last = 0
    for _ in range(720):
        time.sleep(5)
        for l in logs[last:]:
            print(l, flush=True)
        last = len(logs)
        
        # Check faces count
        if _ % 6 == 0:  # every 30s
            fc = page.evaluate('document.querySelectorAll(\".lazy-face[data-src]\").length')
            fd = page.evaluate('document.querySelectorAll(\".lazy-face:not([data-src])\").length')
            print(f'[CHROME] Status: waiting={fc} loaded={fd}', flush=True)
" 2>&1

echo "[$(date +%H:%M:%S)] Chrome exited"
