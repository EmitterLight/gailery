// Ollama module — URL from /api/settings, auto-check on load
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
        '<div class="maint-sec"><h3>🤖 Сервер Ollama</h3>'+
        '<div class="maint-row">'+
        '<label style="width:100px;font-size:12px;line-height:28px">URL сервера</label>'+
        '<input id="'+pfx+'url" class="mdl-input" style="flex:1;max-width:350px" placeholder="http://ollama.localnet:11434">'+
        '<button class="btn btn-go" id="'+pfx+'checkBtn">🔍 Проверить</button>'+
        '<button class="btn btn-go" id="'+pfx+'saveBtn" style="display:none">💾 Сохранить</button>'+
        '<span id="'+pfx+'saveStatus" class="c-dim" style="font-size:12px"></span></div>'+
        '<div id="'+pfx+'serverInfo" class="c-dim" style="margin-top:8px;font-size:12px"></div></div>'+
        '<div class="maint-sec" id="'+pfx+'modelsSec" style="display:none"><h3>📖 Проверка моделей</h3>'+
        '<div id="'+pfx+'modelChecks" style="font-size:12px"></div></div>'+
        '<div class="maint-sec" style="margin-top:12px"><h3>⚙️ Настройки моделей</h3>'+
        '<div class="maint-row" style="margin-top:8px">'+
        '<label class="c-muted" style="font-size:12px;width:120px">Embed модель:</label>'+
        '<input id="'+pfx+'embedModel" class="mdl-input" style="min-width:180px" value="qwen3-embedding:0.6b"></div>'+
        '<div class="maint-row" style="margin-top:6px">'+
        '<label class="c-muted" style="font-size:12px;width:120px">Describe модель:</label>'+
        '<input id="'+pfx+'descModel" class="mdl-input" style="min-width:180px" value="qwen3.5:4b"></div>'+
        '<div class="maint-row" style="margin-top:6px">'+
        '<label class="c-muted" style="font-size:12px;width:120px">Chunk size:</label>'+
        '<input id="'+pfx+'chunk" class="mdl-input" style="min-width:80px" value="128" type="number"></div>'+
        '<button class="btn btn-go" id="'+pfx+'saveModelsBtn" style="margin-top:8px">Сохранить настройки моделей</button>'+
        '<span id="'+pfx+'modelSaveStatus" style="font-size:12px;margin-left:8px"></span></div>';

    document.getElementById(pfx+'checkBtn').addEventListener('click', function() { ollamaCheck(containerId); });
    document.getElementById(pfx+'saveBtn').addEventListener('click', function() { ollamaSaveUrl(containerId); });
    document.getElementById(pfx+'saveModelsBtn').addEventListener('click', function() { ollamaSaveModels(containerId); });

    A.ajax('/api/settings/ollama_base_url', function(v) {
        var url = (v && v.value) || '';
        var inp = document.getElementById(pfx+'url');
        if (inp && url) {
            inp.value = url;
            ollamaCheck(containerId);
        }
    });
    A.ajax('/api/settings/ollama_embed_model', function(v) {
        if (v && v.value) { var inp = document.getElementById(pfx+'embedModel'); if (inp) inp.value = v.value; }
    });
    A.ajax('/api/settings/ollama_describe_model', function(v) {
        if (v && v.value) { var inp = document.getElementById(pfx+'descModel'); if (inp) inp.value = v.value; }
    });
    A.ajax('/api/settings/ollama_embed_chunk', function(v) {
        if (v && v.value) { var inp = document.getElementById(pfx+'chunk'); if (inp) inp.value = v.value; }
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
                    h += '<tr><td>'+A.esc(req.name)+'</td><td class="c-muted">'+req.purpose+'</td><td style="text-align:center"><span class="c-ok">✓ '+fmtBytesStr(found.size)+'</span></td></tr>';
                } else {
                    allOk = false;
                    h += '<tr><td>'+A.esc(req.name)+'</td><td class="c-muted">'+req.purpose+'</td><td style="text-align:center"><span class="c-err">✗ Нет</span></td></tr>';
                    h += '<tr><td colspan="3" style="padding:0 8px 8px"><span class="c-warn" style="font-size:11px">Администратору сервера Ollama:<br><code>ollama pull '+A.esc(req.name)+'</code></span></td></tr>';
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

function ollamaSaveUrl(cid) {
    var pfx = 'ol_'+cid+'_';
    var url = (document.getElementById(pfx+'url')||{}).value||'';
    var el = document.getElementById(pfx+'saveStatus');
    if (el) { el.textContent = 'Сохраняю...'; el.className = 'c-info'; }
    A.put('/api/settings/ollama_base_url', {value:url}, function() {
        if (el) { el.textContent = '✓ Сохранено'; el.className = 'c-ok'; }
        setTimeout(function() { if (el) el.textContent = ''; }, 3000);
    }, function() {
        if (el) { el.textContent = 'Ошибка'; el.className = 'c-err'; }
    });
}

function ollamaSaveModels(cid) {
    var pfx = 'ol_'+cid+'_';
    var el = document.getElementById(pfx+'modelSaveStatus');
    if (el) { el.textContent = 'Сохраняю...'; el.className = 'c-info'; }
    var vals = [
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
