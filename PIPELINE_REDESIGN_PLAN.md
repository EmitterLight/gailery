# План редизайна пайплайна Gailery

**Текущий порядок:** Scan → Describe → Faces → EXIF → Embed
**Целевой порядок:** Scan → EXIF → Faces → Describe → Embed

Каждый шаг обратно совместим — система продолжает работать между шагами.

---

## Диаграмма зависимостей

```
Этап 0: Срочные баги (не зависят от редизайна, ломают текущую работу)
  0.1  describe.py NameError Ollama
  0.2  exif.py исключает видео
  0.3  scan_catalog.py stale LanceDB
  0.4  Единый VIDEO_EXTS в config.py

Этап 1: Подготовка к перестановке (каждый шаг обратно совместим)
  1.1  faces.py — скан ВСЕХ фото (faces_done=0)
  1.2  Счётчики прогресса для Faces
  1.3  describe.py — контекст лиц в промпте
  1.4  describe — не перезаписывать faces_present
  1.5  Каскад инвалидации при изменении персон
  1.6  exif.py — SQL JOIN вместо N+1

Этап 2: Перестановка (ключевой шаг)
  2.1  pipeline.py — новый порядок шагов

Этап 3: Доводка
  3.1  Watchdog — убийство сирот llama-server
  3.2  Очистка мёртвого кода (верхнерегистровые расширения)
  3.3  Документация (AGENTS.md + PIPELINE.md)
```

---

## Этап 0: Срочные баги

> Не зависят от редизайна. Ломают текущую работу. Можно делать в любом порядке.

### 0.1 describe.py — NameError в Ollama-режиме

**Подтверждено.** `describe.py:268` — `described += 1`, `272` — `failed += 1` используются без инициализации в `_main_ollama()`. NameError при первом успешном описании.

**Исправление:**
```python
# Добавить после строки 249 (total = len(prepared)):
described = 0
failed = 0
```

**Файл:** `describe.py:249`

---

### 0.2 exif.py — видео исключены из EXIF-обработки

**Подтверждено.** `exif.py:299` — SQL `WHERE exif_checked = 0 AND (media_type IS NULL OR media_type != 'video')` исключает видео. Код обработки видео (строки 340-370) через `video_metadata` недостижим.

**Исправление:** Убрать фильтр `media_type != 'video'` из SQL. При этом:
- Видео с `media_type IS NULL` (ещё не распознанные) попадут в выборку
- Видео с `media_type = 'video'` тоже попадут — получат дату/длительность/кодек через ffprobe
- Фото обрабатываются как раньше через exifread

**Файл:** `exif.py:299`

---

### 0.3 scan_catalog.py — stale-эмбеддинги не удаляются из LanceDB

**Подтверждено.** `_mark_stale()` (`scan_catalog.py:253-259`) ставит `embedded=0` в SQLite, но не вызывает `db.delete_photo_embedding()`. Старый вектор остаётся в LanceDB до следующей итерации pipeline (dedup).

**Исправление:** Добавить в `_mark_stale()`:
```python
photo = db.get_photo_by_path(abs_path)
if photo and photo.get("embedded"):
    try:
        db.delete_photo_embedding(photo["photo_id"])
    except Exception:
        pass
```

**Файл:** `scan_catalog.py:253-259`

---

### 0.4 Единый VIDEO_EXTS в config.py

**Подтверждено, критично.** 3 разных набора в 7 файлах:

| Набор | Расширения | Где используется |
|---|---|---|
| **Минимальный (7)** | `.mp4 .mov .avi .mkv .webm .3gp .wmv` | scan_catalog.py:245, database.py:1154 |
| **Расширенный (13)** | минимальный + `.mpg .mpeg .m4v .flv .vob .ts` | scan_catalog.py:294, faces.py:131, vision_describe.py:458 |
| **Photos (9, сломан!)** | `.avi .3gp .wmv .mpg .mpeg .flv .m4v .mov .mkv` | photos.py:140 (НЕТ .mp4 и .webm!) |
| **Pipeline (13+верх.рег)** | расширенный + `.MP4 .MOV...` | pipeline.py:104 |

**Доп. проблема:** Верхнерегистровые `.MP4 .MOV` в SUPPORTED_EXTS (`scan_catalog.py:29`), `thumbnails.py:28`, `exif.py:341` — **мёртвый код**, т.к. сравнение идёт через `.lower()`.

**Исправление:**
1. Добавить в `config.py`:
```python
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".3gp", ".wmv",
              ".mpg", ".mpeg", ".m4v", ".flv", ".vob", ".ts"}
```
2. Заменить все локальные наборы на `from config import VIDEO_EXTS`
3. Убрать мёртвые верхнерегистровые варианты
4. Исправить photos.py:140 (добавить `.mp4`, `.webm`, `.vob`, `.ts`)

