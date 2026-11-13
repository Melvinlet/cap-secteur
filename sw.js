// ─────────────────────────────────────────────────────────────────────────────
// Service worker : rend l'appli utilisable hors connexion.
// IMPORTANT : à chaque mise en ligne d'une nouvelle version, change VERSION
// (sinon les téléphones garderont l'ancienne version en cache).
// ─────────────────────────────────────────────────────────────────────────────
const VERSION = 'cap-secteur-1.9.0';
const TUILES = 'cap-secteur-tuiles';
const IMAGES_WEB = 'cap-secteur-images-web';
const MAX_TUILES = 3000;

const APP = [
  './',
  './css/app.css',
  './fonts/barlow-condensed-latin-600-normal.woff2',
  './fonts/barlow-condensed-latin-700-normal.woff2',
  './fonts/barlow-latin-400-normal.woff2',
  './fonts/barlow-latin-500-normal.woff2',
  './fonts/barlow-latin-600-normal.woff2',
  './fonts/barlow-latin-700-normal.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon.svg',
  './index.html',
  './js/app.js',
  './js/carte.js',
  './js/config.js',
  './js/data.js',
  './js/db.js',
  './js/services/activite.js',
  './js/services/affinage.js',
  './js/services/agenda.js',
  './js/services/backup.js',
  './js/services/chiffrement.js',
  './js/services/civilite.js',
  './js/services/excel.js',
  './js/services/geo.js',
  './js/services/images.js',
  './js/services/kit.js',
  './js/services/ndf.js',
  './js/services/nuage.js',
  './js/services/planificateur.js',
  './js/services/rdv.js',
  './js/services/visite.js',
  './js/services/feries.js',
  './js/services/routing.js',
  './js/services/synchro.js',
  './js/ui.js',
  './js/views/act/concurrence.js',
  './js/views/act/frais.js',
  './js/views/act/objectifs.js',
  './js/views/act/rapport.js',
  './js/views/act/visites.js',
  './js/views/activite.js',
  './js/views/aujourdhui.js',
  './js/views/bienvenue.js',
  './js/views/catalogue.js',
  './js/views/compte.js',
  './js/views/cr.js',
  './js/views/magasin.js',
  './js/views/magasins.js',
  './js/views/onglets-planning.js',
  './js/views/plan.js',
  './js/views/presenter.js',
  './js/views/produit.js',
  './js/views/rdv.js',
  './js/views/reglages.js',
  './js/views/semaine.js',
  './js/views/tournee.js',
  './manifest.webmanifest',
  './vendor/exceljs.min.js',
  './vendor/jspdf/jspdf.plugin.autotable.min.js',
  './vendor/jspdf/jspdf.umd.min.js',
  './vendor/leaflet/images/layers-2x.png',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/leaflet.js'
];

self.addEventListener('install', e => {
  // cache: 'reload' = on va chercher les fichiers sur le serveur, jamais dans le cache du navigateur
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(APP.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== TUILES && k !== IMAGES_WEB).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Fonds de carte : on garde les tuiles déjà vues pour les retrouver hors connexion
  if (url.hostname === 'tile.openstreetmap.org' || (url.hostname === 'api.tomtom.com' && url.pathname.startsWith('/map/'))) {
    e.respondWith(caches.open(TUILES).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      try {
        const r = await fetch(e.request);
        if (r.ok) { c.put(e.request, r.clone()); trim(c); }
        return r;
      } catch { return new Response('', { status: 504 }); }
    }));
    return;
  }

  // Photos produits venant des sites fournisseurs : gardées pour le hors connexion
  if (url.origin !== location.origin && e.request.destination === 'image') {
    e.respondWith(caches.open(IMAGES_WEB).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      try {
        const r = await fetch(e.request);
        if (r.ok || r.type === 'opaque') c.put(e.request, r.clone());
        return r;
      } catch { return new Response('', { status: 504 }); }
    }));
    return;
  }

  // Fichiers de l'appli : toujours la dernière version quand le réseau répond (3 s max),
  // sinon la copie gardée pour le mode hors connexion
  if (url.origin === location.origin) {
    e.respondWith(caches.open(VERSION).then(async c => {
      const net = fetch(e.request, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; });
      const delai = new Promise(res => setTimeout(res, 3000, null));
      try {
        const r = await Promise.race([net, delai]);
        if (r) return r;
      } catch { /* hors ligne */ }
      return (await c.match(e.request, { ignoreSearch: true })) || (await net.catch(() => null)) || c.match('./index.html');
    }));
  }
  // Le reste (itinéraires, géocodage) passe directement par le réseau.
});

let trimming = false;
async function trim(c) {
  if (trimming) return; trimming = true;
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TUILES; i++) await c.delete(keys[i]);
  trimming = false;
}
