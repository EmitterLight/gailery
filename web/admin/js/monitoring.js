var Mon = {interval:null, sysLoaded:false};

Admin.on('navigate', function(page) {
    if (page === 'monitoring') { Mon.init(); Mon.load(); Mon.interval = setInterval(Mon.load, 5000); }
    else { if (Mon.interval) { clearInterval(Mon.interval); Mon.interval = null; } }
});

Mon.init = function() {
    var p = document.getElementById('page-monitoring');
    if (!p) return;
    p.innerHTML =
        '<style>'+
        '.m-info{font-size:10px;color:#777;margin:0 0 14px 0;line-height:1.6}'+
        '.m-info b{color:#bbb;font-weight:600}.m-info i{color:#484f58}'+
        '.m-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:5px;margin:0 0 16px 0}'+
        '.m-box{background:#0d1117;border:1px solid #21262d;border-radius:5px;padding:7px 9px 5px}'+
        '.m-hd{display:flex;justify-content:space-between;align-items:center;margin:0 0 3px 0}'+
        '.m-lb{font-size:9px;color:#555;text-transform:uppercase}'+
        '.m-vl{font-size:13px;font-weight:700;color:#ddd}'+
        '.m-box.wrn{border-color:#d29922}.m-box.wrn .m-vl{color:#d29922}'+
        '.m-sp{width:100%;height:36px;display:block}'+
        '.m-det{font-size:8px;color:#444;line-height:1.4;margin-top:2px}'+
        '.m-charts{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:8px}'+
        '.m-ch{background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:10px 12px 8px}'+
        '.m-ch h4{font-size:10px;font-weight:600;color:#6e7681;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:.3px}'+
        '.m-ch svg{width:100%;height:90px;display:block}'+
        '.m-ch .m-lg{display:flex;gap:12px;margin-top:4px;flex-wrap:wrap}'+
        '.m-ch .m-lg b{font-size:8px;font-weight:400;font-style:normal;display:flex;align-items:center;gap:4px}'+
        '.m-ch .m-lg b::before{content:"";display:inline-block;width:8px;height:2px;border-radius:1px}'+

        '.m-report{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:6px}'+
        '.m-r-block{background:#0d1117;border:1px solid #21262d;border-radius:5px;padding:10px 12px 8px;font-size:8px;color:#8b949e;line-height:1.5}'+
        '.m-r-block b{color:#c9d1d9;font-weight:600}'+
        '.m-r-block h4{font-size:10px;color:#6e7681;margin:0 0 5px 0;text-transform:uppercase;letter-spacing:.3px;border-bottom:1px solid #21262d;padding-bottom:4px}'+
        '.light-theme .m-r-block{background:#fff;border-color:#ddd;color:#666}'+
        '.light-theme .m-r-block b{color:#333}'+
        '.light-theme .m-r-block h4{color:#999;border-color:#ddd}'+

        '.light-theme .m-info{color:#666}.light-theme .m-info b{color:#333}.light-theme .m-info i{color:#999}'+
        '.light-theme .m-box{background:#fff;border-color:#ddd}.light-theme .m-lb{color:#999}.light-theme .m-vl{color:#333}'+
        '.light-theme .m-box.wrn{border-color:#bf8700}.light-theme .m-box.wrn .m-vl{color:#bf8700}.light-theme .m-det{color:#aaa}'+
        '.light-theme .m-ch{background:#fff;border-color:#ddd}.light-theme .m-ch h4{color:#999}'+
        '</style>'+
        '<h3 style="margin:0 0 10px 0;font-size:15px;font-weight:600">📈 System Monitor</h3>'+
        '<div class="m-info" id="mInfo"></div>'+
        '<div id="mReport" style="margin-bottom:16px"></div>'+
        '<div class="m-grid" id="mGrid"></div>'+
        '<div class="m-charts" id="mCharts"></div>';
};

