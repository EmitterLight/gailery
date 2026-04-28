#!/usr/bin/env python3
"""
cluster_personas.py - Incremental face clustering into personas.

Strategy:
  1. Existing persona assignments are NEVER changed.
  2. New faces (no persona_id) are matched to existing personas by centroid.
  3. Remaining unmatched faces are DBSCAN-clustered among themselves.
  4. New clusters get unique IDs that never collide with old ones.
  5. Noise faces (DBSCAN -1) keep persona_id=NULL (no spam personas).

This preserves all manual labels (display_name, comment) forever.
"""

import sys
import logging
import numpy as np
from sklearn.cluster import DBSCAN
from sklearn.metrics.pairwise import cosine_distances

from database import DatabaseManager
from config import LOG_FILE, PHOTO_SHARE_PATH

def _log(msg):
    from datetime import datetime
    line = f"[{datetime.now().isoformat()}] [CLUSTER] {msg}"
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [CLUSTER] %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)

MATCH_THRESHOLD = 0.4  # max cosine distance to assign to existing persona
DBSCAN_EPS = 0.4
DBSCAN_MIN_SAMPLES = 2


def compute_centroids(assigned_faces):
    persona_embeddings = {}
    for f in assigned_faces:
        pid = f.get("persona_id")
        if not pid:
            continue
        persona_embeddings.setdefault(pid, []).append(np.array(f["embedding"]))

    centroids = {}
    for pid, embs in persona_embeddings.items():
        arr = np.array(embs)
        c = arr.mean(axis=0)
        norm = np.linalg.norm(c)
        if norm > 0:
            centroids[pid] = c / norm
        else:
            centroids[pid] = c
    return centroids


def next_persona_id(db):
    personas = db.get_all_personas()
    max_num = 0
    for p in personas:
        pid = p["persona_id"]
        if pid.startswith("persona_"):
            try:
                n = int(pid.split("_")[1])
                if n > max_num:
                    max_num = n
            except ValueError:
                pass
        elif pid.startswith("cluster_"):
            try:
                n = int(pid.split("_")[1])
                if n > max_num:
                    max_num = n
            except ValueError:
                pass
    return max_num + 1


def _batch_commit(db, faces_to_update, photos_to_reset):
    """Batch-update SQLite and LanceDB to avoid N+1 fragmentation."""
    if not faces_to_update and not photos_to_reset:
        return

    if faces_to_update:
        db.sqlite.executemany(
            "UPDATE faces SET persona_id = ? WHERE face_id = ?",
            faces_to_update
        )

    if photos_to_reset:
        photo_list = list(photos_to_reset)
        id_list = ", ".join(f"'{pid}'" for pid in photo_list)
        try:
            db.photo_embeddings.delete(f"photo_id IN ({id_list})")
        except Exception as e:
            _log(f"LanceDB batch delete warning: {e}")

        db.sqlite.executemany(
            "UPDATE photos SET embedded = 0 WHERE photo_id = ?",
            [(pid,) for pid in photo_list]
        )

    db.sqlite.commit()

    try:
        db.compact_photo_embeddings()
    except Exception as e:
        _log(f"LanceDB compact warning: {e}")


def cluster_faces(eps=DBSCAN_EPS, min_samples=DBSCAN_MIN_SAMPLES, match_threshold=MATCH_THRESHOLD):
    db = DatabaseManager()

    faces = db.get_all_face_embeddings()
    faces = sorted(faces, key=lambda f: f["face_id"])
    _log(f"Found {len(faces)} faces total")

    if not faces:
        return

    assigned_faces = [f for f in faces if f.get("persona_id")]
    new_faces = [f for f in faces if not f.get("persona_id")]
    _log(f"Already assigned: {len(assigned_faces)}, New: {len(new_faces)}")

    if not new_faces:
        _log("No new faces to cluster")
        return

    # Pre-build path -> photo_uuid mapping to avoid N+1 lookups
    path_to_uuid = {}
    prefix = str(PHOTO_SHARE_PATH) + "/"
    for row in db.sqlite.execute("SELECT photo_id, path FROM photos").fetchall():
        pid, path = row[0], row[1]
        path_to_uuid[path] = pid
        if path.startswith(prefix):
            rel = path[len(prefix):]
            path_to_uuid[rel] = pid

    # Step 1: Match new faces to existing personas by centroid
    centroids = compute_centroids(assigned_faces)
    matched = 0
    unmatched = []

    faces_to_update = []   # list of (persona_id, face_id)
    photos_to_reset = set()

    if centroids:
        centroid_ids = list(centroids.keys())
        centroid_matrix = np.array([centroids[pid] for pid in centroid_ids])

        for f in new_faces:
            emb = np.array(f["embedding"]).reshape(1, -1)
            dists = cosine_distances(emb, centroid_matrix)[0]
            min_idx = np.argmin(dists)
            min_dist = dists[min_idx]

            if min_dist < match_threshold:
                best_pid = centroid_ids[min_idx]
                faces_to_update.append((best_pid, f["face_id"]))
                photo_uuid = path_to_uuid.get(f.get("photo_id"))
                if photo_uuid:
                    photos_to_reset.add(photo_uuid)
                matched += 1
                _log(f"Matched {f['face_id'][:12]}... → {best_pid} (dist={min_dist:.3f})")
            else:
                unmatched.append(f)

        _log(f"Matched {matched} faces to existing personas, {len(unmatched)} unmatched")
    else:
        unmatched = list(new_faces)

    if not unmatched:
        _log("All faces assigned")
        _batch_commit(db, faces_to_update, photos_to_reset)
        return

    # Step 2: DBSCAN on unmatched faces only
    embeddings = np.array([f["embedding"] for f in unmatched])
    _log(f"DBSCAN on {len(unmatched)} unmatched faces (eps={eps})")

    dbscan = DBSCAN(eps=eps, min_samples=min_samples, metric="cosine")
    labels = dbscan.fit_predict(embeddings)

    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    noise_count = list(labels).count(-1)
    _log(f"DBSCAN found {n_clusters} new clusters, {noise_count} noise faces")

    # Step 3: Create new personas for clusters only
    counter = next_persona_id(db)

    cluster_to_persona = {}
    for cluster_id in sorted(set(labels)):
        if cluster_id == -1:
            continue
        persona_id = f"cluster_{counter}"
        counter += 1
        cluster_to_persona[cluster_id] = persona_id
        db.add_persona(persona_id=persona_id, name=persona_id, display_name=None)
        _log(f"Created persona {persona_id} for new cluster {cluster_id}")

    # Step 4: Assign unmatched faces (clusters only, noise stays NULL)
    for i, f in enumerate(unmatched):
        cluster_id = labels[i]
        if cluster_id == -1:
            # Noise: leave persona_id NULL, do not create spam persona
            continue
        persona_id = cluster_to_persona[cluster_id]
        faces_to_update.append((persona_id, f["face_id"]))
        photo_uuid = path_to_uuid.get(f.get("photo_id"))
        if photo_uuid:
            photos_to_reset.add(photo_uuid)

    _batch_commit(db, faces_to_update, photos_to_reset)
    clustered_count = len([l for l in labels if l != -1])
    _log(f"Clustering complete. {matched} matched + {clustered_count} clustered + {noise_count} noise = {len(new_faces)} total")


if __name__ == "__main__":
    eps = float(sys.argv[1]) if len(sys.argv) > 1 else DBSCAN_EPS
    min_samples = int(sys.argv[2]) if len(sys.argv) > 2 else DBSCAN_MIN_SAMPLES
    cluster_faces(eps=eps, min_samples=min_samples)
