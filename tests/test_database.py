import pytest


class TestDatabaseInit:
    def test_creates_tables(self, db):
        """При инициализации создаются все необходимые таблицы."""
        cur = db.sqlite.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row[0] for row in cur.fetchall()}
        assert "photos" in tables
        assert "faces" in tables
        assert "personas" in tables
        assert "catalog_roots" in tables
        assert "catalog_files" in tables
        assert "changes" in tables

    def test_migrations_applied(self, db):
        """Миграции добавили колонки manual_gps, manual_date, deleted."""
        cur = db.sqlite.cursor()
        cur.execute("PRAGMA table_info(photos)")
        columns = {row[1] for row in cur.fetchall()}
        assert "manual_gps" in columns
        assert "manual_date" in columns
        assert "deleted" in columns


class TestPhotoCRUD:
    def test_add_photo(self, db):
        """Добавление фото сохраняет путь и описание."""
        pid = db.add_photo("/test/photo.jpg", date="2024-01-01 12:00:00",
                           description="тест")
        assert pid
        photo = db.get_photo(pid)
        assert photo is not None
        assert photo["path"] == "/test/photo.jpg"
        assert photo["description"] == "тест"

    def test_add_photo_with_gps(self, db):
        """Добавление фото с GPS сохраняет координаты."""
        pid = db.add_photo("/gps.jpg", gps={"lat": 55.75, "lon": 37.62})
        photo = db.get_photo(pid)
        assert abs(photo["gps_lat"] - 55.75) < 0.01

    def test_add_photo_with_camera(self, db):
        """Добавление фото с информацией о камере сохраняет марку."""
        pid = db.add_photo("/cam.jpg", camera={"make": "Nikon", "model": "D850"})
        photo = db.get_photo(pid)
        assert photo["camera_make"] == "Nikon"

    def test_get_photo_nonexistent(self, db):
        """Запрос несуществующего фото возвращает None без ошибок."""
        assert db.get_photo("nonexistent-id") is None

    def test_get_photo_by_path(self, db):
        """Поиск фото по пути находит только что добавленное."""
        db.add_photo("/unique/path.jpg", date="2024-01-01")
        photo = db.get_photo_by_path("/unique/path.jpg")
        assert photo is not None

    def test_count_photos(self, db):
        """Счётчик фото правильно считает добавленные записи."""
        db.add_photo("/1.jpg")
        db.add_photo("/2.jpg")
        assert db.count_photos() == 2

    def test_get_all_photos(self, db):
        """get_all_photos возвращает только canonical файлы из catalog."""
        db.add_catalog_root("r1", "/test", alias="test")
        db.add_catalog_files_batch([
            {"file_id": "f1", "root_id": "r1", "rel_path": "a.jpg", "abs_path": "/a.jpg", "ext": ".jpg", "is_canonical": 1},
            {"file_id": "f2", "root_id": "r1", "rel_path": "b.jpg", "abs_path": "/b.jpg", "ext": ".jpg", "is_canonical": 1},
        ])
        db.add_photo("/a.jpg")
        db.add_photo("/b.jpg")
        all_photos = db.get_all_photos()
        assert len(all_photos) == 2


class TestPhotoSearch:
    def test_search_basic(self, db_with_photos):
        """Базовый поиск возвращает фото и корректный total."""
        total, photos = db_with_photos.search_photos(limit=10)
        assert total >= 3
        assert len(photos) >= 1

    def test_search_by_text(self, db_with_photos):
        """Поиск по тексту находит фото с указанным словом в описании."""
        total, photos = db_with_photos.search_photos(q="зимний")
        assert total >= 1
        assert "зимний" in photos[0]["description"]

    def test_search_with_faces_filter(self, db_with_photos):
        """Фильтр has_faces=True возвращает только фото с лицами."""
        total, photos = db_with_photos.search_photos(has_faces=True)
        assert total >= 1
        for p in photos:
            assert p["faces_present"] == 1

    def test_search_with_gps_filter(self, db_with_photos):
        """Фильтр has_gps=True находит фото с координатами."""
        total, photos = db_with_photos.search_photos(has_gps=True)
        assert total >= 1

    def test_search_date_range(self, db_with_photos):
        """Фильтр по диапазону дат ограничивает результаты."""
        total, photos = db_with_photos.search_photos(
            date_from="2024-01-01", date_to="2024-12-31")
        assert total >= 1

    def test_search_sort_asc(self, db_with_photos):
        """Сортировка date_asc: более ранние фото идут первыми."""
        total, photos = db_with_photos.search_photos(sort="date_asc", limit=10)
        if len(photos) >= 2:
            assert photos[0]["date"] <= photos[1]["date"]

    def test_search_sort_desc(self, db_with_photos):
        """Сортировка date_desc: более поздние фото идут первыми."""
        total, photos = db_with_photos.search_photos(sort="date_desc", limit=10)
        if len(photos) >= 2:
            assert photos[0]["date"] >= photos[1]["date"]

    def test_search_by_person(self, db_with_photos):
        """Поиск по имени персоны находит фото с этим человеком."""
        db_with_photos.add_persona("p1", "cluster_1", display_name="Анна")
        db_with_photos.add_face_sqlite_only(
            "/photos/2024/img1.jpg", [100, 200, 300, 400], 0.95, persona_id="p1")
        total, photos = db_with_photos.search_photos(person="Анна")
        assert total >= 1


