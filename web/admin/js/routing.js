// Routing module
(function(A) {

A.registerBlock('routing', 'Маршрутизация', '🔀', function(cid) { A.renderBlock_routing(cid); });

function buildUI() {
    var el = A.$('page-routing');
    if (!el) return;
    el.innerHTML =
        '<h2 class="page-h2">🔀 Маршрутизация</h2>'+
        '<div id="routingBlock"></div>';
    A.renderBlock_routing('routingBlock');
}

A.renderBlock_routing = function(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '<div id="rtList_'+containerId+'">Загрузка...</div><div id="rtSec_'+containerId+'" style="display:none;margin-top:16px"></div>';

    try {
        var ollamaUrlProm = new Promise(function(resolve) {
            A.ajax('/api/settings/ollama_base_url', function(v) {
                resolve((v&&v.value)||'');
            }, function() { resolve(''); });
        });

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
            ollamaUrlProm.then(function(url) {
                if (!url) return {models:[]};
                return new Promise(function(resolve) {
                    A.ajax('/api/proxy/ollama_models?url='+encodeURIComponent(url), resolve, function() { resolve({models:[]}); });
                });
            })
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
                var lc = localOk?'c-ok':'c-err';
                var lbc = localOk?'bd-ok':'bd-err';
                var oc = ollamaOk?'c-ok':'c-err';
                var obc = ollamaOk?'bd-ok':'bd-err';

                h += '<div class="bd-default" style="padding:12px 0;border-bottom-width:1px;border-bottom-style:solid">';
                h += '<div style="font-weight:600;margin-bottom:8px">'+A.esc(t.name)+'</div>';
                h += '<div class="routing-toggle">';
                h += '<span class="'+lc+' '+lbc+'" style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;border-width:1px;border-style:solid;font-size:12px">🏠 Локально</span>';
                h += '<div class="routing-dot'+(mode==='local'?' active':'')+'" data-task="'+A.esc(t.id)+'" data-mode="local" data-cid="'+containerId+'"></div>';
                h += '<div class="routing-line"></div>';
                h += '<div class="routing-dot'+(mode==='ollama'?' active':'')+'" data-task="'+A.esc(t.id)+'" data-mode="ollama" data-cid="'+containerId+'"></div>';
                h += '<span class="'+oc+' '+obc+'" style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;border-width:1px;border-style:solid;font-size:12px">🤖 Ollama</span>';
                h += '</div>';
                h += '<div class="c-dim" style="font-size:11px;margin-top:4px">Используется '+(isOllama?'внешний сервер Ollama':'локальная модель')+'</div>';
                if (!localOk) h += '<div class="c-err" style="font-size:10px;margin-top:2px">Локальная модель отсутствует</div>';
                if (!ollamaOk) h += '<div class="c-warn" style="font-size:10px;margin-top:2px"><code>ollama pull '+A.esc(t.ollamaModel)+'</code></div>';
                h += '</div>';
            });
            var listEl = document.getElementById('rtList_'+containerId);
            if (listEl) listEl.innerHTML = h;
            listEl.querySelectorAll('.routing-dot[data-cid="'+containerId+'"]').forEach(function(dot) {
                dot.addEventListener('click', function() {
                    A._switchBackend(this.getAttribute('data-task'), this.getAttribute('data-mode'));
                });
            });
            var sec = document.getElementById('rtSec_'+containerId);
            if (sec) sec.style.display = 'block';
        }).catch(function(e) {
            var listEl = document.getElementById('rtList_'+containerId);
            if (listEl) listEl.innerHTML = '<span class="c-err">Ошибка: '+e.message+'</span>';
        });
    } catch(e) {
        var listEl = document.getElementById('rtList_'+containerId);
            if (listEl) listEl.innerHTML = '<span class="c-err">Ошибка JS: '+e.message+'</span>';
    }
};

A._switchBackend = function(taskId, mode) {
    var task = A.DUAL_TASKS.find(function(t) { return t.id===taskId; });
    var key = task ? task.backendKey : 'ollama_mode';
    A.put('/api/settings/'+key, {value:mode}, function() {
        A.renderBlock_routing('routingBlock');
    });
};

A.on('navigate', function(page) {
    if (page==='routing') buildUI();
});

})(window.Admin);
