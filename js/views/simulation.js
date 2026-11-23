// Simulation d'une tournée : on lance le même « Remplir automatiquement » que la Semaine (ou que le Jour), mais sur un brouillon.
// La vraie semaine (ou journée) n'est pas touchée : on compare les deux, puis on exporte si la simulation convient.
// Le brouillon reste sur cet appareil (non synchronisé) tant qu'il n'est pas exporté ou effacé.
import { ongletsPlanning } from './onglets-planning.js';
import { db, getSettings } from '../db.js';
import { magasinsEnrichis } from '../data.js';
import { esc, fmtKm, fmtDuree, fmtHeure, fmtDateLong, toast, modal, today, prioTag, tagSemaine, numSemaine, decale, lundiDe } from '../ui.js';
import { getTournee, estimerJour as estimer, chainer } from './tournee.js';
import { remplir, remplirJour } from './semaine.js';
import { tousLesRdv } from '../services/rdv.js';
import { ferie } from '../services/feries.js';

const JOURS = ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'];
const cle = id => id.includes(':') ? `simulation-${id}` : `simulation:${id}`;   // semaine : « simulation:lundi » ; journée : « simulation-jour:date »
const copie = x => JSON.parse(JSON.stringify(x));
const lireBrouillon = async lundi => (await db.get('reglages', cle(lundi)))?.valeur || null;
const ecrireBrouillon = (lundi, valeur) => db.put('reglages', { cle: cle(lundi), valeur }, { sync: false });
const effacerBrouillon = lundi => db.del('reglages', cle(lundi), { sync: false });

// Chiffres d'une semaine (vraie ou simulée) pour la comparaison
function bilan(tours, mags, s, rdvs) {
  const est = tours.map(t => t.etapes.length ? estimer(t, mags, s, rdvs) : null);
  const ids = tours.flatMap(t => t.etapes.map(e => e.magasinId));
  const ms = ids.map(id => mags.get(id)).filter(Boolean);
  return {
    est,
    visites: ids.length,
    p1: ms.filter(m => m.prio === 1).length,
    retard: ms.filter(m => m.urgence >= 1).length,
    km: est.reduce((a, p) => a + (p?.km || 0), 0),
    route: est.reduce((a, p) => a + (p?.conduite || 0), 0),
    nuits: tours.filter(t => t.etapes.length && !t.retour).length,
    charges: est.filter(p => p?.depasse).length,
    finMax: Math.max(0, ...est.map(p => p?.fin || 0)),
  };
}

let enCours = false;

