// ─────────────────────────────────────────────────────────────────────────────
// Indicateurs d'activité sur une période (rapport, comparateur, objectifs).
// Uniquement des nombres et des unités : aucun prix ni chiffre d'affaires.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from '../db.js';
import { prioriteDe } from '../data.js';
import { haversine } from './geo.js';

export async function chargerTout() {
  const st = ['magasins', 'notes', 'rdv', 'commandes', 'sav', 'concurrence', 'frais', 'tournees', 'objectifs', 'produits'];
  const v = await Promise.all(st.map(s => db.all(s)));
  const d = Object.fromEntries(st.map((s, i) => [s, v[i]]));
  d.magById = new Map(d.magasins.map(m => [m.id, m]));
  return d;
}

const dans = (x, du, au) => x && x >= du && x <= au;
export const estVisiteFaite = n => n.type === 'Visite' && (!n.statut || n.statut === 'Réalisée');

// Kilomètres d'une tournée : calcul TomTom s'il existe, sinon estimation à vol d'oiseau
function kmTournee(t, magById, s) {
  if (t.calcul?.legs?.length) return t.calcul.legs.reduce((a, l) => a + l.km, 0);
  const dep = t.depart?.lat != null ? t.depart : s.depart;
  if (dep?.lat == null) return 0;
  const pts = [dep, ...t.etapes.map(e => magById.get(e.magasinId)).filter(m => m?.lat != null), ...(t.retour ? [s.depart] : [])];
  let k = 0; for (let i = 1; i < pts.length; i++) k += haversine(pts[i - 1], pts[i]) * s.coefRoute;
  return k;
}
const minutes = h => { const [a, b] = (h || '').split(':').map(Number); return a * 60 + (b || 0); };

// filtre : { enseigne, priorite, produitId }
export function indicateurs(d, du, au, s, filtre = {}) {
  const okMag = id => { const m = d.magById.get(id); if (!m) return false;
    return (!filtre.enseigne || m.enseigne === filtre.enseigne) && (filtre.priorite == null || filtre.priorite === '' || prioriteDe(m) === Number(filtre.priorite)); };
  const visites = d.notes.filter(n => estVisiteFaite(n) && dans(n.date, du, au) && okMag(n.magasinId));
  const magVus = new Set(visites.map(n => n.magasinId));
  const p1 = d.magasins.filter(m => prioriteDe(m) === 1 && okMag(m.id));
  const p1Vus = p1.filter(m => magVus.has(m.id)).length;
  const cmds = d.commandes.filter(c => dans(c.date, du, au) && okMag(c.magasinId));
  const lignes = cmds.flatMap(c => c.lignes).filter(l => !filtre.produitId || l.produitId === filtre.produitId);
  const rdvEv = d.rdv.filter(r => okMag(r.magasinId)).flatMap(r => (r.historique || []).map(h => ({ ...h, jour: (h.le || '').slice(0, 10) }))).filter(h => dans(h.jour, du, au));
  const tours = d.tournees.filter(t => dans(t.id, du, au) && t.etapes?.length);
  const actions = {};
  visites.forEach(n => (n.actions || []).forEach(a => { actions[a] = (actions[a] || 0) + 1; }));
  const parEnseigne = {};
  visites.forEach(n => { const e = d.magById.get(n.magasinId)?.enseigne || '?'; parEnseigne[e] = (parEnseigne[e] || 0) + 1; });
  const tempsMag = visites.reduce((a, n) => a + (n.arrivee && n.depart ? Math.max(0, minutes(n.depart) - minutes(n.arrivee)) : 0), 0);
  const frais = d.frais.filter(f => dans(f.date, du, au));
  return {
    visites: visites.length,
    magasins: magVus.size,
    p1: p1Vus, p1Total: p1.length,
    tempsMagasin: tempsMag,
    photos: visites.reduce((a, n) => a + (n.photos?.length || 0), 0),
    releves: visites.filter(n => n.stock && Object.keys(n.stock).length).length,
    ruptures: visites.reduce((a, n) => a + Object.values(n.stock || {}).filter(q => Number(q) === 0).length, 0),
    concurrence: d.concurrence.filter(c => dans(c.date, du, au) && okMag(c.magasinId)).length,
    rdvDemandes: rdvEv.filter(h => h.statut === 'envoyee').length,
    rdvRelances: rdvEv.filter(h => h.statut === 'relancee').length,
    rdv: rdvEv.filter(h => h.statut === 'acceptee' || h.statut === 'autreDate').length,
    rdvRefus: rdvEv.filter(h => h.statut === 'refusee').length,
    commandes: cmds.length,
    unites: lignes.reduce((a, l) => a + (Number(l.qte) || 0), 0),
    dummies: lignes.reduce((a, l) => a + (Number(l.dummy) || 0), 0),
    savOuverts: d.sav.filter(x => dans(x.date, du, au) && okMag(x.magasinId)).length,
    joursTerrain: tours.length,
    km: tours.reduce((a, t) => a + kmTournee(t, d.magById, s), 0),
    nuits: tours.filter(t => t.retour === false).length,
    fraisTotal: frais.reduce((a, f) => a + (Number(f.montant) || 0), 0),
    fraisDu: frais.filter(f => f.payeur === 'moi' && f.remboursable && f.statut !== 'remboursee' && f.statut !== 'refusee').reduce((a, f) => a + (Number(f.montant) || 0), 0),
    actions, parEnseigne, listeVisites: visites,
  };
}

