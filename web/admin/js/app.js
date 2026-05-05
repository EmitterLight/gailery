var _activePage = localStorage.getItem('admin-page') || 'pipeline';
function navigate(page) {
    _activePage = page;
    document.querySelectorAll('.sidebar a').forEach(function(a){a.classList.remove('active');});
    document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
    var l=document.querySelector('.sidebar a[data-page="'+page+'"]');if(l)l.classList.add('active');
    var p=document.getElementById('page-'+page);if(p)p.classList.add('active');
    localStorage.setItem('admin-page',page);
    if(page==='config')loadConfig();
    if(page==='logs')loadLog();
    if(page==='workers'){loadWorkers();loadCrashes();}
    if(page==='maint')loadMaintStats();
    if(page==='family')loadFamilyFacts();
    if(page==='models')loadModels();
    if(page==='hashes')loadHashStats();
    if(page==='dashboard')renderDashboard();
    if(page==='ollama')ollamaInit();
    if(window.innerWidth<=768)document.getElementById('sidebar').classList.remove('open');
}
function toggleSidebar(){document.getElementById('sidebar').classList.toggle('open');}
function renderDashboard(){
    var d=st,sec=document.getElementById('dashStatus');if(!sec||!d.photos_total)return;
    var run=d.current_step!=='idle';
    sec.innerHTML='<h3>📡 Статус</h3><div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap"><div class="metric'+(run?'':' warn')+'"><div class="val">'+(run?'Активен':'Остановлен')+'</div><div class="lbl">пайплайн — '+d.current_step+'</div></div><div class="metric"><div class="val">'+(d.photos_total||0).toLocaleString()+'</div><div class="lbl">фото</div></div><div class="metric"><div class="val">'+(d.faces_total||0).toLocaleString()+'</div><div class="lbl">лиц</div></div><div class="metric"><div class="val">'+(d.personas_total||0).toLocaleString()+'</div><div class="lbl">персон</div></div></div>';
    var pr=document.getElementById('dashProgress');if(pr){
        var bars=[{l:'Наполнение',p:d.pct_ingested,d:d.catalog_ingested||0,t:d.catalog_total||1},{l:'Описание',p:d.pct_described,d:d.photos_described||0,t:d.photos_total||1},{l:'Лица',p:d.pct_faces,d:d.catalog_faces_done||0,t:d.photos_faces_flagged||1},{l:'EXIF',p:d.pct_exif,d:d.catalog_exif_done||0,t:d.photos_total||1},{l:'Семант.индекс',p:d.pct_embedded,d:d.photos_embedded||0,t:d.photos_total||1}];
        pr.innerHTML='<h3>📈 Прогресс</h3>'+bars.map(function(b){return'<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:11px"><span>'+b.l+'</span><span>'+b.d+' / '+b.t+' ('+fmtPct(b.p)+')</span></div><div class="progress-bar"><div class="fill" style="width:'+b.p+'%"></div></div></div>';}).join('');
    }
    var ev=document.getElementById('dashEvents');if(ev){
        fetch(API+'/../api/log?lines=20').then(function(r){return r.json()}).then(function(data){
            var lines=(data.lines||[]).filter(function(l){return/\[(PIPELINE|DESCRIBE|FACES|EMBED|WATCHDOG)\].*?(DONE|done|FAILED|START|Clustering|запускаю)/.test(l);});
            ev.innerHTML='<pre style="margin:0;white-space:pre-wrap;font-size:11px;line-height:1.5">'+esc(lines.join('\n'))+'</pre>';
        },function(){ev.textContent='⚠ лог недоступен';});
    }
    // Workers in dashboard
    var dw = document.getElementById('dashWorkers'); 
    if (dw && d.mqtt_progress) {
        var p = d.mqtt_progress, names = ['describe','faces','embed','exif','ingest'];
        dw.innerHTML = names.map(function(n) {
            var h = p[n], cls = h ? 'run' : '';
            return '<div class="worker-card ' + cls + '"><div class="w-name">' + n + '</div><div class="w-pid">' + (h ? h.replace(/\[.*/,'') : '\u2014') + '</div></div>';
        }).join('');
    }
    var ms = document.getElementById('mqttSummary');
    if (ms && d.mqtt_progress) {
        var p = d.mqtt_progress, names = ['describe','faces','embed','exif','ingest'];
        var active = names.filter(function(n) { return p[n]; });
        ms.innerHTML = active.map(function(n) { return '<span class="w run">\u26a1 ' + n + '</span>'; }).join('') || '<span style="color:#6e7681">idle</span>';
    }
}
function ollamaInit(){
    fetch(API+'/config').then(function(r){return r.json()}).then(function(cfg){
        var g=(cfg.groups||[]).find(function(x){return x.name==='Ollama';});
        var items=g?g.items||[]:[];
        var u=items.find(function(x){return x.key==='ollama_base_url';});
        var e=items.find(function(x){return x.key==='ollama_embed_model';});
        var d=items.find(function(x){return x.key==='ollama_describe_model';});
        var c=items.find(function(x){return x.key==='ollama_embed_chunk';});
        if(u){var el=document.getElementById('ollamaUrl');if(el)el.value=u.value;}
        if(e){var el=document.getElementById('ollamaEmbedModel');if(el)el.value=e.value;}
        if(d){var el=document.getElementById('ollamaDescModel');if(el)el.value=d.value;}
        if(c){var el=document.getElementById('ollamaChunk');if(el)el.value=c.value;}
    });
}
function ollamaCheck(){
    var url=document.getElementById('ollamaUrl').value,st=document.getElementById('ollamaStatus');
    if(st)st.innerHTML='<span style="color:#f0883e">проверка...</span>';
    fetch(API+'/proxy/ollama_check?url='+encodeURIComponent(url)).then(function(r){return r.json()}).then(function(d){
        if(d.ok){if(st)st.innerHTML='<span style="color:#3fb950">✓ '+esc(d.version)+'</span>';
            fetch(API+'/proxy/ollama_models?url='+encodeURIComponent(url)).then(function(r){return r.json()}).then(function(md){
                var ml=document.getElementById('ollamaModelsList');if(ml&&md.models)ml.innerHTML='<div class="card" style="margin-top:12px"><h3>Модели</h3>'+md.models.map(function(m){return'<div class="task"><div class="t-name">'+esc(m.name)+'</div><div class="t-info">'+(m.size/1e9).toFixed(1)+' GB</div></div>';}).join('')+'</div>';
            });
        }else{if(st)st.innerHTML='<span style="color:#f85149">✗ ошибка</span>';}
    }).catch(function(){if(st)st.innerHTML='<span style="color:#f85149">✗ нет ответа</span>';});
}
function ollamaSave(){
    var vals=[['ollama_base_url',document.getElementById('ollamaUrl').value],['ollama_embed_model',document.getElementById('ollamaEmbedModel').value],['ollama_describe_model',document.getElementById('ollamaDescModel').value],['ollama_embed_chunk',parseInt(document.getElementById('ollamaChunk').value)]];
    var done=0;vals.forEach(function(p){fetch(API+'/settings/'+p[0],{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:p[1]})}).then(function(){done++;if(done===vals.length){var st=document.getElementById('ollamaStatus');if(st)st.innerHTML='<span style="color:#3fb950">✓ сохранено</span>';}});});
}
document.addEventListener('DOMContentLoaded',function(){
    document.querySelectorAll('.sidebar a').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();var p=this.getAttribute('data-page');if(p)navigate(p);});});
    navigate(_activePage);
});
var API = '/api';
var st = {};

var STEPS = [
    {id:'ingest', name:'Наполнение', icon:'&#128193;', color:'#c9d1d9'},
    {id:'describe', name:'Описание', icon:'&#128444;&#65039;', color:'#58a6ff'},
    {id:'faces', name:'Лица', icon:'&#128100;', color:'#d29922'},
    {id:'exif', name:'EXIF', icon:'&#128247;', color:'#a5d6ff'},
    {id:'embed', name:'Семантическая индексация', icon:'&#128269;', color:'#bc8cff'},
];

var TASKS = [
    {id:'ingest', name:'Наполнение базы', icon:'&#128193;', desc:'Сканирование фото, добавление записей в базу',
     params:[{k:'ingest_limit',l:'Количество фото',v:100,t:'n'},{k:'exif',l:'Читать EXIF',v:'1',t:'s',opts:[['1','Да'],['0','Нет']]}]},
    {id:'describe', name:'Описание фото', icon:'&#128444;&#65039;', desc:'VLM (Qwen3.5-4B) генерирует описание и флаг лиц',
     params:[{k:'desc_limit',l:'Лимит описаний (0=все)',v:60,t:'n'},{k:'batch_size',l:'Размер батча ВЛМ',v:6,t:'n'}]},
    {id:'faces', name:'Поиск лиц', icon:'&#128100;', desc:'InsightFace: детекция, векторные представления, кластеризация в персоны',
     params:[]},
    {id:'exif', name:'Чтение EXIF', icon:'&#128247;', desc:'Дата, GPS, камера из метаданных фото',
     params:[]},
    {id:'embed', name:'Семантическая индексация', icon:'&#128269;', desc:'Qwen3-Embedding: векторный индекс для смыслового поиска',
     params:[]},
];

