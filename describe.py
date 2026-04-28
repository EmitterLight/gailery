#!/usr/bin/env python3
"""
describe.py - Generate VLM descriptions for photos in DB that lack them.
Runs vision_describe.py on the root photo dir once (one model load).

Usage:
    python describe.py --limit 100
    python describe.py --all
    python describe.py --batch-size 25
"""

import argparse
import os
import sys
import subprocess
import time
from datetime import datetime
from pathlib import Path

VENV_PYTHON = os.environ.get("GALLERY_VENV_PYTHON", str(Path(__file__).parent / "venv" / "bin" / "python3"))
if os.path.exists(VENV_PYTHON) and sys.executable != VENV_PYTHON:
    os.execv(VENV_PYTHON, [VENV_PYTHON, __file__] + sys.argv[1:])

sys.path.insert(0, str(Path(__file__).parent / 'src'))
from config import PHOTO_SHARE_PATH, LLAMA_CPP_DIR
LOG_FILE = str(Path(__file__).parent / "logs" / "pipeline.log")
FLAG_FILE = str(Path(__file__).parent / "data" / "pipeline_flags" / "describe")


def log(msg):
    line = f"[{datetime.now().isoformat()}] [DESCRIBE] {msg}"
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")


def set_flag():
    import os
    os.makedirs(os.path.dirname(FLAG_FILE), exist_ok=True)
    open(FLAG_FILE, 'w').close()


def clear_flag():
    import os
    try:
        os.remove(FLAG_FILE)
    except Exception:
        pass


def count_undescribed():
    from database import DatabaseManager
    db = DatabaseManager()
    return db.sqlite.execute(
        "SELECT COUNT(*) FROM photos p JOIN catalog_files cf ON cf.abs_path = p.path "
        "WHERE (p.description IS NULL OR p.description = '') AND p.deleted = 0 AND cf.is_canonical = 1"
    ).fetchone()[0]


def main():
    parser = argparse.ArgumentParser(description="Generate VLM descriptions")
    parser.add_argument("--limit", type=int, default=60, help="Max photos to describe (0=all)")
    parser.add_argument("--batch-size", type=int, default=6, help="VLM batch size (parallel slots)")
    parser.add_argument("--all", action="store_true", help="Describe all undescribed photos")
    parser.add_argument("--dir", type=str, default="", help="Only describe photos under this directory")
    args = parser.parse_args()

    count = count_undescribed()
    if count == 0:
        log("No undescribed photos found")
        return 0

    log(f"Found {count} undescribed photos")
    set_flag()

    try:
        from mqtt_client import create_worker_mqtt
        mq = create_worker_mqtt("describe")
    except Exception:
        mq = None

    limit = 0 if args.all else args.limit
    t0 = time.time()

    cmd = [
        sys.executable, str(Path(__file__).parent / "vision_describe.py"),
        "--batch-size", str(args.batch_size),
    ]
    if args.dir:
        cmd.append(args.dir)
    if limit > 0:
        cmd += ["--limit", str(limit)]

    log(f"Running: {' '.join(cmd)}")

    env = os.environ.copy()
    env["PYTHONPATH"] = str(Path(__file__).parent / "src")
    _vnvidia = str(Path(__file__).parent / "venv" / "lib" / "python3.12" / "site-packages" / "nvidia")
    env["LD_LIBRARY_PATH"] = ":".join([
        _vnvidia + "/cublas/lib",
        _vnvidia + "/cuda_runtime/lib",
        "/usr/local/cuda-12.6/targets/x86_64-linux/lib",
        str(LLAMA_CPP_DIR / "build" / "bin"),
    ])

    result = subprocess.run(cmd, env=env)
    elapsed = time.time() - t0

    remaining = count_undescribed()
    described = count - remaining
    log(f"Done: {described} described in {elapsed:.0f}s ({described/max(elapsed,1):.1f}/s)")
    clear_flag()
    if mq:
        mq.shutdown()
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
