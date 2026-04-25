#!/usr/bin/env python3
"""
cluster_personas.py - Incremental face clustering into personas.

Strategy:
  1. Existing persona assignments are NEVER changed.
  2. New faces (no persona_id) are matched to existing personas by centroid.
  3. Remaining unmatched faces are DBSCAN-clustered among themselves.
  4. New clusters get unique IDs that never collide with old ones.

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


def compute_centroids(db):
    all_face_data = db.get_all_face_embeddings()
    persona_embeddings = {}
    for f in all_face_data:
        pid = f.get("persona_id")
        if not pid:
            continue
        persona_embeddings.setdefault(pid, []).append(np.array(f["embedding"]))

    centroids = {}
    for pid, embs in persona_embeddings.items():
        arr = np.array(embs)
        centroids[pid] = arr.mean(axis=0)
        centroids[pid] = centroids[pid] / np.linalg.norm(centroids[pid])
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
                prefix = f"cluster_{n}"
                # cluster_X IDs can collide on re-run, so we track them too
                if n > max_num:
                    max_num = n
            except ValueError:
                pass
    return max_num + 1


def cluster_faces(eps=DBSCAN_EPS, min_samples=DBSCAN_MIN_SAMPLES, match_threshold=MATCH_THRESHOLD):
    db = DatabaseManager()

    faces = db.get_all_face_embeddings()
    faces = sorted(faces, key=lambda f: f["face_id"])
    _log(f"Found {len(faces)} faces total")

    if not faces:
        return

    new_faces = [f for f in faces if not f.get("persona_id")]
    assigned_faces = [f for f in faces if f.get("persona_id")]
    _log(f"Already assigned: {len(assigned_faces)}, New: {len(new_faces)}")

    if not new_faces:
        _log("No new faces to cluster")
        return

    # Step 1: Match new faces to existing personas by centroid
    centroids = compute_centroids(db)
    matched = 0
    unmatched = []

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
                assign_face_to_persona(db, f["face_id"], best_pid)
                matched += 1
                _log(f"Matched {f['face_id'][:12]}... → {best_pid} (dist={min_dist:.3f})")
            else:
                unmatched.append(f)

        _log(f"Matched {matched} faces to existing personas, {len(unmatched)} unmatched")
    else:
        unmatched = list(new_faces)

    if not unmatched:
        _log("All faces assigned")
        return

    # Step 2: DBSCAN on unmatched faces only
    embeddings = np.array([f["embedding"] for f in unmatched])
    _log(f"DBSCAN on {len(unmatched)} unmatched faces (eps={eps})")

    dbscan = DBSCAN(eps=eps, min_samples=min_samples, metric="cosine")
    labels = dbscan.fit_predict(embeddings)

    n_clusters = len(set(labels)) - (1 if -1 in labels else 0)
    noise_count = list(labels).count(-1)
    _log(f"DBSCAN found {n_clusters} new clusters, {noise_count} noise faces")

    # Step 3: Create new personas with unique IDs
    existing_personas = db.get_all_personas()
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

    # Step 4: Assign unmatched faces
    noise_count_new = 0
    cluster_assigns = 0
    for i, f in enumerate(unmatched):
        cluster_id = labels[i]
        if cluster_id == -1:
            persona_id = f"persona_{counter}"
            counter += 1
            db.add_persona(persona_id=persona_id, name=persona_id, display_name=None)
            noise_count_new += 1
        else:
            persona_id = cluster_to_persona[cluster_id]
            cluster_assigns += 1

        assign_face_to_persona(db, f["face_id"], persona_id)
        total_done = matched + i + 1
        if (i + 1) % 50 == 0 or (i + 1) == len(unmatched):
            _log(f"Assigned {total_done}/{matched + len(unmatched)} new faces ({matched} matched, {cluster_assigns} clustered, {noise_count_new} noise)")

    _log(f"Clustering complete. {matched} matched + {cluster_assigns} clustered + {noise_count_new} noise = {matched + len(unmatched)} total")


def assign_face_to_persona(db, face_id, persona_id):
    db.update_face_persona(face_id, persona_id)
    face = db.get_face(face_id)
    if face:
        rel = face.get("photo_id", "")
        full_path = f"{PHOTO_SHARE_PATH}/{rel}" if not rel.startswith("/") else rel
        photo = db.get_photo_by_path(full_path)
        if photo:
            db.delete_photo_embedding(photo["photo_id"])
            db.sqlite.execute("UPDATE photos SET embedded = 0 WHERE photo_id = ?", (photo["photo_id"],))
            db.sqlite.commit()


if __name__ == "__main__":
    eps = float(sys.argv[1]) if len(sys.argv) > 1 else DBSCAN_EPS
    min_samples = int(sys.argv[2]) if len(sys.argv) > 2 else DBSCAN_MIN_SAMPLES
    cluster_faces(eps=eps, min_samples=min_samples)