class TestDateHistogram:
    def test_histogram(self, db_with_photos):
        """Гистограмма дат содержит структуру years+months и корректный total."""
        hist = db_with_photos.get_date_histogram()
        assert "years" in hist
        assert "months" in hist
        assert "total" in hist
        assert hist["total"] >= 3


class TestPhotoUpdate:
    def test_update_description(self, db):
        """Обновление description меняет значение в базе."""
        pid = db.add_photo("/up.jpg", description="старое")
        db.update_photo(pid, description="новое")
        photo = db.get_photo(pid)
        assert photo["description"] == "новое"

    def test_update_rich_description(self, db):
        """Обновление rich_description отдельно от обычного."""
        pid = db.add_photo("/rich.jpg")
        db.update_photo(pid, rich_description="обогащённое описание")
        photo = db.get_photo(pid)
        assert photo["rich_description"] == "обогащённое описание"

    def test_soft_delete(self, db):
        """Мягкое удаление: deleted=1, запись остаётся."""
        pid = db.add_photo("/del.jpg")
        db.update_photo(pid, deleted=1)
        photo = db.get_photo(pid)
        assert photo["deleted"] == 1

    def test_update_manual_date(self, db):
        """Ручная дата сохраняется отдельно от автоматической."""
        pid = db.add_photo("/md.jpg", date="2024-01-01 12:00:00")
        db.update_photo(pid, manual_date="2023-06-15 10:00:00")
        photo = db.get_photo(pid)
        assert photo["manual_date"] == "2023-06-15 10:00:00"


class TestFaceCRUD:
    def test_add_face(self, db):
        """Добавление лица к фото возвращает face_id."""
        pid = db.add_photo("/face_test.jpg")
        fid, inserted = db.add_face_sqlite_only(
            pid, [100, 200, 300, 400], 0.9, persona_id="p1")
        assert fid
        assert inserted

    def test_add_face_duplicate_ignored(self, db):
        """Повторное добавление того же face_id игнорируется."""
        pid = db.add_photo("/face_dup.jpg")
        fid1, ins1 = db.add_face_sqlite_only(pid, [10, 20, 30, 40], 0.8, face_id="face123")
        fid2, ins2 = db.add_face_sqlite_only(pid, [10, 20, 30, 40], 0.8, face_id="face123")
        assert ins1 is True
        assert ins2 is False

    def test_get_face(self, db):
        """Получение лица по id возвращает корректную confidence."""
        pid = db.add_photo("/gf.jpg")
        fid, _ = db.add_face_sqlite_only(pid, [50, 60, 150, 200], 0.95)
        face = db.get_face(fid)
        assert face is not None
        assert face["confidence"] == 0.95

    def test_get_faces_for_photo(self, db):
        """Все лица одного фото возвращаются одним запросом."""
        pid = db.add_photo("/fph.jpg")
        db.add_face_sqlite_only(pid, [10, 20, 30, 40], 0.9)
        db.add_face_sqlite_only(pid, [100, 200, 300, 400], 0.85)
        faces = db.get_faces_for_photo(pid)
        assert len(faces) == 2

    def test_count_faces(self, db):
        """Счётчик лиц корректно учитывает добавленные записи."""
        pid = db.add_photo("/cf.jpg")
        db.add_face_sqlite_only(pid, [10, 20, 30, 40], 0.9)
        assert db.count_faces() >= 1


