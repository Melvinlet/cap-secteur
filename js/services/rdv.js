// ─────────────────────────────────────────────────────────────────────────────
// Rendez-vous : génération des messages, suivi des demandes, lien avec les tournées.
// Une demande « en cours » par magasin (id = rdv-<magasin>) avec son historique.
// ─────────────────────────────────────────────────────────────────────────────
import { bonjourDe } from './civilite.js';
import { db } from '../db.js';
import { MODELES_RDV, OBJET_PHRASE, STATUTS_RDV, PROFIL } from '../config.js';
import { ajouterEtape } from '../views/tournee.js';
import { numSemaine } from '../ui.js';

export const rdvId = magasinId => `rdv-${magasinId}`;
export const getRdv = async magasinId => (await db.get('rdv', rdvId(magasinId))) || { id: rdvId(magasinId), magasinId, statut: 'aFaire', historique: [] };
export const tousLesRdv = async () => new Map((await db.all('rdv')).map(r => [r.magasinId, r]));

// Message groupé : un seul mail à tous (en copie cachée), sans prénom, sans magasin ni date
const GROUPE = { label: 'Message groupé (à tous)', groupe: true, sujet: 'Prise de rendez-vous – {marques}', corps: `Bonjour,

Je suis {chef}, {poste} {marques} sur votre région.

Je souhaiterais passer vous rencontrer dans les prochaines semaines pour {objet}. Pourriez-vous m'indiquer le jour et le créneau qui vous conviennent le mieux ?

Bien cordialement,

{chef}
{poste}
{telephone}
{email}` };
export const modeles = s => Object.fromEntries(Object.entries({ ...MODELES_RDV, groupe: MODELES_RDV.groupe || GROUPE }).map(([k, m]) => [k, { ...m, ...((s.modelesRdv || {})[k] || {}) }]));
// Lien mailto avec les destinataires en copie cachée (null si trop long pour une messagerie)
// Outlook sur PC Windows attend des « ; » entre les adresses ; les messageries des téléphones, des « , »
export const separateurMails = () => (/Windows/i.test(navigator.userAgent) ? ';' : ',');
export const lienMailCci = (emails, sujet, corps) => { const u = `mailto:?bcc=${emails.map(encodeURIComponent).join(separateurMails())}&subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`; return u.length < 1900 ? u : null; };

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
  return `le ${dateEnLettres(date)} (semaine ${numSemaine(date)})${heure ? ` ${approx ? 'vers' : 'à'} ${heureEnLettres(heure, approx)}` : ''}`;
}

// Remplit un modèle avec les infos du magasin, du contact et de la demande
export function genererMessage(type, { m = {}, contact, rdv = {}, s }) {
  const md = modeles(s)[type] || modeles(s).demande;
  const date = dateEffRdv(rdv), heure = heureEffRdv(rdv);
  const nom = (contact?.nom || '').trim();
  const v = {
    bonjour: bonjourDe(contact), contact: nom,   // « Bonjour Monsieur / Madame », jamais le prénom
    magasin: m.nom, enseigne: m.enseigne, ville: m.ville,
    quand: quand(date, heure, type !== 'confirmation'), date: dateEnLettres(date), heure: heureEnLettres(heure),
    semaine: date ? `semaine ${numSemaine(date)}` : '',   // « semaine 48 », plus simple à caler au téléphone
    objet: OBJET_PHRASE[rdv.objet || s.objetDefaut] || OBJET_PHRASE.Autre,
    chef: s.commercial || '[ton nom]', telephone: s.telPro || '', email: s.emailPro || '',
    poste: PROFIL.poste || 'Commercial', societe: PROFIL.societe || '', marques: (PROFIL.marques || []).join(' & '),
  };
  const fill = t => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '').replace(/ \(\s*\)/g, '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();   // « ( ) » vide retiré (pas de date)
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
    const jour = dateEffRdv({ ...r, statut }), heure = heureEffRdv({ ...r, statut });
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

// Date / heure effectives d'un RDV : la date retenue si le magasin en a proposé une autre
export const dateEffRdv = r => (r ? (r.statut === 'autreDate' ? r.dateRetenue : r.date) : '') || '';
export const heureEffRdv = r => (r ? (r.statut === 'autreDate' ? r.heureRetenue : r.heure) : '') || '';
export const labelStatut = st => STATUTS_RDV[st]?.label || st;

// Où en est le RDV d'un magasin, vu depuis un jour de tournée (plannings Jour et Semaine) :
// non demandé · demandé / relancé, en attente (à relancer) · accepté (ce jour-là ou un autre) · refusé.
// Un vieux RDV (date passée) ne compte plus pour une nouvelle visite. null = rien à afficher.
const jourCourt = iso => new Date(iso + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
export function etatRdvJour(r, jour, relanceApres = 3) {
  const d0 = new Date(), auj = new Date(d0.getTime() - d0.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const nonDemande = (plus = '') => jour >= auj ? { cls: 'non', txt: `RDV non demandé${plus}` } : null;
  if (!r || r.statut === 'aFaire') return nonDemande(r?.date === jour && r.heure ? ` (souhaité ${r.heure})` : '');
  const dR = dateEffRdv(r), hR = heureEffRdv(r);
  const perime = d => d && d < auj && d < jour;   // demande ou RDV d'une date passée : c'était pour une autre visite
  if (['acceptee', 'autreDate'].includes(r.statut)) {
    if (dR === jour) return { cls: 'ok', txt: `RDV accepté${hR ? ` ${hR}` : ''}` };
    if (dR && !perime(dR)) return { cls: 'autre', txt: `RDV accepté pour le ${jourCourt(dR)}${hR ? ` ${hR}` : ''}` };
    return nonDemande();
  }
  if (['envoyee', 'relancee'].includes(r.statut)) {
    if (perime(r.date)) return nonDemande();
    const quoi = r.statut === 'relancee' ? `RDV relancé${r.relances > 1 ? ` ${r.relances} fois` : ''}` : 'RDV demandé';
    return { cls: 'attente', txt: `${quoi}${r.date && r.date !== jour ? ` pour le ${jourCourt(r.date)}` : ''}${r.heure ? ` ${r.heure}` : ''} · en attente${aRelancer(r, relanceApres) ? ' · à relancer' : ''}` };
  }
  if (r.statut === 'refusee') return perime(r.date) ? nonDemande() : { cls: 'refus', txt: 'RDV refusé' };
  return null;
}
export const tagEtatRdv = (r, jour, relanceApres) => { const x = etatRdvJour(r, jour, relanceApres); return x ? `<span class="rdv-et rdv-${x.cls}">${x.txt.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>` : ''; };
