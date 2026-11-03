// ─────────────────────────────────────────────────────────────────────────────
// Stockage local (IndexedDB). Toutes les données restent sur l'appareil.
// Pour ajouter un type de données : ajoute son nom dans STORES et monte DB_VERSION.
// ─────────────────────────────────────────────────────────────────────────────
import { DEFAULT_SETTINGS, appliquerProfil } from './config.js';

const DB_NAME = 'cap-secteur';
const DB_VERSION = 3;
export const STORES = {
  magasins: { keyPath: 'id' },
  contacts: { keyPath: 'id', index: 'magasinId' },
  notes: { keyPath: 'id', index: 'magasinId' },
  sav: { keyPath: 'id', index: 'magasinId' },
  commandes: { keyPath: 'id', index: 'magasinId' },
  implantations: { keyPath: 'id', index: 'magasinId' },
  produits: { keyPath: 'id' },
  images: { keyPath: 'id' },       // photos produits (Blob)
  tournees: { keyPath: 'id' },     // une tournée par date (id = AAAA-MM-JJ)
  rdv: { keyPath: 'id', index: 'magasinId' },   // demandes de rendez-vous (une en cours par magasin)
  concurrence: { keyPath: 'id', index: 'magasinId' }, // relevés concurrence (marques, produits, offres)
  frais: { keyPath: 'id' },        // notes de frais
  objectifs: { keyPath: 'id' },    // objectifs (en unités / nombres, jamais en prix)
  reglages: { keyPath: 'cle' },
};

let dbPromise;
function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, def] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const os = db.createObjectStore(name, { keyPath: def.keyPath });
        if (def.index) os.createIndex(def.index, def.index);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let result;
    Promise.resolve(fn(os)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const db = {
  all: store => tx(store, 'readonly', os => wrap(os.getAll())),
  get: (store, id) => tx(store, 'readonly', os => wrap(os.get(id))),
  byMagasin: (store, magasinId) => tx(store, 'readonly', os => wrap(os.index('magasinId').getAll(magasinId))),
  put: (store, obj) => tx(store, 'readwrite', os => wrap(os.put(obj))),
  putMany: (store, list) => tx(store, 'readwrite', os => { list.forEach(o => os.put(o)); }),
  del: (store, id) => tx(store, 'readwrite', os => wrap(os.delete(id))),
  clear: store => tx(store, 'readwrite', os => wrap(os.clear())),
  count: store => tx(store, 'readonly', os => wrap(os.count())),
};

export const uid = (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ── Réglages ──────────────────────────────────────────────────────────────────
let cache = null;
export async function getSettings() {
  if (cache) return cache;
  const row = await db.get('reglages', 'settings');
  cache = { ...DEFAULT_SETTINGS, ...(row?.valeur || {}) };
  return cache;
}
export async function saveSettings(patch) {
  const s = { ...(await getSettings()), ...patch };
  cache = s;
  await db.put('reglages', { cle: 'settings', valeur: s });
  return s;
}

// ── Profil entreprise (jamais dans le code : importé sur chaque appareil) ───────
export async function chargerProfil() {
  try { const row = await db.get('reglages', 'profil'); appliquerProfil(row?.valeur || null); return row?.valeur || null; }
  catch { appliquerProfil(null); return null; }
}
export async function enregistrerProfil(p) {
  await db.put('reglages', { cle: 'profil', valeur: p });
  appliquerProfil(p); cache = null;
}

// Demande au navigateur de ne pas effacer les données en cas de manque de place.
export async function persistStorage() {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch { /* ignoré */ }
  return false;
}