class TestPersonaCRUD:
    def test_add_persona(self, db):
        """Добавление персоны с именем успешно."""
        ok = db.add_persona("p1", "cluster_1", display_name="Иван")
        assert ok

    def test_add_persona_duplicate_ignored(self, db):
        """Дубликат persona_id не создаёт вторую запись."""
        db.add_persona("p1", "cluster_1", display_name="Иван")
        db.add_persona("p1", "cluster_1", display_name="Иван")
        all_p = db.get_all_personas()
        assert sum(1 for p in all_p if p["persona_id"] == "p1") == 1

    def test_get_persona(self, db):
        """Получение персоны по id возвращает display_name."""
        db.add_persona("p2", "cluster_2", display_name="Мария")
        p = db.get_persona("p2")
        assert p["display_name"] == "Мария"

    def test_get_all_personas(self, db):
        """Все персоны возвращаются списком."""
        db.add_persona("p3", "cluster_3")
        db.add_persona("p4", "cluster_4")
        all_p = db.get_all_personas()
        assert len(all_p) >= 2

    def test_update_persona(self, db):
        """Обновление display_name и comment персоны."""
        db.add_persona("p5", "cluster_5")
        result = db.update_persona("p5", display_name="Пётр", comment="друг")
        assert result["display_name"] == "Пётр"
        assert result["comment"] == "друг"

    def test_update_persona_clear_name(self, db):
        """Очистка display_name через clear_display_name=True."""
        db.add_persona("p6", "cluster_6", display_name="Старое")
        result = db.update_persona("p6", clear_display_name=True)
        assert result["display_name"] is None

    def test_get_display_names(self, db):
        """Список имён содержит display_name всех персон."""
        db.add_persona("p7", "cluster_7", display_name="Анна")
        db.add_persona("p8", "cluster_8", display_name="Борис")
        names = db.get_display_names()
        assert "Анна" in names
        assert "Борис" in names

    def test_get_personas_by_name(self, db):
        """Поиск персон по имени находит все с одинаковым именем."""
        db.add_persona("p9", "cluster_9", display_name="Общее имя")
        db.add_persona("p10", "cluster_10", display_name="Общее имя")
        result = db.get_personas_by_name("Общее имя")
        assert len(result) == 2

    def test_merge_personas(self, db):
        """Слияние переносит лица из source в target, source удаляется."""
        db.add_persona("src", "src_cluster", display_name="Старое")
        db.add_persona("tgt", "tgt_cluster", display_name="Новое")
        pid = db.add_photo("/merge.jpg")
        db.add_face_sqlite_only(pid, [10, 20, 30, 40], 0.9, persona_id="src")
        ok = db.merge_personas("src", "tgt")
        assert ok
        assert db.get_persona("src") is None
        faces = db.get_faces_for_persona("tgt")
        assert len(faces) >= 1

    def test_face_count_map(self, db):
        """face_count_map возвращает количество лиц по persona_id."""
        db.add_persona("fc1", "fc_cluster1")
        pid = db.add_photo("/fc.jpg")
        db.add_face_sqlite_only(pid, [10, 20, 30, 40], 0.9, persona_id="fc1")
        db.add_face_sqlite_only(pid, [100, 200, 300, 400], 0.8, persona_id="fc1")
        m = db.face_count_map()
        assert m.get("fc1") == 2


class TestCatalogCRUD:
    def test_add_root(self, db):
        """Добавление корня каталога с alias."""
        db.add_catalog_root("r1", "/mnt/photos", alias="Фотки")
        root = db.get_catalog_root("r1")
        assert root["alias"] == "Фотки"

    def test_get_roots(self, db):
        """Список корней возвращает все добавленные."""
        db.add_catalog_root("r2", "/mnt/photos2")
        roots = db.get_catalog_roots()
        assert len(roots) >= 1

    def test_delete_root(self, db):
        """Удаление корня: после удаления get возвращает None."""
        db.add_catalog_root("r3", "/tmp/x")
        db.delete_catalog_root("r3")
        assert db.get_catalog_root("r3") is None

    def test_add_catalog_files_batch(self, db):
        """Пакетное добавление файлов каталога."""
        db.add_catalog_root("r4", "/mnt/test")
        db.add_catalog_files_batch([
            {"file_id": "f1", "root_id": "r4", "rel_path": "img.jpg",
             "abs_path": "/mnt/test/img.jpg", "parent_dir": "/mnt/test",
             "ext": ".jpg", "size": 1000}
        ])
        files = db.get_catalog_files(root_id="r4")
        assert len(files) == 1

    def test_count_catalog_files(self, db):
        """Счётчик файлов с WHERE-условием."""
        db.add_catalog_root("r5", "/mnt/count")
        db.add_catalog_files_batch([
            {"file_id": "f2", "root_id": "r5", "rel_path": "a.jpg",
             "abs_path": "/mnt/count/a.jpg", "parent_dir": "/mnt/count",
             "ext": ".jpg", "size": 500},
            {"file_id": "f3", "root_id": "r5", "rel_path": "b.jpg",
             "abs_path": "/mnt/count/b.jpg", "parent_dir": "/mnt/count",
             "ext": ".jpg", "size": 600},
        ])
        assert db.count_catalog_files(where="root_id='r5'") == 2
