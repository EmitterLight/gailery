// Tools module: hashes, duplicates, backup, maintenance
(function(A) {

var hashWorkerPid = 0, _hashPollTimer = null;

// ═══════ HASHES ═══════
function buildHashes() {
    var el = A.$('page-hashes');
    if (!el) return;
    el.innerHTML =
        '<h2 style="margin-bottom:16px;font-size:16px;color:#e6edf3">🔗 Хеши и дубликаты</h2>'+
        '<div class="backup-sec"><h3>Контроль хешей</h3>'+
        '<div id="hashStats" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px"></div>'+
        '<div class="maint-row"><button class="btn btn-go" id="btnHashStart">Расчёт хешей</button><button class="btn btn-stop" id="btnHashStop" disabled>Стоп</button></div>'+
        '<div class="maint-row"><button class="btn btn-go" id="btnHashDups">Найти дубликаты</button></div>'+
        '<div id="hashStatus" class="backup-status"></div>'+
        '<div id="dupList" style="max-height:300px;overflow:auto;margin-top:8px;font-size:12px"></div></div>';

    A.$('btnHashStart').addEventListener('click', hashBackfill);
    A.$('btnHashStop').addEventListener('click', hashBackfillStop);
    A.$('btnHashDups').addEventListener('click', hashFindDuplicates);
    loadHashStats();
}

function loadHashStats() {
    A.ajax('/api/catalog/hash_status', function(d) {
        var total = d.total_files||0, withH = d.with_hash||0, withoutH = d.without_hash||0;
        var zeroByte = d.zero_byte||0, pendingH = d.pending_hash||0;
        var dupGroups = d.duplicate_groups||0, dupFiles = d.duplicate_files||0;
        var pct = total>0 ? Math.round(withH/total*100) : 0;
        var h = '';
        h += '<div class="maint-sbox"><div class="sv">'+withH+' / '+total+'</div><div class="sl">С хешем ('+pct+'%)</div></div>';
        if (pendingH>0) h += '<div class="maint-sbox"><div class="sv" style="color:#f0883e">'+pendingH+'</div><div class="sl">Ждут хеширования</div></div>';
        if (zeroByte>0) h += '<div class="maint-sbox" style="border-color:#f85149"><div class="sv" style="color:#f85149">'+zeroByte+'</div><div class="sl">Повреждены (0 байт)</div></div>';
        if (dupGroups>0) h += '<div class="maint-sbox" style="border-color:#f85149"><div class="sv" style="color:#f85149">'+dupGroups+'</div><div class="sl">Групп дублей ('+dupFiles+' файлов)</div></div>';
        A.$('hashStats').innerHTML = h;
        if (withoutH===0) A.$('btnHashStart').disabled = true;
    });
    A.ajax('/api/catalog/hash_backfill_status', function(d) {
        if (d.running && d.pids && d.pids.length>0) {
            hashWorkerPid = d.pids[0];
            A.$('btnHashStart').disabled = true;
            A.$('btnHashStop').disabled = false;
            A.$('hashStatus').className = 'backup-status ok';
            A.$('hashStatus').textContent = 'Воркер работает (PID '+hashWorkerPid+')';
            pollHashWorker();
        }
    });
}

function hashBackfill() {
    var el = A.$('hashStatus');
    el.className = 'backup-status'; el.textContent = 'Запуск расчёта хешей...';
    A.post('/api/catalog/hash_backfill', null, function(d) {
        hashWorkerPid = d.pid;
        el.className = 'backup-status ok';
        el.textContent = 'Воркер запущен (PID '+d.pid+')';
        A.$('btnHashStart').disabled = true;
        A.$('btnHashStop').disabled = false;
        pollHashWorker();
    }, function(e) {
        el.className = 'backup-status err'; el.textContent = 'Ошибка: '+e.message;
    });
}

function hashBackfillStop() {
    if (!hashWorkerPid) return;
    var el = A.$('hashStatus');
    A.post('/api/catalog/hash_backfill_stop', null, function(d) {
        el.className = 'backup-status ok';
        el.textContent = 'Воркер остановлен (killed PIDs: '+(d.killed||[]).join(', ')+')';
        hashWorkerPid = 0;
        A.$('btnHashStart').disabled = false;
        A.$('btnHashStop').disabled = true;
        if (_hashPollTimer) { clearTimeout(_hashPollTimer); _hashPollTimer = null; }
        loadHashStats();
    }, function(e) {
        el.className = 'backup-status err'; el.textContent = 'Ошибка: '+e.message;
    });
}

function pollHashWorker() {
    A.ajax('/api/catalog/hash_backfill_status', function(d) {
        if (!d.running) {
            A.$('hashStatus').className = 'backup-status ok';
            A.$('hashStatus').textContent = 'Расчёт хешей завершён';
            hashWorkerPid = 0;
            A.$('btnHashStart').disabled = false;
            A.$('btnHashStop').disabled = true;
            loadHashStats();
            return;
        }
        if (d.pids && d.pids.length>0) hashWorkerPid = d.pids[0];
        loadHashStats();
        _hashPollTimer = setTimeout(pollHashWorker, 5000);
    }, function() {
        _hashPollTimer = setTimeout(pollHashWorker, 10000);
    });
}

function hashFindDuplicates() {
    var el = A.$('hashStatus'), dl = A.$('dupList');
    el.className = 'backup-status'; el.textContent = 'Поиск дубликатов...';
    dl.innerHTML = '';
    A.ajax('/api/catalog/duplicates?limit=100', function(d) {
        var groups = d.duplicates||[];
        if (groups.length===0) {
            el.className = 'backup-status ok'; el.textContent = 'Дубликатов не найдено';
            return;
        }
        el.className = 'backup-status ok'; el.textContent = 'Найдено '+groups.length+' групп дубликатов';
        var h = '';
        for (var i=0;i<groups.length;i++) {
            var g = groups[i];
            h += '<div style="margin-bottom:8px;padding:6px;background:#21262d;border:1px solid #30363d;border-radius:4px">';
            h += '<b style="color:#f0883e">'+g.count+' копий</b> <span style="color:#6e7681">'+A.esc(g.hash)+'</span>';
            for (var j=0;j<g.paths.length;j++) {
                var p = g.paths[j].replace(/\\\\/g,'/');
                var short = p.split('/').slice(-2).join('/');
                h += '<div style="padding-left:12px;color:#8b949e;word-break:break-all" title="'+A.esc(p)+'">'+A.esc(short)+'</div>';
            }
            h += '</div>';
        }
        dl.innerHTML = h;
        loadHashStats();
    }, function(e) {
        el.className = 'backup-status err'; el.textContent = 'Ошибка: '+e.message;
    });
}

// ═══════ MAINTENANCE + BACKUP ═══════
function buildMaint() {
    var el = A.$('page-maint');
    if (!el) return;
    el.innerHTML =
        '<h2 style="margin-bottom:16px;font-size:16px;color:#e6edf3">🛠️ Обслуживание БД</h2>'+
        '<div class="backup-sec"><h3>Бекап</h3>'+
        '<div class="backup-row"><button class="btn btn-go" id="btnBackupDownload">📥 Скачать</button>'+
        '<label class="btn btn-go btn-sm" style="cursor:pointer">📤 Загрузить <input type="file" accept=".gz,.db" id="backupUploadInput" style="display:none"></label>'+
        '<span class="backup-info" id="backupInfo"></span></div>'+
        '<div id="backupStatus" class="backup-status"></div></div>'+
        '<div class="maint-sec"><h3>Обслуживание</h3>'+
        '<div id="maintSizes" class="maint-sizes"></div>'+
        '<div class="maint-row"><button class="btn btn-go" id="btnVacuum">VACUUM SQLite</button><span class="maint-info">Сжать базу</span></div>'+
        '<div class="maint-row"><button class="btn btn-go" id="btnDedup">Удалить дубли индексов</button><span class="maint-info">LanceDB дедупликация</span></div>'+
        '<div id="maintStatus" class="backup-status"></div></div>';

    A.$('btnBackupDownload').addEventListener('click', backupDownload);
    A.$('backupUploadInput').addEventListener('change', function() { backupUpload(this); });
    A.$('btnVacuum').addEventListener('click', maintVacuum);
    A.$('btnDedup').addEventListener('click', maintDedup);
    loadMaintStats();
}

function loadMaintStats() {
    A.ajax('/api/maintenance/stats', function(d) {
        var h = '';
        var sqliteMain = d['gallery.db']||0, sqliteWAL = d['gallery.db-wal']||0;
        h += '<div class="maint-sbox"><div class="sv">'+A.fmtBytes(sqliteMain)+'</div><div class="sl">gallery.db</div></div>';
        if (sqliteWAL>1048576) h += '<div class="maint-sbox"><div class="sv">'+A.fmtBytes(sqliteWAL)+'</div><div class="sl">gallery.db-wal</div></div>';
        var legacyDb = d['gailray.db']||0, legacyWAL = d['gailray.db-wal']||0;
        if (legacyDb>0) h += '<div class="maint-sbox legacy"><div class="sv">'+A.fmtBytes(legacyDb+legacyWAL)+'</div><div class="sl">gailray.db (устарела)</div></div>';

        var lanceNames = {
            'photo_embeddings':'Семантические индексы','face_vectors':'Векторы лиц',
            'faces':'Лица (legacy)','personas':'Персоны','photos':'Фото (legacy)',
            'catalog_files':'Каталог файлов','catalog_roots':'Каталог корней'
        };
        var lt = d.lance_tables||{};
        var lanceOrder = ['photo_embeddings','face_vectors','personas','faces','photos','catalog_files','catalog_roots'];
        for (var i=0;i<lanceOrder.length;i++) {
            var k = lanceOrder[i];
            if (lt[k]!==undefined && lt[k]>0) {
                var cls = (k==='faces'||k==='photos')?' legacy':'';
                h += '<div class="maint-sbox'+cls+'"><div class="sv">'+A.fmtBytes(lt[k])+'</div><div class="sl">'+(lanceNames[k]||k)+'</div></div>';
            }
        }
        h += '<div class="maint-sbox total"><div class="sv">'+A.fmtBytes(d.data_total)+'</div><div class="sl">Всего данных</div></div>';
        A.$('maintSizes').innerHTML = h;
    });
}

function backupDownload() {
    var el = A.$('backupStatus');
    el.className = 'backup-status'; el.textContent = 'Создание бекапа...';
    fetch('/api/backup/download').then(function(r) {
        if (!r.ok) throw new Error('HTTP '+r.status);
        var sz = r.headers.get('content-length');
        var mb = sz ? (parseInt(sz)/1048576).toFixed(1)+'MB' : '';
        el.className = 'backup-status ok'; el.textContent = 'Скачивание... '+mb;
        return r.blob();
    }).then(function(blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'gallery_backup.db.gz'; a.click();
        URL.revokeObjectURL(url);
        el.className = 'backup-status ok'; el.textContent = 'Бекап скачан ('+(blob.size/1048576).toFixed(1)+'MB)';
    }).catch(function(e) {
        el.className = 'backup-status err'; el.textContent = 'Ошибка: '+e.message;
    });
}

function backupUpload(input) {
    if (!input.files || !input.files[0]) return;
    var file = input.files[0];
    var el = A.$('backupStatus');
    el.className = 'backup-status'; el.textContent = 'Загрузка '+file.name+' ('+(file.size/1048576).toFixed(1)+'MB)...';
    var fd = new FormData(); fd.append('file', file);
    fetch('/api/backup/upload', {method:'POST', body:fd}).then(function(r) {
        if (!r.ok) return r.json().then(function(d) { throw new Error(d.detail||'HTTP '+r.status); });
        return r.json();
    }).then(function() {
        el.className = 'backup-status ok'; el.textContent = 'БД восстановлена! Перезапустите сервис для применения.';
    }).catch(function(e) {
        el.className = 'backup-status err'; el.textContent = 'Ошибка: '+e.message;
    });
    input.value = '';
}

function maintVacuum() {
    var el = A.$('maintStatus');
    el.className = 'backup-status'; el.textContent = 'VACUUM...';
    A.post('/api/maintenance/vacuum', null, function(d) {
        el.className = 'backup-status ok';
        el.textContent = 'VACUUM: '+A.fmtBytes(d.before)+' → '+A.fmtBytes(d.after)+' (освобождено '+A.fmtBytes(d.freed)+')';
        loadMaintStats();
    }, function(e) {
        el.className = 'backup-status err'; el.textContent = 'Ошибка: '+e.message;
    });
}

function maintDedup() {
    var el = A.$('maintStatus');
    el.className = 'backup-status'; el.textContent = 'Дедупликация семантических индексов... (может занять минуту)';
    A.post('/api/maintenance/dedup_embeddings', null, function(d) {
        el.className = 'backup-status ok';
        el.textContent = 'Было '+d.before+' → стало '+d.after+' (удалено '+d.removed+' дублей)';
        loadMaintStats();
    }, function(e) {
        el.className = 'backup-status err'; el.textContent = 'Ошибка: '+e.message;
    });
}

A.on('navigate', function(page) {
    if (page==='hashes') { buildHashes(); }
    if (page==='maint') { buildMaint(); }
});

})(window.Admin);