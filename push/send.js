/* Sends the calendar's reminders.
 *
 * Runs on a schedule in GitHub Actions, not in anyone's browser, so reminders
 * arrive even when every phone is locked and the app is closed. It reads the
 * same database the app writes to, works out what is about to start, and pushes
 * to each device that has turned reminders on.
 *
 * The VAPID private key comes from the repository's Actions secrets. Nothing
 * secret is ever written back to the database.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const SITE = 'https://calebwilkerson-art.github.io/wilkerson-family-calendar/';
const ZONE = 'America/New_York';
const LEAD_FROM = 20;              // start reminding when something is this many minutes away
const LEAD_TO = 40;                // and stop once it is closer than this
const DIGEST_HOUR = 7;             // the morning rundown, local time
const KEEP_MARKERS_DAYS = 4;

function loadConfig(){
  const src = fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8');
  const window = {};
  eval(src);                                    // config.js is a plain assignment to window
  return window.FAMILY_CAL || {};
}

function localNow(when){
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const p = {};
  for(const part of fmt.formatToParts(when)) if(part.type !== 'literal') p[part.type] = part.value;
  let hour = parseInt(p.hour, 10); if(hour === 24) hour = 0;
  return { date: `${p.year}-${p.month}-${p.day}`, mins: hour * 60 + parseInt(p.minute, 10) };
}

function minutesOf(t){
  if(!t) return null;
  const m = /(\d{1,2})[:.]?(\d{2})?\s*(a|p)/i.exec(String(t).trim());
  if(!m){
    const n = /^(\d{1,2}):(\d{2})$/.exec(String(t).trim());
    return n ? parseInt(n[1],10)*60 + parseInt(n[2],10) : null;
  }
  let h = parseInt(m[1],10);
  const mi = m[2] ? parseInt(m[2],10) : 0;
  const pm = m[3].toLowerCase() === 'p';
  if(pm && h < 12) h += 12;
  if(!pm && h === 12) h = 0;
  return h*60 + mi;
}
function clock(mins){
  const h = Math.floor(mins/60), mi = mins % 60, hh = h % 12 === 0 ? 12 : h % 12;
  return hh + ':' + String(mi).padStart(2,'0') + ' ' + (h >= 12 ? 'PM' : 'AM');
}
function dayKey(offsetDays){
  return localNow(new Date(Date.now() + offsetDays*86400000)).date;
}

async function readJson(url){
  const res = await fetch(url);
  if(!res.ok) throw new Error(url + ' -> HTTP ' + res.status);
  return res.json();
}
async function patch(base, body){
  const res = await fetch(base + '.json', {
    method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  if(!res.ok) throw new Error('PATCH -> HTTP ' + res.status);
}

async function main(){
  const cfg = loadConfig();
  if(!cfg.db){ console.log('No database configured yet. Nothing to send.'); return; }
  const priv = process.env.VAPID_PRIVATE;
  if(!priv){ console.log('VAPID_PRIVATE is not set. Nothing to send.'); return; }
  webpush.setVapidDetails(SITE, cfg.vapidPublic, priv);

  const base = cfg.db.replace(/\/+$/, '') + '/' + (cfg.cal || 'wilkerson-main');
  const tree = (await readJson(base + '.json')) || {};
  const subs = tree.subs || {};
  const events = tree.events || {};
  const people = tree.people || {};
  const sent = tree.pushed || {};
  const ids = Object.keys(subs);
  if(!ids.length){ console.log('No devices have reminders turned on.'); return; }

  const now = localNow(new Date());
  const today = now.date;
  const todays = Object.keys(events)
    .map(id => Object.assign({id}, events[id]))
    .filter(e => e && e.date === today)
    .map(e => Object.assign(e, {mins: e.allDay ? null : minutesOf(e.time)}))
    .sort((a,b) => (a.mins == null ? -1 : b.mins == null ? 1 : a.mins - b.mins));

  const who = e => (people[e.personId] && people[e.personId].name) || 'Family';
  const notes = [];

  // Anything about to start.
  for(const e of todays){
    if(e.mins == null) continue;
    const away = e.mins - now.mins;
    if(away < LEAD_FROM || away >= LEAD_TO) continue;
    const key = 'r_' + e.id + '_' + today;
    if(sent[key]) continue;
    const where = e.place || e.address || '';
    notes.push({
      key,
      title: who(e) + ' · ' + e.title,
      body: 'Starts at ' + clock(e.mins) + (where ? ' · ' + where : '') + ' (in about ' + away + ' min)',
      tag: e.id
    });
  }

  // The morning rundown.
  if(now.mins >= DIGEST_HOUR*60 && now.mins < DIGEST_HOUR*60 + 15 && todays.length){
    const key = 'd_' + today;
    if(!sent[key]){
      const lines = todays.slice(0,5).map(e => (e.mins == null ? 'All day' : clock(e.mins)) + ' · ' + who(e) + ' · ' + e.title);
      const extra = todays.length - Math.min(todays.length, 5);
      notes.push({
        key,
        title: 'Today · ' + todays.length + (todays.length === 1 ? ' thing on' : ' things on'),
        body: lines.join('\n') + (extra > 0 ? '\n+ ' + extra + ' more' : ''),
        tag: 'digest-' + today
      });
    }
  }

  if(!notes.length){ console.log('Nothing due at ' + today + ' ' + clock(now.mins) + '.'); return; }

  const done = {};
  const dead = {};
  for(const note of notes){
    const payload = JSON.stringify({title: note.title, body: note.body, tag: note.tag, url: SITE});
    let delivered = 0;
    for(const id of ids){
      const s = subs[id];
      if(!s || !s.endpoint) continue;
      try{
        await webpush.sendNotification({endpoint: s.endpoint, keys: {p256dh: s.p256dh, auth: s.auth}}, payload);
        delivered++;
      }catch(err){
        const code = err && err.statusCode;
        if(code === 404 || code === 410){ dead['subs/' + id] = null; }
        else console.log('  device ' + id + ': ' + (err && err.message ? err.message : err));
      }
    }
    console.log(note.title + ' -> ' + delivered + '/' + ids.length + ' device(s)');
    done['pushed/' + note.key] = Date.now();
  }

  // Forget old markers so the database stays small.
  const keepFrom = dayKey(-KEEP_MARKERS_DAYS);
  for(const key of Object.keys(sent)){
    const stamp = /_(\d{4}-\d{2}-\d{2})$/.exec(key);
    if(stamp && stamp[1] < keepFrom) done['pushed/' + key] = null;
  }

  const body = Object.assign({}, done, dead);
  if(Object.keys(body).length) await patch(base, body);
  if(Object.keys(dead).length) console.log('Removed ' + Object.keys(dead).length + ' device(s) that no longer accept push.');
}

main().catch(err => { console.error(err.message || err); process.exitCode = 1; });