var taskState = {};
TASKS.forEach(function(t){ taskState[t.id] = {status:'idle', started:null, stopped:null, startPct:0, baseCount:0}; });

function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

var _activeTab = localStorage.getItem('ctrl-tab') || 'pipeline';
function switchTab(id){
    _activeTab = id;
    var btns = document.querySelectorAll('.tab-btn');
    var panels = document.querySelectorAll('.tab-panel');
    for(var i=0;i<btns.length;i++) btns[i].classList.toggle('active', btns[i].getAttribute('onclick').indexOf(id)>=0);
    for(var i=0;i<panels.length;i++) panels[i].classList.toggle('active', panels[i].id === 'tab-'+id);
    localStorage.setItem('ctrl-tab', id);
}
function restoreTab(){
    var btns = document.querySelectorAll('.tab-btn');
    for(var i=0;i<btns.length;i++) btns[i].classList.toggle('active', btns[i].getAttribute('onclick').indexOf(_activeTab)>=0);
    var panels = document.querySelectorAll('.tab-panel');
    for(var i=0;i<panels.length;i++) panels[i].classList.toggle('active', panels[i].id === 'tab-'+_activeTab);
}

function fmtTime(iso){ if(!iso) return '\u2014'; return iso.substring(11,19); }
function fmtDur(ms){
    var s=Math.floor(ms/1000), m=Math.floor(s/60), h=Math.floor(m/60);
    if(h>0) return h+'ч '+m%60+'м';
    if(m>0) return m+'м '+s%60+'с';
    return s+'с';
}

function stepPct(id){
    if(!st.photos_total && id!=='ingest') return 0;
    if(id==='ingest') return st.pct_ingested||0;
    if(id==='describe') return st.pct_described||0;
    if(id==='faces') return st.pct_faces||0;
    if(id==='exif') return st.pct_exif||0;
    if(id==='embed') return st.pct_embedded||0;
    return 0;
}
function stepCount(id){
    var ct = st.catalog_total||0, ci = st.catalog_ingested||0, ff = st.faces_flagged_in_db||0;
    if(id==='ingest') return {done:ci, total:ct};
    if(id==='describe') return {done:st.catalog_described||0, total:ci||ct};
    if(id==='faces') return {done:st.catalog_faces_done||0, total:ff||ci||ct};
    if(id==='exif') return {done:st.catalog_exif_done||0, total:ci||ct};
    if(id==='embed') return {done:st.photos_embedded||0, total:st.photos_total||0};
    return {done:0, total:0};
}
function fmtPct(v){
    if(!v) return '0%';
    if(v < 1) return v.toFixed(2)+'%';
    return v.toFixed(1)+'%';
}

function renderSummary(){
    if(!st.photos_total) return;
    var h = '';
    var ct = st.catalog_total || 0;
    h+='<div class="sbox"><div class="sv">'+(st.catalog_ingested||0)+'</div><div class="sl">Внесено из '+ct+'</div></div>';
    h+='<div class="sbox"><div class="sv">'+(st.catalog_described||0)+'</div><div class="sl">Описано из '+(st.catalog_ingested||0)+'</div></div>';
    h+='<div class="sbox"><div class="sv">'+(st.catalog_faces_done||0)+'</div><div class="sl">Лица из '+(st.faces_flagged_in_db||0)+'</div></div>';
    h+='<div class="sbox"><div class="sv">'+(st.catalog_exif_done||0)+'</div><div class="sl">EXIF из '+(st.catalog_ingested||0)+'</div></div>';
    h+='<div class="sbox"><div class="sv">'+(st.photos_embedded||0)+'</div><div class="sl">Индекс из '+(st.photos_total||0)+'</div></div>';
    if (st.per_root && st.per_root.length > 1) {
        h+='<div class="src-section">';
        h+='<div class="src-title">По источникам:</div>';
        for (var i = 0; i < st.per_root.length; i++) {
            var r = st.per_root[i];
            h+='<div class="src-row">';
            h+='<span class="src-alias">'+esc(r.alias)+'</span>';
            h+='<span class="src-counts">'+r.ingested+' / '+r.catalog_total+'</span>';
            h+='<span class="src-details">D:'+r.described+' E:'+r.exif_done+' I:'+r.embedded+'</span>';
            h+='</div>';
        }
        h+='</div>';
    }
    document.getElementById('summary').innerHTML = h;
}

function renderCyclo(){
    var currentStep = (st.step_details||'').toLowerCase();
    var isRunning = st.current_step !== 'idle';
    var banner = document.getElementById('pipelineBanner');
    var title = document.getElementById('pbTitle');
    var status = document.getElementById('pbStatus');
    var btnStart = document.getElementById('btnStart');
    var btnStop = document.getElementById('btnStop');

    if(isRunning){
        banner.className = 'pipeline-banner running';
        title.textContent = '\u26A1 Пайплайн работает: ' + st.step_details;
        status.className = 'pb-status s-run';
        status.textContent = '\u25CF ' + st.step_details;
        btnStart.disabled = true;
        btnStop.disabled = false;
        var pTimeEl = document.getElementById('pbPipelineTime');
        if(st.pipeline_started_at){
            var pStart = new Date(st.pipeline_started_at + (st.pipeline_started_at.indexOf('+') < 0 && st.pipeline_started_at.indexOf('Z') < 0 ? '+00:00' : ''));
            pTimeEl.innerHTML = 'Цепочка идёт: <span id="pbPipelineDur">' + fmtDur(Date.now() - pStart.getTime()) + '</span> (с ' + pStart.toLocaleTimeString() + ')';
        } else {
            pTimeEl.textContent = 'Одиночный шаг: ' + st.step_details;
        }
    } else {
        banner.className = 'pipeline-banner idle';
        title.textContent = 'Пайплайн остановлен';
        status.className = 'pb-status s-idle';
        status.textContent = 'IDLE';
        btnStart.disabled = false;
        btnStop.disabled = true;
        var pTimeEl = document.getElementById('pbPipelineTime');
        if(st.pipeline_started_at){
            var pStart = new Date(st.pipeline_started_at + (st.pipeline_started_at.indexOf('+') < 0 && st.pipeline_started_at.indexOf('Z') < 0 ? '+00:00' : ''));
            pTimeEl.textContent = 'Последний запуск: ' + pStart.toLocaleTimeString();
        } else {
            pTimeEl.textContent = '';
        }
    }

    var h = '';
    for(var i=0; i<STEPS.length; i++){
        var s = STEPS[i];
        var pct = stepPct(s.id);
        var cnt = stepCount(s.id);
        var isActive = (s.id === currentStep && isRunning);
        var ts = taskState[s.id];
        var isDone = pct >= 100;
        var isFailed = ts.status === 'fail';

        var cls = 'st-wait';
        var badgeHtml = '\u25CB ожидание';
        if(isFailed){ cls = 'st-fail'; badgeHtml = '\u2717 ошибка'; }
        else if(isActive){ cls = 'st-run'; badgeHtml = '\u25CF работает'; }
        else if(isDone){ cls = 'st-done'; badgeHtml = '\u2713 готово'; }

        var pctStr = fmtPct(pct);
        var countStr = cnt.done + '/' + cnt.total;
        var barW = Math.min(pct, 100);

        h += '<div class="cy-step ' + cls + '">';
        h += '<div class="cy-icon">' + s.icon + '</div>';
        h += '<div class="cy-name" style="color:' + (isActive || isDone ? s.color : '') + '">' + s.name + '</div>';
        h += '<div class="cy-pct">' + pctStr + '</div>';
        h += '<div class="cy-count">' + countStr + '</div>';
        h += '<div class="cy-bar-bg"><div class="cy-bar" style="width:' + barW + '%"></div></div>';
        h += '<div class="cy-badge">' + badgeHtml + '</div>';
        if(isActive && ts.started){
            h += '<div class="cy-time" id="cyTime_' + s.id + '">' + fmtDur(Date.now() - ts.started.getTime()) + '</div>';
        } else if(ts.status === 'done' && ts.started && ts.stopped){
            var durDone = fmtDur(ts.stopped.getTime() - ts.started.getTime());
            var agoDone = fmtDur(Date.now() - ts.stopped.getTime());
            h += '<div class="cy-time">' + durDone + ' \u2022 ' + agoDone + ' назад</div>';
        }
        var cycleDelta = cnt.done - ts.baseCount;
        if(ts.baseCount > 0 && cycleDelta > 0){
            h += '<div class="cy-count" style="color:#3fb950">+' + cycleDelta + ' за цикл</div>';
        }
        if(isDone && !isActive) h += '<div class="cy-check">\u2713</div>';
        if(s.id === 'faces' && isActive && st.faces_phase){
            var phaseNames = {loading:'Загрузка', detecting:'Детекция', lance_write:'LanceDB', clustering:'Кластеризация', detection_done:'Завершение', done:'Готово'};
            var phaseLabel = phaseNames[st.faces_phase] || st.faces_phase;
            var detailHtml = st.faces_detail ? esc(st.faces_detail) : '';
            h += '<div style="font-size:9px;color:#d29922;margin-top:3px">' + phaseLabel + (detailHtml ? ': ' + detailHtml : '') + '</div>';
        }
        h += '</div>';

        if(i < STEPS.length - 1){
            var arrowLit = isRunning && STEPS.slice(0, i+1).some(function(ss){ return ss.id === currentStep; });
            h += '<div class="cy-arrow' + (arrowLit ? ' lit' : '') + '">\u2192</div>';
        }
    }
    document.getElementById('cyclo').innerHTML = h;
}

