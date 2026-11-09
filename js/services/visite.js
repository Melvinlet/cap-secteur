// « Visité » en un geste, depuis le planning ou la fiche magasin.
// Crée la visite (statut Réalisée) si elle n'existe pas encore ce jour-là, et coche l'étape de la tournée.
// Les détails (compte rendu, stock, photos…) restent facultatifs : on les ajoute ensuite sur la même visite.
import { db, getSettings } from '../db.js';
import { numeroVisite } from '../data.js';
import { today } from '../ui.js';

const ANNULEES = ['Annulée', 'Reportée'];
// Même identifiant sur le téléphone et le PC : deux « visité » du même jour ne font qu'une visite après la synchro
const idVisite = (magasinId, date) => `n-vis-${date}-${magasinId}`;
const visiteDuJour = (notes, date) => notes.find(n => n.type === 'Visite' && n.date === date && !ANNULEES.includes(n.statut));
// Une visite « vide » : rien d'autre que le geste « visité » (on peut l'effacer sans rien perdre)
export const estVide = n => !(n.texte || '').trim() && !(n.aFaire || '').trim() && !(n.contact || '').trim() && !(n.arrivee || n.depart)
  && !(n.photos || []).length && !(n.actions || []).length && !(n.interlocuteurs || []).length && !Object.keys(n.stock || {}).length;

async function cocherEtape(magasinId, date, fait) {
  const t = await db.get('tournees', date);
  const e = t?.etapes.find(x => x.magasinId === magasinId);
  if (e && e.fait !== fait) { e.fait = fait; await db.put('tournees', t); }
  return e;
}

// Note la visite du magasin ce jour-là (aujourd'hui par défaut) et renvoie la visite
export async function marquerVisite(magasinId, date = today()) {
  const notes = await db.byMagasin('notes', magasinId);
  let v = visiteDuJour(notes, date);
  const e = await cocherEtape(magasinId, date, true);
  if (v) {
    if (v.statut !== 'Réalisée') { v = { ...v, statut: 'Réalisée', maj: new Date().toISOString() }; await db.put('notes', v); }
    return v;
  }
  const s = await getSettings();
  v = { id: idVisite(magasinId, date), type: 'Visite', magasinId, date, statut: 'Réalisée', objet: e?.objet || s.objetDefaut, numero: numeroVisite(notes, date),
    texte: '', actions: [], photos: [], interlocuteurs: [], maj: new Date().toISOString() };
  await db.put('notes', v);
  return v;
}

// Retire le « visité » : la visite est effacée si elle est vide, gardée (avec son compte rendu) sinon
export async function annulerVisite(magasinId, date = today()) {
  await cocherEtape(magasinId, date, false);
  const v = visiteDuJour(await db.byMagasin('notes', magasinId), date);
  if (v && v.statut === 'Réalisée' && estVide(v)) { await db.del('notes', v.id); return { garde: false }; }
  return { garde: !!v };
}

// Visites réalisées d'une journée : magasinId → visite
export async function visitesDuJour(date) {
  const r = new Map();
  for (const n of await db.all('notes')) if (n.type === 'Visite' && n.date === date && n.statut === 'Réalisée') r.set(n.magasinId, n);
  return r;
}

export const lienDetails = v => `#/cr/${encodeURIComponent(v.magasinId)}/${encodeURIComponent(v.id)}`;

// Étapes cochées « visité » sans visite enregistrée (anciennes versions) : on crée la visite manquante
export async function rattraperVisites() {
  const [tours, notes] = await Promise.all([db.all('tournees'), db.all('notes')]);
  const vues = new Set(notes.filter(n => n.type === 'Visite' && !ANNULEES.includes(n.statut)).map(n => `${n.date}|${n.magasinId}`));
  let n = 0;
  for (const t of tours) {
    if (t.id > today()) continue;
    for (const e of t.etapes || []) if (e.fait && !vues.has(`${t.id}|${e.magasinId}`)) { await marquerVisite(e.magasinId, t.id); vues.add(`${t.id}|${e.magasinId}`); n++; }
  }
  return n;
}
