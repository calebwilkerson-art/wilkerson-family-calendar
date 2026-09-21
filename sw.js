/* Keeps the app shell available offline, lets it install to the Home Screen,
 * and receives push reminders when the app is closed.
 * Calendar data never goes through here; it streams straight from the database. */
var CACHE = 'wilkerson-cal-v3';
var SHELL = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest', 'hero.webp', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(SHELL); }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener('fetch', function(e){
  var url = new URL(e.request.url);
  if(url.origin !== location.origin || e.request.method !== 'GET') return;   // database and fonts pass straight through
  // Network first so updates land right away; fall back to the cached shell when offline.
  e.respondWith(
    fetch(e.request).then(function(res){
      var copy = res.clone();
      caches.open(CACHE).then(function(c){ c.put(e.request, copy); });
      return res;
    }).catch(function(){
      return caches.match(e.request).then(function(hit){ return hit || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined); });
    })
  );
});

/* Push reminders. The sender runs on a schedule outside the app, so these
 * arrive whether or not anyone has the calendar open. */
self.addEventListener('push', function(e){
  var data = {};
  try{ data = e.data ? e.data.json() : {}; }catch(err){ data = {title:'Wilkerson Calendar', body: e.data ? e.data.text() : ''}; }
  var title = data.title || 'Wilkerson Calendar';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: data.tag || title,
    renotify: false,
    data: {url: data.url || './'}
  }));
});
self.addEventListener('notificationclick', function(e){
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(function(list){
    for(var i=0;i<list.length;i++){ if('focus' in list[i]) return list[i].focus(); }
    return self.clients.openWindow(target);
  }));
});
/* If the browser rotates the subscription, take the new one and tell the app next time it opens. */
self.addEventListener('pushsubscriptionchange', function(e){
  e.waitUntil(self.registration.pushManager.getSubscription().then(function(s){
    if(s) return s;
    return self.registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey: e.oldSubscription && e.oldSubscription.options && e.oldSubscription.options.applicationServerKey});
  }).catch(function(){}));
});