function renderTasks(){
    var currentStep = (st.step_details||'').toLowerCase();
    var isRunning = st.current_step !== 'idle';
    var h = '';

    for(var i=0;i<TASKS.length;i++){
        var t = TASKS[i];
        var ts = taskState[t.id];
        var isActive = (t.id === currentStep && isRunning);

        if(isActive && ts.status !== 'run'){
            ts.status = 'run';
            if(!ts.started){
                if(st.step_started_at){
                    ts.started = new Date(st.step_started_at + (st.step_started_at.indexOf('+') < 0 && st.step_started_at.indexOf('Z') < 0 ? '+00:00' : ''));
                } else {
                    ts.started = new Date();
                }
            }
            if(!ts.startPct && ts.startPct !== 0) ts.startPct = stepPct(t.id);
            if(!ts.baseCount) ts.baseCount = stepCount(t.id).done;
        } else if(!isActive && ts.status === 'run'){
            ts.status = stepPct(t.id) >= 100 ? 'done' : 'done';
            ts.stopped = new Date();
        }

        var badgeCls = 'tb-idle', badgeText = 'Остановлено';
        if(ts.status==='run'){ badgeCls='tb-run'; badgeText='\u25CF Выполняется'; }
        else if(ts.status==='done'){ badgeCls='tb-done'; badgeText='\u2713 Завершено'; }
        else if(ts.status==='fail'){ badgeCls='tb-fail'; badgeText='\u2717 Ошибка'; }

        var dur = '';
        var eta = '';
        var progressLine = (st.progress_lines || {})[t.id] || '';
        if(ts.status==='run' && ts.started){
            dur = fmtDur(Date.now() - ts.started.getTime());
        } else if(ts.stopped && ts.started){
            dur = fmtDur(ts.stopped.getTime() - ts.started.getTime());
        }
        if(progressLine){
            var m = progressLine.match(/\u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C ~([^\]]+)/);
            if(m) eta = '~'+m[1];
        }

        var tl = '';
        if(ts.started) tl += '<div class="ev">Запущено: <b>'+fmtTime(ts.started.toISOString())+'</b></div>';
        if(ts.stopped) tl += '<div class="ev">Остановлено: <b>'+fmtTime(ts.stopped.toISOString())+'</b></div>';
        if(dur) tl += '<div class="ev">Длительность: <b>'+dur+'</b></div>';

        var descHtml = t.desc;
        var cnt = stepCount(t.id);
        if(cnt.total > 0){
            var pctStr = fmtPct(stepPct(t.id));
            descHtml += ' \xB7 <b style="color:#58a6ff">'+cnt.done+'/'+cnt.total+' ('+pctStr+')</b>';
        }

        h += '<div class="task">';
        h += '<div class="task-head" onclick="toggleTask(\''+t.id+'\')">';
        h += '<div class="task-icon">'+t.icon+'</div>';
        h += '<div class="task-info"><div class="tn">'+t.name+'</div><div class="td">'+descHtml+(dur?' \xB7 <b>'+dur+'</b>':'')+(eta?' \u2192 '+eta:'')+'</div></div>';
        h += '<div class="task-badge '+badgeCls+'">'+badgeText+'</div>';
        h += '<div class="task-btns" onclick="event.stopPropagation()">';
        h += '<button class="btn btn-go" onclick="runStep(\''+t.id+'\')" '+(isRunning?'disabled':'')+'>Запустить</button>';
        h += '<button class="btn btn-stop" onclick="stopStep(\''+t.id+'\')" '+(isActive?'':'disabled')+'>Стоп</button>';
        h += '</div></div>';

        h += '<div class="task-body" id="tb_'+t.id+'">';
        if(t.params.length > 0){
            for(var j=0;j<t.params.length;j++){
                var pp = t.params[j];
                h += '<label>'+pp.l+'</label>';
                if(pp.t==='s'){
                    h += '<select id="p_'+pp.k+'">';
                    for(var o=0;o<pp.opts.length;o++) h+='<option value="'+pp.opts[o][0]+'">'+pp.opts[o][1]+'</option>';
                    h += '</select>';
                } else {
                    h += '<input type="number" id="p_'+pp.k+'" value="'+pp.v+'" min="0">';
                }
            }
        }
        h += '<div class="task-timeline">'+tl+'</div>';
        h += '</div></div>';
    }
    saveParamValues();
    document.getElementById('tasks').innerHTML = h;
    restoreOpenTasks();
}

function toggleTask(id){
    var el = document.getElementById('tb_'+id);
    if(el) el.classList.toggle('open');
    var openIds = [];
    var bodies = document.querySelectorAll('.task-body.open');
    for(var i=0;i<bodies.length;i++) openIds.push(bodies[i].id);
    _openTasks = openIds;
}

var _openTasks = [];
var _paramValues = {};

function saveParamValues(){
    var inputs = document.querySelectorAll('.task-body input, .task-body select');
    for(var i=0;i<inputs.length;i++){
        if(inputs[i].id) _paramValues[inputs[i].id] = inputs[i].value;
    }
}

function restoreParamValues(){
    for(var id in _paramValues){
        var el = document.getElementById(id);
        if(el) el.value = _paramValues[id];
    }
}

function restoreOpenTasks(){
    for(var i=0;i<_openTasks.length;i++){
        var el = document.getElementById(_openTasks[i]);
        if(el) el.classList.add('open');
    }
    restoreParamValues();
}

function getParam(key){
    var el = document.getElementById('p_'+key);
    return el ? el.value : '';
}

function loadRoots(){
    fetch(API+'/catalog/roots').then(function(r){return r.json()}).then(function(roots){
        var sel = document.getElementById('chainRoot');
        if (!sel) return;
        sel.innerHTML = '<option value="">Все включённые</option>';
        for (var i = 0; i < roots.length; i++) {
            var r = roots[i];
            if (r.enabled) {
                sel.innerHTML += '<option value="' + r.root_id + '">' + esc(r.alias) + '</option>';
            }
        }
    });
}

function runStep(step){
    var params = {step: step};
    TASKS.forEach(function(t){
        if(t.id===step){
            t.params.forEach(function(pp){ params[pp.k] = getParam(pp.k); });
        }
    });
    fetch(API+'/../api/control/start',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(params)
    }).then(function(r){return r.json()}).then(function(d){
        if(d.ok){
            taskState[step] = {status:'run', started:new Date(), stopped:null, startPct:stepPct(step), baseCount:stepCount(step).done};
            renderTasks(); renderCyclo();
        }
    });
}

function stopStep(step){
    fetch(API+'/../api/control/stop',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({step:step})
    }).then(function(r){return r.json()}).then(function(d){
        taskState[step] = {status:'idle', started:taskState[step].started, stopped:new Date(), baseCount:0};
        renderTasks(); renderCyclo();
    });
}

function runChain(){
    var lim = document.getElementById('chainLimit').value;
    var rootId = document.getElementById('chainRoot').value;
    var params = {step:'chain', ingest_limit:lim, desc_limit:lim, batch_size:getParam('batch_size')||10, exif:getParam('exif')||'1'};
    if (rootId) params.root_id = rootId;
    fetch(API+'/../api/control/start',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(params)
    }).then(function(r){return r.json()}).then(function(d){
        if(d.ok){
            document.getElementById('chainInfo').textContent = '\u26A1 Запущено '+new Date().toLocaleTimeString();
            TASKS.forEach(function(t){
                taskState[t.id].baseCount = stepCount(t.id).done;
            });
            renderTasks(); renderCyclo();
        }
    });
}

function stopAll(){
    fetch(API+'/../api/control/stop',{method:'POST'}).then(function(r){return r.json()}).then(function(){
        TASKS.forEach(function(t){
            if(taskState[t.id].status==='run'){
                taskState[t.id] = {status:'idle', started:taskState[t.id].started, stopped:new Date(), baseCount:0};
            }
        });
        document.getElementById('chainInfo').textContent = 'Остановлено '+new Date().toLocaleTimeString();
        renderTasks(); renderCyclo();
        loadCrashes();
    });
}

function loadStatus(){
    fetch(API+'/../api/status').then(function(r){return r.json()}).then(function(d){
        st = d;
        var step = (d.step_details||'').toLowerCase();
        if(d.current_step==='idle'){
            TASKS.forEach(function(t){
                if(taskState[t.id].status==='run') taskState[t.id].status='done';
                if(!taskState[t.id].stopped) taskState[t.id].stopped=new Date();
            });
        }
        renderSummary();
        renderCyclo();
        renderTasks();
        renderDashboard();
    }).catch(function(){});
}

