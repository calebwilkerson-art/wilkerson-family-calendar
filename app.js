/* Wilkerson family calendar
 * Shared, live, no login. Data lives in a Firebase Realtime Database reached
 * over its plain REST + streaming API (no SDK), with a local cache so the app
 * paints instantly and keeps working offline. Without a database configured it
 * runs in local mode, saving on this device only.
 */
(function(){
  'use strict';

  var CFG_KEY = 'wilkersonCalCfgV1';
  var CACHE_PREFIX = 'wilkersonCalTreeV3:';
  var PENDING_PREFIX = 'wilkersonCalPendingV3:';
  var OLD_KEY = 'wilkersonCalendarV1';
  var OLD_PHOTO_KEY = 'wilkersonCalendarPhotoV1';
  var PREF_KEY = 'wilkersonCalPrefsV1';

  /* The family photo ships with the site, so it is there the moment anyone opens
     the link. Uploading a new one from Settings replaces it for everyone. */
  var DEFAULT_PHOTO = 'hero.webp';

  var PALETTE = ['#fdb715','#a1d184','#3f7e96','#85aec5','#4e5257','#589db5','#7fb862','#2b5d70','#e0a006','#63656a'];
  var LEGACY_MAP = {
    '#2f5d8a':'#fdb715','#1e3f66':'#fdb715','#2f7d68':'#a1d184','#146149':'#a1d184',
    '#8a3f6b':'#3f7e96','#7d2452':'#3f7e96','#a3702a':'#85aec5','#8a5a1c':'#85aec5',
    '#5c5648':'#4e5257','#4d4638':'#4e5257','#b8562f':'#589db5','#9c4a2c':'#589db5',
    '#4a6a8a':'#7fb862','#2c5468':'#7fb862','#6b7d2f':'#e0a006','#5c6b2c':'#e0a006'
  };
  var MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var DOWS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var DOW1 = ['S','M','T','W','T','F','S'];

  /* ── helpers ─────────────────────────────────────────── */
  function $(id){ return document.getElementById(id); }
  function uid(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }
  function pad(n){ return String(n).padStart(2,'0'); }
  function iso(y,m,d){ return y + '-' + pad(m+1) + '-' + pad(d); }
  function isoOf(dt){ return iso(dt.getFullYear(), dt.getMonth(), dt.getDate()); }
  function todayIso(){ return isoOf(new Date()); }
  function dateOf(s){ return new Date(s + 'T00:00:00'); }
  function addDays(s, n){ var d = dateOf(s); d.setDate(d.getDate()+n); return isoOf(d); }
  function esc(s){ var d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; }
  function hex2rgb(h){
    h = (h||'').replace('#','');
    if(h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    var n = parseInt(h || '888888', 16);
    return [(n>>16)&255, (n>>8)&255, n&255];
  }
  function mix(hex, withHex, pct){
    var a = hex2rgb(hex), b = hex2rgb(withHex), k = pct/100;
    return 'rgb(' + Math.round(a[0]*k + b[0]*(1-k)) + ',' + Math.round(a[1]*k + b[1]*(1-k)) + ',' + Math.round(a[2]*k + b[2]*(1-k)) + ')';
  }
  function inkFor(hex){
    var c = hex2rgb(hex);
    var lum = (0.299*c[0] + 0.587*c[1] + 0.114*c[2]) / 255;
    return lum > 0.6 ? '#2c2f33' : '#ffffff';
  }
  function initialOf(name){ return (name||'?').trim().charAt(0).toUpperCase(); }
  function ordinal(n){
    if(n > 3 && n < 21) return n + 'th';
    var r = n % 10;
    return n + (r === 1 ? 'st' : r === 2 ? 'nd' : r === 3 ? 'rd' : 'th');
  }
  function minutesOf(t){
    if(!t) return null;
    var m = /(\d{1,2})[:.]?(\d{2})?\s*(a|p)/i.exec(t.trim());
    if(!m){
      var n = /^(\d{1,2}):(\d{2})$/.exec(t.trim());          // 24h "15:30"
      return n ? parseInt(n[1],10)*60 + parseInt(n[2],10) : null;
    }
    var h = parseInt(m[1],10), mi = m[2] ? parseInt(m[2],10) : 0;
    var pm = m[3].toLowerCase() === 'p';
    if(pm && h < 12) h += 12;
    if(!pm && h === 12) h = 0;
    return h*60 + mi;
  }
  function fmtMinutes(mins){
    var h = Math.floor(mins/60), mi = mins % 60, hh = h % 12 === 0 ? 12 : h % 12;
    return hh + ':' + pad(mi) + ' ' + (h >= 12 ? 'PM' : 'AM');
  }
  function to24(t){ var m = minutesOf(t); return m == null ? '' : pad(Math.floor(m/60)) + ':' + pad(m%60); }
  function from24(v){ if(!v) return ''; var p = v.split(':'); return fmtMinutes(parseInt(p[0],10)*60 + parseInt(p[1],10)); }
  function splitTime(ev){
    if(ev.allDay) return {t:'ALL', ap:'DAY'};
    var mins = minutesOf(ev.time);
    if(mins == null) return {t: ev.time ? ev.time.slice(0,5) : '--', ap:''};
    var h = Math.floor(mins/60), mi = mins % 60, hh = h % 12 === 0 ? 12 : h % 12;
    return {t: hh + ':' + pad(mi), ap: h >= 12 ? 'PM' : 'AM'};
  }
  function timeLabel(ev){ var s = splitTime(ev); return ev.allDay ? 'All day' : (s.ap ? s.t + ' ' + s.ap : (ev.time || '')); }
  function spanLabel(ev){
    if(ev.allDay || !ev.endTime) return '';
    var a = minutesOf(ev.time), b = minutesOf(ev.endTime);
    if(a == null || b == null) return '';
    var sa = fmtMinutes(a), sb = fmtMinutes(b);
    if(sa.slice(-2) === sb.slice(-2)) sa = sa.slice(0,-3);
    return sa + ' \u2013 ' + sb;
  }
  function toast(msg, ms){
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function(){ t.classList.remove('show'); }, ms || 2200);
  }
  function download(name, text, mime){
    var blob = new Blob([text], {type: mime || 'text/plain'});
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
  }
  function copyText(text){
    if(navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try{ document.execCommand('copy'); }catch(e){}
    document.body.removeChild(ta);
    return Promise.resolve();
  }
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  /* ── seed data (the family's real schedule) ──────────── */
  function basePeople(){
    return {
      cj:      {name:'CJ',       color:'#fdb715', order:0},
      dean:    {name:'Dean',     color:'#a1d184', order:1},
      mom:     {name:'Mom',      color:'#3f7e96', order:2},
      grandpa: {name:'Grandpa',  color:'#85aec5', order:3},
      family:  {name:'Everyone', color:'#4e5257', order:4}
    };
  }
  /* CJ: baseball (Hamilton A's) and cross country (Delran Middle). Stable ids so shared copies merge. */
  var FIXED = [
    ['2026-09-14','Baseball practice','8:00 PM','cj','',''],
    ['2026-09-17','Cross country meet','3:45 PM','cj','Kingsway','Away'],
    ['2026-09-17','Baseball practice','5:30 PM','cj','',''],
    ['2026-09-18','Baseball practice','6:30 PM','cj','',''],
    ['2026-09-20','Guest play w/ Gold','1:00 PM','cj','',''],
    ['2026-09-21','Baseball practice','8:00 PM','cj','',''],
    ['2026-09-24','Cross country meet','3:45 PM','cj','Walnut Street','Away'],
    ['2026-09-24','Baseball practice','5:30 PM','cj','',''],
    ['2026-09-25','Baseball practice','6:30 PM','cj','',''],
    ['2026-09-28','Baseball practice','8:00 PM','cj','',''],
    ['2026-10-01','Cross country meet','3:45 PM','cj','Phifer Middle','Away'],
    ['2026-10-01','Baseball practice','5:30 PM','cj','',''],
    ['2026-10-02','Knocktoberfest','All day','cj','Glendora/Blackwood',''],
    ['2026-10-02','Baseball practice','6:30 PM','cj','',''],
    ['2026-10-03','Knocktoberfest','All day','cj','Glendora/Blackwood',''],
    ['2026-10-05','Cross country meet','3:45 PM','cj','Home vs. Holbein/Phifer','Home'],
    ['2026-10-05','Baseball practice','8:00 PM','cj','',''],
    ['2026-10-08','Cross country meet','3:45 PM','cj','Northern Burlington','Away'],
    ['2026-10-09','Baseball practice','6:30 PM','cj','',''],
    ['2026-10-12','Baseball practice','8:00 PM','cj','',''],
    ['2026-10-14','Cross country meet','3:45 PM','cj','Phifer Middle','Away'],
    ['2026-10-15','Baseball practice','5:30 PM','cj','',''],
    ['2026-10-16','Baseball practice','6:30 PM','cj','',''],
    ['2026-10-19','Baseball practice','8:00 PM','cj','',''],
    ['2026-10-20','Cross country meet','3:45 PM','cj','Home vs. Maple Shade, NBC, Demasi','Home'],
    ['2026-10-22','Cross country meet','3:45 PM','cj','Cinnaminson','Away'],
    ['2026-10-23','Baseball practice','6:30 PM','cj','',''],
    ['2026-10-24','Clutch Classic','All day','cj','','Tournament'],
    ['2026-10-25','Clutch Classic','All day','cj','','Tournament'],
    ['2026-10-26','Baseball practice','8:00 PM','cj','',''],
    ['2026-10-28','County Championship','','cj','Location TBD','Cross country'],
    ['2026-10-29','Baseball practice','5:30 PM','cj','',''],
    ['2026-10-30','Baseball practice','6:30 PM','cj','',''],
    ['2026-11-02','Baseball practice','8:00 PM','cj','',''],
    ['2026-11-07','USABL Veterans Day Classic','All day','cj','','Tournament'],
    ['2026-11-08','USABL Veterans Day Classic','All day','cj','','Tournament'],
    ['2026-11-09','Baseball practice','8:00 PM','cj','',''],
    ['2026-11-16','Baseball practice','8:00 PM','cj','',''],
    ['2026-11-20','End of season pickleball','7:00 PM','cj','','Team party'],
    ['2026-12-02','Parent meeting','7:00 PM','family','','Spring tournament schedule']
  ];
  function fixedEvents(){
    var out = {};
    FIXED.forEach(function(r, i){
      var id = 'fixed-' + r[0] + '-' + i;
      out[id] = {date:r[0], title:r[1], time:(r[2] === 'All day' ? '' : r[2]), endTime:'', allDay:(r[2] === 'All day'),
                 personId:r[3], place:r[4] || '', address:'', note:r[5] || ''};
    });
    return out;
  }
  /* Weekly commitments, generated with stable ids so they merge cleanly */
  function recurring(){
    var out = {};
    function run(startY, startM, startD, endY, endM, endD, dow, make){
      var cur = new Date(startY, startM, startD), end = new Date(endY, endM, endD);
      while(cur.getDay() !== dow) cur.setDate(cur.getDate()+1);
      while(cur <= end){ var d = isoOf(cur), r = make(d); out[r[0]] = r[1]; cur.setDate(cur.getDate()+7); }
    }
    run(2026,8,14, 2026,11,20, 6, function(d){ return ['boxing-'+d, {date:d, title:'Boxing lesson', time:'9:00 AM', endTime:'10:00 AM', allDay:false, personId:'dean', place:'Athletic Rep', address:'', note:''}]; });
    run(2026,8,14, 2026,11,20, 0, function(d){ return ['swim-'+d, {date:d, title:'Swim lesson', time:'12:00 PM', endTime:'12:30 PM', allDay:false, personId:'dean', place:'', address:'', note:''}]; });
    run(2026,8,14, 2027,8,30, 3, function(d){ return ['basketball-'+d, {date:d, title:'Basketball training w/ Dale', time:'3:30 PM', endTime:'4:30 PM', allDay:false, personId:'cj', place:'Ravenwood Park', address:'', note:''}]; });
    [2,4].forEach(function(dow){
      run(2026,8,14, 2027,5,18, dow, function(d){ return ['work-'+d, {date:d, title:'Mom at work', time:'10:00 AM', endTime:'5:30 PM', allDay:false, personId:'mom', place:'', address:'', note:''}]; });
      run(2026,8,14, 2027,5,18, dow, function(d){ return ['pickup-'+d, {date:d, title:'Grandpa picks up the kids', time:'2:30 PM', endTime:'', allDay:false, personId:'grandpa', place:'', address:'', note:'CJ out 2:30 \u00b7 Dean out 3:00'}]; });
    });
    return out;
  }
  function seedTree(){
    var ev = fixedEvents(), rec = recurring();
    Object.keys(rec).forEach(function(k){ ev[k] = rec[k]; });
    return {people:basePeople(), events:ev, removed:{}, photo:'', meta:{name:'Wilkerson Calendar', createdAt:Date.now()}};
  }

  /* ── config ──────────────────────────────────────────── */
  function loadJSON(key){ try{ var r = localStorage.getItem(key); return r ? JSON.parse(r) : null; }catch(e){ return null; } }
  function saveJSON(key, v){ try{ localStorage.setItem(key, JSON.stringify(v)); }catch(e){} }
  function cleanDb(u){
    u = (u || '').trim();
    if(!u) return '';
    if(!/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u.replace(/\/+$/, '').replace(/\.json$/, '');
  }
  function randomCal(){ var s = ''; while(s.length < 18) s += Math.random().toString(36).slice(2); return 'cal-' + s.slice(0,18); }

  var cfg = (function(){
    var q = new URLSearchParams(location.search);
    var stored = loadJSON(CFG_KEY) || {};
    var def = window.FAMILY_CAL || {};
    var db = cleanDb(q.get('db') || stored.db || def.db);
    var cal = (q.get('cal') || stored.cal || def.cal || '').replace(/[^\w-]/g, '');
    var out = {db: db, cal: db ? (cal || randomCal()) : cal};
    if(db) saveJSON(CFG_KEY, out);
    return out;
  })();
  var live = !!cfg.db;
  var cacheKey = CACHE_PREFIX + (live ? cfg.cal : 'local');
  var pendingKey = PENDING_PREFIX + (live ? cfg.cal : 'local');

  /* ── tree (the whole calendar as one object) ─────────── */
  var tree = null;
  var state = {people:[], events:[]};     // derived arrays for rendering

  function oldFormatToTree(){
    var old = loadJSON(OLD_KEY);
    if(!old || !Array.isArray(old.events)) return null;
    var t = {people:{}, events:{}, removed:{}, photo:'', meta:{name:'Wilkerson Calendar', createdAt:Date.now()}};
    old.people.forEach(function(p, i){ t.people[p.id] = {name:p.name, color:LEGACY_MAP[(p.color||'').toLowerCase()] || p.color, order:i}; });
    old.events.forEach(function(e){
      var id = e.id || uid();
      t.events[id] = {date:e.date, title:e.title, time:e.time || '', endTime:'', allDay:!!e.allDay, personId:e.personId,
                      place:e.place || e.location || '', address:'', note:e.note || ''};
    });
    (old.removed || []).forEach(function(id){ t.removed[id] = true; });
    try{ t.photo = localStorage.getItem(OLD_PHOTO_KEY) || ''; }catch(e){}
    return t;
  }
  function normalize(t){
    t = t && typeof t === 'object' ? t : {};
    t.people = t.people && typeof t.people === 'object' ? t.people : {};
    t.events = t.events && typeof t.events === 'object' ? t.events : {};
    t.removed = t.removed && typeof t.removed === 'object' ? t.removed : {};
    t.photo = typeof t.photo === 'string' ? t.photo : '';
    t.meta = t.meta && typeof t.meta === 'object' ? t.meta : {};
    if(!Object.keys(t.people).length) t.people = basePeople();
    return t;
  }
  function derive(){
    state.people = Object.keys(tree.people).map(function(id){ var p = tree.people[id]; return {id:id, name:p.name, color:p.color, order:p.order == null ? 99 : p.order}; })
      .sort(function(a,b){ return a.order - b.order || a.name.localeCompare(b.name); });
    state.events = Object.keys(tree.events).map(function(id){ var e = tree.events[id]; e = e || {}; return {
      id:id, date:e.date || '', title:e.title || '', time:e.time || '', endTime:e.endTime || '', allDay:!!e.allDay,
      personId:e.personId || '', place:e.place || '', address:e.address || '', note:e.note || ''}; })
      .filter(function(e){ return /^\d{4}-\d{2}-\d{2}$/.test(e.date); });
  }
  function cache(){ saveJSON(cacheKey, tree); }

  /* Add any weekly events that newer versions introduced, unless they were deleted on purpose. */
  function missingRecurring(){
    var rec = recurring(), patch = {}, n = 0;
    Object.keys(rec).forEach(function(id){
      if(!tree.events[id] && !tree.removed[id]){ patch['events/' + id] = rec[id]; n++; }
    });
    return n ? patch : null;
  }

  /* ── writes: local first, then the shared database ───── */
  function applyPatchLocal(patch){
    Object.keys(patch).forEach(function(path){
      var parts = path.split('/').filter(Boolean), node = tree;
      for(var i=0;i<parts.length-1;i++){ if(!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {}; node = node[parts[i]]; }
      var last = parts[parts.length-1];
      if(patch[path] === null) delete node[last]; else node[last] = patch[path];
    });
  }
  var pending = loadJSON(pendingKey) || [];
  /* Every event write carries the moment it was made. A change queued on a phone
     that was offline is dropped later only if someone else changed that same
     event more recently. Everything else still goes through. */
  function stamp(patch){
    Object.keys(patch).forEach(function(k){
      if(/^events\/[^/]+$/.test(k) && patch[k] && typeof patch[k] === 'object') patch[k].updatedAt = Date.now();
    });
    return patch;
  }
  function write(patch){
    stamp(patch);
    applyPatchLocal(patch);
    derive(); cache(); render();
    if(!live) return Promise.resolve();
    return sendPatch(patch).catch(function(){
      pending.push({patch:patch, at:Date.now()}); saveJSON(pendingKey, pending);
      setSync('off', 'OFFLINE'); toast('Saved here. It will sync when you are back online.');
    });
  }
  function sendPatch(patch){
    return fetch(cfg.db + '/' + cfg.cal + '.json', {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(patch)})
      .then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); });
  }
  function flushPending(){
    if(!pending.length || !live) return Promise.resolve();
    var job = pending[0];
    var patch = job && job.patch ? job.patch : job;
    return resolveStale(patch).then(function(fresh){
      if(!Object.keys(fresh).length){ pending.shift(); saveJSON(pendingKey, pending); return flushPending(); }
      return sendPatch(fresh).then(function(){ pending.shift(); saveJSON(pendingKey, pending); return flushPending(); });
    });
  }
  /* Drop only the parts of a queued change that someone else has since superseded. */
  function resolveStale(patch){
    var paths = Object.keys(patch).filter(function(k){ return /^events\/[^/]+$/.test(k) && patch[k] && patch[k].updatedAt; });
    if(!paths.length) return Promise.resolve(patch);
    return Promise.all(paths.map(function(k){
      return fetch(cfg.db + '/' + cfg.cal + '/' + k + '/updatedAt.json')
        .then(function(r){ return r.ok ? r.json() : null; })
        .then(function(remote){ if(typeof remote === 'number' && remote > patch[k].updatedAt) delete patch[k]; })
        .catch(function(){});
    })).then(function(){ return patch; });
  }

  /* ── live connection (Firebase REST streaming) ───────── */
  var es = null, syncState = 'local', gotFirst = false;
  function setSync(kind, text){
    syncState = kind;
    var pill = $('syncPill'); pill.className = 'sync ' + kind; $('syncText').textContent = text;
  }
  function applyRemote(path, data, isPatch){
    var parts = path.split('/').filter(Boolean);
    if(parts.length === 0){
      if(isPatch){ Object.keys(data || {}).forEach(function(k){ tree[k] = data[k]; }); }
      else tree = normalize(data || {});
      if(!data) tree = normalize(null);
    } else {
      var node = tree;
      for(var i=0;i<parts.length-1;i++){ if(!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {}; node = node[parts[i]]; }
      var last = parts[parts.length-1];
      if(isPatch){
        if(!node[last] || typeof node[last] !== 'object') node[last] = {};
        Object.keys(data || {}).forEach(function(k){ if(data[k] === null) delete node[last][k]; else node[last][k] = data[k]; });
      } else if(data === null || data === undefined){ delete node[last]; }
      else node[last] = data;
    }
    tree = normalize(tree);
  }
  function connect(){
    if(!live) return;
    if(es){ try{ es.close(); }catch(e){} es = null; }
    setSync('off', 'CONNECTING');
    es = new EventSource(cfg.db + '/' + cfg.cal + '.json');
    es.addEventListener('put', function(e){
      var msg = JSON.parse(e.data);
      var first = !gotFirst;
      if(first && msg.path === '/' && (msg.data === null || !msg.data.events)){
        // Empty calendar in the database: this device's copy becomes the shared one.
        gotFirst = true;
        var seed = tree && Object.keys(tree.events).length ? tree : seedTree();
        fetch(cfg.db + '/' + cfg.cal + '.json', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(seed)})
          .then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); setSync('live', 'LIVE'); toast('Calendar is live for everyone with the link.'); })
          .catch(function(){ toast('Could not write to the database. Check the rules in Firebase.'); setSync('off', 'CHECK RULES'); });
        return;
      }
      gotFirst = true;
      applyRemote(msg.path, msg.data, false);
      derive(); cache(); render();
      setSync('live', 'LIVE');
      if(first){
        var add = missingRecurring(); if(add) sendPatch(add).catch(function(){});
        flushPending().catch(function(){});
      }
    });
    es.addEventListener('patch', function(e){
      var msg = JSON.parse(e.data);
      applyRemote(msg.path, msg.data, true);
      derive(); cache(); render();
    });
    es.addEventListener('cancel', function(){ setSync('off', 'CHECK RULES'); toast('The database refused the connection. Check its rules.'); });
    es.addEventListener('auth_revoked', function(){ setSync('off', 'CHECK RULES'); });
    es.onopen = function(){ if(gotFirst) setSync('live', 'LIVE'); flushPending().catch(function(){}); };
    es.onerror = function(){ if(es.readyState === EventSource.CLOSED) setSync('off', 'OFFLINE'); else setSync('off', 'RECONNECTING'); };
  }
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'visible' && live && (!es || es.readyState === EventSource.CLOSED)) connect();
  });
  window.addEventListener('online', function(){ if(live) connect(); });

  /* ── boot state ──────────────────────────────────────── */
  tree = loadJSON(cacheKey);
  if(!tree){
    var converted = oldFormatToTree();
    tree = converted || (live ? normalize({events:{}}) : seedTree());
  }
  tree = normalize(tree);
  if(!live){
    var add = missingRecurring(); if(add) applyPatchLocal(add);
    if(!Object.keys(tree.events).length) tree = seedTree();
  }
  derive(); cache();

  /* ── view state ──────────────────────────────────────── */
  var selected = todayIso();
  var view = 'agenda';
  var filter = null;
  var warnsOpen = null, warnsAll = false;
  var agendaDays = 21;
  var monthAnchor = (function(){ var d = new Date(); return {y:d.getFullYear(), m:d.getMonth()}; })();
  var prefs = loadJSON(PREF_KEY) || {};

  function person(id){
    for(var i=0;i<state.people.length;i++) if(state.people[i].id === id) return state.people[i];
    return {id:id, name:'Someone', color:'#63656a'};
  }
  function eventById(id){ for(var i=0;i<state.events.length;i++) if(state.events[i].id === id) return state.events[i]; return null; }
  function byDate(){
    var map = {};
    state.events.forEach(function(e){ (map[e.date] = map[e.date] || []).push(e); });
    Object.keys(map).forEach(function(k){
      map[k].sort(function(a,b){
        if(a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        var x = minutesOf(a.time), y = minutesOf(b.time);
        if(x == null) return 1; if(y == null) return -1; return x - y;
      });
    });
    return map;
  }
  function visible(list){ return filter ? list.filter(function(e){ return e.personId === filter; }) : list; }
  function destinationOf(e){ return (e.address || e.place || '').trim(); }

  /* ── hero ────────────────────────────────────────────── */
  function nextUp(){
    var now = new Date(), nowIso = isoOf(now), nowMin = now.getHours()*60 + now.getMinutes(), best = null;
    state.events.forEach(function(e){
      if(e.date < nowIso) return;
      var mins = e.allDay ? 0 : minutesOf(e.time);
      if(e.date === nowIso && mins != null && mins < nowMin) return;
      var rank = (dateOf(e.date) - dateOf(nowIso)) / 60000 + (mins == null ? 0 : mins);
      if(!best || rank < best.rank) best = {ev:e, rank:rank, mins:mins};
    });
    return best;
  }
  function renderHero(){
    var media = $('heroMedia'), hero = media.parentNode;
    var shot = tree.photo || DEFAULT_PHOTO;
    if(shot){
      media.style.setProperty('--hero-photo', 'url("' + shot + '")');
      media.classList.add('has-photo'); hero.classList.add('photo'); $('btnPhoto').textContent = 'CHANGE';
    } else {
      media.classList.remove('has-photo'); hero.classList.remove('photo'); $('btnPhoto').textContent = 'PHOTO';
    }
    var d = dateOf(selected);
    $('heroDate').textContent = DOWS[d.getDay()] + ' the ' + ordinal(d.getDate());
    var todays = visible(byDate()[selected] || []), sub;
    if(todays.length === 0) sub = selected === todayIso() ? 'Nothing on the calendar today.' : 'Nothing scheduled this day.';
    else {
      var names = todays.slice(0,3).map(function(e){ return e.title.replace(/\s*\(.*\)$/, ''); });
      var extra = todays.length - names.length;
      sub = names.join(', ') + (extra > 0 ? ', and ' + extra + ' more.' : '.');
    }
    $('heroSub').textContent = sub;

    var nx = nextUp(), txt = 'NOTHING COMING UP';
    if(nx){
      var now = new Date();
      if(nx.ev.date === isoOf(now) && nx.mins != null){
        var diff = nx.mins - (now.getHours()*60 + now.getMinutes());
        txt = diff <= 0 ? 'ON NOW \u00b7 ' + nx.ev.title.toUpperCase()
            : diff < 60 ? 'NEXT IN ' + diff + ' MIN \u00b7 ' + nx.ev.title.toUpperCase()
            : 'TODAY ' + timeLabel(nx.ev).toUpperCase() + ' \u00b7 ' + nx.ev.title.toUpperCase();
      } else if(nx.ev.date === isoOf(now)) txt = 'TODAY \u00b7 ' + nx.ev.title.toUpperCase();
      else if(nx.ev.date === addDays(isoOf(now),1)) txt = 'TOMORROW \u00b7 ' + nx.ev.title.toUpperCase();
      else { var nd = dateOf(nx.ev.date); txt = DOWS[nd.getDay()].slice(0,3).toUpperCase() + ' ' + nd.getDate() + ' \u00b7 ' + nx.ev.title.toUpperCase(); }
    }
    $('nextText').textContent = txt.length > 36 ? txt.slice(0,34) + '\u2026' : txt;
    $('ghostNum').textContent = d.getDate();
    $('setupBanner').hidden = live;
  }

  /* ── week strip ──────────────────────────────────────── */
  function renderWeek(){
    var bar = $('weekbar'); bar.innerHTML = '';
    var map = byDate(), start = dateOf(selected);
    start.setDate(start.getDate() - start.getDay());
    var prev = document.createElement('button');
    prev.className = 'wk-arrow'; prev.innerHTML = '&#8249;'; prev.title = 'Previous week';
    prev.addEventListener('click', function(){ selected = addDays(selected, -7); syncMonth(); render(); });
    bar.appendChild(prev);
    for(var i=0;i<7;i++){
      var dt = new Date(start); dt.setDate(start.getDate()+i);
      var key = isoOf(dt), btn = document.createElement('button');
      btn.className = 'wk-day' + (key === selected ? ' sel' : '') + (key === todayIso() ? ' today' : '');
      var dots = '', seen = {}, colors = [];
      visible(map[key] || []).forEach(function(e){ var c = person(e.personId).color; if(!seen[c]){ seen[c] = 1; colors.push(c); } });
      colors.slice(0,3).forEach(function(c){ dots += '<i style="background:' + c + '"></i>'; });
      btn.innerHTML = '<span class="wk-dow">' + DOW1[dt.getDay()] + '</span><span class="wk-num">' + dt.getDate() + '</span><span class="wk-dots">' + dots + '</span>';
      (function(k){ btn.addEventListener('click', function(){ selected = k; agendaDays = 21; syncMonth(); render(); }); })(key);
      bar.appendChild(btn);
    }
    var next = document.createElement('button');
    next.className = 'wk-arrow'; next.innerHTML = '&#8250;'; next.title = 'Next week';
    next.addEventListener('click', function(){ selected = addDays(selected, 7); syncMonth(); render(); });
    bar.appendChild(next);
  }

  /* ── avatars / filter ────────────────────────────────── */
  function renderAvatars(){
    var wrap = $('avatars'); wrap.innerHTML = '';
    state.people.forEach(function(p){
      var b = document.createElement('button');
      b.className = 'avatar' + (filter && filter !== p.id ? ' off' : '');
      b.style.background = p.color; b.style.color = inkFor(p.color);
      b.textContent = initialOf(p.name); b.title = p.name;
      b.addEventListener('click', function(){ filter = (filter === p.id) ? null : p.id; render(); });
      wrap.appendChild(b);
    });
    if(filter){
      var all = document.createElement('button');
      all.className = 'avatar all'; all.textContent = '\u00d7'; all.title = 'Show everyone';
      all.addEventListener('click', function(){ filter = null; render(); });
      wrap.appendChild(all);
    }
  }

  /* ── conflicts (recomputed from the data on every render) ── */
  function conflicts(){
    var map = byDate(), out = [], from = todayIso();
    Object.keys(map).sort().forEach(function(key){
      if(key < from) return;
      if(dateOf(key) - dateOf(from) > 75*86400000) return;
      var evs = map[key]; if(evs.length < 2) return;
      var d = dateOf(key);
      var when = DOWS[d.getDay()].slice(0,3).toUpperCase() + ' ' + MONTHS[d.getMonth()].slice(0,3) + ' ' + d.getDate();
      var allDay = evs.filter(function(e){ return e.allDay; }), timed = evs.filter(function(e){ return !e.allDay; });
      if(allDay.length && timed.length){
        var a = allDay[0], who = person(a.personId).name, others = [], mine = [];
        timed.forEach(function(e){
          var n = person(e.personId).name;
          if(n === who) mine.push(e.title + ' at ' + timeLabel(e)); else if(others.indexOf(n) === -1) others.push(n);
        });
        var tail = others.length
          ? ', but ' + others.join(' and ') + ' still ' + (others.length === 1 ? 'has' : 'have') + ' something on. Sort out who covers what.'
          : ' and still has ' + mine.join(' and ') + '.';
        out.push({key:key, when:when, level:'high', msg: who + ' is out all day at ' + a.title + tail});
        return;
      }
      for(var i=0;i<timed.length;i++){
        for(var j=i+1;j<timed.length;j++){
          var A = timed[i], B = timed[j], ta = minutesOf(A.time), tb = minutesOf(B.time);
          if(ta == null || tb == null) continue;
          var first = ta <= tb ? A : B, second = ta <= tb ? B : A;
          var fs = Math.min(ta,tb), ss = Math.max(ta,tb), fe = minutesOf(first.endTime);
          var gap = ss - fs, overlaps = fe != null && fe > ss;
          var pa = person(A.personId), pb = person(B.personId);
          if(pa.id === pb.id){
            if(overlaps || gap < 60){
              out.push({key:key, when:when, level:'high', msg: pa.name + ' is double-booked: ' + first.title + ' at ' + timeLabel(first) + ' and ' + second.title + ' at ' + timeLabel(second) + '.'});
            } else if(gap <= 150 && !(fe != null && ss - fe > 45)){
              out.push({key:key, when:when, level:'med', msg: 'Tight for ' + pa.name + ': ' + first.title + ' at ' + timeLabel(first) + ', then ' + second.title + ' at ' + timeLabel(second) + '. Plan the hand-off.'});
            }
          } else if(gap < 45){
            out.push({key:key, when:when, level:'med', msg: 'Two places at once: ' + pa.name + ' at ' + A.title + ' (' + timeLabel(A) + ') and ' + pb.name + ' at ' + B.title + ' (' + timeLabel(B) + '). Who drives?'});
          }
        }
      }
    });
    return out;
  }
  function renderWarns(){
    var list = conflicts(), sec = $('warns');
    if(warnsOpen === null){ var soon = addDays(todayIso(), 2); warnsOpen = list.some(function(w){ return w.key < soon; }); }
    sec.classList.toggle('empty', list.length === 0);
    sec.classList.toggle('collapsed', !warnsOpen);
    $('warnCount').textContent = list.length;
    var limit = warnsAll ? 40 : 3;
    $('warnList').innerHTML = list.slice(0,limit).map(function(w){
      return '<div class="warn ' + w.level + '"><div class="warn-when">' + esc(w.when) + '</div><div class="warn-msg">' + esc(w.msg) + '</div></div>';
    }).join('') + (list.length > limit ? '<button class="more-btn" id="warnMore" style="margin-top:4px">SHOW ' + (list.length-limit) + ' MORE</button>' : '');
    var more = $('warnMore'); if(more) more.addEventListener('click', function(){ warnsAll = true; renderWarns(); });
  }

  /* ── event card ──────────────────────────────────────── */
  var DIR_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>';
  function cardHtml(e){
    var p = person(e.personId), s = splitTime(e), ink = inkFor(p.color);
    var meta = '<span class="card-who" style="color:' + p.color + '">' + esc(p.name.toUpperCase()) + '</span>';
    var span = spanLabel(e); if(span) meta += '<span class="card-span">' + esc(span) + '</span>';
    if(e.note) meta += '<span class="card-note">\u00b7 ' + esc(e.note) + '</span>';
    if(destinationOf(e)) meta += '<button class="dir-btn" data-dir="' + e.id + '" title="Get directions">' + DIR_ICON + 'GO</button>';
    return '<div class="card" role="button" tabindex="0" data-id="' + e.id + '" style="background:' + mix(p.color,'#2c2f33',16) + ';border-color:' + mix(p.color,'#2c2f33',34) + '">' +
      '<span class="lane" style="background:' + p.color + ';color:' + ink + '"><span class="t">' + esc(s.t) + '</span><span class="ap">' + esc(s.ap) + '</span></span>' +
      '<span class="card-body"><span class="card-title" style="display:block">' + esc(e.title) + '</span>' +
        (e.place ? '<span class="card-place" style="display:block">' + esc(e.place) + '</span>' : '') +
        '<span class="card-meta">' + meta + '</span></span></div>';
  }
  function wireCards(host){
    host.querySelectorAll('.card').forEach(function(el){
      var open = function(){ var ev = eventById(el.getAttribute('data-id')); if(ev) openForm(ev); };
      el.addEventListener('click', open);
      el.addEventListener('keydown', function(e){ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); open(); } });
    });
    host.querySelectorAll('.dir-btn').forEach(function(b){
      b.addEventListener('click', function(e){ e.stopPropagation(); var ev = eventById(b.getAttribute('data-dir')); if(ev) openDirections(ev); });
    });
  }

  /* ── agenda ──────────────────────────────────────────── */
  function renderAgenda(){
    var host = $('agenda'), map = byDate(), html = '', shown = 0;
    for(var i=0;i<agendaDays;i++){
      var key = addDays(selected, i), evs = visible(map[key] || []);
      if(i > 0 && evs.length === 0) continue;
      var d = dateOf(key);
      var head = i === 0 ? (key === todayIso() ? 'TODAY' : DOWS[d.getDay()].toUpperCase()) : key === addDays(todayIso(),1) ? 'TOMORROW' : DOWS[d.getDay()].toUpperCase();
      var sub = MONTHS[d.getMonth()].slice(0,3) + ' ' + d.getDate();
      html += '<div class="group"><div class="group-head"><span class="lbl">' + head + '</span><span class="sub">' + sub + '</span></div><div class="cards">';
      if(evs.length === 0) html += '<div class="day-empty">' + (filter ? esc(person(filter).name) + ' has nothing on this day.' : 'Nothing scheduled. A rare one.') + '</div>';
      else { evs.forEach(function(e){ html += cardHtml(e); }); shown += evs.length; }
      html += '</div></div>';
    }
    if(shown === 0 && agendaDays >= 21) html += '<div class="group"><div class="day-empty">Nothing in the next few weeks' + (filter ? ' for ' + esc(person(filter).name) : '') + '. Try the month view or add something.</div></div>';
    html += '<button class="more-btn" id="moreBtn">SHOW MORE DAYS</button>';
    host.innerHTML = html;
    wireCards(host);
    $('moreBtn').addEventListener('click', function(){ agendaDays += 30; renderAgenda(); });
  }

  /* ── month ───────────────────────────────────────────── */
  function syncMonth(){ var d = dateOf(selected); monthAnchor = {y:d.getFullYear(), m:d.getMonth()}; }
  function renderMonth(){
    var host = $('month'), map = byDate(), y = monthAnchor.y, m = monthAnchor.m;
    var first = new Date(y, m, 1), days = new Date(y, m+1, 0).getDate(), offset = first.getDay();
    var html = '<div class="month-head"><div class="month-title">' + MONTHS[m] + ' ' + y + '</div><div class="month-nav"><button id="mPrev">&#8249;</button><button id="mNext">&#8250;</button></div></div><div class="mgrid">';
    DOW1.forEach(function(d){ html += '<div class="mdow">' + d + '</div>'; });
    for(var i=0;i<offset;i++) html += '<div class="mcell blank"></div>';
    for(var day=1; day<=days; day++){
      var key = iso(y, m, day), evs = visible(map[key] || []), bars = '';
      evs.slice(0,3).forEach(function(e){ bars += '<span class="mbar" style="background:' + person(e.personId).color + '"></span>'; });
      html += '<button class="mcell' + (key === todayIso() ? ' today' : '') + (key === selected ? ' sel' : '') + '" data-key="' + key + '"><span class="mnum">' + day + '</span><span class="mbars">' + bars + '</span>' + (evs.length > 3 ? '<span class="mmore">+' + (evs.length-3) + '</span>' : '') + '</button>';
    }
    host.innerHTML = html + '</div>';
    $('mPrev').addEventListener('click', function(){ monthAnchor.m--; if(monthAnchor.m < 0){ monthAnchor.m = 11; monthAnchor.y--; } renderMonth(); });
    $('mNext').addEventListener('click', function(){ monthAnchor.m++; if(monthAnchor.m > 11){ monthAnchor.m = 0; monthAnchor.y++; } renderMonth(); });
    host.querySelectorAll('.mcell[data-key]').forEach(function(cell){
      cell.addEventListener('click', function(){ selected = cell.getAttribute('data-key'); openDay(selected); renderHero(); renderWeek(); renderMonth(); });
    });
  }

  function render(){
    renderHero(); renderWeek(); renderAvatars(); renderWarns();
    $('agenda').hidden = view !== 'agenda'; $('month').hidden = view !== 'month';
    if(view === 'agenda') renderAgenda(); else renderMonth();
    if(dayOverlay.classList.contains('open') && dayKey) fillDay(dayKey);
  }

  /* ── day sheet ───────────────────────────────────────── */
  var dayOverlay = $('dayOverlay'), dayKey = null;
  function fillDay(key){
    var d = dateOf(key), evs = visible(byDate()[key] || []);
    $('dayTitle').textContent = DOWS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
    $('daySub').textContent = evs.length === 0 ? 'Nothing on this day yet.' : evs.length + (evs.length === 1 ? ' thing on' : ' things on');
    $('dayList').innerHTML = evs.map(function(e){
      var p = person(e.personId), bits = [p.name]; if(e.place) bits.push(e.place); if(e.note) bits.push(e.note);
      return '<button class="drow" data-id="' + e.id + '" style="background:' + mix(p.color,'#2c2f33',14) + ';border-color:' + mix(p.color,'#2c2f33',30) + '">' +
        '<span class="dtime" style="color:' + p.color + '">' + esc(timeLabel(e) || '\u2014') + '</span>' +
        '<span class="dmain"><span class="dt" style="display:block">' + esc(e.title) + '</span><span class="dm" style="display:block">' + esc(bits.join(' \u00b7 ')) + '</span></span>' +
        '<span class="dedit">EDIT</span></button>';
    }).join('');
    $('dayList').querySelectorAll('.drow').forEach(function(row){
      row.addEventListener('click', function(){ var ev = eventById(row.getAttribute('data-id')); closeDay(); if(ev) openForm(ev); });
    });
  }
  function openDay(key){ dayKey = key; fillDay(key); dayOverlay.classList.add('open'); }
  function closeDay(){ dayOverlay.classList.remove('open'); }
  $('btnCloseDay').addEventListener('click', closeDay);
  $('btnAddOnDay').addEventListener('click', function(){ var k = dayKey; closeDay(); openForm(null, k); });

  /* ── directions ──────────────────────────────────────── */
  var dirOverlay = $('dirOverlay'), dirDest = '';
  function openDirections(ev){
    dirDest = destinationOf(ev); if(!dirDest) return;
    $('dirTitle').textContent = ev.place || ev.title;
    $('dirAddr').textContent = ev.address ? ev.address : dirDest + ' (no street address yet, edit the event to add one)';
    var q = encodeURIComponent(dirDest);
    $('dirApple').href = 'https://maps.apple.com/?daddr=' + q + '&dirflg=d';
    $('dirGoogle').href = 'https://www.google.com/maps/dir/?api=1&destination=' + q + '&travelmode=driving';
    dirOverlay.classList.add('open');
  }
  $('dirClose').addEventListener('click', function(){ dirOverlay.classList.remove('open'); });
  $('dirCopy').addEventListener('click', function(){ copyText(dirDest).then(function(){ toast('Address copied'); }); });
  $('dirApple').addEventListener('click', function(){ setTimeout(function(){ dirOverlay.classList.remove('open'); }, 300); });
  $('dirGoogle').addEventListener('click', function(){ setTimeout(function(){ dirOverlay.classList.remove('open'); }, 300); });

  /* ── event form ──────────────────────────────────────── */
  var formOverlay = $('formOverlay'), editing = null;
  function fillPeople(sel){
    var el = $('fPerson'); el.innerHTML = '';
    state.people.forEach(function(p){ var o = document.createElement('option'); o.value = p.id; o.textContent = p.name; el.appendChild(o); });
    var add = document.createElement('option'); add.value = '__new__'; add.textContent = '+ Add someone new\u2026'; el.appendChild(add);
    el.value = sel || (state.people[0] && state.people[0].id) || '';
  }
  $('fPerson').addEventListener('change', function(){ var f = $('fNewPerson'); f.hidden = this.value !== '__new__'; if(!f.hidden) f.focus(); });
  $('fAllDay').addEventListener('change', function(){ $('timeRow').style.opacity = this.checked ? '.35' : '1'; });

  function openForm(ev, presetDate){
    editing = ev ? ev.id : null;
    $('formTitle').textContent = ev ? 'Edit event' : 'New event';
    $('formSub').textContent = ev ? 'Change it, or take it off the calendar.' : 'Anything on the family calendar';
    $('btnDelete').hidden = !ev; $('editExtras').hidden = !ev;
    $('fTitle').value = ev ? ev.title : '';
    fillPeople(ev ? ev.personId : null);
    var np = $('fNewPerson'); np.hidden = true; np.value = '';
    $('fDate').value = ev ? ev.date : (presetDate || selected);
    $('fTime').value = ev ? to24(ev.time) : '';
    $('fEnd').value = ev ? to24(ev.endTime) : '';
    $('fAllDay').checked = ev ? !!ev.allDay : false;
    $('timeRow').style.opacity = $('fAllDay').checked ? '.35' : '1';
    $('fPlace').value = ev ? (ev.place || '') : '';
    $('fAddress').value = ev ? (ev.address || '') : '';
    $('fNote').value = ev ? (ev.note || '') : '';
    formOverlay.classList.add('open');
    if(!ev) setTimeout(function(){ $('fTitle').focus(); }, 60);
  }
  function closeForm(){ formOverlay.classList.remove('open'); editing = null; }
  $('btnAdd').addEventListener('click', function(){ openForm(null); });
  $('btnCancel').addEventListener('click', closeForm);

  $('btnSave').addEventListener('click', function(){
    var title = $('fTitle').value.trim(); if(!title){ $('fTitle').focus(); return; }
    var date = $('fDate').value; if(!date){ $('fDate').focus(); return; }
    var patch = {}, pid = $('fPerson').value;
    if(pid === '__new__'){
      var name = $('fNewPerson').value.trim(); if(!name){ $('fNewPerson').focus(); return; }
      var used = state.people.map(function(p){ return (p.color||'').toLowerCase(); });
      var color = PALETTE.filter(function(c){ return used.indexOf(c) === -1; })[0] || PALETTE[state.people.length % PALETTE.length];
      pid = uid();
      patch['people/' + pid] = {name:name, color:color, order:state.people.length};
    }
    var allDay = $('fAllDay').checked;
    var data = {
      title:title, date:date, personId:pid, allDay:allDay,
      time: allDay ? '' : from24($('fTime').value),
      endTime: allDay ? '' : from24($('fEnd').value),
      place: $('fPlace').value.trim(), address: $('fAddress').value.trim(), note: $('fNote').value.trim()
    };
    var id = editing || uid();
    patch['events/' + id] = data;
    selected = date; syncMonth(); closeForm();
    write(patch);
    toast(editing ? 'Saved' : 'Added to the calendar');
  });
  $('btnDelete').addEventListener('click', function(){
    if(!editing) return;
    var id = editing, patch = {}; patch['events/' + id] = null; patch['removed/' + id] = true;
    closeForm(); write(patch); toast('Removed');
  });
  $('btnFormDirections').addEventListener('click', function(){
    var ev = eventById(editing); if(!ev) return;
    var addr = $('fAddress').value.trim(), place = $('fPlace').value.trim();
    var tmp = {title:$('fTitle').value, place:place, address:addr};
    if(!destinationOf(tmp)){ toast('Add a place or address first'); return; }
    openDirections(tmp);
  });
  $('btnFormIcs').addEventListener('click', function(){ var ev = eventById(editing); if(ev) downloadIcs([ev], ev.title); });

  [formOverlay, dayOverlay, dirOverlay, $('settingsOverlay')].forEach(function(ov){
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.classList.remove('open'); });
  });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape'){ closeForm(); closeDay(); dirOverlay.classList.remove('open'); $('settingsOverlay').classList.remove('open'); } });

  /* ── chrome ──────────────────────────────────────────── */
  $('viewSeg').addEventListener('click', function(e){
    var b = e.target.closest('button[data-view]'); if(!b) return;
    view = b.getAttribute('data-view');
    this.querySelectorAll('button').forEach(function(x){ x.setAttribute('data-on', x === b ? 'true' : 'false'); });
    if(view === 'month') syncMonth();
    render();
  });
  $('btnToday').addEventListener('click', function(){ selected = todayIso(); agendaDays = 21; syncMonth(); render(); window.scrollTo({top:0, behavior:'smooth'}); });
  $('warnHead').addEventListener('click', function(){ warnsOpen = !warnsOpen; $('warns').classList.toggle('collapsed', !warnsOpen); });

  /* ── photo (stored with the calendar so everyone sees it) ── */
  $('btnPhoto').addEventListener('click', function(){ $('photoFile').click(); });
  $('photoFile').addEventListener('change', function(e){
    var file = e.target.files[0]; if(!file) return;
    var r = new FileReader();
    r.onload = function(){
      var img = new Image();
      img.onload = function(){
        var max = 1000, w = img.width, h = img.height;
        if(w > max){ h = Math.round(h * max / w); w = max; }
        if(h > 1200){ w = Math.round(w * 1200 / h); h = 1200; }
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        var q = 0.82, out = c.toDataURL('image/jpeg', q);
        while(out.length > 420000 && q > 0.45){ q -= 0.1; out = c.toDataURL('image/jpeg', q); }
        write({photo: out}); toast(live ? 'Photo saved for everyone' : 'Photo saved on this device');
      };
      img.src = r.result;
    };
    r.readAsDataURL(file); e.target.value = '';
  });

  /* ── share link ──────────────────────────────────────── */
  function shareUrl(){
    var u = new URL(location.href); u.hash = '';
    u.search = '';
    if(live){
      var def = window.FAMILY_CAL || {};
      if(!(cleanDb(def.db) === cfg.db && def.cal === cfg.cal)){ u.searchParams.set('db', cfg.db); u.searchParams.set('cal', cfg.cal); }
    }
    return u.toString();
  }
  function share(){
    if(!live){ openSettings(); toast('Connect the database first so the link is shared.'); return; }
    var url = shareUrl();
    if(navigator.share){ navigator.share({title:'Wilkerson Calendar', text:'Our family calendar', url:url}).catch(function(){}); }
    else copyText(url).then(function(){ toast('Link copied'); });
  }
  $('btnShare').addEventListener('click', share);
  $('btnShareNative').addEventListener('click', share);
  $('btnCopyLink').addEventListener('click', function(){ copyText(shareUrl()).then(function(){ toast('Link copied'); }); });

  /* ── settings ────────────────────────────────────────── */
  var settingsOverlay = $('settingsOverlay');
  function openSettings(){
    $('shareConnected').hidden = !live; $('shareSetup').hidden = live; $('btnDisconnect').hidden = !live;
    $('shareUrl').value = shareUrl();
    $('settingsSub').textContent = live ? 'Live \u00b7 ' + cfg.db.replace(/^https?:\/\//,'') : 'Saving on this device only.';
    var canNotify = ('Notification' in window) && Notification.permission === 'granted';
    $('swReminders').setAttribute('aria-checked', prefs.reminders && canNotify ? 'true' : 'false');
    $('remHint').textContent = !live ? 'Connect the calendar first, then reminders can be sent to every phone.'
      : (isIOS && !standalone) ? 'On iPhone, add this to your Home Screen first, then come back and turn this on.'
      : 'A reminder arrives 30 minutes before anything starts, and a rundown of the day each morning, even when the app is closed.';
    if(standalone) $('installHint').textContent = 'Installed. You are running it from the Home Screen.';
    else if(!isIOS) $('installHint').textContent = 'On iPhone: open this link in Safari, tap Share, then "Add to Home Screen". On Android: use "Install app" in the browser menu.';
    settingsOverlay.classList.add('open');
  }
  $('btnSettings').addEventListener('click', openSettings);
  $('btnOpenSettings').addEventListener('click', openSettings);
  $('btnBannerConnect').addEventListener('click', openSettings);
  $('btnCloseSettings').addEventListener('click', function(){ settingsOverlay.classList.remove('open'); });
  $('btnCopyRules').addEventListener('click', function(){ copyText($('rulesCode').textContent).then(function(){ toast('Rules copied'); }); });
  $('btnConnect').addEventListener('click', function(){
    var db = cleanDb($('dbUrl').value);
    if(!/^https:\/\/[\w.-]+\.(firebaseio\.com|firebasedatabase\.app)$/i.test(db)){ toast('That does not look like a Firebase database URL'); $('dbUrl').focus(); return; }
    var btn = this; btn.disabled = true; btn.textContent = 'CHECKING\u2026';
    fetch(db + '/.json?shallow=true').then(function(r){
      if(r.status === 401 || r.status === 403){ /* root locked, per-calendar rules still fine */ }
      var cal = (window.FAMILY_CAL && window.FAMILY_CAL.cal) || randomCal();
      return fetch(db + '/' + cal + '/meta.json').then(function(r2){
        if(r2.status === 401 || r2.status === 403) throw new Error('rules');
        saveJSON(CFG_KEY, {db:db, cal:cal});
        var u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set('db', db); u.searchParams.set('cal', cal);
        location.replace(u.toString());
      });
    }).catch(function(err){
      btn.disabled = false; btn.textContent = 'CONNECT AND GO LIVE';
      toast(err && err.message === 'rules' ? 'Connected, but the rules block access. Paste the rules from above and Publish.' : 'Could not reach that database. Check the URL.', 3600);
    });
  });
  $('btnDisconnect').addEventListener('click', function(){
    if(!confirm('Disconnect this device from the shared calendar? Nothing in the shared calendar is deleted.')) return;
    try{ localStorage.removeItem(CFG_KEY); }catch(e){}
    var u = new URL(location.href); u.search = ''; u.hash = ''; location.replace(u.toString());
  });

  /* backups */
  $('btnExport').addEventListener('click', function(){
    download('wilkerson-calendar-' + todayIso() + '.json', JSON.stringify({people:tree.people, events:tree.events, removed:tree.removed}, null, 2), 'application/json');
  });
  $('btnImport').addEventListener('click', function(){ $('importFile').click(); });
  $('importFile').addEventListener('change', function(e){
    var file = e.target.files[0]; if(!file) return;
    var r = new FileReader();
    r.onload = function(){
      try{
        var inc = JSON.parse(r.result), patch = {}, n = 0;
        var evs = Array.isArray(inc.events) ? inc.events : Object.keys(inc.events || {}).map(function(id){ var x = inc.events[id]; x.id = id; return x; });
        var ppl = Array.isArray(inc.people) ? inc.people : Object.keys(inc.people || {}).map(function(id){ var x = inc.people[id]; x.id = id; return x; });
        ppl.forEach(function(p){ if(p.id && !tree.people[p.id]) patch['people/' + p.id] = {name:p.name, color:p.color, order:p.order == null ? 99 : p.order}; });
        evs.forEach(function(x){
          if(!x.id || tree.events[x.id] || tree.removed[x.id]) return;
          patch['events/' + x.id] = {date:x.date, title:x.title || '', time:x.time || '', endTime:x.endTime || '', allDay:!!x.allDay, personId:x.personId || 'family', place:x.place || x.location || '', address:x.address || '', note:x.note || ''}; n++;
        });
        if(n || Object.keys(patch).length) write(patch);
        toast('Merged in ' + n + ' new event' + (n === 1 ? '' : 's') + '.');
      }catch(err){ toast('That file could not be read.'); }
    };
    r.readAsText(file); e.target.value = '';
  });
  $('btnReset').addEventListener('click', function(){
    if(!confirm('This replaces the calendar' + (live ? ' for everyone' : ' on this device') + ' with the original schedule. Continue?')) return;
    var seed = seedTree(); seed.photo = tree.photo;
    tree = seed; derive(); cache(); render();
    if(live) fetch(cfg.db + '/' + cfg.cal + '.json', {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(seed)}).catch(function(){ toast('Could not reach the database.'); });
    toast('Original schedule restored');
  });

  /* ── iCal export (.ics with alerts) ──────────────────── */
  function icsDate(dateIso, mins){ var d = dateIso.replace(/-/g,''); return mins == null ? d : d + 'T' + pad(Math.floor(mins/60)) + pad(mins%60) + '00'; }
  function icsText(s){ return String(s || '').replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n'); }
  function buildIcs(evs){
    var lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Wilkerson Calendar//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:Wilkerson Calendar'];
    var stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
    evs.forEach(function(e){
      var p = person(e.personId), start = minutesOf(e.time), end = minutesOf(e.endTime);
      lines.push('BEGIN:VEVENT', 'UID:' + e.id + '@wilkerson-calendar', 'DTSTAMP:' + stamp);
      if(e.allDay || start == null){ lines.push('DTSTART;VALUE=DATE:' + icsDate(e.date), 'DTEND;VALUE=DATE:' + icsDate(addDays(e.date,1))); }
      else { if(end == null || end <= start) end = start + 60; lines.push('DTSTART:' + icsDate(e.date, start), 'DTEND:' + icsDate(e.date, end)); }
      lines.push('SUMMARY:' + icsText(p.name + ' \u00b7 ' + e.title));
      var loc = e.address || e.place; if(loc) lines.push('LOCATION:' + icsText(loc));
      var desc = [e.place && e.address ? e.place : '', e.note].filter(Boolean).join(' \u00b7 '); if(desc) lines.push('DESCRIPTION:' + icsText(desc));
      if(!(e.allDay || start == null)) lines.push('BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:' + icsText(e.title),'TRIGGER:-PT30M','END:VALARM');
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.map(function(l){ return l.length > 74 ? l.match(/.{1,74}/g).join('\r\n ') : l; }).join('\r\n');
  }
  function downloadIcs(evs, name){
    download((name || 'wilkerson-calendar').replace(/[^\w-]+/g,'-').toLowerCase() + '.ics', buildIcs(evs), 'text/calendar');
    toast(isIOS ? 'Open the file and tap "Add All"' : 'Calendar file saved');
  }
  $('btnIcsAll').addEventListener('click', function(){
    var from = addDays(todayIso(), -1);
    downloadIcs(state.events.filter(function(e){ return e.date >= from; }), 'wilkerson-calendar');
  });

  /* ── reminders (while the app is open) ───────────────── */
  var notified = {};
  function notify(title, body){
    if(!('Notification' in window) || Notification.permission !== 'granted') return;
    if(navigator.serviceWorker && navigator.serviceWorker.ready){
      navigator.serviceWorker.ready.then(function(reg){ reg.showNotification(title, {body:body, icon:'icons/icon-192.png', badge:'icons/icon-192.png', tag:title + body}); })
        .catch(function(){ try{ new Notification(title, {body:body}); }catch(e){} });
    } else { try{ new Notification(title, {body:body}); }catch(e){} }
  }
  function checkReminders(){
    if(!prefs.reminders) return;
    var now = new Date(), key = isoOf(now), nowMin = now.getHours()*60 + now.getMinutes();
    (byDate()[key] || []).forEach(function(e){
      var m = minutesOf(e.time); if(m == null || e.allDay) return;
      var diff = m - nowMin;
      if(diff <= 30 && diff >= 25 && !notified[e.id]){
        notified[e.id] = true;
        notify(person(e.personId).name + ' \u00b7 ' + e.title, 'Starts at ' + timeLabel(e) + (e.place ? ' \u00b7 ' + e.place : ''));
      }
    });
  }
  setInterval(checkReminders, 60000);

  /* ── push: reminders that arrive with the app closed ──────────── */
  var VAPID = (window.FAMILY_CAL && window.FAMILY_CAL.vapidPublic) || '';
  function urlB64(b64){
    var pad = '===='.slice(0, (4 - b64.length % 4) % 4);
    var raw = atob((b64 + pad).replace(/-/g,'+').replace(/_/g,'/'));
    var out = new Uint8Array(raw.length);
    for(var i=0;i<raw.length;i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function hashStr(str){
    var h = 5381;
    for(var i=0;i<str.length;i++) h = ((h<<5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  function pushable(){ return live && VAPID && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  function enablePush(){
    if(!pushable()) return Promise.resolve(false);
    return navigator.serviceWorker.ready.then(function(reg){
      return reg.pushManager.getSubscription().then(function(existing){
        return existing || reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:urlB64(VAPID)});
      });
    }).then(function(sub){
      var j = sub.toJSON(), id = hashStr(j.endpoint), patch = {};
      prefs.subId = id; saveJSON(PREF_KEY, prefs);
      patch['subs/' + id] = {endpoint:j.endpoint, p256dh:j.keys.p256dh, auth:j.keys.auth,
                             at:Date.now(), label:(navigator.platform || 'device')};
      return sendPatch(patch).then(function(){ return true; });
    }).catch(function(){ return false; });
  }
  function disablePush(){
    var id = prefs.subId;
    if(!('serviceWorker' in navigator)) return Promise.resolve();
    return navigator.serviceWorker.ready.then(function(reg){ return reg.pushManager.getSubscription(); })
      .then(function(sub){ return sub ? sub.unsubscribe() : null; })
      .then(function(){ if(id && live){ var p = {}; p['subs/' + id] = null; return sendPatch(p); } })
      .catch(function(){});
  }

  $('swReminders').addEventListener('click', function(){
    var sw = this;
    if(sw.getAttribute('aria-checked') === 'true'){
      prefs.reminders = false; saveJSON(PREF_KEY, prefs); sw.setAttribute('aria-checked','false');
      disablePush(); toast('Reminders off'); return;
    }
    if(!('Notification' in window)){
      toast(isIOS && !standalone ? 'Add this to your Home Screen first, then turn reminders on.' : 'Notifications are not supported in this browser.', 3800); return;
    }
    if(!live){ toast('Connect the calendar first, in the Sharing section above.', 3800); return; }
    Notification.requestPermission().then(function(perm){
      if(perm !== 'granted'){ toast('Notifications were not allowed.'); return; }
      prefs.reminders = true; saveJSON(PREF_KEY, prefs); sw.setAttribute('aria-checked','true');
      return enablePush().then(function(ok){
        notify('Reminders are on', ok ? 'You will hear about things 30 minutes before they start.'
                                      : 'This device will remind you while the app is open.');
        toast(ok ? 'Reminders on for this device' : 'Reminders on while the app is open');
        checkReminders();
      });
    });
  });

  /* ── install: service worker for offline + Home Screen ── */
  if('serviceWorker' in navigator && window.isSecureContext){
    window.addEventListener('load', function(){ navigator.serviceWorker.register('sw.js').catch(function(){}); });
  }

  /* ── parallax ────────────────────────────────────────── */
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!reduce){
    var media = $('heroMedia'), copy = $('heroCopy'), ghost = $('ghostNum'), ticking = false;
    window.addEventListener('scroll', function(){
      if(ticking) return; ticking = true;
      requestAnimationFrame(function(){
        ticking = false; var y = window.scrollY || 0;
        media.style.transform = 'translate3d(0,' + (y*0.4).toFixed(1) + 'px,0) scale(' + (1 + Math.min(y,300)*0.0004).toFixed(3) + ')';
        copy.style.transform = 'translate3d(0,' + (-y*0.22).toFixed(1) + 'px,0)';
        copy.style.opacity = String(Math.max(0, 1 - y/220));
        ghost.style.transform = 'translate3d(0,' + (-Math.max(0, y-260)*0.35).toFixed(1) + 'px,0)';
      });
    }, {passive:true});
  }

  /* ── go ──────────────────────────────────────────────── */
  render();
  if(live) connect(); else setSync('local', 'THIS DEVICE ONLY');
  if(prefs.reminders && 'Notification' in window && Notification.permission === 'granted'){
    setTimeout(function(){ enablePush(); }, 3000);   // keep this device's subscription current
  }
  setInterval(function(){ renderHero(); }, 60000);   // keep "next up" honest
})();
