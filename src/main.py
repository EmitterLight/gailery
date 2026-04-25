"""FastAPI application for Gailery Photo Gallery"""

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
import logging
import os

from database import DatabaseManager
from config import LANCEDB_PATH, LOG_FILE, FLAG_DIR, VENV_PYTHON, PROJECT_ROOT, DATA_DIR

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

db_manager = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db_manager
    logger.info("Starting application...")
    db_manager = DatabaseManager()
    logger.info("Database connected")
    yield
    logger.info("Shutting down application...")


app = FastAPI(
    title="Gailery Photo Gallery API",
    description="AI-powered photo gallery with face search",
    version="0.1.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/gallery")


@app.get("/catalog")
async def catalog_page():
    from pathlib import Path
    from fastapi.responses import HTMLResponse
    catalog_html = Path(__file__).parent.parent / "web" / "catalog.html"
    if catalog_html.exists():
        with open(catalog_html) as f:
            return HTMLResponse(f.read())
    return {"error": "Page not found"}


@app.get("/gallery")
async def gallery_page():
    from pathlib import Path
    from fastapi.responses import HTMLResponse
    gallery_html = Path(__file__).parent.parent / "web" / "gallery.html"
    if gallery_html.exists():
        with open(gallery_html) as f:
            return HTMLResponse(f.read(), headers={"Cache-Control": "no-cache, no-store"})
    return {"error": "Page not found"}


@app.get("/persons")
async def persons_page():
    from pathlib import Path
    persons_html = Path(__file__).parent.parent / "web" / "personas.html"
    if persons_html.exists():
        from fastapi.responses import HTMLResponse
        with open(persons_html) as f:
            return HTMLResponse(f.read())
    return {"error": "Page not found"}


@app.get("/monitor")
async def monitor_page():
    from pathlib import Path
    from fastapi.responses import HTMLResponse
    monitor_html = Path(__file__).parent.parent / "web" / "photos.html"
    if monitor_html.exists():
        with open(monitor_html) as f:
            return HTMLResponse(f.read())
    return {"error": "Page not found"}


@app.get("/log")
async def pipeline_log():
    from pathlib import Path
    from fastapi.responses import HTMLResponse
    log_html = Path(__file__).parent.parent / "web" / "log.html"
    if log_html.exists():
        with open(log_html) as f:
            return HTMLResponse(f.read())
    return {"error": "Page not found"}


@app.get("/control")
async def control_page():
    from pathlib import Path
    from fastapi.responses import HTMLResponse
    ctrl_html = Path(__file__).parent.parent / "web" / "control.html"
    if ctrl_html.exists():
        with open(ctrl_html) as f:
            return HTMLResponse(f.read())
    return {"error": "Page not found"}


@app.get("/map")
async def map_page():
    from pathlib import Path
    from fastapi.responses import HTMLResponse
    map_html = Path(__file__).parent.parent / "web" / "map.html"
    if map_html.exists():
        with open(map_html) as f:
            content = f.read()
        return HTMLResponse(content, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
    return {"error": "Page not found"}


@app.get("/api/log")
async def get_log(lines: int = 100):
    log_path = Path(str(LOG_FILE))
    if not log_path.exists():
        return {"lines": [], "total": 0}
    with open(log_path) as f:
        all_lines = f.readlines()
    return {
        "lines": all_lines[-lines:],
        "total": len(all_lines),
    }


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "database": "connected" if db_manager else "disconnected"
    }