**Файлы:** `config.py`, `scan_catalog.py`, `exif.py`, `faces.py`, `vision_describe.py`, `pipeline.py`, `database.py`, `thumbnails.py`, `photos.py`

---

## Этап 1: Подготовка к перестановке

> Каждый шаг обратно совместим. Система работает как раньше между шагами.

### 1.1 faces.py — сканирование ВСЕХ фото (faces_done=0 вместо faces_present=1)

**Зачем:** Сделать Faces независимым от Describe. InsightFace надёжнее VLM для детекции лиц.

**Что менять:**
- `get_undetected_photos()`: заменить `p.faces_present = 1` на `cf.faces_done = 0` (исключая видео)
- `run_detection()`: после обработки фото с 0 лиц → ставить `faces_done=1, faces_present=0`
- `run_detection()`: после обработки фото с N лиц → ставить `faces_done=1, faces_present=1` (уже ставится через update_photo)
- Добавить вызов `db.update_catalog_file_by_path(path, faces_done=1)` для ВСЕХ обработанных фото (и с лицами, и без)

**Обратная совместимость:** В текущем порядке (Describe→Faces) describe ставит `faces_done=int(has_faces)`. Если VLM сказал нет лиц → faces_done=0 → faces.py обработает и проверит InsightFace. Если InsightFace найдёт лица — исправит faces_present. Это улучшение даже при старом порядке.

**Файлы:** `faces.py:52-78` (get_undetected_photos), `faces.py:81-227` (run_detection)

---

### 1.2 Обновить счётчики прогресса для Faces

**Зачем:** Faces теперь обрабатывает ВСЕ фото, а не только faces_present=1.

**Что менять:**
- `pipeline.py get_progress()`: faces считать как `faces_done / canonical_photos` (не `faces_done / faces_flagged`)
- faces_total = canonical фото (не видео), faces_done = canonical с `cf.faces_done=1`
- Убрать отдельный `faces_pending` счётчик (больше не нужен)

**Файлы:** `pipeline.py:79-130` (get_progress)

---

### 1.3 describe.py/vision_describe.py — контекст лиц в промпте

**Зачем:** VLM получает имена + позиции лиц → «Мария и Иван за столом» вместо «двое людей».

**Что менять:**
- Перед описанием каждого фото: запросить из БД лица (faces + personas) по content_hash
- Если есть лица с именами — добавить в user message: «На фото обнаружено N лиц: Мария (слева, 30% ширины), Иван (справа, 25% ширины). Используй имена в описании.»
- Если лица без имён — добавить: «На фото обнаружено N лиц без имён»
- Если лиц нет — текущий промпт без изменений

**Новый хелпер:** `_get_face_context(content_hash, db)` → строка с лицами и позициями

**Позиция из bbox:**
```python
def bbox_to_position(bbox, img_width):
    x_center = (bbox[0] + bbox[2]) / 2 / img_width
    if x_center < 0.33: return "слева"
    elif x_center > 0.67: return "справа"
    else: return "в центре"
```

**Обратная совместимость:** В текущем порядке (Describe до Faces) — лицо-данных ещё нет, промпт без изменений. После перестановки — данные будут.

**Файлы:** `vision_describe.py:155-184` (describe_one), `describe.py:86-111` (_describe_ollama_request)

---

### 1.4 describe — не перезаписывать faces_present если Faces уже отработал

**Зачем:** InsightFace — ground truth. VLM не должен перетирать faces_present если faces_done=1.

**Что менять:**
- В `vision_describe.py save_description()`: проверять faces_done из catalog_files
- Если `faces_done=1` → не обновлять `faces_present` (InsightFace уже определил)
- Если `faces_done=0` → обновлять `faces_present` из VLM как раньше (fallback)
- То же в `describe.py _save_description()`

**Обратная совместимость:** Если Faces не отработал — describe ставит faces_present как раньше. Если Faces отработал — VLM не перетирает.

**Файлы:** `vision_describe.py:365-384` (save_description), `describe.py:114-121` (_save_description)

---

### 1.5 Каскад инвалидации при изменении персон

**Зачем:** Переименовали «Мария» → «Маша» → описания с «Мария» устарели → нужно переописать.

**Текущее состояние (проверено):**
- `update_persona` (rename) — инвалидация **НЕ вызывается** нигде (ни в persons.py, ни в pipeline.py)
- `merge_personas` — вызывается `invalidate_embeddings_for_persona()`, но **только сброс embed**, без сброса description
- `delete_persona` — инвалидация **НЕ вызывается**
- `assign face to persona` — инвалидация **НЕ вызывается**