Mon.load = function() {
    Admin.ajax('/../api/monitoring', function(d) {
        Mon._hist = d.history;
        Mon.renderCards(d.live);
        Mon.renderCharts(d.history);
        Mon.renderInfo(d.live);
    });
    Admin.ajax('/../api/system-report', function(r) {
        Mon.renderReport(r);
    });
    if (!Mon.sysLoaded) { Mon.sysLoaded = true; Mon.loadPhotos(); }
};

Mon.loadPhotos = function() {
    Admin.ajax('/../api/status', function(s) {
        Mon._photos = s.catalog_total ? s.catalog_total+' photos, '+s.personas_total+' personas' : '';
        if (Mon._lastLive) Mon.renderInfo(Mon._lastLive);
    });
};

Mon.renderInfo = function(L) {
    Mon._lastLive = L;
    var el = document.getElementById('mInfo');
    if (!el) return;
    var si = L.system_info || {};
    var u = L.uptime_seconds || 0;
    var ud = Math.floor(u/86400), uh = Math.floor((u%86400)/3600), um = Math.floor((u%3600)/60);
    var up = ud+'d '+uh+'h '+um+'m';
    el.innerHTML =
        '<b>'+si.hostname+'</b> [LXC] | '+
        'kernel <b>'+si.kernel+'</b>, up <b>'+up+'</b> | '+
        'GPU <b>'+si.gpu_name+'</b> (drv '+si.driver_ver+', PCIe '+si.pcie_gen+'x'+si.pcie_width+') | '+
        'CPU <b>'+si.cpu_model+'</b>, '+si.cpu_count+' cores | '+
        'RAM <b>'+si.ram_total_gb+' GiB</b> (used '+(si.ram_total_gb - L.mem_avail_gb).toFixed(1)+' GiB) | '+
        'Disks <b>'+(si.disk_root_gb||'?')+' GiB</b> + <b>'+(si.disk_share_gb||'?')+' GiB</b>'+
        (Mon._photos ? ' | '+Mon._photos : '')+
        '<br><i>'+(L.timestamp||'').substring(0,19).replace('T',' ')+'</i>';
};