var _logFilter = '';
function setLogFilter(f){
    _logFilter = f;
    document.getElementById('logFilter').value = f.indexOf(',')>=0?'':f;
    document.querySelectorAll('.fbtn').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-f')===f);});
    applyLogFilter();
}
function applyLogFilter(){
    var el = document.getElementById('logC');
    if(!_logFilter){
        el.querySelectorAll('.ll').forEach(function(s){s.style.display='';});
        return;
    }
    var terms = _logFilter.toUpperCase().split(',');
    el.querySelectorAll('.ll').forEach(function(s){
        var txt = s.textContent.toUpperCase();
        var show = terms.some(function(t){return t && txt.indexOf(t)>=0;});
        s.style.display = show ? '' : 'none';
    });
    updateLogInfo(el);
}
function loadLog(){
    fetch(API+'/../api/log?lines=2000').then(function(r){return r.json()}).then(function(d){
        var el = document.getElementById('logC');
        var wasBot = el.scrollTop+el.clientHeight >= el.scrollHeight-20;
        var h = '';
        for(var i=0;i<d.lines.length;i++){
            var t = d.lines[i].replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\r/g,'');
            var m = t.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
            if(m){
                var d2=new Date(m[1]+'Z');
                if(!isNaN(d2.getTime())){
                    var pad=function(n){return n<10?'0'+n:n;};
                    var local=d2.getFullYear()+'-'+pad(d2.getMonth()+1)+'-'+pad(d2.getDate())+' '+pad(d2.getHours())+':'+pad(d2.getMinutes())+':'+pad(d2.getSeconds());
                    t=t.replace(m[1],local);
                }
            }
            var cls='ll';
            if(t.indexOf('[DESCRIBE]')>=0) cls+=' l-DESCRIBE';
            else if(t.indexOf('[FACES]')>=0) cls+=' l-FACES';
            else if(t.indexOf('[EMBED]')>=0) cls+=' l-EMBED';
            else if(t.indexOf('[EXIF]')>=0) cls+=' l-EXIF';
            else if(t.indexOf('[PIPELINE]')>=0) cls+=' l-PIPELINE';
            else if(t.indexOf('[INGEST]')>=0) cls+=' l-INGEST';
            else if(t.indexOf('[ENRICH]')>=0) cls+=' l-ENRICH';
            else if(t.indexOf('[WATCHDOG]')>=0) cls+=' l-WATCHDOG';
            if(t.indexOf('FAILED')>=0||t.indexOf('ERROR')>=0) cls+=' l-error';
            if(t.indexOf('DONE')>=0||t.indexOf('START')>=0) cls+=' l-DONE';
            h += '<div class="'+cls+'">'+t+'</div>';
        }
        el.innerHTML = h;
        el.setAttribute('data-total', d.total);
        document.getElementById('logInfo').textContent = _logFilter ? '?/'+d.lines.length+'/'+d.total : d.lines.length+'/'+d.total;
        if(wasBot) el.scrollTop = el.scrollHeight;
        applyLogFilter();
        updateLogInfo(el);
    }).catch(function(){});
}
function updateLogInfo(el){
    var total = el.getAttribute('data-total')||'0';
    var shown = el.querySelectorAll('.ll').length;
    var visible = _logFilter ? el.querySelectorAll('.ll:not([style*="display: none"])').length : shown;
    document.getElementById('logInfo').textContent = _logFilter ? visible+'/'+shown+'/'+total : shown+'/'+total;
}

function backupDownload(){
    var el = document.getElementById('backupStatus');
    el.className = 'backup-status'; el.textContent = 'Создание бекапа...';
    fetch(API+'/backup/download').then(function(r){
        if(!r.ok) throw new Error('HTTP '+r.status);
        var sz = r.headers.get('content-length');
        var mb = sz ? (parseInt(sz)/1048576).toFixed(1)+'MB' : '';
        el.className = 'backup-status ok'; el.textContent = 'Скачивание... '+mb;
        return r.blob();
    }).then(function(blob){
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        var cd = '';
        a.download = 'gallery_backup.db.gz';
        a.click();
        URL.revokeObjectURL(url);
        el.className = 'backup-status ok'; el.textContent = 'Бекап скачан ('+(blob.size/1048576).toFixed(1)+'MB)';
    }).catch(function(e){
        el.className = 'backup-status err'; el.textContent = 'Ошибка: '+e.message;
    });
}

function backupUpload(input){
    if(!input.files || !input.files[0]) return;
    var file = input.files[0];
    var el = document.getElementById('backupStatus');
    el.className = 'backup-status'; el.textContent = 'Загрузка '+file.name+' ('+(file.size/1048576).toFixed(1)+'MB)...';
    var fd = new FormData();
    fd.append('file', file);
    fetch(API+'/backup/upload', {method:'POST', body:fd}).then(function(r){
        if(!r.ok) return r.json().then(function(d){ throw new Error(d.detail||'HTTP '+r.status); });
        return r.json();
    }).then(function(d){
        el.className = 'backup-status ok'; el.textContent = 'БД восстановлена! Перезапустите сервис для применения.';
    }).catch(function(e){
        el.className = 'backup-status err'; el.textContent = 'Ошибка: '+e.message;
    });
    input.value = '';
}

function fmtBytes(b){
    if(!b) return '0';
    if(b < 1024) return b+'B';
    if(b < 1048576) return (b/1024).toFixed(1)+'KB';
    if(b < 1073741824) return (b/1048576).toFixed(1)+'MB';
    return (b/1073741824).toFixed(1)+'GB';
}

function loadMaintStats(){
    fetch(API+'/maintenance/stats').then(function(r){return r.json()}).then(function(d){
        var h = '';
        // SQLite
        var sqliteMain = d['gallery.db'] || 0;
        var sqliteWAL = d['gallery.db-wal'] || 0;
        h += '<div class="maint-sbox"><div class="sv">'+fmtBytes(sqliteMain)+'</div><div class="sl">gallery.db</div></div>';
        if(sqliteWAL > 1048576) h += '<div class="maint-sbox"><div class="sv">'+fmtBytes(sqliteWAL)+'</div><div class="sl">gallery.db-wal</div></div>';
        // Legacy DB
        var legacyDb = d['gailray.db'] || 0;
        var legacyWAL = d['gailray.db-wal'] || 0;
        if(legacyDb > 0) h += '<div class="maint-sbox legacy"><div class="sv">'+fmtBytes(legacyDb + legacyWAL)+'</div><div class="sl">gailray.db (устарела)</div></div>';
        // LanceDB tables
        var lanceNames = {
            'photo_embeddings':'Семантические индексы',
            'face_vectors':'Векторы лиц',
            'faces':'Лица (legacy)',
            'personas':'Персоны',
            'photos':'Фото (legacy)',
            'catalog_files':'Каталог файлов',
            'catalog_roots':'Каталог корней'
        };
        var lt = d.lance_tables || {};
        var lanceOrder = ['photo_embeddings','face_vectors','personas','faces','photos','catalog_files','catalog_roots'];
        for(var i=0;i<lanceOrder.length;i++){
            var k = lanceOrder[i];
            if(lt[k] !== undefined && lt[k] > 0){
                var cls = (k === 'faces' || k === 'photos') ? ' legacy' : '';
                h += '<div class="maint-sbox'+cls+'"><div class="sv">'+fmtBytes(lt[k])+'</div><div class="sl">'+(lanceNames[k]||k)+'</div></div>';
            }
        }
        // Total
        h += '<div class="maint-sbox total"><div class="sv">'+fmtBytes(d.data_total)+'</div><div class="sl">Всего данных</div></div>';
        document.getElementById('maintSizes').innerHTML = h;
    }).catch(function(){});
}

function maintVacuum(){
    var el = document.getElementById('maintStatus');
    el.className = 'backup-status'; el.textContent = 'VACUUM...';
    fetch(API+'/maintenance/vacuum',{method:'POST'}).then(function(r){
        if(!r.ok) return r.json().then(function(d){ throw new Error(d.detail); });
        return r.json();
    }).then(function(d){
        el.className = 'backup-status ok';
        el.textContent = 'VACUUM: '+fmtBytes(d.before)+' → '+fmtBytes(d.after)+' (освобождено '+fmtBytes(d.freed)+')';
        loadMaintStats();
    }).catch(function(e){
        el.className = 'backup-status err'; el.textContent = 'Ошибка: '+e.message;
    });
}

function maintDedup(){
    var el = document.getElementById('maintStatus');
    el.className = 'backup-status'; el.textContent = 'Дедупликация семантических индексов... (может занять минуту)';
    fetch(API+'/maintenance/dedup_embeddings',{method:'POST'}).then(function(r){
        if(!r.ok) return r.json().then(function(d){ throw new Error(d.detail); });
        return r.json();
    }).then(function(d){
        el.className = 'backup-status ok';
        el.textContent = 'Было '+d.before+' → стало '+d.after+' (удалено '+d.removed+' дублей)';
        loadMaintStats();
    }).catch(function(e){
        el.className = 'backup-status err'; el.textContent = 'Ошибка: '+e.message;
    });
}

var hashWorkerPid = 0;

