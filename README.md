# Gailery — Локальная AI-фотогалерея

Локальная фотогалерея с AI-описанием, распознаванием лиц, кластеризацией персон и семантическим поиском. Работает на одной GPU (проверено на NVIDIA P104-100, Pascal SM 6.1, 8GB VRAM).

## Возможности

- **AI-описание фото** — VLM генерирует описания на русском языке
- **Обогащение описаний** — LLM подставляет имена людей, события из папок (tool-calling)
- **Детекция лиц** — InsightFace (GPU): детекция + 512-dim эмбеддинги
- **Кластеризация персон** — DBSCAN инкрементально, существующие персоны не пересчитываются
- **Семантический поиск** — векторный поиск по смыслу описания
- **Текстовый поиск** — SQL LIKE по описаниям
- **EXIF-метаданные** — дата, GPS, камера
- **GPS-карта** — Leaflet + markercluster
- **Веб-интерфейс** — галерея с таймлайном, слайдшоу, тёмная/светлая тема

## Стек

| Компонент | Технология |
|-----------|------------|
| Backend | Python 3.12, FastAPI, Uvicorn |
| БД | SQLite + LanceDB (векторы) |
| VLM | Qwen3.5-4B GGUF через llama-server |
| Эмбеддинги | Qwen3-Embedding-0.6B (PyTorch CUDA) |
| Лица | InsightFace buffalo_l (onnxruntime-gpu) |
| Миниатюры | pyvips (WebP) |
| Frontend | Vanilla HTML/CSS/JS, Leaflet.js |

---

## Установка и развёртывание

### 1. Системные требования

- **ОС**: Ubuntu 22.04+ / Debian 12+
- **GPU**: NVIDIA с CUDA support, минимум 6GB VRAM (проверено на P104-100 8GB)
- **CUDA**: 12.x (Toolkit установлен)
- **Python**: 3.12
- **RAM**: 8GB+
- **Диск**: ~10GB под модели + место под миниатюры и БД

### 2. Клонирование

```bash
git clone https://github.com/YOU/gailery.git /opt/gailery
cd /opt/gailery
```

### 3. Переменные окружения

```bash
cp .env.example .env
```

Отредактируйте `.env`:

```bash
# Обязательные — укажите ваши пути:
PHOTO_SHARE_PATH=/path/to/your/photos      # Корневая папка с фотографиями
GALLERY_DATA_DIR=/opt/gailery/data          # SQLite + LanceDB
GALLERY_THUMBNAILS_DIR=/opt/gailery/thumbnails
GALLERY_LOGS_DIR=/opt/gailery/logs
LLAMA_CPP_DIR=/opt/llama.cpp                # Папка куда собран llama.cpp
GALLERY_VENV_PYTHON=/opt/gailery/venv/bin/python3
```

### 4. Python-окружение

```bash
python3 -m venv /opt/gailery/venv
source /opt/gailery/venv/bin/activate
pip install --upgrade pip wheel setuptools
pip install -r requirements.txt
```

> **Важно для onnxruntime-gpu**: Pascal (SM 6.1) требует cuDNN 8.x. cuDNN 9.x не работает.
> Пакет `nvidia.cudnn` версии 8 ставится через pip (см. ниже про cuDNN).

### 5. Сборка llama.cpp

llama-server используется для VLM описаний, обогащения текстов и эмбеддингов поиска.

```bash
git clone https://github.com/ggml-org/llama.cpp.git /opt/llama.cpp
cd /opt/llama.cpp

# Сборка с CUDA (без cuDNN — кастомные CUDA kernels)
cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release -j$(nproc)
```

После сборки бинарник: `/opt/llama.cpp/build/bin/llama-server`

Проверьте что `LLAMA_CPP_DIR` в `.env` указывает на папку сборки (скрипты ищут `LLAMA_CPP_DIR/build/bin/llama-server`).

### 6. Скачивание моделей

