// ─────────────────────────────────────────────────────────────────────────────
// Rendez-vous : génération des messages, suivi des demandes, lien avec les tournées.
// Une demande « en cours » par magasin (id = rdv-<magasin>) avec son historique.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from '../db.js';
import { MODELES_RDV, OBJET_PHRASE, STATUTS_RDV, PROFIL } from '../config.js';
import { ajouterEtape } from '../views/tournee.js';

export const rdvId = magasinId => `rdv-${magasinId}`;
export const getRdv = async magasinId => (await db.get('rdv', rdvId(magasinId))) || { id: rdvId(magasinId), magasinId, statut: 'aFaire', historique: [] };
export const tousLesRdv = async () => new Map((await db.all('rdv')).map(r => [r.magasinId, r]));

export const modeles = s => Object.fromEntries(Object.entries(MODELES_RDV).map(([k, m]) => [k, { ...m, ...((s.modelesRdv || {})[k] || {}) }]));

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export function dateEnLettres(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00');
  return `${JOURS[d.getDay()]} ${d.getDate() === 1 ? '1er' : d.getDate()} ${MOIS[d.getMonth()]}`;
}
// « 09:35 » → « 9 h 35 » ; arrondi au quart d'heure quand l'heure est approximative
const heureEnLettres = (h, arrondi = false) => {
  if (!h) return '';
  let [H, M] = h.split(':').map(Number);
  if (arrondi) { M = Math.round(M / 15) * 15; if (M === 60) { H += 1; M = 0; } }
  return `${H} h${M ? ' ' + String(M).padStart(2, '0') : ''}`;
};

// « le mardi 10 novembre vers 10 h 30 » / « le mardi 10 novembre » / « prochainement »
export function quand(date, heure, approx = true) {
  if (!date) return 'prochainement';
  return `le ${dateEnLettres(date)}${heure ? ` ${approx ? 'vers' : 'à'} ${heureEnLettres(heure, approx)}` : ''}`;
}

// Remplit un modèle avec les infos du magasin, du contact et de la demande
export function genererMessage(type, { m, contact, rdv, s }) {
  const md = modeles(s)[type] || modeles(s).demande;
  const date = rdv.statut === 'autreDate' ? rdv.dateRetenue : rdv.date;
  const heure = rdv.statut === 'autreDate' ? rdv.heureRetenue : rdv.heure;
  const nom = (contact?.nom || '').trim();
  const v = {
    bonjour: nom ? `Bonjour ${nom}` : 'Bonjour', contact: nom, magasin: m.nom, enseigne: m.enseigne, ville: m.ville,
    quand: quand(date, heure, type !== 'confirmation'), date: dateEnLettres(date), heure: heureEnLettres(heure),
    objet: OBJET_PHRASE[rdv.objet || s.objetDefaut] || OBJET_PHRASE.Autre,
    chef: s.commercial || '[ton nom]', telephone: s.telPro || '', email: s.emailPro || '',
    poste: PROFIL.poste || 'Commercial', societe: PROFIL.societe || '', marques: (PROFIL.marques || []).join(' & '),
  };
  const fill = t => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  return { sujet: fill(md.sujet), corps: fill(md.corps) };
}

export const lienMail = (to, sujet, corps) => `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
export const lienSms = (tel, corps) => `sms:${(tel || '').replace(/\s/g, '')}?body=${encodeURIComponent(corps)}`;
export const estMobile = (tel = '') => /^0[67]/.test(tel.replace(/\s/g, ''));

// Change le statut, garde l'historique ; un rendez-vous accepté est ajouté à la tournée du jour retenu.
export async function changerStatut(rdv, statut, extra = {}) {
  const now = new Date().toISOString();
  const r = { ...rdv, ...extra, statut, maj: now, historique: [...(rdv.historique || []), { le: now, statut, ...extra }] };
  if (statut === 'envoyee' && !rdv.dateEnvoi) r.dateEnvoi = now.slice(0, 10);
  if (statut === 'relancee') { r.relances = (rdv.relances || 0) + 1; r.dateRelance = now.slice(0, 10); }
  await db.put('rdv', r);
  let ajoute = null;
  if (statut === 'acceptee' || statut === 'autreDate') {
    const jour = statut === 'autreDate' ? r.dateRetenue : r.date;
    const heure = statut === 'autreDate' ? r.heureRetenue : r.heure;
    if (jour) {
      await ajouterEtape(jour, r.magasinId);
      const t = await db.get('tournees', jour);
      const e = t.etapes.find(x => x.magasinId === r.magasinId);
      e.rdv = { heure: heure || '', statut: 'Confirmée' };
      if (r.objet) e.objet = r.objet;
      await db.put('tournees', t);
      ajoute = jour;
    }
  }
  return { rdv: r, ajoute };
}

// Une demande envoyée sans réponse depuis N jours est « à relancer »
export function aRelancer(r, jours = 3) {
  if (!['envoyee', 'relancee'].includes(r.statut)) return false;
  const d = r.dateRelance || r.dateEnvoi;
  return d && (Date.now() - new Date(d + 'T12:00').getTime()) / 86400000 >= jours;
}

export const labelStatut = st => STATUTS_RDV[st]?.label || st;