function loadHashStats(){
    fetch(API+'/catalog/hash_status').then(function(r){return r.json()}).then(function(d){
        var total = d.total_files || 0;
        var withH = d.with_hash || 0;
        var withoutH = d.without_hash || 0;
        var zeroByte = d.zero_byte || 0;
        var pendingH = d.pending_hash || 0;
        var dupGroups = d.duplicate_groups || 0;
        var dupFiles = d.duplicate_files || 0;
        var pct = total > 0 ? Math.round(withH / total * 100) : 0;
        var h = '';
        h += '<div class="maint-sbox"><div class="sv">'+withH+' / '+total+'</div><div class="sl">С хешем ('+pct+'%)</div></div>';
        if(pendingH > 0){
            h += '<div class="maint-sbox"><div class="sv" style="color:#f0883e">'+pendingH+'</div><div class="sl">Ждут хеширования</div></div>';
        }
        if(zeroByte > 0){
            h += '<div class="maint-sbox" style="border-color:#f85149"><div class="sv" style="color:#f85149">'+zeroByte+'</div><div class="sl">Повреждены (0 байт)</div></div>';
        }
        if(dupGroups > 0){
            h += '<div class="maint-sbox" style="border-color:#f85149"><div class="sv" style="color:#f85149">'+dupGroups+'</div><div class="sl">Групп дублей ('+dupFiles+' файлов)</div></div>';
        }
        document.getElementById('hashStats').innerHTML = h;
        if(withoutH === 0){
            document.getElementById('btnHashStart').disabled = true;
        }
    }).catch(function(){});
    fetch(API+'/catalog/hash_backfill_status').then(function(r){return r.json()}).then(function(d){
        if(d.running && d.pids && d.pids.length > 0){
            hashWorkerPid = d.pids[0];
            document.getElementById('btnHashStart').disabled = true;
            document.getElementById('btnHashStop').disabled = false;
            var el = document.getElementById('hashStatus');
            el.className = 'backup-status ok';
            el.textContent = 'Воркер работает (PID '+hashWorkerPid+')';
            pollHashWorker();
        }
    }).catch(function(){});
}

function hashBackfill(){
    var el = document.getElementById('hashStatus');
    el.className = 'backup-status'; el.textContent = 'Запуск расчёта хешей...';
    fetch(API+'/catalog/hash_backfill',{method:'POST'}).then(function(r){
        if(!r.ok) return r.json().then(function(d){ throw new Error(d.detail); });
        return r.json();
    }).then(function(d){
        hashWorkerPid = d.pid;
        el.className = 'backup-status ok';
        el.textContent = 'Воркер запущен (PID '+d.pid+')';
        document.getElementById('btnHashStart').disabled = true;
        document.getElementById('btnHashStop').disabled = false;
        pollHashWorker();
    }).catch(function(e){
        el.className = 'backup-status err'; el.textContent = 'Ошибка: '+e.message;
    });
}

function hashBackfillStop(){
    if(!hashWorkerPid) return;
    var el = document.getElementById('hashStatus');
    fetch(API+'/catalog/hash_backfill_stop',{method:'POST'}).then(function(r){
        if(!r.ok) return r.json().then(function(d){ throw new Error(d.detail); });
        return r.json();
    }).then(function(d){
        el.className = 'backup-status ok';
        el.textContent = 'Воркер остановлен (killed PIDs: '+(d.killed||[]).join(', ')+')';
        hashWorkerPid = 0;
        document.getElementById('btnHashStart').disabled = false;
        document.getElementById('btnHashStop').disabled = true;
        loadHashStats();
    }).catch(function(e){
        el.className = 'backup-status err'; el.textContent = 'Ошибка: '+e.message;
    });
}

function pollHashWorker(){
    fetch(API+'/catalog/hash_backfill_status').then(function(r){return r.json()}).then(function(d){
        if(!d.running){
            var el = document.getElementById('hashStatus');
            el.className = 'backup-status ok';
            el.textContent = 'Расчёт хешей завершён';
            hashWorkerPid = 0;
            document.getElementById('btnHashStart').disabled = false;
            document.getElementById('btnHashStop').disabled = true;
            loadHashStats();
            return;
        }
        if(d.pids && d.pids.length > 0) hashWorkerPid = d.pids[0];
        loadHashStats();
        setTimeout(pollHashWorker, 5000);
    }).catch(function(){
        setTimeout(pollHashWorker, 10000);
    });
}

function hashFindDuplicates(){
    var el = document.getElementById('hashStatus');
    var dl = document.getElementById('dupList');
    el.className = 'backup-status'; el.textContent = 'Поиск дубликатов...';
    dl.innerHTML = '';
    fetch(API+'/catalog/duplicates?limit=100').then(function(r){
        if(!r.ok) return r.json().then(function(d){ throw new Error(d.detail); });
        return r.json();
    }).then(function(d){
        var groups = d.duplicates || [];
        if(groups.length === 0){
            el.className = 'backup-status ok';
            el.textContent = 'Дубликатов не найдено';
            return;
        }
        el.className = 'backup-status ok';
        el.textContent = 'Найдено '+groups.length+' групп дубликатов';
        var h = '';
        for(var i=0;i<groups.length;i++){
            var g = groups[i];
            h += '<div style="margin-bottom:8px;padding:6px;background:#21262d;border:1px solid #30363d;border-radius:4px">';
            h += '<b style="color:#f0883e">'+g.count+' копий</b> <span style="color:#6e7681">'+g.hash+'</span>';
            for(var j=0;j<g.paths.length;j++){
                var p = g.paths[j].replace(/\\/g,'/');
                var short = p.split('/').slice(-2).join('/');
                h += '<div style="padding-left:12px;color:#8b949e;word-break:break-all" title="'+p+'">'+short+'</div>';
            }
            h += '</div>';
        }
        dl.innerHTML = h;
        loadHashStats();
    }).catch(function(e){
        el.className = 'backup-status err'; el.textContent = 'Ошибка: '+e.message;
    });
}

function loadConfig(){
    fetch(API+'/config').then(function(r){return r.json()}).then(function(d){
        var groups = d.groups || [];
        var h = '';
        for(var i=0;i<groups.length;i++){
            var g = groups[i];
            h += '<div class="cfg-group">';
            h += '<div class="cfg-group-head">'+g.icon+' '+esc(g.name)+'</div>';
            for(var j=0;j<g.params.length;j++){
                var p = g.params[j];
                var isPrompt = p.k.indexOf('SYSTEM_PROMPT') !== -1 || p.k.indexOf('tool:') !== -1;
                h += '<div class="cfg-row">';
                h += '<div class="cfg-key">'+esc(p.k)+'</div>';
                if(isPrompt){
                    h += '<div class="cfg-val cfg-prompt"><pre>'+esc(p.v)+'</pre></div>';
                } else {
                    h += '<div class="cfg-val">'+esc(p.v)+'</div>';
                }
                h += '<div class="cfg-desc">'+esc(p.d)+'</div>';
                h += '</div>';
            }
            h += '</div>';
        }
        document.getElementById('configContent').innerHTML = h;
    }).catch(function(){});
}

var WORKER_NAMES = ['ingest','describe','faces','exif','embed','pipeline','thumbnails','scan_catalog','enrich'];
var WORKER_LABELS = {ingest:'Наполнение',describe:'Описание',faces:'Лица',exif:'EXIF',embed:'Семантическая индексация',pipeline:'Пайплайн',thumbnails:'Превью',scan_catalog:'Каталог',enrich:'Обогащение'};

function loadWorkers(){
    fetch(API+'/../api/mqtt/workers').then(function(r){return r.json()}).then(function(d){
        var w = d.workers || {};
        var anyAlive = false, anyDead = false;
        var h = '';
        for(var i=0;i<WORKER_NAMES.length;i++){
            var name = WORKER_NAMES[i];
            var s = w[name] || {status:'idle',alive:false,gpu_held:false};
            var dotCls = s.alive ? 'alive' : (s.status==='dead' ? 'dead' : (s.status==='done' ? 'done' : 'idle'));
            var label = WORKER_LABELS[name] || name;
            if(s.alive) anyAlive = true;
            if(s.status==='dead') anyDead = true;
            h += '<div class="wcard">';
            h += '<div class="wcard-name"><span>'+esc(label)+'</span><span class="wcard-dot '+dotCls+'" title="'+esc(s.status)+'"></span></div>';
            h += '<div class="wcard-row">Статус: <b>'+esc(s.status||'idle')+'</b></div>';
            if(s.pid) h += '<div class="wcard-row">PID: <b>'+s.pid+'</b></div>';
            if(s.progress) h += '<div class="wcard-row">'+s.progress.done+'/'+s.progress.total+' ('+s.progress.pct.toFixed(1)+'%)</div>';
            if(s.gpu_held) h += '<div class="wcard-row wcard-gpu">GPU</div>';
            h += '</div>';
        }
        document.getElementById('workersGrid').innerHTML = h;
        window._lastWorkers = w;
        var info = document.getElementById('watchdogInfo');
        if(anyDead) info.textContent = '⚠ есть падения — смотри лог ниже';
        else if(anyAlive) info.textContent = '✓ процессы работают';
        else info.textContent = '';
    }).catch(function(){});
}

var _crashLogVisible = false;
function toggleCrashLog(){
    _crashLogVisible = !_crashLogVisible;
    var el = document.getElementById('crashLog');
    var btn = document.getElementById('btnCrashLog');
    if(_crashLogVisible){
        el.style.display = 'block';
        btn.textContent = 'Скрыть журнал';
        loadCrashes();
    } else {
        el.style.display = 'none';
        btn.textContent = 'Журнал срабатываний';
    }
}