Mon.renderCards = function(L) {
    var el = document.getElementById('mGrid');
    if (!el) return;
    var H = Mon._hist;
    var si = L.system_info || {};
    var ramTotal = si.ram_total_gb || 16;
    var rootGb = si.disk_root_gb || 126;
    var shareGb = si.disk_share_gb || 1800;
    var vr = (L.gpu_vram_mb/1024).toFixed(1), vt = ((L.gpu_vram_total||8192)/1024).toFixed(0);
    var rf = L.mem_avail_gb.toFixed(1);

    var items = [
        {k:'gpu_load',      lb:'GPU %',  vl:L.gpu_load+'%',           dt:'VRAM '+vr+'/'+vt+' GiB',                          cl:'#3fb950', w:L.gpu_load>80},
        {k:'gpu_vram_mb',   lb:'VRAM',   vl:vr+' GiB',                dt:'of '+vt+' GiB ('+Math.round(L.gpu_vram_mb/L.gpu_vram_total*100)+'%)', cl:'#3fb950', w:L.gpu_vram_mb/L.gpu_vram_total>0.85},
        {k:'gpu_temp',      lb:'GPU °C', vl:L.gpu_temp+'°C',         dt:'Fan '+L.gpu_fan+'%',                              cl:'#db6d28', w:L.gpu_temp>75},
        {k:'gpu_power_w',   lb:'GPU W',  vl:L.gpu_power_w.toFixed(0)+'W',  dt:'Limit 180 W',                              cl:'#f0883e', w:L.gpu_power_w>160},
        {k:'gpu_sm_clock',  lb:'SM MHz', vl:L.gpu_sm_clock.toFixed(0)+' MHz', dt:'Max 1911 MHz',                               cl:'#bc8cff', w:false},
        {k:'gpu_fan',       lb:'Fan %',  vl:L.gpu_fan+'%',           dt:'GPU '+L.gpu_temp+'°C  '+L.gpu_power_w.toFixed(0)+'W', cl:'#8b949e', w:false},
        {k:'cpu_percent',   lb:'CPU %',  vl:Math.round(L.cpu_percent)+'%', dt:'t° max '+L.cpu_temp_max+'°C',                        cl:'#58a6ff', w:L.cpu_percent>80},
        {k:'cpu_temp_max',  lb:'CPU °C', vl:L.cpu_temp_max+'°C',     dt:'Load '+Math.round(L.cpu_percent)+'%',                       cl:'#f0883e', w:L.cpu_temp_max>85},
        {k:'mem_percent',   lb:'RAM %',  vl:Math.round(L.mem_percent)+'%', dt:'Free '+rf+' GiB',                                   cl:'#58a6ff', w:L.mem_percent>85},
        {k:'mem_avail_gb',  lb:'RAM free', vl:rf+' GiB',               dt:'Used '+(ramTotal-L.mem_avail_gb).toFixed(1)+' GiB',       cl:'#bc8cff', w:L.mem_avail_gb<2},
        {k:'disk_root',     lb:'Disk /', vl:Math.round(L.disk_root)+'%', dt:Math.round(rootGb)+' GiB SSD',                      cl:'#58a6ff', w:L.disk_root>85},
        {k:'disk_share',    lb:'/mnt',   vl:Math.round(L.disk_share)+'%', dt:(shareGb>=1000?(shareGb/1000).toFixed(1)+' TiB':Math.round(shareGb)+' GiB'), cl:'#f0883e', w:L.disk_share>85},
    ];

    el.innerHTML = items.map(function(x){
        var sp = '';
        var vals;
        if (H && H.length >= 2) {
            vals = H.map(function(r){return (r[x.k]||0);});
        }
        if (vals && vals.length >= 2) {
            var lo = Math.min.apply(null,vals), hi = Math.max.apply(null,vals);
            if (hi-lo < 0.5) { hi = lo + 1; lo = lo - 1; }
            var rng = hi - lo, n = vals.length-1, sw = 100, sh = 28;
            var pts = vals.map(function(v,i){
                return Math.round(i/n*sw)+','+Math.round(sh-4-((v-lo)/rng)*(sh-8));
            }).join(' ');
            sp = '<svg class="m-sp" viewBox="0 0 '+sw+' '+sh+'" preserveAspectRatio="none"><polyline points="'+pts+'" fill="none" stroke="'+x.cl+'" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>';
        }
        return '<div class="m-box'+(x.w?' wrn':'')+'"><div class="m-hd"><span class="m-lb">'+x.lb+'</span><span class="m-vl">'+x.vl+'</span></div>'+sp+'<div class="m-det">'+x.dt+'</div></div>';
    }).join('');
};

