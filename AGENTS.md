# Gailery — Контекст проекта

## Что это
Фото-галерея, Python/FastAPI/SQLite+LanceDB, веб-фронтенд. GPU NVIDIA (проверено на P104-100, Pascal SM 6.1, 8GB VRAM).

## Текущая задача: enrich_description — обогащение описаний

### Проблема
VLM описание: "женщина в синей куртке стоит слева, мужчина в чёрной куртке в центре"
Реальность: Иванова Анна (x=723, слева), Петров Алексей (x=1033, центр), (без имени) (x=2200, справа)
Папка: "Петровы и Друзья"

Нужно: LLM берёт базовое описание + данные лиц + папку + дату → пишет обогащённое описание с именами.

### Что уже сделано
1. ✅ `rich_description` колонка в photos таблице SQLite
2. ✅ `enrich_description.py` — воркер, llama-server on-demand (порт 8103), POST /v1/chat/completions
3. ✅ API endpoint `POST /api/photos/{photo_id}/enrich` в src/api/photos.py
4. ✅ `rich_description` в ответе фото API
5. ✅ Кнопка "Обогатить описание" + отображение в detail-панели gallery.html
6. ✅ Первый рабочий тест — модель подставила имя вместо описания одежды

### Текущий промт (надо улучшать)
SYSTEM: правила замены имён, позиций, обрезания длинных списков
USER: базовое описание + папка + дата + список лиц с bbox

### Проблемы текущего промта
- Иванова Анна НЕ была подставлена (VLM написал "её лицо не видно" — модель не сопоставила)
- Папка "Петровы и Друзья" не использована в контексте
- Модель не имеет доступа к дополнительным данным в режиме размышлений

### Следующий шаг (по указанию пользователя)
Дать модели **инструменты извлечения данных** — чтобы в режиме размышлений (thinking) она могла:
- Запросить подробности о конкретном лице (сколько фото с этим persona, comment)
- Запросить контекст папки (сколько фото, какие ещё люди там)
- Посмотреть соседние фото по дате
- Использовать всё это для более точного обогащения

Это значит: модель работает в **tool-calling** режиме — llama-server поддерживает `tools` в chat/completions API.

### Архитектура решения
1. Определить набор tools (get_persona_info, get_folder_context, get_nearby_photos)
2. В enrich_description.py: отправлять промт с tools, парсить tool_calls, выполнять их через БД, возвращать результаты
3. Цикл: model → tool_call → execute → result → model (повторять пока не даст финальный ответ)
4. llama-server Qwen3.5-4B поддерживает function calling через chat template

### Ключевые файлы
- `enrich_description.py` — воркер обогащения (llama-server порт 8103, SYSTEM_PROMPT, format_faces, run_llm через API)
- `src/api/photos.py` — API endpoint enrich + rich_description в ответе
- `web/gallery.html` — кнопка + отображение rich_description (dp-desc с золотым бордером)
- `src/database.py` — DatabaseManager, все методы работы с БД
- `<GALLERY_MODELS>/Qwen3.5-4B-Q4_K_M.gguf` — текстовый LLM 2.7GB

### Данные лиц в БД
- `faces` таблица: face_id, photo_id (=format "2023/2023_06_20 - Петровы и Друзья/IMG_3617.JPG"), persona_id, bbox_x1/y1/x2/y2, confidence
- `personas` таблица: persona_id (cluster_NNN или persona_NNN), display_name, comment
- photo_id в faces = относительный путь от PHOTO_SHARE_PATH
- photo_id в photos = число (старый формат) — JOIN через photos.path LIKE '%' || faces.photo_id

### Пример данных для теста
```
PATH: <PHOTO_SHARE_PATH>/2023/2023_06_20 - Петровы и Друзья/IMG_3617.JPG
DESC: На фотографии изображены три человека, стоящие на улице в зимний период. На переднем плане слева видна женщина в синей куртке и чёрной шапке, её лицо не видно. В центре стоит мужчина в чёрной куртке и шапке...
FACES:
  Иванова Анна bbox=[723,452]-[838,605] conf=0.89
  Петров Алексей bbox=[1033,467]-[1311,800] conf=0.91
  (без имени) bbox=[2200,443]-[2441,737] conf=0.87
FOLDER: 2023/2023_06_20 - Петровы и Друзья
DATE: 2023-06-20 13:39:07
```

### Другие шаги пайплайна (уже работают быстро)
- DESCRIBE: VLM llama-server on-demand, ~7м/цикл, save=0.00s
- FACES: InsightFace GPU (onnxruntime 1.18 + cuDNN 8), ~0.9м/цикл, LanceDB optimized (2 fragments)
- EMBED: PyTorch Qwen3-Embedding-0.6B, ~1-2м/цикл
- Важно: НЕ использовать delete_photo_embedding() — только embedded=0 в SQLite

### GPU ограничения
- P104-100 Pascal SM 6.1, cuDNN 9.x НЕ работает
- onnxruntime-gpu 1.18.0 + cuDNN 8.x — работает (ldconfig настроен)
- llama.cpp — работает через custom CUDA kernels (без cuDNN)
- При запуске llama-server для enrich — GPU свободен (VLM не работает в этот момент)

### Формат промта для tool-calling
Qwen3.5-4B поддерживает функции через chat template. Формат:
```json
{"messages": [...], "tools": [{"type": "function", "function": {"name": "...", "parameters": {...}}}]}
```
Модель вернёт tool_call в ответе, нужно выполнить и вернуть tool result.

## Тестирование

### Запуск
```bash
./run_tests.sh                  # все тесты
./run_tests.sh tests/test_database.py   # только база
./run_tests.sh tests/test_api.py        # только API
```

Или напрямую:
```bash
/opt/gailray/venv/bin/python3 -m pytest tests/ -v
```

### Что покрывают (84 теста)

| Файл | Что тестирует | Кол-во |
|---|---|---|
| `test_database.py` | CRUD фото/лиц/персон/каталога, поиск, гистограммы, обновления, миграции | 42 |
| `test_middleware.py` | BFCACHE-fix middleware, SPA fallback, HEAD→GET, редиректы ошибок, маршруты страниц | 16 |
| `test_api.py` | /api/photos/search, dates, GPS, delete, persons, catalog, health, log, changes | 26 |

### Как это работает
- Тесты создают **временную БД** в `tmp_path` (pytest cleanup), продакшн-база не трогается
- Фикстуры патчат `config` и `database` модули, чтобы указывать на временные пути
- `app_client` — Starlette TestClient, делает HTTP-запросы к FastAPI app без запуска сервера

### Когда запускать
- После любых изменений в `src/database.py`, `src/main.py`, `src/api/`
- Перед коммитом — убедиться что ничего не сломано
- При обновлении зависимостей (LanceDB, FastAPI и т.д.)

## Правила
- Все изменения фиксировать в git локально
- Сервис перезапускается через `systemctl restart gailray.service`
- Работать на русском языке
- Не обрезать вывод команд
- Не downgrade пакеты без согласия
