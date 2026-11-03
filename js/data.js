// Requêtes métier réutilisées par plusieurs écrans.
import { db } from './db.js';
import { joursDepuis } from './ui.js';
import { DUREES_ENSEIGNE, PRIORITES, PRIORITE_ENSEIGNE, PRIORITE_DEFAUT, SAISON, ROLES_CONTACT } from './config.js';

// Durée de visite : réglage du magasin > réglage de l'enseigne > durée par défaut
export function dureeVisite(m, s) {
  if (Number(m.dureeVisite)) return Number(m.dureeVisite);
  const tab = { ...DUREES_ENSEIGNE, ...(s.dureesEnseigne || {}) };
  const k = Object.keys(tab).filter(e => (m.enseigne || '').startsWith(e)).sort((a, b) => b.length - a.length)[0];
  return Number(k ? tab[k] : s.dureeVisite);
}

// Priorité d'un magasin : la sienne, sinon celle de son enseigne, sinon la priorité par défaut
export function prioriteDe(m) {
  if (m.priorite != null && m.priorite !== '') return Number(m.priorite);
  const k = Object.keys(PRIORITE_ENSEIGNE).filter(e => (m.enseigne || '').startsWith(e)).sort((a, b) => b.length - a.length)[0];
  return k ? PRIORITE_ENSEIGNE[k] : PRIORITE_DEFAUT;
}
// Nombre de jours entre deux visites (null = hors tournées)
export function frequenceDe(m, s) {
  if (Number(m.frequence)) return Number(m.frequence);
  const p = prioriteDe(m);
  if (PRIORITES[p] && PRIORITES[p].freq == null) return null;
  return Number((s.frequencesPriorite || {})[p] ?? PRIORITES[p]?.freq ?? s.frequenceDefaut);
}

// Magasins + indicateurs calculés (dernière visite, SAV ouverts, retard de visite)
export async function magasinsEnrichis(settings) {
  const [mags, notes, sav, cmds] = await Promise.all([db.all('magasins'), db.all('notes'), db.all('sav'), db.all('commandes')]);
  const last = new Map(), savOuv = new Map(), nbCmd = new Map();
  for (const n of notes) if (n.type === 'Visite' && (!last.has(n.magasinId) || n.date > last.get(n.magasinId))) last.set(n.magasinId, n.date);
  for (const s of sav) if (s.statut !== 'Résolu') savOuv.set(s.magasinId, (savOuv.get(s.magasinId) || 0) + 1);
  for (const c of cmds) nbCmd.set(c.magasinId, (nbCmd.get(c.magasinId) || 0) + 1);
  return mags.map(m => {
    const derniereVisite = last.get(m.id) || null;
    const freq = frequenceDe(m, settings);
    const j = joursDepuis(derniereVisite);
    return { ...m, derniereVisite, joursDepuisVisite: j, frequenceEff: freq, prio: prioriteDe(m),
      // urgence : > 1 = visite en retard ; un magasin jamais visité est considéré comme dû
      urgence: freq == null ? 0 : j == null ? 1 : j / freq,
      enRetard: j == null || freq == null ? null : j > freq, savOuverts: savOuv.get(m.id) || 0, nbCommandes: nbCmd.get(m.id) || 0 };
  });
}

export async function magasinComplet(id) {
  const [m, contacts, notes, sav, commandes, implantations] = await Promise.all([
    db.get('magasins', id), db.byMagasin('contacts', id), db.byMagasin('notes', id),
    db.byMagasin('sav', id), db.byMagasin('commandes', id), db.byMagasin('implantations', id)]);
  if (!m) return null;
  const desc = (a, b) => (b.date || '').localeCompare(a.date || '');
  return { m, contacts, notes: notes.sort(desc), sav: sav.sort(desc), commandes: commandes.sort(desc), implantations };
}

// ── Campagne / visites / stock ───────────────────────────────────────────────

// Produits vendables dans une enseigne (référencés), sinon tout le catalogue
export const produitsPour = (produits, enseigne) => {
  const ref = produits.filter(p => (p.enseignes || []).includes(enseigne));
  return (ref.length ? ref : produits).sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0));
};
export const estReference = (p, enseigne) => !p.enseignes?.length || p.enseignes.includes(enseigne);