**Что менять:**
- Переименовать и расширить `invalidate_embeddings_for_persona()` → `invalidate_for_persona()` в database.py:
  - Сброс description: `photos SET description=NULL, embedded=0` для затронутых фото
  - Сброс catalog_files: `described=0, embedded=0`
  - Удаление из LanceDB (уже делается)
- В `pipeline.py _execute_db_cmd()`:
  - Для `update_persona`: вызывать `invalidate_for_persona(persona_id)`
  - Для `merge_personas`: вызывать `invalidate_for_persona(target)` (уже вызывается, расширить)
- В `src/api/persons.py`:
  - Для `update_persona`: добавить вызов `invalidate_for_persona()` (сейчас не вызывается!)
  - Для `merge_personas`: уже вызывается, расширить метод

**Файлы:** `src/database.py:1086-1102`, `pipeline.py:308-330`, `src/api/persons.py:32-51`

---

### 1.6 exif.py — SQL JOIN вместо N+1 canonical

**Зачем:** Текущий код делает `db.is_path_canonical(r[1])` для каждого фото в Python-цикле. JOIN с catalog_files быстрее.

**Что менять:**
```python
# Было:
rows = db.sqlite.execute(
    "SELECT photo_id, path FROM photos WHERE exif_checked = 0 ...").fetchall()
need_exif = [{"photo_id": r[0], "path": r[1]} for r in rows if db.is_path_canonical(r[1])]

# Стало:
rows = db.sqlite.execute(
    "SELECT p.photo_id, p.path FROM photos p "
    "JOIN catalog_files cf ON cf.abs_path = p.path AND cf.is_canonical = 1 AND cf.deleted = 0 "
    "WHERE p.exif_checked = 0 AND p.deleted = 0 ...").fetchall()
need_exif = [{"photo_id": r[0], "path": r[1]} for r in rows]
```

**Файл:** `exif.py:298-301`

---

## Этап 2: Перестановка (ключевой шаг)

### 2.1 pipeline.py — новый порядок шагов

**Зачем:** Собственно редизайн — EXIF до GPU, Faces до Describe.

**Что менять:**
- Переставить блоки в главном цикле pipeline.py:
  1. Scan (без изменений)
  2. EXIF (перенести из позиции 4 в позицию 2) — `run_step("EXIF", ...)` без GPU
  3. Faces (перенести из позиции 3 в позицию 3, но после EXIF) — GPU
  4. Describe (перенести из позиции 2 в позицию 4) — GPU, с контекстом лиц
  5. Embed (без изменений) — GPU
- Обновить docstring: `Chain: Ingest -> EXIF -> Faces -> Describe -> Embed`
- Маркировка видео `[видео]` остаётся перед describe (шаг 4)

**Новый код (псевдокод):**
```python
# 1. SCAN
run_step("QUICK SCAN", scan_args)
if stopped(): break
progress = get_progress()

# 2. EXIF (без GPU, сразу после скана)
if progress["exif"][2] < 100:
    run_step("EXIF", [VENV_PYTHON, f"{SCRIPTS_DIR}/exif.py", "--all"])
    if stopped(): break
    progress = get_progress()

# 3. FACES (GPU, InsightFace быстрый)
if progress["faces"][2] < 100:
    kill_orphan_llama_servers()
    run_step("FACES", [VENV_PYTHON, f"{SCRIPTS_DIR}/faces.py"])
    if stopped(): break
    progress = get_progress()

# 4. DESCRIBE (GPU, llama медленный, получает контекст лиц)
if progress["describe"][2] < 100:
    # видео → [видео]
    db = get_db()
    _cur = db.sqlite.execute("UPDATE photos SET description='[видео]' WHERE media_type='video' AND (description IS NULL OR description='') AND deleted=0")
    ...
    kill_orphan_llama_servers()
    run_step("DESCRIBE", [VENV_PYTHON, f"{SCRIPTS_DIR}/describe.py", ...])
    if stopped(): break
    progress = get_progress()

# 5. EMBED (GPU, собирает все данные)
if progress["embed"][2] < 100:
    kill_orphan_llama_servers()
    run_step("EMBED", [VENV_PYTHON, f"{SCRIPTS_DIR}/embed.py"])
    if stopped(): break
```

**Файлы:** `pipeline.py:494-554` (главный цикл), `pipeline.py:5` (docstring)

---

## Этап 3: Доводка

### 3.1 Watchdog — убийство сирот llama-server

**Зачем:** Pipeline крашится → llama-server-сирота жрёт VRAM → следующий шаг не может запуститься.

