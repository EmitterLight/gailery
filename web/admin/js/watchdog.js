// Watchdog module — сторожевой пёс (без воркеров, они в workers.js)
(function(A) {

var _crashVisible = false;
var _refreshTimer = null;

A.registerBlock('watchdog', 'Сторожевой пёс', '🐶', function(cid) { A.renderBlock_watchdog(cid); }, function(cid, d) { A.refreshBlock_watchdog(cid, d); });

function buildUI() {
    var el = A.$('page-watchdog');
    if (!el) return;
    el.innerHTML =
        '<h2 class="page-h2">🐶 Сторожевой пёс</h2>'+
        '<div id="wdBlock"></div>';
    A.renderBlock_watchdog('wdBlock');
}

A.renderBlock_watchdog = function(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var pfx = containerId;
    el.innerHTML =
        '<div class="workers-panel" style="margin-bottom:16px">'+
        '<h3>Режим <span id="wdStatusText_'+pfx+'" style="font-weight:normal;font-size:12px"></span></h3>'+
        '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:8px">'+
        '<div id="wdModeCard_'+pfx+'" class="bg-deep bd-default" style="border-radius:8px;padding:14px 20px;min-width:180px;text-align:center">'+
        '<div id="wdModeIcon_'+pfx+'" style="font-size:32px;margin-bottom:4px">🐶</div>'+
        '<div id="wdModeLabel_'+pfx+'" class="c-ok" style="font-size:14px;font-weight:bold">Активен</div>'+
        '<div id="wdModeDesc_'+pfx+'" class="c-muted" style="font-size:11px;margin-top:4px">Следит за пайплайном, перезапускает при падениях</div>'+
        '</div>'+
        '<div id="wdStats_'+pfx+'" style="display:flex;gap:8px;flex-wrap:wrap"></div>'+
        '</div>'+
        '<div style="margin-top:12px;display:flex;gap:8px">'+
        '<button class="btn btn-warn btn-sm" id="wdBtnSleep_'+pfx+'">😴 Усыпить</button>'+
        '<button class="btn btn-go btn-sm" id="wdBtnWake_'+pfx+'" disabled>⚡ Разбудить</button>'+
        '<span id="wdBtnStatus_'+pfx+'" style="font-size:11px"></span>'+
        '</div></div>'+
        '<div class="workers-panel">'+
        '<h3>Журнал срабатываний <span id="wdCrashCount_'+pfx+'" class="c-orange" style="font-weight:normal;font-size:11px"></span></h3>'+
        '<div style="margin-top:8px"><button class="btn btn-go btn-sm" id="wdBtnCrashLog_'+pfx+'">Показать журнал</button></div>'+
        '<div id="wdCrashLog_'+pfx+'" class="crash-log" style="display:none;margin-top:8px"></div>'+
        '</div>';

    var btn = document.getElementById('wdBtnCrashLog_'+pfx);
    if (btn) btn.addEventListener('click', function() { toggleCrashLog(containerId); });
    var sleepBtn = document.getElementById('wdBtnSleep_'+pfx);
    var wakeBtn = document.getElementById('wdBtnWake_'+pfx);
    if (sleepBtn) sleepBtn.addEventListener('click', function() { doWatchdogCmd(containerId, 'sleep'); });
    if (wakeBtn) wakeBtn.addEventListener('click', function() { doWatchdogCmd(containerId, 'wake'); });
    loadWatchdog(containerId);
};

A.refreshBlock_watchdog = function(containerId, d) {
    if (!d) return;
    loadWatchdog(containerId);
};

function loadWatchdog(containerId) {
    var pfx = containerId;
    A.ajax('/api/watchdog/crashes', function(d) {
        var crashes = d.crashes || [];
        var mode = d.mode || 'active';

        var icon = document.getElementById('wdModeIcon_'+pfx);
        var label = document.getElementById('wdModeLabel_'+pfx);
        var desc = document.getElementById('wdModeDesc_'+pfx);
        var card = document.getElementById('wdModeCard_'+pfx);

        if (mode === 'sleeping') {
            if (icon) icon.textContent = '😴';
            if (label) { label.textContent = 'Дремлет'; label.className = 'c-warn'; }
            if (desc) desc.textContent = 'Пёс спит — не следит и не перезапускает. Нажмите «Разбудить».';
            if (card) card.className = 'bg-deep bd-warn';
        } else {
            if (icon) icon.textContent = '🐶';
            if (label) { label.textContent = 'Активен'; label.className = 'c-ok'; }
            if (desc) desc.textContent = 'Следит за пайплайном, перезапускает при падениях';
            if (card) card.className = 'bg-deep bd-ok';
        }

        var statusText = document.getElementById('wdStatusText_'+pfx);
        if (statusText) {
        if (mode === 'sleeping') statusText.innerHTML = ' — <span class="c-warn">дремлет</span>';
        else statusText.innerHTML = ' — <span class="c-ok">активен</span>';
        }

        var sleepBtn = document.getElementById('wdBtnSleep_'+pfx);
        var wakeBtn = document.getElementById('wdBtnWake_'+pfx);
        if (mode === 'sleeping') {
            if (sleepBtn) sleepBtn.disabled = true;
            if (wakeBtn) wakeBtn.disabled = false;
        } else {
            if (sleepBtn) sleepBtn.disabled = false;
            if (wakeBtn) wakeBtn.disabled = true;
        }

        var stats = document.getElementById('wdStats_'+pfx);
        if (stats) {
            var cntCls = crashes.length > 0 ? 'c-orange' : 'c-ok';
            stats.innerHTML = '<div class="maint-sbox"><div class="sv '+cntCls+'">'+crashes.length+'</div><div class="sl">Срабатываний</div></div>';
        }

        var countEl = document.getElementById('wdCrashCount_'+pfx);
        if (countEl) countEl.textContent = crashes.length > 0 ? crashes.length+' записей' : '';

        if (A._wdCrashVisible && A._wdCrashVisible[containerId]) {
            renderCrashLog(containerId, crashes);
        }

        var info = A.$('watchdogInfo');
        if (info) {
            if (mode === 'sleeping') info.textContent = '🐶 дремлет';
            else info.textContent = '🐶 активен';
        }
    });
}

function doWatchdogCmd(containerId, cmd) {
    var pfx = containerId;
    var stEl = document.getElementById('wdBtnStatus_'+pfx);
    A.post('/api/watchdog/'+cmd, null, function(d) {
        if (d.ok) {
            if (stEl) { stEl.textContent = cmd==='sleep'?'✓ Усыплён':'✓ Разбужен'; stEl.className = 'c-ok'; }
            loadWatchdog(containerId);
        } else {
            if (stEl) { stEl.textContent = '✗ Ошибка'; stEl.className = 'c-err'; }
        }
    }, function() {
        if (stEl) { stEl.textContent = '✗ Ошибка сети'; stEl.className = 'c-err'; }
    });
    setTimeout(function() { var s = document.getElementById('wdBtnStatus_'+pfx); if (s) s.textContent = ''; }, 3000);
}

function toggleCrashLog(containerId) {
    if (!A._wdCrashVisible) A._wdCrashVisible = {};
    A._wdCrashVisible[containerId] = !A._wdCrashVisible[containerId];
    var pfx = containerId;
    var el = document.getElementById('wdCrashLog_'+pfx);
    var btn = document.getElementById('wdBtnCrashLog_'+pfx);
    if (A._wdCrashVisible[containerId]) {
        if (el) el.style.display = 'block';
        if (btn) btn.textContent = 'Скрыть журнал';
        A.ajax('/api/watchdog/crashes', function(d) {
            renderCrashLog(containerId, d.crashes || []);
        });
    } else {
        if (el) el.style.display = 'none';
        if (btn) btn.textContent = 'Показать журнал';
    }
}

function renderCrashLog(containerId, crashes) {
    var pfx = containerId;
    var el = document.getElementById('wdCrashLog_'+pfx);
    if (!el) return;
    if (crashes.length === 0) {
        el.innerHTML = '<span class="c-dim">Срабатываний нет — все процессы работают штатно</span>';
        return;
    }
    el.innerHTML = crashes.map(function(c) {
        var t = A.esc(c);
        var m = t.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
        if (m) {
            var d2 = new Date(m[1]+'Z');
            if (!isNaN(d2.getTime())) {
                var pad = function(n){return n<10?'0'+n:n;};
                var local = d2.getFullYear()+'-'+pad(d2.getMonth()+1)+'-'+pad(d2.getDate())+' '+pad(d2.getHours())+':'+pad(d2.getMinutes())+':'+pad(d2.getSeconds());
                t = t.replace(m[1], local);
            }
        }
        if (t.indexOf('LWT DEAD')>=0) return '<span class="c-err">'+t+'</span>';
        if (t.indexOf('RESTART')>=0) return '<span class="c-warn">'+t+'</span>';
        if (t.indexOf('RECOVERY')>=0) return '<span class="c-ok">'+t+'</span>';
        if (t.indexOf('STALE')>=0) return '<span class="c-orange">'+t+'</span>';
        return t;
    }).join('<br>');
}

A.on('navigate', function(page) {
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
    if (page === 'watchdog') {
        buildUI();
        _refreshTimer = setInterval(function() { loadWatchdog('wdBlock'); }, 5000);
    }
});

setInterval(function() {
    A.ajax('/api/watchdog/crashes', function(d) {
        var info = A.$('watchdogInfo');
        if (!info) return;
        if (d.mode === 'sleeping') info.textContent = '🐶 дремлет';
        else info.textContent = '🐶 активен';
    });
}, 15000);

})(window.Admin);