function loadCrashes(){
    fetch(API+'/../api/watchdog/crashes').then(function(r){return r.json()}).then(function(d){
        var crashes = d.crashes || [];
        var countEl = document.getElementById('crashCount');
        var statusEl = document.getElementById('watchdogStatus');
        if(crashes.length > 0){
            countEl.textContent = crashes.length + ' срабатываний';
        } else {
            countEl.textContent = '';
        }
        try {
            var resp = fetch(API+'/../api/mqtt/workers').then(function(){});
        } catch(e){}
        var alive = false;
        try { for(var n in (window._lastWorkers||{})) { if(window._lastWorkers[n]&&window._lastWorkers[n].status==='running') alive=true; } } catch(e){}
        if(!document.getElementById('watchdogDot')){
            var dot = document.createElement('span');
            dot.id = 'watchdogDot';
            dot.className = 'wcard-dot';
            dot.style.marginRight = '4px';
            statusEl.parentNode.insertBefore(dot, statusEl);
        }
        var dotEl = document.getElementById('watchdogDot');
        var mode = d.mode || 'active';
        if(mode === 'sleeping'){
            dotEl.className = 'wcard-dot sleeping';
            statusEl.innerHTML = '<span style="color:#8b949e">&#128054; Сторожевой пёс: </span><b style="color:#d29922">дремлет</b>';
        } else {
            dotEl.className = 'wcard-dot alive';
            statusEl.innerHTML = '<span style="color:#8b949e">&#128054; Сторожевой пёс: </span><b style="color:#3fb950">активен</b>';
        }
        if(_crashLogVisible){
            var el = document.getElementById('crashLog');
            if(crashes.length === 0){
                el.innerHTML = '<span style="color:#6e7681">Срабатываний нет — все процессы работают штатно</span>';
            } else {
                el.innerHTML = crashes.map(function(c){
                    var t = esc(c);
                    var m = t.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
                    if(m){
                        var d2=new Date(m[1]+'Z');
                        if(!isNaN(d2.getTime())){
                            var pad=function(n){return n<10?'0'+n:n;};
                            var local=d2.getFullYear()+'-'+pad(d2.getMonth()+1)+'-'+pad(d2.getDate())+' '+pad(d2.getHours())+':'+pad(d2.getMinutes())+':'+pad(d2.getSeconds());
                            t=t.replace(m[1],local);
                        }
                    }
                    if(t.indexOf('LWT DEAD')>=0) return '<span style="color:#f85149">'+t+'</span>';
                    if(t.indexOf('RESTART')>=0) return '<span style="color:#d29922">'+t+'</span>';
                    if(t.indexOf('RECOVERY')>=0) return '<span style="color:#3fb950">'+t+'</span>';
                    if(t.indexOf('STALE')>=0) return '<span style="color:#f0883e">'+t+'</span>';
                    return t;
                }).join('<br>');
            }
        }
    }).catch(function(){});
}

 loadStatus(); loadLog(); loadMaintStats(); loadRoots(); loadHashStats(); loadWorkers(); loadCrashes(); loadConfig(); loadFamilyFacts();
 document.getElementById('logFilter').addEventListener('input',function(){
     var v=this.value.trim();
     if(!v){ _logFilter=''; document.querySelectorAll('.fbtn').forEach(function(b){b.classList.remove('active');}); }
     else { _logFilter=v; document.querySelectorAll('.fbtn').forEach(function(b){b.classList.remove('active');}); }
     loadLog();
 });
 setInterval(loadStatus, 3000);
 setInterval(loadLog, 5000);
 setInterval(loadWorkers, 5000);
 setInterval(loadCrashes, 15000);
setInterval(function(){
    for(var i=0; i<STEPS.length; i++){
        var ts = taskState[STEPS[i].id];
        var el = document.getElementById('cyTime_' + STEPS[i].id);
        if(el && ts.status === 'run' && ts.started){
            el.textContent = fmtDur(Date.now() - ts.started.getTime());
        }
    }
    if(st.pipeline_started_at){
        var pStart = new Date(st.pipeline_started_at + (st.pipeline_started_at.indexOf('+') < 0 && st.pipeline_started_at.indexOf('Z') < 0 ? '+00:00' : ''));
        var pdEl = document.getElementById('pbPipelineDur');
        if(pdEl) pdEl.textContent = fmtDur(Date.now() - pStart.getTime());
    }
}, 1000);

var _isLightTheme = false;
function toggleTheme() {
    _isLightTheme = !_isLightTheme;
    document.body.classList.toggle('light-theme', _isLightTheme);
    localStorage.setItem('gallery-theme', _isLightTheme ? 'light' : 'dark');
    var logo = document.querySelector('h1 .logo');
    if (logo) logo.src = _isLightTheme ? logo.dataset.light : logo.dataset.dark;
    updateThemeIcon();
}
function updateThemeIcon() {
    var btn = document.querySelector('.theme-toggle');
    if (btn) {
        btn.innerHTML = _isLightTheme ? '\u263E' : '\u2600';
        btn.title = _isLightTheme ? 'Тёмная тема' : 'Дневная тема';
    }
}
(function() {
    var savedTheme = localStorage.getItem('gallery-theme');
    if (savedTheme === 'light') {
        _isLightTheme = true;
        var logo = document.querySelector("h1 .logo");
        if (logo) logo.src = logo.dataset.light;
        document.body.classList.add('light-theme');
    }
    updateThemeIcon();
})();

function openMobileNav() {
    var p = document.getElementById('mmPanel');if(!p)return;
    p.classList.remove('dragging');
    p.style.transform = '';
    p.classList.add('open');
    document.getElementById('mmOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    updateMmTheme();
}
function closeMobileNav() {
    var p = document.getElementById('mmPanel');if(!p)return;
    p.classList.remove('dragging');
    p.style.transform = '';
    p.classList.remove('open');
    document.getElementById('mmOverlay').classList.remove('open');
    document.body.style.overflow = '';
}
function toggleMobileNav() {
    var p = document.getElementById('mmPanel');if(!p)return;
    if (p.classList.contains('open')) closeMobileNav(); else openMobileNav();
}
function updateMmTheme() {
    var ico = document.getElementById('mmThemeIco');
    var lbl = document.getElementById('mmThemeLbl');
    if (ico) ico.innerHTML = _isLightTheme ? '\u263E' : '\u2600';
    if (lbl) lbl.textContent = _isLightTheme ? 'Тёмная тема' : 'Дневная тема';
    var mmLogo = document.querySelector('.mm-head img');
    if (mmLogo) mmLogo.src = _isLightTheme ? mmLogo.dataset.light : mmLogo.dataset.dark;
}
var mo = document.getElementById('mmOverlay');if(mo)mo.addEventListener('click',closeMobileNav);

(function() {
    var panel = document.getElementById('mmPanel');
    var edge = document.getElementById('mmEdge');if(!edge)return;
    var startX = 0, startY = 0, curX = 0, isEdgeSwipe = false, isPanelSwipe = false, panelOpen = false;
    var W = 280;

    function onOpen() { panelOpen = true; }
    function onClose() { panelOpen = false; }

    var origOpen = openMobileNav;
    openMobileNav = function() { origOpen(); onOpen(); };
    var origClose = closeMobileNav;
    closeMobileNav = function() { origClose(); onClose(); };

    document.addEventListener('touchstart', function(e) {
        var t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        curX = startX;
        isEdgeSwipe = false;
        isPanelSwipe = false;

        if (!panelOpen && startX >= window.innerWidth - 30) {
            isEdgeSwipe = true;
            panel.classList.add('dragging');
        }
        if (panelOpen && panel.contains(e.target)) {
            isPanelSwipe = true;
            panel.classList.add('dragging');
        }
    }, { passive: true });

    document.addEventListener('touchmove', function(e) {
        if (!isEdgeSwipe && !isPanelSwipe) return;
        var t = e.touches[0];
        curX = t.clientX;
        var dx = curX - startX;
        var dy = t.clientY - startY;
        if (Math.abs(dy) > Math.abs(dx) * 1.5) { isEdgeSwipe = false; isPanelSwipe = false; panel.classList.remove('dragging'); panel.style.transform = ''; return; }

        if (isEdgeSwipe) {
            var tx = Math.max(0, -dx);
            if (tx > 0) {
                panel.classList.add('open');
                document.getElementById('mmOverlay').classList.add('open');
                var pct = Math.min(1, tx / W);
                panel.style.transform = 'translateX(' + (100 - pct * 100) + '%)';
                document.getElementById('mmOverlay').style.opacity = pct * 0.5;
            }
        }
        if (isPanelSwipe) {
            var tx = Math.min(0, -dx);
            var pct = Math.min(1, Math.abs(tx) / W);
            panel.style.transform = 'translateX(' + (-pct * 100) + '%)';
            document.getElementById('mmOverlay').style.opacity = (1 - pct) * 0.5;
        }
    }, { passive: true });

    document.addEventListener('touchend', function(e) {
        if (!isEdgeSwipe && !isPanelSwipe) return;
        panel.classList.remove('dragging');
        panel.style.transform = '';
        var overlay = document.getElementById('mmOverlay');
        overlay.style.opacity = '';

        var dx = curX - startX;
        if (isEdgeSwipe) {
            if (dx < -60) { openMobileNav(); }
            else { panel.classList.remove('open'); overlay.classList.remove('open'); }
        }
        if (isPanelSwipe) {
            if (dx > 60) { closeMobileNav(); }
            else { panel.classList.add('open'); }
        }
        isEdgeSwipe = false;
        isPanelSwipe = false;
    }, { passive: true });
})();

function loadFamilyFacts(){
    fetch(API+'/settings/family_facts').then(function(r){return r.json()}).then(function(d){
        document.getElementById('familyFacts').value = d.value || '';
    }).catch(function(){});
}
function saveFamilyFacts(){
    var text = document.getElementById('familyFacts').value;
    var el = document.getElementById('familySaveStatus');
    fetch(API+'/settings/family_facts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:text})}).then(function(r){
        if(r.ok){
            el.textContent='Сохранено'; el.style.color='#3fb950';
        } else { el.textContent='Ошибка'; el.style.color='#f85149'; }
    }).catch(function(){ el.textContent='Ошибка сети'; el.style.color='#f85149'; });
    setTimeout(function(){ el.textContent=''; }, 3000);
}
function fillTopPersonas(){
    var el = document.getElementById('familySaveStatus');
    fetch(API+'/settings/family_facts/top_personas').then(function(r){return r.json()}).then(function(d){
        var ta = document.getElementById('familyFacts');
        var existing = ta.value.trim();
        var add = d.text || '';
        if(existing){
            ta.value = existing + '\n\n' + add;
        } else {
            ta.value = add;
        }
        el.textContent='Добавлено'; el.style.color='#58a6ff';
        setTimeout(function(){ el.textContent=''; }, 2000);
    }).catch(function(){ el.textContent='Ошибка'; el.style.color='#f85149'; });
}