**Что менять:**
- Добавить `"llama-server"` в `WORKER_PROCESSES` в watchdog.py
- В `check_orphan_workers()`: убивать llama-server с ppid=1
- Только когда watchdog активен (no_restart не стоит)

**Файлы:** `watchdog.py:44` (WORKER_PROCESSES), `watchdog.py:180-205` (check_orphan_workers)

---

### 3.2 Очистка мёртвого кода (верхнерегистровые расширения)

**Зачем:** `.MP4 .MOV .AVI` и т.д. в SUPPORTED_EXTS — мёртвый код. Сравнение через `.lower()` никогда не совпадёт с верхним регистром.

**Что менять:**
- Убрать верхнерегистровые варианты из всех наборов после введения единого VIDEO_EXTS
- `scan_catalog.py:29` — убрать `.MP4, .MOV, .AVI, .MKV, .WEBM, .3GP, .WMV`
- `thumbnails.py:28` — убрать верхнерегистровые
- `exif.py:341` — убрать верхнерегистровые
- `pipeline.py:104` — убрать верхнерегистровые

---

### 3.3 Документация

**Зачем:** Синхронизировать AGENTS.md с PIPELINE.md (рецензия 05_идеальный_PIPELINE.md).

**Что менять:**
- AGENTS.md: обновить порядок шагов в описании пайплайна
- AGENTS.md: добавить SQLite-арбитраж
- AGENTS.md: добавить каскад при изменении персоны
- Проверить что PIPELINE.md и AGENTS.md не противоречат друг другу

**Файлы:** `AGENTS.md`

---

## Порядок выполнения

```
ЭТАП 0 — Срочные баги (любой порядок, ~1.5ч):
  0.1  describe.py NameError Ollama                     [5мин]
  0.2  exif.py — включить видео                          [15мин]
  0.3  scan_catalog.py — stale LanceDB                   [15мин]
  0.4  config.py — единый VIDEO_EXTS                     [30мин]

ЭТАП 1 — Подготовка (строго по порядку, ~8-12ч):
  1.1  faces.py — faces_done=0 вместо faces_present=1    [2-4ч]
  1.2  Счётчики прогресса для Faces                      [30мин]
  1.3  describe — контекст лиц в промпте                 [3-5ч]
  1.4  describe — не перетирать faces_present             [30мин]
  1.5  Каскад инвалидации персон                          [2-3ч]
  1.6  exif.py — SQL JOIN вместо N+1                      [15мин]

ЭТАП 2 — Перестановка (зависит от этапа 1):
  2.1  pipeline.py — новый порядок шагов                  [30мин]

ЭТАП 3 — Доводка (любой порядок, ~30мин):
  3.1  Watchdog — сироты llama-server                     [15мин]
  3.2  Очистка мёртвого кода                              [10мин]
  3.3  Документация                                       [15мин]

ИТОГО: ~10-14 часов
```

---

## Верификация утверждений рецензии

| # | Утверждение рецензии | Результат проверки | Детали |
|---|---|---|---|
| 1 | describe.py NameError Ollama | **ПОДТВЕРЖДЕНО** | `described`, `failed` не инициализированы в `_main_ollama()` (строки 268, 272) |
| 2 | exif.py исключает видео | **ПОДТВЕРЖДЕНО** | SQL фильтр `media_type != 'video'` (строка 299), видео-код (340-370) недостижим |
| 3 | scan_catalog.py stale LanceDB | **ПОДТВЕРЖДЕНО** | `_mark_stale()` ставит `embedded=0` в SQLite, но не удаляет вектор из LanceDB |
| 4 | Несогласованные VIDEO_EXTS | **ПОДТВЕРЖДЕНО** | 3 разных набора в 7 файлах; photos.py сломан (нет .mp4/.webm) |
| 5 | Мёртвые верхнерегистровые .MP4 | **ПОДТВЕРЖДЕНО** | `Path(fn).suffix.lower()` в scan_catalog.py:124,136 — никогда не совпадёт с .MP4 |
| 6 | exif.py N+1 canonical | **ПОДТВЕРЖДЕНО** | `db.is_path_canonical(r[1])` в цикле (строка 301) вместо SQL JOIN |
| 7 | faces.py зависит от faces_present | **ПОДТВЕРЖДЕНО** | `get_undetected_photos()` фильтрует `p.faces_present = 1` (строка 58) |
| 8 | describe без контекста лиц | **ПОДТВЕРЖДЕНО** | Ни describe.py, ни vision_describe.py не запрашивают faces/personas |
| 9 | Нет каскада при rename | **ПОДТВЕРЖДЕНО** | `update_persona` в persons.py:32-43 — НЕ вызывает инвалидацию; merge — вызывает только для embed |