// N° de visite de la campagne (V1, V2… comme dans le planning de l'entreprise)
export function numeroVisite(notes, date, idExclu) {
  const n = notes.filter(x => x.type === 'Visite' && x.id !== idExclu && (!SAISON.debut || x.date >= SAISON.debut) && x.date < date
    && !['Annulée', 'Reportée'].includes(x.statut)).length + 1;
  return n <= 6 ? `V${n}` : 'Autre';
}

// Relevés de stock successifs → ventes estimées, moyenne, couverture (en nombre de visites)
// vendu entre deux relevés = stock précédent + quantités commandées entre les deux − stock actuel
export function analyseStock(notes, commandes, produits) {
  const releves = notes.filter(n => n.stock && Object.keys(n.stock).length).sort((a, b) => a.date.localeCompare(b.date));
  const ids = [...new Set(releves.flatMap(n => Object.keys(n.stock)))];
  return ids.map(pid => {
    const pts = releves.filter(n => n.stock[pid] !== undefined && n.stock[pid] !== '').map(n => ({ date: n.date, stock: Number(n.stock[pid]) }));
    const ventes = [];
    for (let i = 1; i < pts.length; i++) {
      const livre = commandes.filter(c => c.date > pts[i - 1].date && c.date <= pts[i].date)
        .reduce((a, c) => a + c.lignes.filter(l => l.produitId === pid).reduce((x, l) => x + (Number(l.qte) || 0), 0), 0);
      ventes.push(Math.max(0, pts[i - 1].stock + livre - pts[i].stock));
    }
    const moyenne = ventes.length ? ventes.reduce((a, b) => a + b, 0) / ventes.length : null;
    const dernier = pts[pts.length - 1];
    const couverture = moyenne > 0 ? dernier.stock / moyenne : null;
    return { produit: produits.find(p => p.id === pid) || { id: pid, nom: pid }, pts, ventes, moyenne, dernier,
      couverture, rupture: (couverture != null && couverture < 1) || dernier.stock === 0 };
  }).sort((a, b) => (a.produit.ordre ?? 0) - (b.produit.ordre ?? 0));
}

// Registre des produits offerts : déjà donnés à ce magasin (1 seul par magasin et par produit)
export function offertsDejaDonnes(commandes, idExclu) {
  const set = new Set();
  for (const c of commandes) if (c.id !== idExclu) for (const l of c.lignes) if (Number(l.dummy) > 0) set.add(l.produitId);
  return set;
}

// Rôle d'un contact : choisi dans l'appli, sinon déduit de sa fonction (« rr », « cs », « directeur »…)
export function roleDe(c) {
  if (c.role && ROLES_CONTACT.includes(c.role)) return c.role;
  const f = ` ${(c.fonction || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')} `;
  if (/directeu|directric|\bdir\b/.test(f)) return 'Directeur';
  if (/chef des ventes|\bcdv\b|chef de groupe|\bcgm\b/.test(f)) return 'Chef des ventes';
  if (/chef de secteur|\bcss?\b|\bcds\b/.test(f)) return 'Chef de secteur magasin';
  if (/responsable rayon|resp\.? rayon|chef de rayon|\brr\b|\bcr\b|\brs\b/.test(f)) return 'Responsable de rayon';
  if (/vendeu|animat|conseill/.test(f)) return 'Vendeur';
  if (/adherent|gerant|patron|proprietaire/.test(f)) return 'Adhérent / gérant';
  if (/achet|centrale/.test(f)) return 'Acheteur / centrale';
  return '';
}
// Interlocuteurs triés : principal d'abord, puis du décisionnaire au vendeur, puis ceux qui ont un e-mail
const RANG = { 'Directeur': 1, 'Adhérent / gérant': 1, 'Chef des ventes': 2, 'Chef de secteur magasin': 3, 'Responsable de rayon': 4, 'Acheteur / centrale': 5, 'Vendeur': 6 };
export const trierContacts = list => [...list].sort((a, b) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0)
  || (RANG[roleDe(a)] || 9) - (RANG[roleDe(b)] || 9) || (!!b.email - !!a.email));
