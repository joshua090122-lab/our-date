/* Version all shell files together. External APIs and photos are never cached here. */
const PREFIX = 'our-date-v2-' + new URL(self.registration.scope).pathname + '-';
const CACHE = PREFIX + '20260918-3';
const FILES = ['./','./index.html','./styles.css','./enhancements.css','./config.js','./auth.js','./data.js','./app.js','./enhancements.js','./map-css-rotate.js','./manifest.webmanifest','./fonts/NotoSansKR.woff','./icons/red-pandas-v3-192.png','./icons/red-pandas-v3-512.png','./icons/red-pandas-v3-180.png','./icons/red-pandas-v3-maskable.png'];
const urls = FILES.map(x => new URL(x, self.registration.scope).href);
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(urls))));
self.addEventListener('message', e => { if(e.data === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil((async()=>{
  for(const key of await caches.keys()) if(key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  if(e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if(u.origin !== self.location.origin || !u.href.startsWith(self.registration.scope)) return;
  const canonical = u.origin + u.pathname;
  if(canonical === new URL('./config.js',self.registration.scope).href){
    e.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      try{const response=await fetch(e.request);if(response.ok){await cache.put(canonical,response.clone());return response;}return (await cache.match(canonical))||response;}
      catch(error){const cached=await cache.match(canonical);if(cached)return cached;throw error;}
    })());return;
  }
  if(u.pathname.startsWith('/api/')) return;
  if(e.request.mode === 'navigate') {
    e.respondWith(caches.open(CACHE).then(async c => (await c.match(new URL('./index.html',self.registration.scope).href)) || fetch(e.request)));
  } else if(urls.includes(canonical)) {
    e.respondWith(caches.open(CACHE).then(async c => (await c.match(canonical)) || fetch(e.request)));
  }
});