@app.get("/api/status")
async def get_status():
    import subprocess
    from database import DatabaseManager
    from datetime import datetime

    db = DatabaseManager()
    status = db.get_status()

    import os
    flag_dir = str(FLAG_DIR)
    os.makedirs(flag_dir, exist_ok=True)

    procs = {"vlm": False, "face_pipeline": False, "embed": False}
    for key, fname in [("vlm", "describe"), ("face_pipeline", "faces"), ("embed", "embed")]:
        procs[key] = os.path.exists(os.path.join(flag_dir, fname))

    current_step = "idle"
    step_details = ""
    step_started_at = None
    pipeline_started_at = None
    pipeline_flag = os.path.join(flag_dir, "pipeline")
    if os.path.exists(pipeline_flag):
        try:
            import datetime as dt
            mtime = os.path.getmtime(pipeline_flag)
            pipeline_started_at = dt.datetime.fromtimestamp(mtime, tz=dt.timezone.utc).isoformat()
        except Exception:
            pass
    for proc_name, fname in [("DESCRIBE", "describe"), ("INGEST", "ingest"), ("FACES", "faces"), ("EXIF", "exif"), ("EMBED", "embed"), ("PIPELINE", "pipeline")]:
        fpath = os.path.join(flag_dir, fname)
        if os.path.exists(fpath):
            current_step = proc_name.lower()
            step_details = proc_name
            try:
                import datetime as dt
                mtime = os.path.getmtime(fpath)
                step_started_at = dt.datetime.fromtimestamp(mtime, tz=dt.timezone.utc).isoformat()
            except Exception:
                pass
            break

    status["processes"] = procs
    status["current_step"] = current_step
    status["step_details"] = step_details
    status["step_started_at"] = step_started_at
    status["pipeline_started_at"] = pipeline_started_at
    status["server_time"] = datetime.now().isoformat()

    try:
        log_path = str(LOG_FILE)
        progress_info = {}
        tag_map = {"DESCRIBE": "describe", "INGEST": "ingest", "FACES": "faces", "EXIF": "exif", "EMBED": "embed"}
        with open(log_path, "r") as f:
            for line in f:
                for tag, key in tag_map.items():
                    if "[" + tag + "]" in line:
                        progress_info[key] = line.strip()
        status["progress_lines"] = progress_info
    except Exception:
        status["progress_lines"] = {}

    try:
        faces_phase = ""
        faces_detail = ""
        with open(str(LOG_FILE), "r") as f:
            lines = f.readlines()
        for line in reversed(lines[-100:]):
            if "[FACES]" in line or "[CLUSTER]" in line:
                stripped = line.strip()
                if "detecting " in stripped:
                    fname = stripped.split("detecting ")[-1].replace("...", "")
                    faces_phase = "detecting"
                    faces_detail = fname
                    break
                elif "lance write " in stripped and "done" not in stripped:
                    nvec = stripped.split("lance write ")[-1].replace(" vectors...", "")
                    faces_phase = "lance_write"
                    faces_detail = nvec + " vectors"
                    break
                elif "lance write done" in stripped:
                    faces_phase = "lance_write"
                    faces_detail = "done"
                    break
                elif "Running DBSCAN" in stripped:
                    faces_phase = "clustering"
                    faces_detail = "DBSCAN"
                    break
                elif "[CLUSTER]" in stripped and "DBSCAN on" in stripped:
                    faces_phase = "clustering"
                    faces_detail = "DBSCAN"
                    break
                elif "[CLUSTER]" in stripped and "Matched" in stripped:
                    faces_phase = "clustering"
                    faces_detail = "matching"
                    break
                elif "Detection done" in stripped:
                    faces_phase = "detection_done"
                    m = stripped.split("Detection done: ")[-1] if "Detection done: " in stripped else ""
                    faces_detail = m
                    break
                elif "Clustering done" in stripped:
                    faces_phase = "done"
                    faces_detail = ""
                    break
                elif "InsightFace loaded" in stripped:
                    faces_phase = "loading"
                    faces_detail = "InsightFace"
                    break
                elif "Found " in stripped and "photos needing" in stripped:
                    faces_phase = "loading"
                    m = stripped.split("Found ")[-1].split(" photos")[0]
                    faces_detail = m + " photos"
                    break
        status["faces_phase"] = faces_phase
        status["faces_detail"] = faces_detail
    except Exception:
        status["faces_phase"] = ""
        status["faces_detail"] = ""

    return status


