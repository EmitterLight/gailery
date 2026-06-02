# Отчёт тестера: infinite scroll — задержка между батчами (~10 секунд)

## Контекст проблемы

**Задержка НЕ в рендеринге карточек внутри батча.**
Независимо от размера батча (1, 50 или 100 фото), сами фотографии грузятся и рендерятся очень быстро. Пользователь свободно скроллит внутри загруженной партии.

**Задержка МЕЖДУ батчами.**
Когда пользователь доскролливает до конца текущего батча, следующий вызов `loadAfter` стартует с **паузой ~10 секунд**. Во время этой паузы интерфейс "висит" — создаётся эффект "стены" (wall).

**Зачем pageSize=1 вместо 60:**
При батче из 60 фото пользователь тратит время на прокрутку, и 10-секундная пауза маскируется естественным скроллом. При батче из 1 фото он мгновенно доходит до конца и **видит чистую задержку** между `loadAfter` и `search resp`. Это позволяет изолировать bottleneck.

**Что именно отлавливаем:**
Производственный bottleneck — почему между запуском `loadAfter` и получением ответа `search resp` проходит ~10 секунд. Это может быть медленный SQL-запрос на бэкенде, лаг `IntersectionObserver`/`_loadIfRoom`, или задержка в сети/бекенде.

---

## Среда
- Сервер: `localhost:8000` (uvicorn Gailery)
- Браузер: Chromium на Xvfb `:98`, Playwright, viewport 2560x1440
- Контроллер: `run_chrome.py` (API на `localhost:9999`)
- База: живая БД `~/.local/share/gailery/gallery.db`

## Шаги воспроизведения

1. Запустить тестовый браузер:
```bash
cd /opt/gailray
DISPLAY=:98 ./venv/bin/python3 run_chrome.py > /tmp/run_chrome.log 2>&1 &
sleep 5
curl -s http://localhost:9999/status
# Убедиться: {"ready": true, ...}
```

2. Перейти в галерею и установить иглу времени на 2012-10-04:
```bash
curl -s -X POST http://localhost:9999/eval \
  -H "Content-Type: application/json" \
  -d '{"js": "_restoreNeedleDate = \"2012-10-04\"; doSearch(); console.log(\"[TEST] Needle set to 2012-10-04\");"}'
```

3. Подождать 4 секунды для стабилизации загрузки.

4. Снять метрики:
```bash
curl -s -X POST http://localhost:9999/eval \
  -H "Content-Type: application/json" \
  -d '{"js": "JSON.stringify({pageSize: pageSize, cards: document.querySelectorAll(\".card\").length, scrollY: window.scrollY, docH: document.documentElement.scrollHeight, vh: window.innerHeight, canLoadMore: _canLoadMore, isLoading: _isLoading, currentPhotos: currentPhotos.length, lastDate: _lastDate})"}'
```

5. Получить консольные логи:
```bash
curl -s "http://localhost:9999/logs?n=30"
```

## Фактический результат

Метрики:
```json
{
  "pageSize": 1,
  "cards": 2,
  "scrollY": 217,
  "docH": 1657,
  "vh": 1440,
  "canLoadMore": true,
  "isLoading": false,
  "currentPhotos": 2,
  "lastDate": "2012-10-04 12:02:54"
}
```

Логи (фрагмент):
```
[TEST] Needle set to 2012-10-04
[289.954s] loadAfter cursor=2012-10-04 path=
[290.663s] search resp 1p              ← загружено 1 фото
[290.663s] _applyBatch 1 photos, total=70661
[290.665s] _loadIfRoom docH=1440 vh=1440 room=100
[290.666s] loadAfter cursor=2012-10-04 12:02:54 path=DSCF0519.JPG
[290.666s] thumb start
[291.373s] thumb done
[292.720s] search resp 1p              ← загружено ещё 1 фото
[292.720s] _applyBatch 1 photos, total=70660
[292.723s] _loadIfRoom docH=1440 vh=1440 room=100
[292.724s] loadAfter cursor=2012-10-04 12:03:35 path=DSCF0520.JPG
[292.725s] thumb start
[293.433s] thumb done
```

После этого поток логов обрывается. `_loadIfRoom` видит `room=100`, но следующий `loadAfter` НЕ вызывается. В результате на экране 2 карточки, scrollY=217, высота документа 1657px, viewport 1440px. Дальнейшая загрузка не происходит ни автоматически, ни при скролле (скролл тоже не срабатывает, потому что docH почти равен vh + scrollY).

## Ожидаемый результат

При `pageSize=1` и наличии 70661 результата:
- Либо `_loadIfRoom` должен циклически догружать фото, пока `docH >= vh + 100`
- Либо скролл должен вызывать `loadAfter` при приближении к низу документа
- В итоге на экране должно быть хотя бы 5-7 фото (чтобы заполнить viewport)

## Аномалии

1. `room=100` при `docH=1440 vh=1440` — условие `docH < vh + 100` даёт `1440 < 1540` (TRUE), но загрузка не продолжается после 2-3 итераций.
2. `scrollY=217` после загрузки — документ уже "впритык" к viewport, пользователь не видит, что можно скроллить.
3. При `pageSize=60` проблема НЕ воспроизводится (60 карточек создают `docH > vh`, и `_loadIfRoom` корректно останавливается).

## Артефакты

- Скриншот: `curl -s http://localhost:9999/screenshot > /tmp/repro_screenshot.png`
- Полные логи: `curl -s "http://localhost:9999/logs?n=100" > /tmp/repro_logs.json`
- Сеть: `curl -s "http://localhost:9999/network?n=50" > /tmp/repro_network.json`

## Версии

- Файл: `web/gallery.html` (строка 907: `var pageSize = 1;` — тестовый режим)
- Коммит: `9a3c655` (infinite scroll: sentinels, month-bounded timeline)
