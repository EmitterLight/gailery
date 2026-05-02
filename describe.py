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
import base64
import json
import re
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


SYSTEM_PROMPT = """Ты — автоматический анализатор фотографий. Анализируй изображение и вызови функцию describe_photo с результатами.

Обрати внимание:
- description: что происходит на фото, кто изображён, где, настроение. Пиши на русском.
- photo_type: классификация изображения. photo = обычная фотография, screenshot = скриншот экрана, document = документ/квитанция/скан/чек/сертификат/объявление, meme = мем/карточка с текстом, icon = иконка/аватарка, other = всё остальное
- has_faces: true если видны лица людей (даже частично), false если нет людей или лица не видны"""


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


def _describe_ollama(img_path, ollama_url, ollama_model):
    import requests
    from PIL import Image
    import io

    img = Image.open(img_path)
    max_dim = max(img.size)
    if max_dim > 1280:
        scale = 1280 / max_dim
        new_size = (int(img.size[0] * scale), int(img.size[1] * scale))
        img = img.resize(new_size, Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format='JPEG', quality=85)
    img_b64 = base64.b64encode(buf.getvalue()).decode('utf-8')

    body = {
        "model": ollama_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": "Проанализируй эту фотографию.", "images": [img_b64]},
        ],
        "stream": False,
        "keep_alive": "5m",
    }
    r = requests.post(f"{ollama_url}/api/chat", json=body, timeout=120)
    r.raise_for_status()
    msg = r.json().get("message", {}).get("content", "")
    try:
        data = json.loads(msg)
        desc = data.get("description", "")
        has_faces = data.get("has_faces", False)
    except json.JSONDecodeError:
        m = re.search(r'"description"\s*:\s*"(.+?)"', msg)
        desc = m.group(1) if m else msg[:500]
        has_faces = "has_faces" in msg and "true" in msg.lower()
    return desc, has_faces


def _save_description(db, photo_id, path, description, has_faces):
    cur = db.sqlite.cursor()
    cur.execute(
        "UPDATE photos SET description = ?, faces_present = ? WHERE photo_id = ? AND deleted = 0",
        (description, 1 if has_faces else 0, photo_id),
    )
    db.sqlite.commit()
    log(f"  Saved: {Path(path).name} faces={has_faces} desc={description[:60]}...")


def _get_photos_to_describe(limit=0, dir_filter=""):
    from database import DatabaseManager
    db = DatabaseManager()
    sql = """
        SELECT p.photo_id, p.path FROM photos p
        JOIN catalog_files c ON p.path = c.abs_path AND c.is_canonical = 1 AND c.deleted = 0
        WHERE (p.description IS NULL OR p.description = '') AND p.deleted = 0
    """
    if dir_filter:
        dir_filter = dir_filter.rstrip('/')
        sql += f" AND p.path LIKE '{dir_filter}/%'"
    sql += " ORDER BY p.path"
    if limit > 0:
        sql += f" LIMIT {limit}"
    rows = db.sqlite.execute(sql).fetchall()
    return db, rows


def main():
    parser = argparse.ArgumentParser(description="Generate VLM descriptions")
    parser.add_argument("--limit", type=int, default=60, help="Max photos to describe (0=all)")
    parser.add_argument("--batch-size", type=int, default=6, help="VLM batch size (parallel slots)")
    parser.add_argument("--all", action="store_true", help="Describe all undescribed photos")
    parser.add_argument("--dir", type=str, default="", help="Only describe photos under this directory")
    args = parser.parse_args()

    from config import describe_backend as db_backend, OLLAMA_MODE, OLLAMA_BASE_URL, OLLAMA_DESCRIBE_MODEL
    be = db_backend or OLLAMA_MODE
    count = count_undescribed()
    if count == 0:
        log("No undescribed photos found")
        return 0

    log(f"Found {count} undescribed photos, backend={be}")
    set_flag()

    try:
        from mqtt_client import create_worker_mqtt
        mq = create_worker_mqtt("describe")
    except Exception:
        mq = None

    try:
        limit = 0 if args.all else args.limit
        t0 = time.time()

        if be == "ollama":
            return _main_ollama(db=None, limit=limit, dir_filter=args.dir, mq=mq, t0=t0)
        else:
            return _main_local(args, mq=mq, t0=t0)
    finally:
        clear_flag()
        if mq:
            mq.shutdown()


def _main_local(args, mq, t0):
    cmd = [
        sys.executable, str(Path(__file__).parent / "vision_describe.py"),
        "--batch-size", str(args.batch_size),
    ]
    if args.dir:
        cmd.append(args.dir)
    limit = 0 if args.all else args.limit
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
    described = (args.limit if args.all else min(args.limit, args.limit)) - remaining
    log(f"Done: {described} described in {elapsed:.0f}s")
    return result.returncode


def _main_ollama(db, limit, dir_filter, mq, t0):
    import requests
    from config import OLLAMA_DESCRIBE_MODEL, OLLAMA_BASE_URL
    url = OLLAMA_BASE_URL.rstrip('/')
    model = OLLAMA_DESCRIBE_MODEL

    db, rows = _get_photos_to_describe(limit=limit, dir_filter=dir_filter)
    total = len(rows)
    described = 0
    last_log_t = t0

    for i, row in enumerate(rows):
        photo_id, path = row
        if mq and mq.stopped():
            break
        if not os.path.exists(path):
            log(f"  SKIP (missing): {Path(path).name}")
            continue

        try:
            desc, has_faces = _describe_ollama(path, url, model)
            _save_description(db, photo_id, path, desc, has_faces)
            described += 1
        except Exception as e:
            log(f"  ERROR: {Path(path).name}: {e}")

        now = time.time()
        if now - last_log_t >= 10:
            elapsed = now - t0
            rate = described / max(elapsed, 1)
            pct = described / max(total, 1) * 100
            log(f"  [{described}/{total}] {pct:.1f}% | {elapsed:.0f}с, {rate:.1f}/с")
            last_log_t = now

    elapsed = time.time() - t0
    log(f"Done (Ollama): {described} described in {elapsed:.0f}s ({described/max(elapsed,1):.1f}/s)")

    # Unload Ollama model to free VRAM
    try:
        requests.post(f"{url}/api/generate", json={"model": model, "keep_alive": "0s"}, timeout=10)
        log("Ollama model unloaded, VRAM freed")
    except Exception:
        pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
