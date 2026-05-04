// Logs module
(function(A) {

var _logFilter = '';

function buildUI() {
    var el = A.$('page-logs');
    if (!el) return;
    el.innerHTML =
        '<h2 style="margin-bottom:16px;font-size:16px;color:#e6edf3">📋 Логи</h2>'+
        '<div class="log-sec"><h3>Лог <span id="logInfo"></span></h3>'+
        '<div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;align-items:center">'+
        '<input id="logFilter" type="text" placeholder="Фильтр..." class="log-filter-input">'+
        '<button class="fbtn" data-f="DESCRIBE">VLM</button>'+
        '<button class="fbtn" data-f="FACES">Лица</button>'+
        '<button class="fbtn" data-f="EMBED">Индекс</button>'+
        '<button class="fbtn" data-f="PIPELINE">Пайплайн</button>'+
        '<button class="fbtn" data-f="ENRICH">Обогащ.</button>'+
        '<button class="fbtn fbtn-err" data-f="ERROR,FAILED">Ошибки</button>'+
        '<button class="fbtn fbtn-all" data-f="">Все</button></div>'+
        '<div id="logC"></div></div>';

    // Hook up filter buttons
    A.$$('#page-logs .fbtn').forEach(function(b) {
        b.addEventListener('click', function() {
            A._setLogFilter(this.getAttribute('data-f'));
        });
    });

    // Hook up text filter
    A.$('logFilter').addEventListener('input', function() {
        var v = this.value.trim();
        if (!v) { _logFilter = ''; A.$$('.fbtn').forEach(function(b){b.classList.remove('active');}); }
        else { _logFilter = v; A.$$('.fbtn').forEach(function(b){b.classList.remove('active');}); }
        loadLog();
    });

    loadLog();
}

A._setLogFilter = function(f) {
    _logFilter = f;
    A.$('logFilter').value = f.indexOf(',')>=0 ? '' : f;
    A.$$('.fbtn').forEach(function(b) { b.classList.toggle('active', b.getAttribute('data-f')===f); });
    applyLogFilter();
};

function applyLogFilter() {
    var el = A.$('logC');
    if (!el) return;
    if (!_logFilter) {
        el.querySelectorAll('.ll').forEach(function(s){s.style.display='';});
        updateLogInfo(el);
        return;
    }
    var terms = _logFilter.toUpperCase().split(',');
    el.querySelectorAll('.ll').forEach(function(s) {
        var txt = s.textContent.toUpperCase();
        var show = terms.some(function(t) { return t && txt.indexOf(t)>=0; });
        s.style.display = show ? '' : 'none';
    });
    updateLogInfo(el);
}

function updateLogInfo(el) {
    var total = el ? (el.getAttribute('data-total')||'0') : '0';
    var shown = el ? el.querySelectorAll('.ll').length : 0;
    var visible = _logFilter ? (el?el.querySelectorAll('.ll:not([style*="display: none"])').length:0) : shown;
    var info = A.$('logInfo');
    if (info) info.textContent = _logFilter ? visible+'/'+shown+'/'+total : shown+'/'+total;
}

function loadLog() {
    A.ajax('/api/log?lines=2000', function(d) {
        var el = A.$('logC');
        if (!el) return;
        var wasBot = el.scrollTop+el.clientHeight >= el.scrollHeight-20;
        var h = '';
        for (var i=0;i<d.lines.length;i++) {
            var t = d.lines[i].replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\r/g,'');
            var m = t.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
            if (m) {
                var d2 = new Date(m[1]+'Z');
                if (!isNaN(d2.getTime())) {
                    var pad = function(n){return n<10?'0'+n:n;};
                    var local = d2.getFullYear()+'-'+pad(d2.getMonth()+1)+'-'+pad(d2.getDate())+' '+pad(d2.getHours())+':'+pad(d2.getMinutes())+':'+pad(d2.getSeconds());
                    t = t.replace(m[1], local);
                }
            }
            var cls = 'll';
            if (t.indexOf('[DESCRIBE]')>=0) cls += ' l-DESCRIBE';
            else if (t.indexOf('[FACES]')>=0) cls += ' l-FACES';
            else if (t.indexOf('[EXIF]')>=0) cls += ' l-EXIF';
            else if (t.indexOf('[EMBED]')>=0) cls += ' l-EMBED';
            else if (t.indexOf('[PIPELINE]')>=0) cls += ' l-PIPELINE';
            else if (t.indexOf('[INGEST]')>=0) cls += ' l-INGEST';
            else if (t.indexOf('[ENRICH]')>=0) cls += ' l-ENRICH';
            else if (t.indexOf('[WATCHDOG]')>=0) cls += ' l-WATCHDOG';
            if (t.indexOf('FAILED')>=0||t.indexOf('ERROR')>=0) cls += ' l-error';
            if (t.indexOf('DONE')>=0||t.indexOf('START')>=0) cls += ' l-DONE';
            h += '<div class="'+cls+'">'+t+'</div>';
        }
        el.innerHTML = h;
        el.setAttribute('data-total', d.total);
        var info = A.$('logInfo');
        if (info) info.textContent = _logFilter ? '?/'+d.lines.length+'/'+d.total : d.lines.length+'/'+d.total;
        if (wasBot) el.scrollTop = el.scrollHeight;
        applyLogFilter();
        updateLogInfo(el);
    });
}

A.on('navigate', function(page) {
    if (page==='logs') buildUI();
});

setInterval(function() {
    var el = A.$('page-logs');
    if (el && el.classList.contains('active')) loadLog();
}, 5000);

})(window.Admin);