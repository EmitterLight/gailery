// Ollama module — extended with model checking
(function(A) {

var _ollamaOk = false;
var REQUIRED_MODELS = [
    {name:'qwen3-embedding:0.6b', purpose:'Семантическая индексация'},
    {name:'qwen3.5:4b', purpose:'Описание фото / Обогащение'},
];

function buildUI() {
    var el = A.$('page-ollama');
    if (!el) return;
    el.innerHTML =
        '<h2 style="margin-bottom:16px;font-size:16px;color:#e6edf3">🦙 Ollama</h2>'+
        '<div class="mdl-token-box">'+
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">'+
        '<input id="ollamaUrl" class="mdl-input" style="min-width:280px" placeholder="http://ollama.localnet:11434">'+
        '<button class="btn btn-go" id="ollamaCheckBtn" style="white-space:nowrap">Проверить</button>'+
        '<span id="ollamaStatus" style="font-size:11px"></span></div>'+
        '<div id="ollamaServerInfo" style="font-size:12px;margin-bottom:8px"></div>'+
        '<div id="ollamaModelsSec" style="display:none"><div id="ollamaModelChecks"></div></div>'+
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;margin-top:8px">'+
        '<label style="font-size:11px;color:#8b949e">Embed модель:</label>'+
        '<input id="ollamaEmbedModel" class="mdl-input" style="min-width:180px" value="qwen3-embedding:0.6b"></div>'+
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">'+
        '<label style="font-size:11px;color:#8b949e">Describe модель:</label>'+
        '<input id="ollamaDescModel" class="mdl-input" style="min-width:180px" value="qwen3.5:4b"></div>'+
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">'+
        '<label style="font-size:11px;color:#8b949e">Chunk size:</label>'+
        '<input id="ollamaChunk" class="mdl-input" style="min-width:80px" value="128" type="number"></div>'+
        '<button class="btn btn-go" id="ollamaSaveBtn" style="display:none">Сохранить</button>'+
        '<span id="ollamaSaveStatus" style="font-size:11px;margin-left:8px"></span>'+
        '<div id="ollamaModelsList" style="margin-top:12px"></div></div>';

    A.$('ollamaCheckBtn').addEventListener('click', ollamaCheck);
    A.$('ollamaSaveBtn').addEventListener('click', ollamaSave);

    // Load saved values
    A.ajax('/api/config', function(cfg) {
        var g = (cfg.groups||[]).find(function(x) { return x.name==='Ollama'; });
        var items = g ? g.items||[] : [];
        var u = items.find(function(x) { return x.key==='ollama_base_url'; });
        var e = items.find(function(x) { return x.key==='ollama_embed_model'; });
        var d = items.find(function(x) { return x.key==='ollama_describe_model'; });
        var c = items.find(function(x) { return x.key==='ollama_embed_chunk'; });
        if (u) A.$('ollamaUrl').value = u.value;
        if (e) A.$('ollamaEmbedModel').value = e.value;
        if (d) A.$('ollamaDescModel').value = d.value;
        if (c) A.$('ollamaChunk').value = c.value;
    });
}

function ollamaCheck() {
    var info = A.$('ollamaServerInfo');
    var sec = A.$('ollamaModelsSec');
    var chk = A.$('ollamaModelChecks');
    var saveBtn = A.$('ollamaSaveBtn');
    var url = A.$('ollamaUrl').value;
    if (!url) { if (info) info.innerHTML = '<span style="color:#f85149">Укажите URL сервера</span>'; return; }

    if (info) info.innerHTML = '<span style="color:#58a6ff">Проверяю...</span>';
    if (sec) sec.style.display = 'none';
    if (saveBtn) saveBtn.style.display = 'none';
    _ollamaOk = false;

    A.ajax('/api/proxy/ollama_check?url='+encodeURIComponent(url), function(ver) {
        if (!ver.ok) {
            if (info) info.innerHTML = '<span style="color:#f85149">✗ Сервер недоступен: '+A.esc(ver.error||'нет ответа')+'</span>';
            return;
        }
        if (info) info.innerHTML = '<span style="color:#3fb950">✓ Доступен</span> — v'+A.esc(ver.version);

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
                    h += '<td>'+A.esc(req.name)+'</td><td style="color:#8b949e">'+req.purpose+'</td><td><span style="color:#3fb950">✓ '+fmtBytesStr(found.size)+'</span></td>';
                } else {
                    allOk = false;
                    h += '<td>'+A.esc(req.name)+'</td><td style="color:#8b949e">'+req.purpose+'</td><td><span style="color:#f85149">✗ Нет</span></td>';
                }
            });
            h += '</table>';
            if (chk) chk.innerHTML = h;
            if (sec) sec.style.display = 'block';
            _ollamaOk = allOk;
            if (allOk) {
                if (info) info.innerHTML += ' <span style="color:#3fb950;margin-left:8px">Все модели на месте</span>';
                if (saveBtn) saveBtn.style.display = 'inline-block';
            } else {
                if (info) info.innerHTML += ' <span style="color:#d29922;margin-left:8px">Не хватает моделей</span>';
                if (saveBtn) saveBtn.style.display = 'none';
            }
        }, function(e) {
            if (info) info.innerHTML = '<span style="color:#f85149">✗ Ошибка: '+e+'</span>';
        });
    }, function(e) {
        if (info) info.innerHTML = '<span style="color:#f85149">✗ Нет ответа от сервера</span>';
    });
}

function ollamaSave() {
    var el = A.$('ollamaSaveStatus');
    if (el) { el.textContent = 'Сохраняю...'; el.style.color = '#58a6ff'; }
    var vals = [
        ['ollama_base_url', A.$('ollamaUrl').value],
        ['ollama_embed_model', A.$('ollamaEmbedModel').value],
        ['ollama_describe_model', A.$('ollamaDescModel').value],
        ['ollama_embed_chunk', parseInt(A.$('ollamaChunk').value)]
    ];
    var done = 0;
    vals.forEach(function(p) {
        A.put('/api/settings/'+p[0], {value:p[1]}, function() {
            done++;
            if (done===vals.length) {
                if (el) { el.textContent = '✓ Сохранено'; el.style.color = '#3fb950'; }
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