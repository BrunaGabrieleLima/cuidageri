// CuidaGeri PWA: cache apenas de imagens públicas.
// Nunca interceptar/cachar convites, tokens, login, dados do Supabase ou respostas privadas.
const CACHE='cuidageri-public-images-v2';
const ICONS=['/favicon.png','/icone-cuidageri.png','/logo-cuidageri.png','/pwa-192.png','/pwa-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ICONS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==self.location.origin||!ICONS.includes(u.pathname))return;e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request)));});
