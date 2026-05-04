// Dashboard module
(function(A) {

var _timer = null;

function buildUI() {
    var el = A.$('page-dashboard');
    if (!el) return;
    el.innerHTML =
        '<h2 style="margin-bottom:16px;font-size:16px;color:#e6edf3">📊 Дашборд</h2>'+
        '<div class="card-grid big">'+
        '<div class="card" id="dashStatus"></div>'+
        '<div class="card" id="dashProgress"></div></div>'+
        '<div class="workers-panel" id="dashWorkersPanel"><h3>🔌 Воркеры MQTT</h3><div class="workers-grid" id="dashWorkers">—</div></div>'+
        '<div class="card"><h3>📋 Последние события</h3><div class="log-lines" id="dashEvents">Загрузка...</div></div>';
}

function render() {
    var d = A.st || {};
    var sec = A.$('dashStatus');
    if (sec) {
        var run = d.current_step !== 'idle';
        sec.innerHTML =
            '<h3>📡 Статус</h3>'+
            '<div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">'+
            '<div class="metric'+(run?'':' warn')+'"><div class="val">'+(run?'Активен':'Остановлен')+'</div><div class="lbl">пайплайн — '+A.esc(d.current_step||'idle')+'</div></div>'+
            '<div class="metric"><div class="val">'+(d.photos_total||0).toLocaleString()+'</div><div class="lbl">фото</div></div>'+
            '<div class="metric"><div class="val">'+(d.faces_total||0).toLocaleString()+'</div><div class="lbl">лиц</div></div>'+
            '<div class="metric"><div class="val">'+(d.personas_total||0).toLocaleString()+'</div><div class="lbl">персон</div></div></div>';
    }

    var pr = A.$('dashProgress');
    if (pr) {
        var bars = [
            {l:'Наполнение', p:d.pct_ingested, d:d.catalog_ingested||0, t:d.catalog_total||1},
            {l:'Описание', p:d.pct_described, d:d.photos_described||0, t:d.photos_total||1},
            {l:'Лица', p:d.pct_faces, d:d.catalog_faces_done||0, t:d.photos_faces_flagged||1},
            {l:'EXIF', p:d.pct_exif, d:d.catalog_exif_done||0, t:d.photos_total||1},
            {l:'Семант.индекс', p:d.pct_embedded, d:d.photos_embedded||0, t:d.photos_total||1},
        ];
        pr.innerHTML = '<h3>📈 Прогресс</h3>' + bars.map(function(b) {
            return '<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:11px">'+
            '<span>'+b.l+'</span><span>'+b.d+' / '+b.t+' ('+A.fmtPct(b.p)+')</span></div>'+
            '<div class="progress-bar"><div class="fill" style="width:'+b.p+'%"></div></div></div>';
        }).join('');
    }

    var ev = A.$('dashEvents');
    if (ev) {
        A.ajax('/api/log?lines=20', function(data) {
            var lines = (data.lines||[]).filter(function(l) {
                return /\[(PIPELINE|DESCRIBE|FACES|EMBED|WATCHDOG)\].*?(DONE|done|FAILED|START|Clustering|запускаю)/.test(l);
            });
            ev.innerHTML = '<pre style="margin:0;white-space:pre-wrap;font-size:11px;line-height:1.5">'+A.esc(lines.join('\n'))+'</pre>';
        }, function() { ev.textContent = '⚠ лог недоступен'; });
    }

    A.ajax('/api/mqtt/workers', function(d) {
        A.renderWorkerCards('dashWorkers', d.workers || {});
    });

    var ms = A.$('mqttSummary');
    if (ms) {
        var proc = d.processes || {};
        var map = {vlm:'describe',face_pipeline:'faces',embed:'embed'};
        var active = [];
        for (var k in map) if (proc[k]) active.push(map[k]);
        ms.innerHTML = active.map(function(n) { return '<span class="w run">⚡ '+n+'</span>'; }).join('') || '<span style="color:#6e7681">idle</span>';
    }
}

function startPolling() {
    if (_timer) clearInterval(_timer);
    loadStatus();
    _timer = setInterval(loadStatus, 3000);
}

function stopPolling() {
    if (_timer) { clearInterval(_timer); _timer = null; }
}

function loadStatus() {
    A.ajax('/api/status', function(d) {
        A.st = d;
        render();
    });
}

A.on('navigate', function(page) {
    if (page === 'dashboard') { buildUI(); startPolling(); }
    else { stopPolling(); }
});

})(window.Admin);
