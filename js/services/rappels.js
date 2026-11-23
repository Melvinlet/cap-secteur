// Rappels par notification : relances de RDV, « À faire » à échéance, RDV du jour.
// Le calcul se fait ici (une seule fois, dans l'appli) ; le résultat est rangé dans l'appareil
// (réglage local « rappels », jamais synchronisé) et le service worker n'a plus qu'à l'afficher le bon jour,
// même appli fermée quand le téléphone le permet (Chrome Android, appli installée : « synchronisation périodique »).
import { db, getSettings } from '../db.js';
import { today, decale, fmtDate } from '../ui.js';
import { estOuvert } from './afaire.js';
import { dateEffRdv, heureEffRdv } from './rdv.js';

const CLE = 'rappels';
export const rappelsPossibles = () => 'Notification' in window && 'serviceWorker' in navigator;

// Liste datée des rappels à venir (et du jour)
export async function calculerRappels() {
  const s = await getSettings();
  const [rdvs, notes, mags] = await Promise.all([db.all('rdv'), db.all('notes'), db.all('magasins')]);
  const nom = id => mags.find(m => m.id === id)?.nom || 'Magasin';
  const auj = today(), apres = Number(s.relanceApres ?? 3);
  const l = [];
  for (const r of rdvs) {
    if (['envoyee', 'relancee'].includes(r.statut)) {
      const dernier = r.dateRelance || r.dateEnvoi;
      if (!dernier || (r.date && r.date < auj)) continue;   // demande pour une date passée : plus d'actualité
      l.push({ quand: decale(dernier.slice(0, 10), apres), type: 'relance', texte: `${nom(r.magasinId)} : pas de réponse à ta demande de RDV du ${fmtDate(dernier)}`, url: '#/rdv' });
    } else if (['acceptee', 'autreDate'].includes(r.statut) && dateEffRdv(r) >= auj) {
      l.push({ quand: dateEffRdv(r), type: 'rdv', texte: `RDV ${heureEffRdv(r) ? `à ${heureEffRdv(r).replace(':', 'h')} ` : ''}chez ${nom(r.magasinId)}`, url: '#/tournee' });
    }
  }
  for (const n of notes) if (estOuvert(n) && n.echeance) l.push({ quand: n.echeance, type: 'afaire', texte: `${nom(n.magasinId)} : ${n.aFaire}`, url: '#/afaire' });
  return l.filter(x => x.quand && x.quand >= decale(auj, -30)).sort((a, b) => a.quand.localeCompare(b.quand));
}

// Regroupe les rappels du jour (et en retard) en une notification
export function notificationDuJour(liste, jour = today()) {
  const l = liste.filter(x => x.quand <= jour);
  if (!l.length) return null;
  const n = t => l.filter(x => x.type === t).length;
  const titre = [n('rdv') && `${n('rdv')} RDV aujourd'hui`, n('relance') && `${n('relance')} relance${n('relance') > 1 ? 's' : ''}`, n('afaire') && `${n('afaire')} à faire`].filter(Boolean).join(' · ');
  return { titre: `Cap Secteur : ${titre}`, corps: l.slice(0, 4).map(x => x.texte).join('\n') + (l.length > 4 ? `\n… et ${l.length - 4} autre${l.length > 5 ? 's' : ''}` : ''),
    url: n('rdv') ? '#/tournee' : n('relance') ? '#/rdv' : '#/afaire', tag: `cap-rappels-${jour}` };
}

// À l'ouverture de l'appli (et après une modification) : range la liste pour le service worker,
// et montre la notification du jour si elle n'a pas encore été vue aujourd'hui
export async function majRappels({ montrer = true } = {}) {
  const s = await getSettings();
  if (!s.rappels || !rappelsPossibles() || Notification.permission !== 'granted') return;
  const liste = await calculerRappels();
  const ancien = (await db.get('reglages', CLE))?.valeur || {};
  // notifications prêtes pour les 14 prochains jours : le service worker n'a qu'à prendre celle du jour
  const parJour = {};
  for (let i = 0; i < 14; i++) { const d = decale(today(), i); const n = notificationDuJour(liste, d); if (n) parJour[d] = n; }
  await db.put('reglages', { cle: CLE, valeur: { ...ancien, liste, parJour, calcule: new Date().toISOString() } }, { sync: false });
  if (!montrer || ancien.vu === today()) return;
  const n = notificationDuJour(liste);
  if (!n) return;
  const reg = await navigator.serviceWorker.ready;
  try { await reg.showNotification(n.titre, { body: n.corps, tag: n.tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: n.url } }); } catch { return; }
  await db.put('reglages', { cle: CLE, valeur: { ...ancien, liste, parJour, vu: today(), calcule: new Date().toISOString() } }, { sync: false });
}

// Activation depuis les Réglages : autorisation + réveil périodique (si le téléphone le permet)
export async function activerRappels() {
  if (!rappelsPossibles()) return { ok: false, raison: 'Ce navigateur ne gère pas les notifications.' };
  const p = await Notification.requestPermission();
  if (p !== 'granted') return { ok: false, raison: 'Notifications refusées : autorise-les pour Cap Secteur dans les réglages du téléphone.' };
  let fond = false;
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) {
      const st = await navigator.permissions.query({ name: 'periodic-background-sync' }).catch(() => ({ state: 'prompt' }));
      if (st.state !== 'denied') { await reg.periodicSync.register('cap-rappels', { minInterval: 6 * 3600e3 }); fond = true; }
    }
  } catch { /* pas de réveil en arrière-plan : rappels à l'ouverture de l'appli */ }
  return { ok: true, fond };
}
