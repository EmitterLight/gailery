"""
Tests for core gallery UI functionality.
These verify that the API endpoints the frontend depends on actually work
with real data — not just return 200 on empty DBs.
"""
import pytest
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

_MODULES_TO_CLEAN = ("main", "database", "api", "api.photos", "api.persons", "api.catalog")


def _clean():
    for m in list(sys.modules.keys()):
        if m in _MODULES_TO_CLEAN:
            del sys.modules[m]


@pytest.fixture
def gallery(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    lance = data / "lancedb"
    lance.mkdir(parents=True)
    logs = tmp_path / "logs"
    logs.mkdir()
    thumbs = tmp_path / "thumbnails"
    thumbs.mkdir()
    photo_share = tmp_path / "photos"
    photo_share.mkdir()
    flags = data / "pipeline_flags"
    flags.mkdir(parents=True)

    _clean()
    cfg = [
        patch("config.DATA_DIR", data),
        patch("config.LANCEDB_PATH", lance),
        patch("config.LOG_FILE", logs / "pipeline.log"),
        patch("config.THUMBNAILS_DIR", thumbs),
        patch("config.PHOTO_SHARE_PATH", photo_share),
        patch("config.FLAG_DIR", flags),
    ]
    for p in cfg:
        p.start()

    from database import DatabaseManager
    db = DatabaseManager(db_path=data / "gallery.db")

    rid = "root1"
    db.add_catalog_root(rid, str(photo_share), alias="Test")
    db.add_catalog_files_batch([
        {"file_id": "cf1", "root_id": rid,
         "rel_path": "2024/photo1.jpg", "abs_path": f"{photo_share}/2024/photo1.jpg",
         "parent_dir": "2024", "ext": ".jpg", "size": 1000, "modified": "1700000000",
         "is_canonical": 1, "content_hash": "aa11111111111111"},
        {"file_id": "cf2", "root_id": rid,
         "rel_path": "2024/photo2.jpg", "abs_path": f"{photo_share}/2024/photo2.jpg",
         "parent_dir": "2024", "ext": ".jpg", "size": 2000, "modified": "1700000001",
         "is_canonical": 1, "content_hash": "bb22222222222222"},
        {"file_id": "cf3", "root_id": rid,
         "rel_path": "2025/photo3.jpg", "abs_path": f"{photo_share}/2025/photo3.jpg",
         "parent_dir": "2025", "ext": ".jpg", "size": 3000, "modified": "1700000002",
         "is_canonical": 1, "content_hash": "cc33333333333333"},
    ])

    db.add_photo(f"{photo_share}/2024/photo1.jpg", date="2024-01-15 10:00:00",
                 description="зимний лес", faces_present=True)
    db.add_photo(f"{photo_share}/2024/photo2.jpg", date="2024-06-20 14:30:00",
                 description="летний парк", gps={"lat": 55.75, "lon": 37.62},
                 camera={"make": "Canon", "model": "EOS R5"})
    db.add_photo(f"{photo_share}/2025/photo3.jpg", date="2025-03-01 09:00:00",
                 description="весеннее утро", faces_present=True)

    db.sqlite.execute("UPDATE photos SET root_id = ?", (rid,))
    db.sqlite.commit()

    pid = "pers1"
    db.add_persona(pid, "Иванов Иван")
    for bbox, face_id, ch in [
        ([10, 20, 100, 200], "face1", "aa11111111111111"),
        ([50, 60, 150, 250], "face2", "aa11111111111111"),
        ([30, 40, 130, 230], "face3", "cc33333333333333"),
    ]:
        db.add_face_sqlite_only(
            photo_id=f"2024/photo1.jpg" if ch == "aa11111111111111" else "2025/photo3.jpg",
            face_id=face_id, bbox=bbox, confidence=0.99,
            persona_id=pid, content_hash=ch,
        )

    from main import app
    from starlette.testclient import TestClient
    client = TestClient(app, raise_server_exceptions=False)

    yield {"db": db, "client": client, "photo_share": photo_share}

    db.sqlite.close()
    for p in cfg:
        p.stop()
    _clean()


class TestGallerySearchPage:
    """Главный экран галереи — /api/photos/search"""

    def test_search_200(self, gallery):
        """Поиск возвращает 200 на реальных данных."""
        r = gallery["client"].get("/api/photos/search?limit=60&sort=date_desc")
        assert r.status_code == 200, f"Got {r.status_code}: {r.text[:300]}"

    def test_search_returns_photo_list(self, gallery):
        """Результат содержит total >= 3 и photos длиной >= 3."""
        r = gallery["client"].get("/api/photos/search?limit=60")
        data = r.json()
        assert data["total"] >= 3
        assert len(data["photos"]) >= 3

    def test_search_photo_has_required_fields(self, gallery):
        """Каждое фото содержит все поля нужные фронтенду."""
        r = gallery["client"].get("/api/photos/search?limit=60")
        photo = r.json()["photos"][0]
        required = ["path", "photo_id", "description", "faces_present",
                    "date", "deleted", "embedded", "content_hash",
                    "personas", "faces", "is_canonical"]
        for field in required:
            assert field in photo, f"Missing field '{field}' in photo response"

    def test_search_photo_content_hash_present(self, gallery):
        """Все фото в результатах поиска имеют content_hash."""
        r = gallery["client"].get("/api/photos/search?limit=60")
        photos = r.json()["photos"]
        with_hash = [p for p in photos if p.get("content_hash")]
        assert len(with_hash) >= 3, "content_hash should be in every search result"

    def test_search_photo_faces_linked_by_content_hash(self, gallery):
        """Лица привязаны к фото через content_hash, а не photo_id."""
        r = gallery["client"].get("/api/photos/search?limit=60")
        photos = {p["path"]: p for p in r.json()["photos"]}
        p1 = photos.get(f'{gallery["photo_share"]}/2024/photo1.jpg')
        assert p1 is not None
        assert len(p1["faces"]) >= 1, f"photo1 should have faces, got {p1['faces']}"
        assert len(p1["personas"]) >= 1, f"photo1 should have personas"

    def test_search_no_deleted_photos(self, gallery):
        """Удалённые фото не показываются в результатах поиска."""
        db = gallery["db"]
        db.sqlite.execute("UPDATE photos SET deleted = 1 WHERE path LIKE '%photo2%'")
        db.sqlite.commit()
        r = gallery["client"].get("/api/photos/search?limit=60")
        paths = [p["path"] for p in r.json()["photos"]]
        assert not any("photo2" in p for p in paths)

    def test_search_text_query(self, gallery):
        """Текстовый поиск находит фото по описанию."""
        r = gallery["client"].get("/api/photos/search?q=лес&limit=60")
        assert r.status_code == 200
        assert r.json()["total"] >= 1

    def test_search_person_filter(self, gallery):
        """Фильтр по персоне находит фото с этим человеком."""
        r = gallery["client"].get("/api/photos/search?person=Иванов&limit=60")
        assert r.status_code == 200
        assert r.json()["total"] >= 1

    def test_search_has_faces_filter(self, gallery):
        """Фильтр has_faces=true: все результаты имеют faces_present=True."""
        r = gallery["client"].get("/api/photos/search?has_faces=true&limit=60")
        assert r.status_code == 200
        for p in r.json()["photos"]:
            assert p["faces_present"] is True

    def test_search_has_gps_filter(self, gallery):
        """Фильтр has_gps=true находит фото с координатами."""
        r = gallery["client"].get("/api/photos/search?has_gps=true&limit=60")
        assert r.status_code == 200
        assert r.json()["total"] >= 1

    def test_search_date_range(self, gallery):
        """Фильтр по диапазону дат корректно ограничивает результаты."""
        r = gallery["client"].get("/api/photos/search?date_from=2024-06-01&date_to=2024-06-30&limit=60")
        assert r.status_code == 200
        assert r.json()["total"] >= 1

    def test_search_deleted_only(self, gallery):
        """Фильтр deleted_only=true показывает только удалённые фото."""
        db = gallery["db"]
        db.sqlite.execute("UPDATE photos SET deleted = 1 WHERE path LIKE '%photo2%'")
        db.sqlite.commit()
        r = gallery["client"].get("/api/photos/search?deleted_only=true&limit=60")
        assert r.status_code == 200
        assert r.json()["total"] >= 1


class TestGalleryDatesPage:
    """Страница дат — /api/photos/dates"""

    def test_dates_200(self, gallery):
        """Гистограмма дат возвращает 200."""
        r = gallery["client"].get("/api/photos/dates")
        assert r.status_code == 200, f"Got {r.status_code}: {r.text[:300]}"

    def test_dates_has_years(self, gallery):
        """Год 2024 содержит ≥2 фото."""
        r = gallery["client"].get("/api/photos/dates")
        data = r.json()
        assert "years" in data
        assert "2024" in data["years"]
        assert data["years"]["2024"] >= 2

    def test_dates_no_deleted(self, gallery):
        """Удалённые фото исключены из гистограммы."""
        db = gallery["db"]
        db.sqlite.execute("UPDATE photos SET deleted = 1 WHERE path LIKE '%photo1%'")
        db.sqlite.commit()
        r = gallery["client"].get("/api/photos/dates")
        assert r.status_code == 200
        data = r.json()
        assert data["years"].get("2024", 0) < 2, "deleted photo should not be in histogram"


class TestGalleryStatusPage:
    """Страница статуса — /api/status"""

    def test_status_200(self, gallery):
        """Статус доступен."""
        r = gallery["client"].get("/api/status")
        assert r.status_code == 200

    def test_status_has_progress_fields(self, gallery):
        """Ответ содержит все поля прогресса."""
        r = gallery["client"].get("/api/status")
        data = r.json()
        for key in ["pct_ingested", "pct_described", "pct_exif", "pct_faces", "pct_embedded",
                    "catalog_total", "photos_total", "photos_described"]:
            assert key in data, f"Missing key '{key}'"

    def test_status_total_reasonable(self, gallery):
        """Счётчики catalog/photos >= 3, pct_ingested = 100%."""
        r = gallery["client"].get("/api/status")
        data = r.json()
        assert data["catalog_total"] >= 3
        assert data["photos_total"] >= 3
        assert data["pct_ingested"] == 100.0


class TestGalleryMapPage:
    """Карта — /api/photos/map"""

    def test_map_200(self, gallery):
        """Карта возвращает 200."""
        r = gallery["client"].get("/api/photos/map")
        assert r.status_code == 200, f"Got {r.status_code}: {r.text[:300]}"

    def test_map_returns_gps_photos(self, gallery):
        """Результат — список фото с lat/lon."""
        r = gallery["client"].get("/api/photos/map")
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        assert data[0]["lat"] is not None
        assert data[0]["lon"] is not None


class TestGalleryNeighbor:
    """Навигация между фото — /api/photos/neighbor"""

    def test_neighbor_next_200(self, gallery):
        """Соседнее фото вперёд доступно."""
        r = gallery["client"].get("/api/photos/neighbor?date=2024-03-01&dir=next")
        assert r.status_code == 200, f"Got {r.status_code}: {r.text[:300]}"

    def test_neighbor_prev_200(self, gallery):
        """Соседнее фото назад доступно."""
        r = gallery["client"].get("/api/photos/neighbor?date=2024-12-01&dir=prev")
        assert r.status_code == 200


class TestGalleryPhotoCRUD:
    """Операции с фото — date/gps/delete/undelete"""

    def test_set_date(self, gallery):
        """Ручная дата устанавливается и возвращает success."""
        db = gallery["db"]
        photo = db.sqlite.execute("SELECT photo_id FROM photos WHERE deleted=0 LIMIT 1").fetchone()
        r = gallery["client"].post("/api/photos/set_date", json={
            "photo_id": photo[0], "manual_date": "2024-05-01 12:00:00"
        })
        assert r.status_code == 200
        assert r.json()["success"] is True

    def test_set_gps(self, gallery):
        """GPS координаты устанавливаются через API."""
        db = gallery["db"]
        photo = db.sqlite.execute("SELECT photo_id FROM photos WHERE deleted=0 LIMIT 1").fetchone()
        r = gallery["client"].post("/api/photos/set_gps", json={
            "photo_id": photo[0], "lat": 56.0, "lon": 38.0
        })
        assert r.status_code == 200

    def test_mark_deleted_and_undelete(self, gallery):
        """Удаление и восстановление: оба возвращают 200."""
        db = gallery["db"]
        photo = db.sqlite.execute("SELECT photo_id FROM photos WHERE deleted=0 LIMIT 1").fetchone()
        pid = photo[0]
        r1 = gallery["client"].post("/api/photos/mark_deleted", json={"photo_id": pid})
        assert r1.status_code == 200
        r2 = gallery["client"].post("/api/photos/undelete", json={"photo_id": pid})
        assert r2.status_code == 200


class TestGalleryPersonPage:
    """Страница персон — /api/persons"""

    def test_persons_list_200(self, gallery):
        """Список персон — пагинированный ответ с total."""
        r = gallery["client"].get("/api/persons/")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, dict)
        assert "persons" in data
        assert data["total"] >= 1

    def test_persons_names_200(self, gallery):
        """Имена персон доступны для автокомплита."""
        r = gallery["client"].get("/api/persons/names")
        assert r.status_code == 200

    def test_person_has_faces(self, gallery):
        """Персона имеет face_count ≥ количеству привязанных лиц."""
        r = gallery["client"].get("/api/persons/")
        persons = r.json()["persons"]
        ivanov = [p for p in persons if p.get("display_name") == "Иванов Иван" or p.get("name") == "Иванов Иван"]
        assert len(ivanov) >= 1, "Иванов Иван should be in persons list"
        assert ivanov[0].get("face_count", 0) >= 3


class TestGalleryCatalogPage:
    """Страница каталога — /api/catalog"""

    def test_roots_200(self, gallery):
        """Корни каталога доступны."""
        r = gallery["client"].get("/api/catalog/roots")
        assert r.status_code == 200

    def test_stats_200(self, gallery):
        """Статистика каталога доступна."""
        r = gallery["client"].get("/api/catalog/stats")
        assert r.status_code == 200