loadFamilyFacts();

function loadModels(){
    document.getElementById('modelsList').innerHTML = '<div style="color:#6e7681;padding:12px">&#8987; Загрузка моделей...</div>';
    fetch(API+'/models').then(function(r){return r.json()}).then(function(d){
        var html = '';
        var models = d.models || [];
        for(var i=0;i<models.length;i++){
            var m = models[i];
            var statusColor = m.present ? '#3fb950' : '#f85149';
            var statusText = m.present ? 'OK' : 'ОТСУТСТВУЕТ';
            if(m.present && m.size_ok === false){ statusColor='#f85149'; statusText='РАЗМЕР НЕ СОВПАДАЕТ'; }
            else if(m.present && m.verified){ statusColor='#3fb950'; statusText='ВЕРИФИЦИРОВАН'; }
            else if(m.present && m.size_ok){ statusColor='#58a6ff'; statusText='OK (размер совпадает)'; }
            var sizeText = m.total_size_mb > 0 ? (m.total_size_mb > 1024 ? (m.total_size_mb/1024).toFixed(1)+' GB' : m.total_size_mb.toFixed(0)+' MB') : '';
            html += '<div class="mdl-card">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">';
            html += '<div><span style="font-weight:600;font-size:14px">'+esc(m.name)+'</span> <span style="color:'+statusColor+';font-size:12px;font-weight:600">['+statusText+']</span></div>';
            html += '<div style="display:flex;gap:6px;align-items:center">';
            if(sizeText) html += '<span class="mdl-size">'+sizeText+'</span>';
            html += '<button class="btn btn-sec" onclick="checkModel(\''+m.id+'\')" style="font-size:11px;padding:3px 10px">&#128270; Проверить</button>';
            html += '</div></div>';
            html += '<div class="mdl-role">'+esc(m.role)+'</div>';
            if(m.note) html += '<div style="font-size:11px;color:#58a6ff;margin-top:2px">'+esc(m.note)+'</div>';
            html += '<div class="mdl-sub">Репо: '+esc(m.repo)+' | Тип: '+m.type+' | Использует: '+esc(m.used_by||'')+'</div>';
            if(m.files && m.files.length){
                html += '<div class="mdl-file-list">';
                for(var j=0;j<m.files.length;j++){
                    var f = m.files[j];
                    var fc = f.exists ? '#3fb950' : '#f85149';
                    var fs = f.size_mb > 0 ? ' ('+f.size_mb.toFixed(0)+' MB)' : '';
                    var hashIcon = '';
                    if(f.exists && f.sha256_ok === true) hashIcon = ' <span style="color:#3fb950" title="SHA256 совпадает с HuggingFace LFS">&#128274;</span>';
                    else if(f.exists && f.sha256_ok === false) hashIcon = ' <span style="color:#f85149" title="SHA256 НЕ совпадает!">&#128275;</span>';
                    else if(f.exists && f.size_ok === false) hashIcon = ' <span style="color:#f85149" title="Размер файла не совпадает!">&#9888;</span>';
                    else if(f.exists && f.size_ok) hashIcon = ' <span style="color:#58a6ff" title="Размер совпадает, SHA256 не проверен">&#128269;</span>';
                    html += '<div class="mdl-file-item"><span style="color:'+fc+'">'+(f.exists?'&#10003;':'&#10007;')+'</span> '+esc(f.name)+fs+hashIcon+'</div>';
                }
                html += '</div>';
            }
            html += '</div>';
        }
        document.getElementById('modelsList').innerHTML = html;
        if(!d.hf_token_set){
            document.getElementById('modelsStatus').innerHTML = '<span style="color:#d29922">&#9888; HF token не задан — скачивание моделей невозможно</span>';
        } else {
            document.getElementById('modelsStatus').innerHTML = '';
        }
        var dirInp = document.getElementById('modelsDir');
        if(d.models_dir) dirInp.value = d.models_dir;
    }).catch(function(e){
        document.getElementById('modelsList').innerHTML = '<div style="color:#f85149">Ошибка загрузки: '+e+'</div>';
    });
    fetch(API+'/settings/hf_token').then(function(r){return r.json()}).then(function(d){
        var inp = document.getElementById('hfToken');
        if(d.value) inp.value = d.value;
    }).catch(function(){});
}
function saveModelsDir(){
    var dir = document.getElementById('modelsDir').value.trim();
    var el = document.getElementById('modelsDirStatus');
    if(!dir){ el.textContent='Путь пуст'; el.style.color='#f85149'; return; }
    fetch(API+'/models/dir',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:dir})}).then(function(r){
        if(r.ok) return r.json();
        return r.json().then(function(d){ throw new Error(d.detail||'Error'); });
    }).then(function(d){
        el.textContent='Сохранено: '+d.models_dir; el.style.color='#3fb950';
        if(d.note) setTimeout(function(){ el.textContent=d.note; el.style.color='#d29922'; },2000);
        loadModels();
    }).catch(function(e){ el.textContent='Ошибка: '+e.message; el.style.color='#f85149'; });
    setTimeout(function(){ el.textContent=''; }, 5000);
}
function saveHfToken(){
    var token = document.getElementById('hfToken').value.trim();
    var el = document.getElementById('hfTokenStatus');
    fetch(API+'/settings/hf_token',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:token})}).then(function(r){
        if(r.ok){
            el.textContent='Сохранено'; el.style.color='#3fb950';
            loadModels();
        } else { el.textContent='Ошибка'; el.style.color='#f85149'; }
    }).catch(function(){ el.textContent='Ошибка сети'; el.style.color='#f85149'; });
    setTimeout(function(){ el.textContent=''; }, 3000);
}
function toggleHfTokenVisibility(){
    var inp = document.getElementById('hfToken');
    inp.type = inp.type === 'password' ? 'text' : 'password';
}
function downloadModel(modelId){
    var el = document.getElementById('modelsStatus');
    el.innerHTML = '<span style="color:#58a6ff">&#11015; Скачивание '+modelId+'...</span>';
    fetch(API+'/models/download/'+modelId,{method:'POST'}).then(function(r){return r.json()}).then(function(d){
        if(d.status==='ok'){
            el.innerHTML = '<span style="color:#3fb950">&#10003; Модель '+modelId+' скачана</span>';
            loadModels();
        } else {
            el.innerHTML = '<span style="color:#f85149">&#10007; Ошибка: '+esc(d.error||'unknown')+'</span>';
        }
    }).catch(function(e){
        el.innerHTML = '<span style="color:#f85149">&#10007; Ошибка сети: '+e+'</span>';
    });
}
function checkModel(modelId){
    var el = document.getElementById('modelsStatus');
    el.innerHTML = '<span style="color:#58a6ff">&#128270; Проверка SHA256 '+modelId+'... (может занять ~30с)</span>';
    fetch(API+'/models/check/'+modelId).then(function(r){return r.json()}).then(function(d){
        if(d.verified){
            el.innerHTML = '<span style="color:#3fb950">&#10003; '+modelId+': SHA256 верифицирован (совпадает с HuggingFace LFS)</span>';
        } else if(d.present){
            el.innerHTML = '<span style="color:#f85149">&#10007; '+modelId+': файл есть, но SHA256 НЕ совпадает!</span>';
        } else {
            el.innerHTML = '<span style="color:#f85149">&#10007; '+modelId+': файл отсутствует</span>';
        }
        loadModels();
    }).catch(function(e){
        el.innerHTML = '<span style="color:#f85149">&#10007; Ошибка: '+e+'</span>';
    });
}

// --- Ollama tab ---
var _ollamaOk = false;
var REQUIRED_MODELS = [
    {name:'qwen3-embedding:0.6b', purpose:'Семантическая индексация'},
    {name:'qwen3.5:4b', purpose:'Описание фото / Обогащение'},
];

