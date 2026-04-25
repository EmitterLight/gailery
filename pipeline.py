#!/usr/bin/env python3
"""
pipeline.py - Batch worker: loops through chain until 100% or stopped.
Chain: Ingest -> Describe -> Faces -> EXIF -> Embed

Usage:
    python pipeline.py
    python pipeline.py --ingest 200 --describe 50
    python pipeline.py --batch 200
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
LOG_FILE = str(Path(__file__).parent / "logs" / "pipeline.log")
FLAG_FILE = str(Path(__file__).parent / "data" / "pipeline_flags" / "pipeline")
SCRIPTS_DIR = str(Path(__file__).parent)


def log(msg):
    line = f"[{datetime.now().isoformat()}] [PIPELINE] {msg}"
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")


def set_flag():
    os.makedirs(os.path.dirname(FLAG_FILE), exist_ok=True)
    open(FLAG_FILE, 'w').close()


def clear_flag():
    try:
        os.remove(FLAG_FILE)
    except Exception:
        pass


def stopped():
    return not os.path.exists(FLAG_FILE)


def get_progress():
    from database import DatabaseManager
    db = DatabaseManager()
    cur = db.sqlite.cursor()

    img_exts = ('.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tiff', '.tif', '.webp', '.heic', '.heif', '.avif', '.cr2', '.nef', '.arw', '.dng', '.rw2', '.orf')
    img_exts_all = img_exts + tuple(e.upper() for e in img_exts)
    ext_placeholders = ','.join(['?'] * len(img_exts_all))
    cat_total = cur.execute(f"SELECT COUNT(*) FROM catalog_files WHERE ext IN ({ext_placeholders})", img_exts_all).fetchone()[0]
    ingested = cur.execute("SELECT COUNT(*) FROM photos").fetchone()[0]
    described = cur.execute("SELECT COUNT(*) FROM photos WHERE description IS NOT NULL").fetchone()[0]
    exif_checked = cur.execute("SELECT COUNT(*) FROM photos WHERE exif_checked = 1").fetchone()[0]
    faces_flagged = cur.execute("SELECT COUNT(*) FROM photos WHERE faces_present = 1").fetchone()[0]
    faces_with_persona = cur.execute("SELECT COUNT(DISTINCT photo_id) FROM faces WHERE persona_id IS NOT NULL").fetchone()[0]
    faces_done = cur.execute("SELECT COUNT(DISTINCT photo_id) FROM faces").fetchone()[0]
    faces_pending = faces_flagged - faces_done
    embedded = cur.execute("SELECT COUNT(*) FROM catalog_files WHERE embedded = 1 AND ingested = 1").fetchone()[0]

    p_ingest = ingested / max(cat_total, 1) * 100
    p_describe = described / max(ingested, 1) * 100
    p_exif = exif_checked / max(ingested, 1) * 100
    p_faces = faces_with_persona / max(faces_flagged, 1) * 100 if faces_flagged > 0 else 100
    p_embed = embedded / max(ingested, 1) * 100

    return {
        "ingest": (ingested, cat_total, p_ingest),
        "describe": (described, ingested, p_describe),
        "exif": (exif_checked, ingested, p_exif),
        "faces": (faces_with_persona, faces_flagged, p_faces),
        "faces_pending": faces_pending,
        "embed": (embedded, ingested, p_embed),
    }


def run_step(name, cmd):
    if stopped():
        return -1
    log(f"  START: {name}")
    t0 = time.time()
    try:
        result = subprocess.run(cmd, capture_output=False, text=True, env=os.environ.copy())
        elapsed = time.time() - t0
        if result.returncode == 0:
            log(f"  DONE: {name} ({elapsed:.0f}s)")
        else:
            log(f"  FAILED: {name} rc={result.returncode} ({elapsed:.0f}s)")
        return result.returncode
    except Exception as e:
        log(f"  ERROR: {name}: {e}")
        return 1


def main():
    parser = argparse.ArgumentParser(description="Gailery batch worker loop")
    parser.add_argument("--batch", type=int, default=60, help="Photos per iteration (ingest/describe)")
    parser.add_argument("--ingest", type=int, default=0, help="Override ingest batch size (0=use --batch)")
    parser.add_argument("--describe", type=int, default=0, help="Override describe batch size (0=use --batch)")
    parser.add_argument("--batch-size", type=int, default=6, help="VLM batch size for describe")
    args = parser.parse_args()

    ingest_n = args.ingest or args.batch
    describe_n = args.describe or args.batch

    os.makedirs(str(Path(__file__).parent / "logs"), exist_ok=True)
    set_flag()
    log("=" * 60)
    log(f"Pipeline loop started (batch={args.batch}, ingest={ingest_n}, describe={describe_n})")

    try:
        iteration = 0
        while not stopped():
            iteration += 1
            progress = get_progress()

            log(f"--- Итерация {iteration} ---")
            for step, val in progress.items():
                if isinstance(val, tuple):
                    done, total, pct = val
                    log(f"  {step}: {done}/{total} ({pct:.1f}%)")
                else:
                    log(f"  {step}: {val}")

            all_done = all(pct >= 100 for _, _, pct in progress.values())
            if all_done:
                log("Все шаги 100% — цикл завершён")
                break

            if progress["ingest"][2] < 100:
                remaining = progress["ingest"][1] - progress["ingest"][0]
                n = min(ingest_n, remaining) if remaining > 0 else ingest_n
                run_step("INGEST", [VENV_PYTHON, f"{SCRIPTS_DIR}/ingest.py", "--random", str(n)])
                if stopped():
                    break

            if progress["describe"][2] < 100:
                remaining = progress["describe"][1] - progress["describe"][0]
                n = min(describe_n, remaining) if remaining > 0 else describe_n
                run_step("DESCRIBE", [VENV_PYTHON, f"{SCRIPTS_DIR}/describe.py", "--limit", str(n), "--batch-size", str(args.batch_size)])
                if stopped():
                    break

            if progress["faces"][2] < 100 or progress.get("faces_pending", 0) > 0:
                run_step("FACES", [VENV_PYTHON, f"{SCRIPTS_DIR}/faces.py"])
                if stopped():
                    break

            if progress["exif"][2] < 100:
                run_step("EXIF", [VENV_PYTHON, f"{SCRIPTS_DIR}/exif.py", "--all"])
                if stopped():
                    break

            if progress["embed"][2] < 100:
                run_step("EMBED", [VENV_PYTHON, f"{SCRIPTS_DIR}/embed.py"])
                if stopped():
                    break

            progress2 = get_progress()
            any_changed = any(
                progress2[k][0] != progress[k][0] for k in progress
            )
            if not any_changed and not all(pct >= 100 for _, _, pct in progress2.values()):
                log("Прогресса нет, засыпаю 30с...")
                time.sleep(30)

        log("Pipeline loop завершён")
    finally:
        clear_flag()


if __name__ == "__main__":
    main()
