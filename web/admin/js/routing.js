// Routing module
(function(A) {

function buildUI() {
    var el = A.$('page-routing');
    if (!el) return;
    el.innerHTML =
        '<h2 style="margin-bottom:16px;font-size:16px;color:#e6edf3">🔀 Маршрутизация</h2>'+
        '<div class="card"><h3>Выбор бэкенда</h3><div id="routingList">Загрузка...</div></div>'+
        '<div id="routingSec" style="display:none;margin-top:16px"></div>';

    try {
        var urlEl = document.getElementById('ollamaUrl');
        var url = urlEl ? urlEl.value : '';
        var prom = url ? A.ajax('/api/proxy/ollama_models?url='+encodeURIComponent(url)) : Promise.resolve({models:[]});

        var backendProms = A.DUAL_TASKS.map(function(t) {
            return new Promise(function(resolve) {
                A.ajax('/api/settings/'+t.backendKey, function(v) {
                    resolve({key:t.id, value:(v&&v.value)||'local'});
                }, function() { resolve({key:t.id, value:'local'}); });
            });
        });

        Promise.all([
            new Promise(function(resolve) { A.ajax('/api/models', resolve, function() { resolve({models:[]}); }); }),
            Promise.all(backendProms),
            Promise.resolve(prom).catch(function() { return {models:[]}; })
        ]).then(function(r) {
            var backendMap = {};
            (r[1]||[]).forEach(function(v) { backendMap[v.key] = v.value; });
            var localModels = r[0].models||[];
            var ollamaModels = (r[2]&&r[2].models)||[];
            var localPresent = {};
            localModels.forEach(function(m) { localPresent[m.id] = m.present||false; });
            var ollamaNames = {};
            ollamaModels.forEach(function(m) { ollamaNames[m.name] = true; });

            var h = '';
            A.DUAL_TASKS.forEach(function(t) {
                var localOk = localPresent[t.modelId]||false;
                var ollamaOk = ollamaNames[t.ollamaModel]||false;
                var mode = backendMap[t.id]||'local';
                var isOllama = mode==='ollama';
                var lc = localOk?'#3fb950':'#f85149';
                var oc = ollamaOk?'#3fb950':'#f85149';

                h += '<div style="padding:12px 0;border-bottom:1px solid #21262d">';
                h += '<div style="font-weight:600;margin-bottom:8px">'+A.esc(t.name)+'</div>';
                h += '<div class="routing-toggle">';
                h += '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;border:1px solid '+A.esc(lc)+';color:'+A.esc(lc)+';font-size:12px">🏠 Локально</span>';
                h += '<div class="routing-dot'+(mode==='local'?' active':'')+'" data-task="'+A.esc(t.id)+'" data-mode="local"></div>';
                h += '<div class="routing-line"></div>';
                h += '<div class="routing-dot'+(mode==='ollama'?' active':'')+'" data-task="'+A.esc(t.id)+'" data-mode="ollama"></div>';
                h += '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;border:1px solid '+A.esc(oc)+';color:'+A.esc(oc)+';font-size:12px">🤖 Ollama</span>';
                h += '</div>';
                h += '<div style="font-size:11px;color:#6e7681;margin-top:4px">Используется '+(isOllama?'внешний сервер Ollama':'локальная модель')+'</div>';
                if (!localOk) h += '<div style="font-size:10px;color:#f85149;margin-top:2px">Локальная модель отсутствует</div>';
                if (!ollamaOk) h += '<div style="font-size:10px;color:#d29922;margin-top:2px"><code>ollama pull '+A.esc(t.ollamaModel)+'</code></div>';
                h += '</div>';
            });
            A.$('routingList').innerHTML = h;
            A.$$('#routingList .routing-dot[data-task]').forEach(function(dot) {
                dot.addEventListener('click', function() {
                    A._switchBackend(this.getAttribute('data-task'), this.getAttribute('data-mode'));
                });
            });
            var sec = A.$('routingSec');
            if (sec) sec.style.display = 'block';
        }).catch(function(e) {
            A.$('routingList').innerHTML = '<span style="color:#f85149">Ошибка: '+e.message+'</span>';
        });
    } catch(e) {
        A.$('routingList').innerHTML = '<span style="color:#f85149">Ошибка JS: '+e.message+'</span>';
    }
}

A._switchBackend = function(taskId, mode) {
    var task = A.DUAL_TASKS.find(function(t) { return t.id===taskId; });
    var key = task ? task.backendKey : 'ollama_mode';
    A.put('/api/settings/'+key, {value:mode}, function() {
        buildUI();
    });
};

A.on('navigate', function(page) {
    if (page==='routing') buildUI();
});

})(window.Admin);