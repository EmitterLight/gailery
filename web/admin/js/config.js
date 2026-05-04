// Config module: config, models, family
(function(A) {

// ═══════ CONFIG ═══════
function buildConfig() {
    var el = A.$('page-config');
    if (!el) return;
    el.innerHTML = '<h2 style="margin-bottom:16px;font-size:16px;color:#e6edf3">⚙️ Конфигурация</h2><div id="configContent">⏳ Загрузка...</div>';
    A.ajax('/api/config', function(cfg) {
        var groups = cfg.groups||[];
        var h = '';
        for (var i=0;i<groups.length;i++) {
            var g = groups[i];
            h += '<div class="cfg-group"><div class="cfg-group-head">'+A.esc(g.name)+'</div>';
            for (var j=0;j<g.params.length;j++) {
                var p = g.params[j];
                var isPrompt = p.k.indexOf('SYSTEM_PROMPT')!==-1||p.k.indexOf('tool:')!==-1;
                h += '<div class="cfg-row"><div class="cfg-key">'+A.esc(p.k)+'</div>';
                if (isPrompt) h += '<div class="cfg-val cfg-prompt"><pre>'+A.esc(p.v)+'</pre></div>';
                else h += '<div class="cfg-val">'+A.esc(p.v)+'</div>';
                h += '<div class="cfg-desc">'+A.esc(p.d)+'</div></div>';
            }
            h += '</div>';
        }
        A.$('configContent').innerHTML = h;
    });
}

// ═══════ MODELS ═══════
function buildModels() {
    var el = A.$('page-models');
    if (!el) return;
    el.innerHTML =
        '<h2 style="margin-bottom:16px;font-size:16px;color:#e6edf3">💻 Модели</h2>'+
        '<div class="mdl-token-box">'+
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">'+
        '<input id="modelsDir" class="mdl-input" style="min-width:280px" placeholder="/opt/gailray/models/gguf">'+
        '<button class="btn btn-go btn-sm" id="btnSaveDir">Сохранить</button>'+
        '<span id="modelsDirStatus" style="font-size:11px"></span></div>'+
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">'+
        '<input id="hfToken" class="mdl-input" style="min-width:280px" type="password" placeholder="hf_token...">'+
        '<button class="btn btn-sec btn-sm" id="btnShowToken">👁</button>'+
        '<button class="btn btn-go btn-sm" id="btnSaveToken">Сохранить</button>'+
        '<span id="hfTokenStatus" style="font-size:11px"></span></div>'+
        '<div id="modelsStatus" class="mdl-status"></div></div>'+
        '<div id="modelsList">⏳ Загрузка моделей...</div>';

    A.$('btnSaveDir').addEventListener('click', saveModelsDir);
    A.$('btnSaveToken').addEventListener('click', saveHfToken);
    A.$('btnShowToken').addEventListener('click', toggleHfTokenVisibility);
    loadModels();
}

function saveModelsDir() {
    var dir = A.$('modelsDir').value.trim();
    var el = A.$('modelsDirStatus');
    if (!dir) { el.textContent = 'Путь пуст'; el.style.color = '#f85149'; return; }
    A.put('/api/models/dir', {path:dir}, function(d) {
        el.textContent = '✓ Сохранено: '+d.models_dir; el.style.color = '#3fb950';
        if (d.note) setTimeout(function() { el.textContent = d.note; el.style.color = '#d29922'; }, 2000);
        loadModels();
    }, function(e) {
        el.textContent = 'Ошибка: '+e.message; el.style.color = '#f85149';
    });
    setTimeout(function() { el.textContent = ''; }, 5000);
}

function saveHfToken() {
    var token = A.$('hfToken').value.trim();
    var el = A.$('hfTokenStatus');
    A.put('/api/settings/hf_token', {value:token}, function() {
        el.textContent = '✓ Сохранено'; el.style.color = '#3fb950'; loadModels();
    }, function() {
        el.textContent = 'Ошибка'; el.style.color = '#f85149';
    });
    setTimeout(function() { el.textContent = ''; }, 3000);
}

function toggleHfTokenVisibility() {
    var inp = A.$('hfToken');
    if (inp) inp.type = inp.type==='password'?'text':'password';
}

function loadModels() {
    if (!A.$('modelsList')) return;
    A.$('modelsList').innerHTML = '⏳ Загрузка моделей...';
    A.ajax('/api/models', function(d) {
        var html = '';
        var models = d.models||[];
        for (var i=0;i<models.length;i++) {
            var m = models[i];
            var statusColor = m.present?'#3fb950':'#f85149';
            var statusText = m.present?'OK':'ОТСУТСТВУЕТ';
            if (m.present && m.size_ok===false) { statusColor='#f85149'; statusText='РАЗМЕР НЕ СОВПАДАЕТ'; }
            else if (m.present && m.verified) { statusColor='#3fb950'; statusText='ВЕРИФИЦИРОВАН'; }
            else if (m.present && m.size_ok) { statusColor='#58a6ff'; statusText='OK (размер совпадает)'; }
            var sizeText = m.total_size_mb>0?(m.total_size_mb>1024?(m.total_size_mb/1024).toFixed(1)+' GB':m.total_size_mb.toFixed(0)+' MB'):'';
            html += '<div class="mdl-card">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">';
            html += '<div><span style="font-weight:600;font-size:14px">'+A.esc(m.name)+'</span> <span style="color:'+statusColor+';font-size:12px;font-weight:600">['+statusText+']</span></div>';
            html += '<div style="display:flex;gap:6px;align-items:center">';
            if (sizeText) html += '<span class="mdl-size">'+sizeText+'</span>';
            html += '<button class="btn btn-sec btn-sm" data-action="check" data-model="'+m.id+'" style="font-size:11px;padding:3px 10px">🔍 Проверить</button>';
            if (!m.present) html += '<button class="btn btn-go btn-sm" data-action="download" data-model="'+m.id+'" style="font-size:11px;padding:3px 10px">⬇ Скачать</button>';
            html += '</div></div>';
            html += '<div class="mdl-role">'+A.esc(m.role)+'</div>';
            if (m.note) html += '<div style="font-size:11px;color:#58a6ff;margin-top:2px">'+A.esc(m.note)+'</div>';
            html += '<div class="mdl-sub">Репо: '+A.esc(m.repo)+' | Тип: '+m.type+' | Использует: '+A.esc(m.used_by||'')+'</div>';
            if (m.files && m.files.length) {
                html += '<div class="mdl-file-list">';
                for (var j=0;j<m.files.length;j++) {
                    var f = m.files[j];
                    var fc = f.exists?'#3fb950':'#f85149';
                    var fs = f.size_mb>0?' ('+f.size_mb.toFixed(0)+' MB)':'';
                    var hashIcon = '';
                    if (f.exists && f.sha256_ok===true) hashIcon = ' <span style="color:#3fb950" title="SHA256 совпадает">🔒</span>';
                    else if (f.exists && f.sha256_ok===false) hashIcon = ' <span style="color:#f85149" title="SHA256 НЕ совпадает!">🔓</span>';
                    else if (f.exists && f.size_ok===false) hashIcon = ' <span style="color:#f85149" title="Размер не совпадает!">⚠</span>';
                    html += '<div class="mdl-file-item"><span style="color:'+fc+'">'+(f.exists?'✓':'✗')+'</span> '+A.esc(f.name)+fs+hashIcon+'</div>';
                }
                html += '</div>';
            }
            html += '</div>';
        }
        A.$('modelsList').innerHTML = html;
        // Bind event listeners using data attributes (NO onclick)
        A.$$('#modelsList button[data-action="check"]').forEach(function(btn) {
            btn.addEventListener('click', function() { A._checkModel(this.getAttribute('data-model')); });
        });
        A.$$('#modelsList button[data-action="download"]').forEach(function(btn) {
            btn.addEventListener('click', function() { A._downloadModel(this.getAttribute('data-model')); });
        });
        if (d.hf_token_set) {
            if (A.$('modelsStatus')) A.$('modelsStatus').innerHTML = '';
        } else {
            if (A.$('modelsStatus')) A.$('modelsStatus').innerHTML = '<span style="color:#d29922">⚠ HF token не задан — скачивание моделей невозможно</span>';
        }
        if (d.models_dir && A.$('modelsDir')) A.$('modelsDir').value = d.models_dir;
    }, function(e) {
        if (A.$('modelsList')) A.$('modelsList').innerHTML = '<div style="color:#f85149">Ошибка загрузки: '+e+'</div>';
    });
    // Also load HF token
    A.ajax('/api/settings/hf_token', function(d) {
        if (A.$('hfToken') && d.value) A.$('hfToken').value = d.value;
    });
}

A._checkModel = function(modelId) {
    var el = A.$('modelsStatus');
    if (el) el.innerHTML = '<span style="color:#58a6ff">🔍 Проверка SHA256 '+modelId+'... (может занять ~30с)</span>';
    fetch('/api/models/check/'+modelId).then(function(r){return r.json()}).then(function(d) {
        if (d.verified) { if (el) el.innerHTML = '<span style="color:#3fb950">✓ '+modelId+': SHA256 верифицирован</span>'; }
        else if (d.present) { if (el) el.innerHTML = '<span style="color:#f85149">✗ '+modelId+': файл есть, но SHA256 НЕ совпадает!</span>'; }
        else { if (el) el.innerHTML = '<span style="color:#f85149">✗ '+modelId+': файл отсутствует</span>'; }
        loadModels();
    }).catch(function(e) { if (el) el.innerHTML = '<span style="color:#f85149">✗ Ошибка: '+e+'</span>'; });
};

A._downloadModel = function(modelId) {
    var el = A.$('modelsStatus');
    if (el) el.innerHTML = '<span style="color:#58a6ff">⬇ Скачивание '+modelId+'...</span>';
    A.post('/api/models/download/'+modelId, null, function(d) {
        if (d.status==='ok') {
            if (el) el.innerHTML = '<span style="color:#3fb950">✓ Модель '+modelId+' скачана</span>';
            loadModels();
        } else {
            if (el) el.innerHTML = '<span style="color:#f85149">✗ Ошибка: '+A.esc(d.error||'unknown')+'</span>';
        }
    }, function(e) {
        if (el) el.innerHTML = '<span style="color:#f85149">✗ Ошибка сети: '+e+'</span>';
    });
};

// ═══════ FAMILY ═══════
function buildFamily() {
    var el = A.$('page-family');
    if (!el) return;
    el.innerHTML =
        '<h2 style="margin-bottom:16px;font-size:16px;color:#e6edf3">👨‍👩‍👧‍👦 Семейные данные</h2>'+
        '<div class="backup-sec"><h3>Семейные факты и контекст</h3>'+
        '<textarea style="width:100%;height:200px;background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:10px;font-family:monospace;font-size:12px" id="familyFacts"></textarea>'+
        '<div class="maint-row"><button class="btn btn-go btn-sm" id="btnSaveFamily">Сохранить</button><button class="btn btn-sec btn-sm" id="btnFillPersonas">Заполнить топ-персон</button><span id="familySaveStatus" style="font-size:12px"></span></div></div>';

    A.$('btnSaveFamily').addEventListener('click', saveFamilyFacts);
    A.$('btnFillPersonas').addEventListener('click', fillTopPersonas);
    A.ajax('/api/settings/family_facts', function(d) {
        A.$('familyFacts').value = d.value||'';
    });
}

function saveFamilyFacts() {
    var text = A.$('familyFacts').value;
    var el = A.$('familySaveStatus');
    A.put('/api/settings/family_facts', {value:text}, function() {
        el.textContent = '✓ Сохранено'; el.style.color = '#3fb950';
    }, function() {
        el.textContent = 'Ошибка'; el.style.color = '#f85149';
    });
    setTimeout(function() { el.textContent = ''; }, 3000);
}

function fillTopPersonas() {
    var el = A.$('familySaveStatus');
    A.ajax('/api/settings/family_facts/top_personas', function(d) {
        var ta = A.$('familyFacts');
        var existing = ta.value.trim();
        var add = d.text||'';
        if (existing) ta.value = existing + '\n\n' + add;
        else ta.value = add;
        el.textContent = '✓ Добавлено'; el.style.color = '#58a6ff';
        setTimeout(function() { el.textContent = ''; }, 2000);
    }, function() {
        el.textContent = 'Ошибка'; el.style.color = '#f85149';
    });
}

A.on('navigate', function(page) {
    if (page==='config') buildConfig();
    if (page==='models') buildModels();
    if (page==='family') buildFamily();
});

})(window.Admin);