// ─────────────────────────────────────────────────────────────────────────────
// Stockage local (IndexedDB). Toutes les données restent sur l'appareil.
// Pour ajouter un type de données : ajoute son nom dans STORES et monte DB_VERSION.
// ─────────────────────────────────────────────────────────────────────────────
import { DEFAULT_SETTINGS, appliquerProfil } from './config.js';

const DB_NAME = 'cap-secteur';
const DB_VERSION = 4;
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
  sync: { keyPath: 'k' },          // synchronisation : modifications en attente d'envoi, session, état
};
// Ce qui se synchronise entre appareils (les réglages : seulement « settings » et « profil »)
export const SYNCHRO = new Set(['magasins', 'contacts', 'notes', 'sav', 'commandes', 'implantations', 'produits', 'images',
  'tournees', 'rdv', 'concurrence', 'frais', 'objectifs', 'reglages']);
const cleDe = (store, obj) => obj?.[STORES[store].keyPath];
const aSynchroniser = (store, id) => SYNCHRO.has(store) && (store !== 'reglages' || ['settings', 'profil', 'kit'].includes(id));
let ecouteur = null;                       // prévenu à chaque modification (pour lancer la synchro)
export const surModification = f => { ecouteur = f; };
async function marquer(store, ids, supprime = false) {
  ids = ids.filter(id => id != null && aSynchroniser(store, id));
  if (!ids.length) return;
  const t = Date.now();
  await tx('sync', 'readwrite', os => { for (const id of ids) os.put({ k: `d:${store}:${id}`, store, id, t, supprime }); });
  ecouteur?.();
}

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
  // { sync: false } : écriture venant de la synchronisation elle-même (ne repart pas en ligne)
  put: async (store, obj, { sync = true } = {}) => { const r = await tx(store, 'readwrite', os => wrap(os.put(obj))); if (sync) await marquer(store, [cleDe(store, obj)]); return r; },
  putMany: async (store, list, { sync = true } = {}) => { await tx(store, 'readwrite', os => { list.forEach(o => os.put(o)); }); if (sync) await marquer(store, list.map(o => cleDe(store, o))); },
  del: async (store, id, { sync = true } = {}) => { const r = await tx(store, 'readwrite', os => wrap(os.delete(id))); if (sync) await marquer(store, [id], true); return r; },
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
export const oublierReglages = () => { cache = null; };

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