Все GGUF-модели кладутся в `/opt/gailery/gguf/`:

```bash
mkdir -p /opt/gailery/gguf
```

#### 6.1. Qwen3.5-4B — VLM описание + LLM обогащение (2 файла)

Основная мультимодальная модель для описания фото и обогащения текстов:

```bash
cd /opt/gailery/gguf

# Основная модель (Q4_K_M, ~2.7GB)
wget https://huggingface.co/Qwen/Qwen3.5-4B-GGUF/resolve/main/qwen3.5-4b-q4_k_m.gguf \
     -O Qwen3.5-4B-Q4_K_M.gguf

# Мультимодальный проектор (BF16, ~675MB) — нужен только для VLM описания
wget https://huggingface.co/Qwen/Qwen3.5-4B-GGUF/resolve/main/mmproj-BF16.gguf \
     -O mmproj-BF16.gguf
```

#### 6.2. Qwen3-Embedding-0.6B — семантический поиск и эмбеддинги

Используется в двух форматах:
- **PyTorch** (HuggingFace) — для батч-эмбеддингов в пайплайне
- **GGUF** — для on-demand поиска через llama-server

```bash
# GGUF для поиска (~1.2GB)
cd /opt/gailery/gguf
wget https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/main/qwen3-embedding-0.6b-f16.gguf \
     -O Qwen3-Embedding-0.6B-F16.gguf

# PyTorch модель — скачивается автоматически при первом запуске embed.py
# Либо заранее через huggingface-cli:
pip install huggingface_hub
huggingface-cli download Qwen/Qwen3-Embedding-0.6B
```

#### 6.3. InsightFace — детекция лиц

Модели InsightFace скачиваются автоматически при первом запуске `faces.py` в `~/.insightface/models/`.

Если авто-скачивание не работает (нет интернета на сервере):

```bash
mkdir -p ~/.insightface/models/buffalo_l
cd ~/.insightface/models/buffalo_l

wget https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip
unzip buffalo_l.zip && rm buffalo_l.zip
```

### 7. cuDNN 8 для onnxruntime-gpu (Pascal)

onnxruntime-gpu 1.18.0 требует cuDNN 8 (не 9). Ставится через pip:

```bash
pip install nvidia.cudnn==8.9.7.29
```

Нужно прописать путь в ldconfig чтобы onnxruntime нашёл библиотеку:

```bash
echo "/opt/gailery/venv/lib/python3.12/site-packages/nvidia/cudnn/lib" > /etc/ld.so.conf.d/gailery-cudnn.conf
echo "/opt/gailery/venv/lib/python3.12/site-packages/nvidia/cublas/lib" >> /etc/ld.so.conf.d/gailery-cudnn.conf
ldconfig
```

### 8. Создание директорий

```bash
mkdir -p /opt/gailery/{data,thumbnails,logs}
```

### 9. systemd сервис (опционально)

```bash
cat > /etc/systemd/system/gailery.service << 'EOF'
[Unit]
Description=Gailery Photo Gallery API
After=network.target

[Service]
EnvironmentFile=/opt/gailery/.env
Type=simple
User=root
WorkingDirectory=/opt/gailery/src
Environment="PATH=/opt/gailery/venv/bin:/usr/bin:/bin"
Environment="PYTHONPATH=/opt/gailery/src"
ExecStart=/opt/gailery/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=10
StandardOutput=append:/opt/gailery/logs/gailery.log
StandardError=append:/opt/gailery/logs/gailery-error.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable gailery
systemctl start gailery
```

### 10. Первый запуск

```bash
source /opt/gailery/venv/bin/activate
export PYTHONPATH=/opt/gailery/src

# 1. Сканирование фото-коллекции
python scan_catalog.py --scan

# 2. Наполнение БД (первые 100 фото для проверки)
python ingest.py --random 100

# 3. EXIF-метаданные
python exif.py --all

# 4. AI-описание (VLM, ~7 мин на 100 фото)
python describe.py --limit 100

# 5. Детекция лиц
python faces.py

# 6. Эмбеддинги для поиска
python embed.py

# 7. Миниатюры
python generate_thumbnails.py

# 8. Обработка всей коллекции
python pipeline.py
```