function ollamaLoad(){
    fetch(API+'/settings/ollama_base_url').then(r=>r.json()).then(function(v){
        if(v && v.value) document.getElementById('ollamaUrl').value = v.value;
    });
}
function ollamaCheck(){
    var info = document.getElementById('ollamaServerInfo');
    var sec = document.getElementById('ollamaModelsSec');
    var chk = document.getElementById('ollamaModelChecks');
    var saveBtn = document.getElementById('ollamaSaveBtn');
    var url = document.getElementById('ollamaUrl').value;
    if(!url){ info.innerHTML='<span style=\"color:#f85149\">Укажите URL сервера</span>'; return; }

    info.innerHTML = '<span style=\"color:#58a6ff\">Проверяю...</span>';
    sec.style.display = 'none'; saveBtn.style.display = 'none';
    _ollamaOk = false;

    fetch(API+'/../api/proxy/ollama_check?url='+encodeURIComponent(url))
    .then(r=>r.json()).then(function(ver){
        if(!ver.ok){ info.innerHTML='<span style=\"color:#f85149\">&#10007; Сервер недоступен: '+esc(ver.error||'нет ответа')+'</span>'; return; }

        info.innerHTML = '<span style=\"color:#3fb950\">&#10003; Доступен</span> — v'+esc(ver.version);

        // Now check models
        return fetch(API+'/../api/proxy/ollama_models?url='+encodeURIComponent(url));
    }).then(r=>r?r.json():null).then(function(d){
        if(!d || !d.models){ d={models:[]}; }
        var names = {};
        d.models.forEach(function(m){ names[m.name] = m; });

        var h = '<table style=\"width:100%;border-collapse:collapse;margin-top:8px\">';
        h += '<tr style=\"color:#6e7681\"><th style=\"text-align:left;padding:6px\">Модель</th><th style=\"text-align:left;padding:6px\">Назначение</th><th style=\"text-align:center;padding:6px\">Статус</th></tr>';
        var allOk = true;
        REQUIRED_MODELS.forEach(function(req){
            var found = names[req.name];
            if(found){
                h += '<tr><td style=\"padding:6px\">'+esc(req.name)+'</td><td style=\"padding:6px;color:#6e7681\">'+req.purpose+'</td><td style=\"text-align:center;padding:6px\"><span style=\"color:#3fb950\">&#10003; '+formatBytes(found.size)+'</span></td></tr>';
            } else {
                allOk = false;
                h += '<tr><td style=\"padding:6px\">'+esc(req.name)+'</td><td style=\"padding:6px;color:#6e7681\">'+req.purpose+'</td><td style=\"text-align:center;padding:6px\"><span style=\"color:#f85149\">&#10007; Нет</span></td></tr>';
                h += '<tr><td colspan=\"3\" style=\"padding:0 6px 8px 6px\"><span style=\"color:#d29922;font-size:11px\">Администратору сервера Ollama:<br><code>ollama pull '+esc(req.name)+'</code></span></td></tr>';
            }
        });
        h += '</table>';
        chk.innerHTML = h;
        sec.style.display = 'block';
        _ollamaOk = allOk;
        if(allOk){
            info.innerHTML += ' <span style=\"color:#3fb950;margin-left:8px\">Все модели на месте</span>';
            saveBtn.style.display = 'inline-block';
        } else {
            info.innerHTML += ' <span style=\"color:#d29922;margin-left:8px\">Не хватает моделей</span>';
            saveBtn.style.display = 'none';
        }
    }).catch(function(e){
        info.innerHTML='<span style=\"color:#f85149\">&#10007; Ошибка: '+e+'</span>';
    });
}
function ollamaSave(){
    var el = document.getElementById('ollamaSaveStatus');
    var url = document.getElementById('ollamaUrl').value;
    el.textContent='Сохраняю...'; el.style.color='#58a6ff';
    fetch(API+'/settings/ollama_base_url',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:url})})
    .then(function(){ el.textContent='Сохранено'; el.style.color='#3fb950'; })
    .catch(function(e){ el.textContent='Ошибка: '+e; el.style.color='#f85149'; });
}
function formatBytes(b){ if(!b)return '?'; var u=['B','KB','MB','GB'],i=0; while(b>=1024&&i<3){b/=1024;i++;} return b.toFixed(1)+' '+u[i]; }

// --- Task routing ---
var DUAL_TASKS = [
    {id:'embed', name:'Семантическая индексация', modelId:'qwen3-embed', ollamaModel:'qwen3-embedding:0.6b', backendKey:'embed_backend'},
    {id:'semantic_search', name:'Семантический поиск', modelId:'qwen3-embed', ollamaModel:'qwen3-embedding:0.6b', backendKey:'search_backend'},
    {id:'describe', name:'Описание фото', modelId:'qwen3-vlm', ollamaModel:'qwen3.5:4b', backendKey:'describe_backend'},
];
function loadRouting(){
    try {
    var url = document.getElementById('ollamaUrl').value;
    var prom = url ? fetch(API+'/../api/proxy/ollama_models?url='+encodeURIComponent(url)).then(r=>r.json()).catch(function(){return{models:[]}}) : Promise.resolve({models:[]});
    var backendProms = DUAL_TASKS.map(function(t){ return fetch(API+'/settings/'+t.backendKey).then(r=>r.json()).catch(function(){return{value:''}}); });
    Promise.all([
        fetch(API+'/models').then(r=>r.json()).catch(function(){return{models:[]}}),
        Promise.all(backendProms),
        prom
    ]).then(function(r){
        var backendMap = {};
        (r[1]||[]).forEach(function(v,i){ backendMap[DUAL_TASKS[i].id] = (v && v.value) || 'local'; });
        return {localModels:r[0], backends:backendMap, ollamaModels:r[2].models||[]};
    }).then(function(data){
        var localPresent = {};
        (data.localModels.models||[]).forEach(function(m){ localPresent[m.id] = m.present||false; });
        var ollamaNames = {};
        (data.ollamaModels||[]).forEach(function(m){ ollamaNames[m.name] = true; });

        var sec = document.getElementById('routingSec');
        var list = document.getElementById('routingList');
        if(!sec || !list) return;
        var h = '';
        DUAL_TASKS.forEach(function(t){
            var localOk = localPresent[t.modelId] || false;
            var ollamaOk = ollamaNames[t.ollamaModel] || false;
            var mode = data.backends[t.id] || 'local';
            var isOllama = mode === 'ollama';

            var lc = localOk ? '#3fb950' : '#f85149';
            var oc = ollamaOk ? '#3fb950' : '#f85149';

            h += '<div style=\"padding:12px 0;border-bottom:1px solid #21262d\">';
            h += '<div style=\"font-weight:600;margin-bottom:8px\">'+t.name+'</div>';

            // Toggle bar
            h += '<div style=\"display:flex;align-items:center;gap:12px;margin-bottom:4px;font-size:13px\">';

            // Local badge
            h += '<span style=\"display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;border:1px solid '+lc+';color:'+lc+';font-size:12px\">&#127968; Локально</span>';

            // Dots
            h += '<div onclick=\"switchBackend(\''+t.id+'\',\'local\')\" '
                +'style=\"width:14px;height:14px;border-radius:50%;border:2.5px solid #000;'
                +(isOllama?'background:transparent':'background:#000')
                +';cursor:pointer;flex-shrink:0\"></div>';

            h += '<div style=\"width:36px;height:2.5px;background:#000;flex-shrink:0\"></div>';

            h += '<div onclick=\"switchBackend(\''+t.id+'\',\'ollama\')\" '
                +'style=\"width:14px;height:14px;border-radius:50%;border:2.5px solid #000;'
                +(isOllama?'background:#000':'background:transparent')
                +';cursor:pointer;flex-shrink:0\"></div>';

            // Ollama badge
            h += '<span style=\"display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;border:1px solid '+oc+';color:'+oc+';font-size:12px\">&#129302; Ollama</span>';

            h += '</div>';

            h += '<div style=\"font-size:11px;color:#6e7681\">Используется '+(isOllama?'внешний сервер Ollama':'локальная модель')+'</div>';

            if(!localOk) h += '<div style=\"font-size:10px;color:#f85149;margin-top:2px\">Локальная модель отсутствует</div>';
            if(!ollamaOk) h += '<div style=\"font-size:10px;color:#d29922;margin-top:2px\"><code>ollama pull '+t.ollamaModel+'</code></div>';

            h += '</div>';
        });
        list.innerHTML = h;
        sec.style.display = 'block';
    }).catch(function(e){ console.error('loadRouting failed:', e); });
    } catch(e){ console.error('loadRouting JS error:', e); }
}
function switchBackend(taskId, mode){
    var task = DUAL_TASKS.find(function(t){return t.id===taskId;});
    var key = task ? task.backendKey : 'ollama_mode';
    fetch(API+'/settings/'+key,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:mode})})
    .then(function(){ loadRouting(); });
}

switchTab.ollamaInit = false;
var origSwitchTab = switchTab;
switchTab = function(t){
    origSwitchTab(t);
    if(t==='ollama' && !switchTab.ollamaInit){ ollamaLoad(); switchTab.ollamaInit = true; }
    if(t==='routing'){ loadRouting(); }
};

loadModels();

// Auto-load Ollama URL if saved, and routing
(function initOllama(){
    fetch(API+'/settings/ollama_base_url').then(r=>r.json()).then(function(v){
        if(v && v.value){ document.getElementById('ollamaUrl').value = v.value; ollamaCheck(); }
        loadRouting();
    }).catch(function(){ loadRouting(); });
})();