Mon.renderCharts = function(H) {
    var el = document.getElementById('mCharts');
    if (!el || !H || H.length < 3) return;
    var n = H.length-1;
    var W = 200, Ht = 68, M = 38, T = 3, B = Ht-1, mid = Math.round((T+B)/2);

    var panels = [
        {t:'CPU + GPU load', unit:'%', ls:[
            {k:'cpu_percent',c:'#58a6ff',n:'CPU'},{k:'gpu_load',c:'#3fb950',n:'GPU'}]},
        {t:'Temperatures', unit:'°C', ls:[
            {k:'cpu_temp_max',c:'#f0883e',n:'CPU'},{k:'gpu_temp',c:'#db6d28',n:'GPU'}]},
        {t:'Memory + VRAM', unit:'GiB', ls:[
            {k:'mem_percent',c:'#58a6ff',n:'RAM %'},{k:'gpu_vram_mb',c:'#3fb950',n:'VRAM'}]},
        {t:'Load Average', unit:'', ls:[
            {k:'load1',c:'#58a6ff',n:'1m'},{k:'load5',c:'#f0883e',n:'5m'},{k:'load15',c:'#8b949e',n:'15m'}]},
        {t:'GPU Power + Fan', unit:'W', ls:[
            {k:'gpu_power_w',c:'#f0883e',n:'Watt'},{k:'gpu_fan',c:'#8b949e',n:'Fan %'}]},
        {t:'Disks', unit:'%', ls:[
            {k:'disk_root',c:'#58a6ff',n:'/'},{k:'disk_share',c:'#f0883e',n:'/mnt'}]},
    ];

    el.innerHTML = panels.map(function(p){
        var hi = 0;
        p.ls.forEach(function(l){
            var mx = Math.max.apply(null, H.map(function(r){return r[l.k]||0;}));
            if (mx > hi) hi = mx;
        });
        hi = Math.ceil(hi*1.12)||100;

        var fmtVal = function(v){
            if (p.unit === '%') return Math.round(v);
            if (p.unit === '°C') return Math.round(v)+'°';
            if (p.unit === 'GiB') {
                if (v > 100) return (v/1024).toFixed(1);
                return Math.round(v);
            }
            if (p.unit === 'W') return Math.round(v);
            return v.toFixed(1);
        };

        var axes =
            '<line x1="'+M+'" y1="'+T+'" x2="'+W+'" y2="'+T+'" stroke="#21262d" stroke-width="0.5"/>'+
            '<line x1="'+M+'" y1="'+mid+'" x2="'+W+'" y2="'+mid+'" stroke="#21262d" stroke-width="0.5"/>'+
            '<line x1="'+M+'" y1="'+B+'" x2="'+W+'" y2="'+B+'" stroke="#30363d" stroke-width="0.5"/>'+
            '<text x="'+(M-3)+'" y="'+(T+4)+'" text-anchor="end" fill="#484f58" font-size="7">'+fmtVal(hi)+'</text>'+
            '<text x="'+(M-3)+'" y="'+(mid+3)+'" text-anchor="end" fill="#484f58" font-size="7">'+fmtVal(hi/2)+'</text>'+
            '<text x="'+(M-3)+'" y="'+(B+3)+'" text-anchor="end" fill="#484f58" font-size="7">0</text>';

        var lines = '';
        p.ls.forEach(function(l){
            var vals = H.map(function(r){return r[l.k]||0;});
            var pts = vals.map(function(v,i){
                var x = M + (i/n)*(W-M);
                var y = T + (1 - v/hi)*(B-T);
                return Math.round(x)+','+Math.round(y);
            }).join(' ');
            lines += '<polyline points="'+pts+'" fill="none" stroke="'+l.c+'" stroke-width="1" vector-effect="non-scaling-stroke"/>';
        });

        var leg = p.ls.map(function(l){
            return '<b style="color:'+l.c+'">'+l.n+'</b>';
        }).join('');

        var unitLabel = p.unit ? '<span style="font-size:8px;color:#484f58;margin-left:4px">'+p.unit+'</span>' : '';

        return '<div class="m-ch"><h4>'+p.t+unitLabel+'</h4><svg viewBox="0 0 '+W+' '+Ht+'" preserveAspectRatio="none">'+axes+lines+'</svg><div class="m-lg">'+leg+'</div></div>';
    }).join('');
};

