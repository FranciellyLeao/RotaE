/* sw.js — deixa o app funcionando sem internet depois da primeira visita. */
const V = 'rota-v1';
const SHELL = ['./', 'index.html', 'app.js', 'core.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== 'rota-tiles').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.hostname.includes('router.project-osrm.org')) return; // cálculo de rota: sempre online
  if (u.hostname.endsWith('tile.openstreetmap.org')) {       // mapa: guarda as partes já vistas
    e.respondWith(caches.open('rota-tiles').then(async c => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then(r => { if (r.ok) { c.put(e.request, r.clone()); trim(c); } return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  // app e bibliotecas: usa o que está salvo e atualiza em segundo plano
  e.respondWith(caches.open(V).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: u.origin === location.origin });
    const net = fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
let trimming = false;
async function trim(c) { if (trimming) return; trimming = true; const ks = await c.keys(); for (let i = 0; i < ks.length - 1500; i++) await c.delete(ks[i]); trimming = false; }