// ── Périodes ─────────────────────────────────────────────────────────────────
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const D = s => new Date(s + 'T12:00');
export function periode(type, ref) {
  const r = D(ref);
  if (type === 'semaine') { const l = new Date(r); l.setDate(r.getDate() - ((r.getDay() + 6) % 7)); const f = new Date(l); f.setDate(l.getDate() + 6); return [iso(l), iso(f)]; }
  if (type === 'mois') return [iso(new Date(r.getFullYear(), r.getMonth(), 1, 12)), iso(new Date(r.getFullYear(), r.getMonth() + 1, 0, 12))];
  if (type === 'annee') return [`${r.getFullYear()}-01-01`, `${r.getFullYear()}-12-31`];
  return [ref, ref];
}
// période précédente (S-1, M-1, année-1 ; personnalisée : même durée juste avant)
export function precedente(type, du, au) {
  if (type === 'semaine') { const a = D(du); a.setDate(a.getDate() - 7); return periode('semaine', iso(a)); }
  if (type === 'mois') { const a = D(du); a.setMonth(a.getMonth() - 1); return periode('mois', iso(a)); }
  if (type === 'annee') { const a = D(du); a.setFullYear(a.getFullYear() - 1); return periode('annee', iso(a)); }
  const n = Math.round((D(au) - D(du)) / 86400000) + 1;
  const f = D(du); f.setDate(f.getDate() - 1); const a = new Date(f); a.setDate(f.getDate() - n + 1);
  return [iso(a), iso(f)];
}
// même période l'an dernier (N-1)
export function anPasse(du, au) {
  const a = D(du), b = D(au); a.setFullYear(a.getFullYear() - 1); b.setFullYear(b.getFullYear() - 1);
  return [iso(a), iso(b)];
}
export function decaler(type, du, sens) {
  const a = D(du);
  if (type === 'semaine') a.setDate(a.getDate() + 7 * sens);
  else if (type === 'mois') a.setMonth(a.getMonth() + sens);
  else if (type === 'annee') a.setFullYear(a.getFullYear() + sens);
  return periode(type, iso(a));
}
export const libellePeriode = (type, du, au) => {
  const o = { day: 'numeric', month: 'short' };
  if (type === 'mois') return D(du).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  if (type === 'annee') return du.slice(0, 4);
  return `${D(du).toLocaleDateString('fr-FR', o)} → ${D(au).toLocaleDateString('fr-FR', { ...o, year: 'numeric' })}`;
};