Mon.renderReport = function(r) {
    var el = document.getElementById('mReport');
    if (!el || !r) return;
    var fmtU = function(s){var d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60);return d+'d '+h+'h '+m+'m';};
    var fmtG = function(v){return v.toFixed(1)+' GiB';};
    var h = r.host, m = r.memory, g = r.gpu, d = r.disks, n = r.network, gr = r.gailray, t = r.top_processes;

    var blocks = [
        {t:'Host', c:
            '<b>'+h.hostname+'</b> [LXC container]<br>'+
            'Kernel: <b>'+h.kernel+'</b><br>'+
            'Uptime: <b>'+fmtU(h.uptime_seconds)+'</b><br>'+
            'CPU: <b>'+h.cpu_model+'</b><br>'+
            'Cores: <b>'+h.cpu_cores_physical+'</b> physical / <b>'+h.cpu_cores_logical+'</b> logical<br>'+
            'Load avg: <b>'+h.load_1m.toFixed(1)+'/'+h.load_5m.toFixed(1)+'/'+h.load_15m.toFixed(1)+'</b><br>'+
            'CPU usage: <b>'+Math.round(h.cpu_percent)+'%</b> | max core temp: <b>'+h.cpu_temp_max+'°C</b>'
        },
        {t:'Memory', c:
            'Total: <b>'+fmtG(m.total_gib)+'</b><br>'+
            'Used: <b>'+fmtG(m.used_gib)+'</b> ('+Math.round(m.percent)+'%)<br>'+
            'Available: <b>'+fmtG(m.available_gib)+'</b><br>'+
            'Free: <b>'+fmtG(m.free_gib)+'</b><br>'+
            'Cached/Buffers: <b>'+fmtG(m.cached_gib)+'</b><br>'+
            (m.swap_total_gib>0 ? 'Swap: <b>'+fmtG(m.swap_used_gib)+'</b> / '+fmtG(m.swap_total_gib)+'<br>' : 'Swap: <b>none</b><br>')
        },
        {t:'GPU', c:
            '<b>'+g.name+'</b><br>'+
            'Driver: <b>'+g.driver+'</b> | PCIe: <b>'+g.pcie_gen+'x'+g.pcie_width+'</b><br>'+
            'Load: <b>'+Math.round(g.load_pct)+'%</b> | Temp: <b>'+g.temp_c+'°C</b><br>'+
            'VRAM: <b>'+(g.vram_used_mb/1024).toFixed(1)+' / '+(g.vram_total_mb/1024).toFixed(0)+' GiB</b> ('+Math.round(g.vram_used_mb/g.vram_total_mb*100)+'%)<br>'+
            'Power: <b>'+Math.round(g.power_w)+' W</b> | Fan: <b>'+Math.round(g.fan_pct)+'%</b><br>'+
            'SM clock: <b>'+Math.round(g.sm_clock_mhz)+' MHz</b> | Mem clock: <b>'+Math.round(g.mem_clock_mhz)+' MHz</b><br>'+
            (g.processes||[]).map(function(p){return 'GPU proc: <b>'+p.name+'</b> PID='+p.pid+' VRAM='+p.vram_mb+' MB<br>';}).join('')
        },
        {t:'Disks', c: d.map(function(d){
            return '<b>'+d.mount+'</b> ('+d.device+', '+d.fstype+'):<br>'+
                '&nbsp;Total: <b>'+fmtG(d.total_gib)+'</b> | Used: <b>'+fmtG(d.used_gib)+'</b> ('+Math.round(d.percent)+'%)<br>'+
                '&nbsp;Free: <b>'+fmtG(d.free_gib)+'</b><br>';
        }).join('')
        },
        {t:'Network', c:
            'RX: <b>'+n.rx_gb.toFixed(2)+' GB</b> ('+n.packets_recv+' packets)<br>'+
            'TX: <b>'+n.tx_gb.toFixed(2)+' GB</b> ('+n.packets_sent+' packets)'
        },
        {t:'Top processes', c: t.map(function(p){
            return '<b>'+p.name+'</b> PID='+p.pid+' RAM='+p.mem_pct.toFixed(1)+'% CPU='+p.cpu_pct.toFixed(1)+'%<br>';
        }).join('')
        },
        {t:'Gailray DB', c:
            'Photos: <b>'+gr.photos+'</b> | Persons: <b>'+gr.persons+'</b> | Faces: <b>'+gr.faces+'</b><br>'+
            'Catalog files: <b>'+gr.catalog_files+'</b><br>'+
            'SQLite: <b>'+gr.db_size_mb.toFixed(0)+' MB</b> | LanceDB: <b>'+gr.lancedb_size_mb.toFixed(0)+' MB</b>'
        },
    ];
    el.innerHTML = '<div class="m-report">'+blocks.map(function(b){
        return '<div class="m-r-block"><h4>'+b.t+'</h4>'+b.c+'</div>';
    }).join('')+'</div>';
};
