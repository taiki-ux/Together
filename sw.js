/* ============================================================
   SW.JS — a deliberately tiny service worker.
   It lets Together be installed as an app and keeps the page available if the network
   blips on a reload. Network-first for our own files, so an update is never stuck behind
   an old cached copy. Requests to Supabase, YouTube, PeerJS and fonts are never touched.
   ============================================================ */
const CACHE = 'together-shell-v1';

self.addEventListener('install', ()=> self.skipWaiting());
self.addEventListener('activate', event=>{
  event.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event=>{
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async ()=>{
    try{
      const res = await fetch(req);
      if (res && res.ok){
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{});
      }
      return res;
    }catch(err){
      const cached = await caches.match(req, { ignoreSearch:true });
      if (cached) return cached;
      if (req.mode === 'navigate'){
        const shell = (await caches.match('./')) || (await caches.match('index.html'));
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
