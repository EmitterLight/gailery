// Ollama module — extended with model checking
(function(A) {

var _ollamaOk = false;
var REQUIRED_MODELS = [
    {name:'qwen3-embedding:0.6b', purpose:'Семантическая индексация'},
    {name:'qwen3.5:4b', purpose:'Описание фото / Обогащение'},
];

A.registerBlock('ollama', 'Ollama', '🦙', function(cid) { A.renderBlock_ollama(cid); });

function buildUI() {
    var el = A.$('page-ollama');
    if (!el) return;
    el.innerHTML =
        '<h2 class="page-h2">🦙 Ollama</h2>'+
        '<div id="ollamaBlock"></div>';
    A.renderBlock_ollama('ollamaBlock');
}

A.renderBlock_ollama = function(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    var pfx = 'ol_'+containerId+'_';
    el.innerHTML =
        '<div class="mdl-token-box">'+
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">'+
        '<input id="'+pfx+'url" class="mdl-input" style="min-width:280px" placeholder="http://ollama.localnet:11434">'+
        '<button class="btn btn-go" id="'+pfx+'checkBtn" style="white-space:nowrap">Проверить</button>'+
        '<span id="'+pfx+'status" style="font-size:11px"></span></div>'+
        '<div id="'+pfx+'serverInfo" style="font-size:12px;margin-bottom:8px"></div>'+
        '<div id="'+pfx+'modelsSec" style="display:none"><div id="'+pfx+'modelChecks"></div></div>'+
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;margin-top:8px">'+
        '<label class="c-muted" style="font-size:11px">Embed модель:</label>'+
        '<input id="'+pfx+'embedModel" class="mdl-input" style="min-width:180px" value="qwen3-embedding:0.6b"></div>'+
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">'+
        '<label class="c-muted" style="font-size:11px">Describe модель:</label>'+
        '<input id="'+pfx+'descModel" class="mdl-input" style="min-width:180px" value="qwen3.5:4b"></div>'+
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">'+
        '<label class="c-muted" style="font-size:11px">Chunk size:</label>'+
        '<input id="'+pfx+'chunk" class="mdl-input" style="min-width:80px" value="128" type="number"></div>'+
        '<button class="btn btn-go" id="'+pfx+'saveBtn" style="display:none">Сохранить</button>'+
        '<span id="'+pfx+'saveStatus" style="font-size:11px;margin-left:8px"></span>'+
        '<div id="'+pfx+'modelsList" style="margin-top:12px"></div></div>';

    document.getElementById(pfx+'checkBtn').addEventListener('click', function() { ollamaCheck(containerId); });
    document.getElementById(pfx+'saveBtn').addEventListener('click', function() { ollamaSave(containerId); });

    A.ajax('/api/config', function(cfg) {
        var g = (cfg.groups||[]).find(function(x) { return x.name==='Ollama'; });
        var items = g ? g.items||[] : [];
        var u = items.find(function(x) { return x.key==='ollama_base_url'; });
        var e = items.find(function(x) { return x.key==='ollama_embed_model'; });
        var d = items.find(function(x) { return x.key==='ollama_describe_model'; });
        var c = items.find(function(x) { return x.key==='ollama_embed_chunk'; });
        if (u) { var inp = document.getElementById(pfx+'url'); if (inp) inp.value = u.value; }
        if (e) { var inp = document.getElementById(pfx+'embedModel'); if (inp) inp.value = e.value; }
        if (d) { var inp = document.getElementById(pfx+'descModel'); if (inp) inp.value = d.value; }
        if (c) { var inp = document.getElementById(pfx+'chunk'); if (inp) inp.value = c.value; }
    });
};

function ollamaCheck(cid) {
    var pfx = 'ol_'+cid+'_';
    var info = document.getElementById(pfx+'serverInfo');
    var sec = document.getElementById(pfx+'modelsSec');
    var chk = document.getElementById(pfx+'modelChecks');
    var saveBtn = document.getElementById(pfx+'saveBtn');
    var urlInp = document.getElementById(pfx+'url');
    var url = urlInp ? urlInp.value : '';
    if (!url) { if (info) info.innerHTML = '<span class="c-err">Укажите URL сервера</span>'; return; }

    if (info) info.innerHTML = '<span class="c-info">Проверяю...</span>';
    if (sec) sec.style.display = 'none';
    if (saveBtn) saveBtn.style.display = 'none';
    _ollamaOk = false;

    A.ajax('/api/proxy/ollama_check?url='+encodeURIComponent(url), function(ver) {
        if (!ver.ok) {
            if (info) info.innerHTML = '<span class="c-err">✗ Сервер недоступен: '+A.esc(ver.error||'нет ответа')+'</span>';
            return;
        }
        if (info) info.innerHTML = '<span class="c-ok">✓ Доступен</span> — v'+A.esc(ver.version);

        A.ajax('/api/proxy/ollama_models?url='+encodeURIComponent(url), function(d) {
            if (!d || !d.models) d = {models:[]};
            var names = {};
            d.models.forEach(function(m) { names[m.name] = m; });

            var h = '<table class="ollama-table">';
            h += '<tr><th>Модель</th><th>Назначение</th><th>Статус</th></tr>';
            var allOk = true;
            REQUIRED_MODELS.forEach(function(req) {
                var found = names[req.name];
                if (found) {
                    h += '<td>'+A.esc(req.name)+'</td><td class="c-muted">'+req.purpose+'</td><td><span class="c-ok">✓ '+fmtBytesStr(found.size)+'</span></td>';
                } else {
                    allOk = false;
                    h += '<td>'+A.esc(req.name)+'</td><td class="c-muted">'+req.purpose+'</td><td><span class="c-err">✗ Нет</span></td>';
                }
            });
            h += '</table>';
            if (chk) chk.innerHTML = h;
            if (sec) sec.style.display = 'block';
            _ollamaOk = allOk;
            if (allOk) {
                if (info) info.innerHTML += ' <span class="c-ok" style="margin-left:8px">Все модели на месте</span>';
                if (saveBtn) saveBtn.style.display = 'inline-block';
            } else {
                if (info) info.innerHTML += ' <span class="c-warn" style="margin-left:8px">Не хватает моделей</span>';
                if (saveBtn) saveBtn.style.display = 'none';
            }
        }, function(e) {
            if (info) info.innerHTML = '<span class="c-err">✗ Ошибка: '+e+'</span>';
        });
    }, function(e) {
        if (info) info.innerHTML = '<span class="c-err">✗ Нет ответа от сервера</span>';
    });
}

function ollamaSave(cid) {
    var pfx = 'ol_'+cid+'_';
    var el = document.getElementById(pfx+'saveStatus');
    if (el) { el.textContent = 'Сохраняю...'; el.className = 'c-info'; }
    var vals = [
        ['ollama_base_url', (document.getElementById(pfx+'url')||{}).value||''],
        ['ollama_embed_model', (document.getElementById(pfx+'embedModel')||{}).value||''],
        ['ollama_describe_model', (document.getElementById(pfx+'descModel')||{}).value||''],
        ['ollama_embed_chunk', parseInt((document.getElementById(pfx+'chunk')||{}).value||'128')]
    ];
    var done = 0;
    vals.forEach(function(p) {
        A.put('/api/settings/'+p[0], {value:p[1]}, function() {
            done++;
            if (done===vals.length) {
                if (el) { el.textContent = '✓ Сохранено'; el.className = 'c-ok'; }
                setTimeout(function() { if (el) el.textContent = ''; }, 3000);
            }
        });
    });
}

function fmtBytesStr(b) {
    if (!b) return '?';
    var u = ['B','KB','MB','GB'], i = 0;
    while (b>=1024 && i<3) { b/=1024; i++; }
    return b.toFixed(1)+' '+u[i];
}

A.on('navigate', function(page) {
    if (page==='ollama') buildUI();
});

})(window.Admin);
