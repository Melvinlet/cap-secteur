// ─────────────────────────────────────────────────────────────────────────────
// Sauvegarde / synchronisation manuelle entre appareils, et « pack catalogue »
// à partager avec les collègues. Un seul format de fichier (.json) pour les deux.
// ─────────────────────────────────────────────────────────────────────────────
import { db, STORES, getSettings, saveSettings, enregistrerProfil } from '../db.js';
import { APP_VERSION } from '../config.js';
import { blobToDataURL, dataURLToBlob } from './images.js';

const PERSO = ['magasins', 'contacts', 'notes', 'sav', 'commandes', 'implantations', 'tournees', 'rdv', 'concurrence', 'frais', 'objectifs'];
const CATALOGUE = ['produits', 'images'];

async function dump(stores, catalogueSeul = false) {
  const data = {};
  const imgsProduits = catalogueSeul ? new Set((await db.all('produits')).flatMap(p => p.images || [])) : null;
  for (const s of stores) {
    let rows = await db.all(s);
    // le pack catalogue ne contient que les photos produits (jamais les photos de rayon ni les justificatifs)
    if (s === 'images' && imgsProduits) rows = rows.filter(r => imgsProduits.has(r.id));
    if (s === 'images') rows = await Promise.all(rows.map(async r => ({ ...r, blob: undefined, type: r.blob.type, data: await blobToDataURL(r.blob) })));
    data[s] = rows;
  }
  return data;
}

export async function exporter(type = 'complet') {
  const stores = type === 'catalogue' ? CATALOGUE : [...PERSO, ...CATALOGUE];
  const data = await dump(stores, type === 'catalogue');
  if (type !== 'catalogue') {
    const { cleTomTom, ...reglages } = await getSettings(); // la clé ne quitte jamais l'appareil
    data.reglages = reglages;
  }
  const profil = (await db.get('reglages', 'profil'))?.valeur;   // le profil entreprise voyage avec la sauvegarde et le pack catalogue
  if (profil) data.profil = profil;
  const json = JSON.stringify({ format: 'cap-secteur', type, version: APP_VERSION, date: new Date().toISOString(), data });
  return new Blob([json], { type: 'application/json' });
}

// mode 'fusion' : ajoute / met à jour sans rien supprimer (le plus récent gagne)
// mode 'remplacer' : efface d'abord les données concernées
export async function importer(file, mode = 'fusion') {
  const j = JSON.parse(await file.text());
  if (j.format !== 'cap-secteur') throw new Error("Ce fichier n'est pas une sauvegarde Cap Secteur");
  if (j.type === 'profil') {                                  // profil entreprise seul
    const { format, type, version, ...p } = j;
    await enregistrerProfil(p);
    return { type: 'profil', date: j.date, bilan: { profil: 1 }, nom: p.nom };
  }
  const bilan = {};
  if (j.data.profil) { await enregistrerProfil(j.data.profil); bilan.profil = 1; }
  for (const [store, rows] of Object.entries(j.data)) {
    if (store === 'reglages' || store === 'profil') continue;
    if (!STORES[store]) continue;
    if (mode === 'remplacer') await db.clear(store);
    let list = rows;
    if (store === 'images') list = await Promise.all(rows.map(async ({ data, type, ...r }) => ({ ...r, blob: await dataURLToBlob(data) })));
    if (mode === 'fusion' && store !== 'images') {
      const cur = new Map((await db.all(store)).map(r => [r.id, r]));
      list = list.filter(r => { const c = cur.get(r.id); return !c || (r.maj || '') >= (c.maj || ''); });
    }
    await db.putMany(store, list);
    bilan[store] = list.length;
  }
  if (j.data.reglages && mode === 'remplacer') {
    const { cleTomTom } = await getSettings();
    await saveSettings({ ...j.data.reglages, cleTomTom });
  }
  return { type: j.type, date: j.date, bilan };
}