export async function render(el, params = {}) {
  const s = await getSettings();
  const auj = today(), jSem = new Date(auj + 'T12:00').getDay();
  const modeJour = !!params.jour;   // simulation d'une seule journée (depuis la vue Jour)
  const jourSim = modeJour ? (params.lundi || auj) : null;
  const lundi = lundiDe(jourSim || params.lundi || (jSem === 0 || jSem === 6 ? decale(auj, jSem === 6 ? 2 : 1) : auj));
  const nb = Math.max(1, Math.min(6, Number(s.joursTerrain) || 5));
  const dates = modeJour ? [jourSim] : Array.from({ length: nb }, (_, i) => decale(lundi, i));
  const idB = modeJour ? `jour:${jourSim}` : lundi;
  const ici = modeJour ? `#/simulation/${jourSim}?jour=1` : `#/simulation/${lundi}`;
  const reRender = () => render(el, modeJour ? { lundi: jourSim, jour: '1' } : { lundi });
  const quoi = modeJour ? 'journée' : 'semaine';
  const all = await magasinsEnrichis(s);
  const mags = new Map(all.map(m => [m.id, m]));
  const reels = await Promise.all(dates.map(getTournee));
  reels.forEach(t => { t.etapes = t.etapes.filter(e => mags.has(e.magasinId)); });
  const rdvs = await tousLesRdv();
  const br = await lireBrouillon(idB);
  const sims = br ? br.tours.map(t => ({ ...t, etapes: t.etapes.filter(e => mags.has(e.magasinId)) })) : null;
  const departOk = s.depart.lat != null;
  const A = bilan(reels, mags, s, rdvs), B = sims ? bilan(sims, mags, s, rdvs) : null;

  // ligne de comparaison : actuelle, simulée, écart (vert = mieux, rouge = moins bien)
  const ligne = (lib, a, b, fmt = x => x, mieux = 'plus') => {
    const d = b - a, bon = mieux === 'plus' ? d > 0 : d < 0;
    const ecart = !d ? '<span class="muted">=</span>' : `<span class="${bon ? 'ok-txt' : 'ko-txt'}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</span>`;
    return `<tr><th scope="row">${lib}</th><td class="num">${fmt(a)}</td><td class="num"><strong>${fmt(b)}</strong></td><td class="num">${ecart}</td></tr>`;
  };
  const nomCourt = m => esc(m.nom);
  const jour = (i) => {
    const a = reels[i], b = sims[i], pa = A.est[i], pb = B.est[i];
    const idsA = new Set(a.etapes.map(e => e.magasinId)), idsB = new Set(b.etapes.map(e => e.magasinId));
    const resume = (t, p) => t.etapes.length ? `${t.etapes.length} mag. · ${fmtKm(p.km)} · ${fmtDuree(p.conduite)} de route · fin ${fmtHeure(p.fin)}${p.depasse ? ' · <span class="ko-txt">trop chargé</span>' : ''}${!t.retour ? ' · nuit dehors' : ''}` : '<span class="muted">aucune tournée</span>';
    const liste = (t, autre, signe) => t.etapes.map(e => { const m = mags.get(e.magasinId); const diff = !autre.has(e.magasinId);
      return `<li class="${diff ? `diff-${signe}` : ''}">${diff ? `<b aria-label="${signe === 'plus' ? 'ajouté' : 'retiré'}">${signe === 'plus' ? '+' : '−'}</b> ` : ''}${prioTag(m.prio)} ${nomCourt(m)} <small class="muted">${esc(m.ville || '')}${e.rdv || e.heureImposee ? ` · ${esc(e.rdv?.heure || e.heureImposee || 'RDV')}` : ''}</small></li>`; }).join('');
    const fer = ferie(dates[i]);
    return `<section class="sim-jour">
      <h3>${JOURS[(new Date(dates[i] + 'T12:00').getDay() + 6) % 7] || ''} ${new Date(dates[i] + 'T12:00').getDate()}${fer ? ` <span class="tag ferie">férié</span>` : ''}</h3>
      <div class="sim-cols">
        <div><p class="sim-titre">${modeJour ? 'Journée actuelle' : 'Semaine actuelle'}</p><p class="small">${resume(a, pa)}</p><ul class="plain sim-liste">${liste(a, idsB, 'moins')}</ul></div>
        <div><p class="sim-titre">Simulation</p><p class="small">${resume(b, pb)}</p><ul class="plain sim-liste">${liste(b, idsA, 'plus')}</ul></div>
      </div></section>`;
  };

  el.innerHTML = `<div class="page wide">
    ${ongletsPlanning('simulation', modeJour ? jourSim : lundi)}
    <nav class="seg sim-mode" aria-label="Simuler">
      <a href="#/simulation/${lundi}" ${modeJour ? '' : 'aria-current="page"'}>Une semaine</a>
      <a href="#/simulation/${modeJour ? jourSim : (dates.includes(auj) ? auj : lundi)}?jour=1" ${modeJour ? 'aria-current="page"' : ''}>Une journée</a></nav>
    <header class="page-head">
      ${modeJour ? `<div class="day-nav">
        <a class="btn-icon" href="#/simulation/${decale(jourSim, -1)}?jour=1" aria-label="Jour précédent">‹</a>
        <h1>Simulation · ${fmtDateLong(jourSim)} ${tagSemaine(jourSim)}</h1>
        <a class="btn-icon" href="#/simulation/${decale(jourSim, 1)}?jour=1" aria-label="Jour suivant">›</a>
      </div>` : `<div class="day-nav">
        <a class="btn-icon" href="#/simulation/${decale(lundi, -7)}" aria-label="Semaine précédente">‹</a>
        <h1>${tagSemaine(lundi)} Simulation · semaine du ${new Date(lundi + 'T12:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</h1>
        <a class="btn-icon" href="#/simulation/${decale(lundi, 7)}" aria-label="Semaine suivante">›</a>
      </div>`}
    </header>
    <p class="hint">Essaie un remplissage automatique sans toucher à ta vraie ${quoi}, compare, puis exporte-le s'il te convient. ${br ? `Simulation faite le ${new Date(br.cree).toLocaleDateString('fr-FR')} à ${new Date(br.cree).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.` : ''}</p>
    <div class="actions sim-actions">
      <button class="btn ${sims ? '' : 'primary'}" id="simuler" ${departOk ? '' : 'disabled'}>${sims ? 'Relancer une simulation' : modeJour ? 'Simuler la journée' : 'Simuler une tournée'}</button>
      ${sims ? `<button class="btn primary" id="exporter">Exporter vers la ${quoi}</button><button class="btn ghost" id="effacer">Effacer la simulation</button>` : ''}
      <a class="btn ghost" href="${modeJour ? `#/tournee/${jourSim}` : `#/semaine/${lundi}`}">Voir la ${quoi} actuelle</a>
    </div>
    ${departOk ? '' : '<div class="banner warn">Renseigne d\'abord ton point de départ dans Réglages.</div>'}
    ${sims ? `
    <section class="card sim-comp"><h2>Comparaison</h2>
      <table class="table"><thead><tr><th></th><th class="num">${modeJour ? 'Journée actuelle' : 'Semaine actuelle'}</th><th class="num">Simulation</th><th class="num">Écart</th></tr></thead><tbody>
        ${ligne('Visites', A.visites, B.visites)}
        ${ligne('dont priorité 1', A.p1, B.p1)}
        ${ligne('Magasins en retard de visite vus', A.retard, B.retard)}
        ${ligne('Kilomètres', A.km, B.km, fmtKm, 'moins')}
        ${ligne('Temps de route', A.route, B.route, fmtDuree, 'moins')}
        ${ligne('Nuits dehors', A.nuits, B.nuits, x => x, 'moins')}
        ${modeJour ? '' : ligne('Jours trop chargés', A.charges, B.charges, x => x, 'moins')}
        <tr><th scope="row">${modeJour ? 'Fin de journée' : 'Fin la plus tardive'}</th><td class="num">${A.finMax ? fmtHeure(A.finMax) : '—'}</td><td class="num"><strong>${B.finMax ? fmtHeure(B.finMax) : '—'}</strong></td><td></td></tr>
      </tbody></table>
      <p class="hint">Temps et kilomètres estimés (les deux ${modeJour ? 'journées' : 'semaines'} sont calculées de la même façon). <b class="ok-txt">Vert</b> = mieux dans la simulation, <b class="ko-txt">rouge</b> = moins bien. Dans le détail : <b>+</b> ajouté par la simulation, <b>−</b> absent de la simulation.</p>
    </section>
    <div class="sim-jours">${dates.map((_, i) => jour(i)).join('')}</div>`
    : `<div class="empty"><p>Aucune simulation pour cette ${quoi}.</p><p class="muted">« ${modeJour ? 'Simuler la journée' : 'Simuler une tournée'} » ouvre les mêmes réglages que « Remplir automatiquement » (magasins imposés, nombre maximum, zone, enseignes…), mais le résultat reste ici, à part.</p></div>`}
  </div>`;

  // arrivée depuis la carte de couverture : zone déjà choisie (autour d'un magasin, ou un département)
  const mz = params.autour && mags.get(params.autour);
  const zone = mz?.lat != null ? { lat: mz.lat, lon: mz.lon, nom: mz.nom } : params.dep ? { dep: String(params.dep) } : null;
  const simuler = async () => {
    if (enCours) return; enCours = true;
    try {
      const base = copie(reels);   // la simulation part de la semaine actuelle (RDV et magasins déjà prévus compris)
      if (modeJour) {
        const ok = await remplirJour(jourSim, base[0], all, s, rdvs, {
          titre: 'Simuler la journée', valider: 'Lancer la simulation',
          sortie: async (t, r) => {
            await ecrireBrouillon(idB, { cree: new Date().toISOString(), tours: [copie(t)], resume: r });
            toast(`Simulation prête : ${r.n} magasin${r.n > 1 ? 's' : ''}. Compare avec ta journée actuelle.`);
          },
        });
        if (ok) reRender();
        return;
      }
      const ok = await remplir(lundi, dates, base, all, s, rdvs, {
        titre: 'Simuler la semaine', valider: 'Lancer la simulation', zone,
        sortie: async (tours, r) => {
          await ecrireBrouillon(lundi, { cree: new Date().toISOString(), tours: copie(tours), resume: r });
          toast(`Simulation prête : ${r.n} visites. Compare avec ta semaine actuelle.`);
        },
      });
      if (ok) reRender();
    } finally { enCours = false; }
  };
  el.querySelector('#simuler')?.addEventListener('click', simuler);
  if (zone && departOk) { history.replaceState(null, '', `#/simulation/${lundi}`); simuler(); }
  el.querySelector('#effacer')?.addEventListener('click', async () => {
    await effacerBrouillon(idB); toast('Simulation effacée'); reRender();
  });
  el.querySelector('#exporter')?.addEventListener('click', async () => {
    const faits = reels.reduce((a, t) => a + t.etapes.filter(e => e.fait).length, 0);
    const ok = await modal({ titre: `Exporter vers la ${quoi}`, valider: `Remplacer ma ${quoi}`,
      corps: `<p>${modeJour ? `La journée du ${fmtDateLong(jourSim)}` : `La semaine ${numSemaine(lundi)} (du ${new Date(lundi + 'T12:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })})`} sera remplacée par la simulation (${B.visites} visite${B.visites > 1 ? 's' : ''}).</p>
        ${faits ? `<p>Les ${faits} magasin${faits > 1 ? 's' : ''} déjà marqué${faits > 1 ? 's' : ''} « visité » sont gardé${faits > 1 ? 's' : ''}.</p>` : ''}
        <p class="hint">Tes RDV sont déjà dans la simulation. Pour revenir en arrière, il faudra refaire ta ${quoi} à la main.</p>` });
    if (ok === null) return;
    for (let i = 0; i < dates.length; i++) {
      const vrai = await getTournee(dates[i]), sim = copie(sims[i]);
      const gardes = vrai.etapes.filter(e => e.fait && !sim.etapes.some(x => x.magasinId === e.magasinId));   // une visite faite ne disparaît jamais
      sim.etapes = [...gardes, ...sim.etapes.map(e => ({ ...e, fait: vrai.etapes.find(x => x.magasinId === e.magasinId)?.fait || false }))];
      sim.calcul = null;
      if (sim.etapes.length || sim.heureDebut) await db.put('tournees', sim); else await db.del('tournees', dates[i]);
    }
    const tours = await Promise.all([...(modeJour ? [decale(jourSim, -1)] : []), ...dates, ...(modeJour ? [decale(jourSim, 1)] : [])].map(getTournee));
    for (let i = 1; i < tours.length; i++) if (chainer(tours[i - 1], tours[i], mags) && tours[i].etapes.length) await db.put('tournees', tours[i]);
    if (!modeJour && chainer(null, tours[0], mags) && tours[0].etapes.length) await db.put('tournees', tours[0]);
    await effacerBrouillon(idB);
    toast(`Simulation exportée vers ta ${quoi}`);
    location.hash = modeJour ? `#/tournee/${jourSim}` : `#/semaine/${lundi}`;
  });
}