Галерея доступна: `http://YOUR_SERVER:8000/gallery`

### Проверка установки

```bash
# API статус
curl http://localhost:8000/api/status

# GPU доступность
nvidia-smi
python -c "import torch; print('CUDA:', torch.cuda.is_available())"

# onnxruntime
python -c "import onnxruntime; print('ORT:', onnxruntime.get_available_providers())"

# Модели на месте
ls /opt/gailery/gguf/
```

---

## Пайплайн обработки

```
scan_catalog → ingest → describe (VLM) → faces (InsightFace) → exif → embed
```

GPU используется по очереди: VLM → InsightFace → PyTorch. Одновременно только один GPU-процесс.

## API

### Фото
- `GET /api/photos/search` — текстовый поиск (q, persona, date, sort, limit)
- `GET /api/photos/semantic_search` — семантический поиск
- `GET /api/photos/dates` — гистограмма по годам
- `GET /api/photos/thumbnail?path=&size=` — миниатюра
- `GET /api/photos/face/{face_id}` — кроп лица
- `POST /api/photos/{id}/enrich` — обогащение описания
- `PUT /api/photos/{id}/rich_description` — сохранение описания

### Персоны
- `GET /api/persons` — список персон
- `POST /api/persons/{id}/name` — установить имя
- `POST /api/persons/merge` — объединить персоны

### Управление
- `POST /api/control/start` — запуск пайплайна
- `POST /api/control/stop` — остановка

## Веб-страницы

| Страница | Назначение |
|----------|-----------|
| `/gallery` | Галерея: сетка, поиск, таймлайн, слайдшоу |
| `/persons` | Персоны: имена, превью лиц |
| `/control` | Управление пайплайном |
| `/catalog` | Каталог источников |
| `/map` | GPS-карта |
| `/log` | Лог пайплайна |

## Структура проекта

```
gailery/
├── src/
│   ├── main.py                  # FastAPI приложение
│   ├── database.py              # DatabaseManager (SQLite + LanceDB)
│   ├── config.py                # Конфигурация (env vars)
│   ├── cluster_personas.py      # Кластеризация DBSCAN
│   ├── thumbnails.py            # pyvips миниатюры
│   ├── persona.py               # Persona CRUD
│   └── api/
│       ├── photos.py            # Фото API
│       ├── persons.py           # Персоны API
│       └── catalog.py           # Каталог API
├── web/                         # HTML-страницы
├── gguf/                        # GGUF модели (not in git)
├── data/                        # SQLite + LanceDB (not in git)
├── venv/                        # Python venv (not in git)
├── thumbnails/                  # WebP миниатюры (not in git)
├── logs/                        # Логи (not in git)
├── pipeline.py                  # Оркестратор пайплайна
├── ingest.py                    # Наполнение БД
├── describe.py                  # Оркестратор VLM
├── vision_describe.py           # VLM описания (llama-server)
├── faces.py                     # InsightFace + кластеризация
├── exif.py                      # EXIF-метаданные
├── embed.py                     # PyTorch эмбеддинги
├── enrich_description.py        # LLM обогащение (tool-calling)
├── scan_catalog.py              # Скан каталога
├── generate_thumbnails.py       # Генерация миниатюр
├── .env.example                 # Шаблон окружения
└── AGENTS.md                    # Контекст для AI-агентов
```

## Известные ограничения

- **Pascal SM 6.1**: cuDNN 9.x не работает, нужен 8.x; torch.compile не работает (Triton требует SM 70+)
- **GPU разделена**: VLM, InsightFace, PyTorch, llama-server — работают по очереди
- **Семантический поиск**: паузит пайплайн, стартует llama-server для эмбеддингов