@app.post("/api/control/start")
async def control_start(body: dict):
    import subprocess
    step = body.get("step", "")
    _lf = str(LOG_FILE)
    _pr = str(PROJECT_ROOT)
    cmd = None

    if step == "ingest":
        n = body.get("ingest_limit", 100)
        exif = "--exif" if body.get("exif") == "1" else ""
        cmd = f"/usr/bin/nohup {VENV_PYTHON} {_pr}/ingest.py --random {n} {exif} >> {_lf} 2>&1 &"
    elif step == "describe":
        n = body.get("desc_limit", 60)
        bs = body.get("batch_size", 6)
        cmd = f"/usr/bin/nohup {VENV_PYTHON} {_pr}/describe.py --limit {n} --batch-size {bs} >> {_lf} 2>&1 &"
    elif step == "faces":
        cmd = f"/usr/bin/nohup {VENV_PYTHON} {_pr}/faces.py >> {_lf} 2>&1 &"
    elif step == "exif":
        cmd = f"/usr/bin/nohup {VENV_PYTHON} {_pr}/exif.py --all >> {_lf} 2>&1 &"
    elif step == "embed":
        cmd = f"/usr/bin/nohup {VENV_PYTHON} {_pr}/embed.py >> {_lf} 2>&1 &"
    elif step == "chain":
        n = body.get("ingest_limit", 100)
        dl = body.get("desc_limit", 60)
        bs = body.get("batch_size", 6)
        cmd = f"/usr/bin/nohup {VENV_PYTHON} {_pr}/pipeline.py --ingest {n} --describe {dl} --batch-size {bs} >> {_lf} 2>&1 &"

    if cmd:
        os.system("pkill -9 -f 'llama-server' 2>/dev/null")
        from datetime import datetime
        with open(_lf, "a") as f:
            f.write(f"[{datetime.now().isoformat()}] [CONTROL] Starting: {step}\n")
        os.system(cmd)
        return {"ok": True, "step": step}
    return {"ok": False, "error": "unknown step"}


@app.post("/api/control/stop")
async def control_stop():
    for pattern in ["llama-server", "vision_describe", "face_pipeline", "faces.py", "faces", "ingest.py", "ingest", "exif.py", "exif", "embed.py", "embed", "pipeline.py", "describe.py", "describe"]:
        try:
            os.system(f"pkill -f '{pattern}' 2>/dev/null")
        except Exception:
            pass
    flag_dir = str(FLAG_DIR)
    for fname in ["describe", "ingest", "faces", "exif", "embed", "pipeline"]:
        try:
            os.remove(os.path.join(flag_dir, fname))
        except Exception:
            pass
    from datetime import datetime
    with open(str(LOG_FILE), "a") as f:
        f.write(f"[{datetime.now().isoformat()}] [CONTROL] STOP ALL\n")
    return {"ok": True}


@app.get("/api/changes")
async def get_changes(limit: int = 100):
    from database import DatabaseManager
    db = DatabaseManager()
    cur = db.sqlite.cursor()
    rows = cur.execute(
        "SELECT c.photo_id, c.field, c.value, c.changed_at, p.path "
        "FROM changes c LEFT JOIN photos p ON c.photo_id = p.photo_id "
        "ORDER BY c.changed_at DESC LIMIT ?",
        (limit,)
    ).fetchall()
    from datetime import datetime
    result = []
    for r in rows:
        result.append({
            "photo_id": r[0], "field": r[1], "value": r[2],
            "changed_at": r[3], "path": r[4],
        })
    return {"changes": result, "server_time": datetime.now().isoformat()}


from api import photos, persons, catalog
app.include_router(photos.router)
app.include_router(persons.router)
app.include_router(catalog.router)

from pathlib import Path
static_dir = Path(__file__).parent / "frontend"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

web_dir = Path(__file__).parent.parent / "web"

@app.get("/logo-dark.png")
async def logo_dark():
    p = web_dir / "logo-dark.png"
    if p.exists():
        return FileResponse(str(p), media_type="image/png")
    raise HTTPException(status_code=404)

@app.get("/logo-light.png")
async def logo_light():
    p = web_dir / "logo-light.png"
    if p.exists():
        return FileResponse(str(p), media_type="image/png")
    raise HTTPException(status_code=404)


@app.get("/api/backup/download")
async def backup_download():
    import gzip, tempfile
    db_path = DATA_DIR / "gallery.db"
    if not db_path.exists():
        raise HTTPException(status_code=404, detail="Database file not found")
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".db.gz")
    try:
        with open(db_path, "rb") as f_in:
            with gzip.open(tmp.name, "wb", compresslevel=6) as f_out:
                while True:
                    chunk = f_in.read(8 * 1024 * 1024)
                    if not chunk:
                        break
                    f_out.write(chunk)
        from datetime import datetime
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        return FileResponse(
            tmp.name,
            media_type="application/gzip",
            filename=f"gallery_backup_{ts}.db.gz",
            background=lambda: os.unlink(tmp.name) if os.path.exists(tmp.name) else None,
        )
    except Exception as e:
        if os.path.exists(tmp.name):
            os.unlink(tmp.name)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/backup/upload")
async def backup_upload(file: UploadFile = File(...)):
    import gzip, tempfile, shutil
    db_path = DATA_DIR / "gallery.db"
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename")
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
    try:
        with open(tmp.name, "wb") as f_out:
            content = await file.read()
            if file.filename.endswith(".gz"):
                import io
                with gzip.GzipFile(fileobj=io.BytesIO(content)) as f_in:
                    f_out.write(f_in.read())
            else:
                f_out.write(content)
        if db_path.exists():
            bak = str(db_path) + ".bak"
            if os.path.exists(bak):
                os.unlink(bak)
            shutil.move(str(db_path), bak)
        shutil.move(tmp.name, str(db_path))
        return {"ok": True, "message": "Database restored. Restart service to apply."}
    except Exception as e:
        if os.path.exists(tmp.name):
            os.unlink(tmp.name)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/maintenance/stats")
async def maintenance_stats():
    import os
    stats = {}
    db_path = DATA_DIR / "gallery.db"
    if db_path.exists():
        stats["sqlite_size"] = os.path.getsize(str(db_path))
    lance_path = LANCEDB_PATH / "photo_embeddings.lance"
    if lance_path.exists():
        total = 0
        for root, dirs, files in os.walk(str(lance_path)):
            for f in files:
                total += os.path.getsize(os.path.join(root, f))
        stats["embeddings_size"] = total
    total_data = 0
    for root, dirs, files in os.walk(str(DATA_DIR)):
        for f in files:
            total_data += os.path.getsize(os.path.join(root, f))
    stats["data_total"] = total_data
    return stats


@app.post("/api/maintenance/vacuum")
async def maintenance_vacuum():
    import sqlite3
    try:
        db_path = str(DATA_DIR / "gallery.db")
        before = os.path.getsize(db_path)
        conn = sqlite3.connect(db_path)
        conn.execute("VACUUM")
        conn.close()
        after = os.path.getsize(db_path)
        return {"ok": True, "before": before, "after": after, "freed": before - after}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/maintenance/dedup_embeddings")
async def maintenance_dedup_embeddings():
    import lancedb
    import pyarrow as pa
    try:
        db = lancedb.connect(str(LANCEDB_PATH))
        tbl = db.open_table("photo_embeddings")
        data = tbl.to_arrow()
        before_rows = len(data)
        pids = data.column("photo_id").to_pylist()
        seen = {}
        for i, pid in enumerate(pids):
            seen[pid] = i
        keep = sorted(seen.values())
        if len(keep) == before_rows:
            return {"ok": True, "before": before_rows, "after": before_rows, "removed": 0}
        filtered = data.take(keep)
        db.drop_table("photo_embeddings")
        new_tbl = db.create_table("photo_embeddings", filtered)
        new_tbl.create_index(metric="cosine", vector_column_name="embedding")
        return {"ok": True, "before": before_rows, "after": len(filtered), "removed": before_rows - len(filtered)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def main():
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)


if __name__ == "__main__":
    main()
