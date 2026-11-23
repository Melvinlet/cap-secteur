// Écran « Semaine » : les tournées de la semaine côte à côte, à ajuster à la main ou à
// remplir automatiquement selon les priorités (avec détour pour les magasins en retard).
import { ongletsPlanning } from './onglets-planning.js';
import { db, getSettings, saveSettings } from '../db.js';
import { DEFAULT_SETTINGS, PRIORITES, PROFIL } from '../config.js';
import { magasinsEnrichis, prioriteDe } from '../data.js';
import { $, $$, esc, prioTag, enseigneColor, fmtKm, fmtDuree, fmtHeure, parseHeure, toast, modal, confirmer, fmtDate, glisser, today, norm, tagSemaine, numSemaine, decale, lundiDe, boutonCalendrier, brancherCalendrier, brancherPlus } from '../ui.js';
import { getTournee, heureRdv, choisirMagasins, exporterVersPlanning, estimerJour as estimer, placerRendezVous, departPourRdv, calibrer, empreinte, modifierDuree, chainer, lieuNuit, pointsJour, choisirNuit } from './tournee.js';
import { planifier } from '../services/planificateur.js';
import { dateEnLettres, tousLesRdv, tagEtatRdv, dateEffRdv, heureEffRdv } from '../services/rdv.js';
import { htmlImposes, brancherImposes, lireImposes, htmlCiblage, lireCiblage, optionsZone, lireZone } from './remplissage.js';
import { haversine } from '../services/geo.js';
import { estimate, optimiserOrdre, trajet, calculerTrajets } from '../services/routing.js';
import { carte, repere, repereDepart, animerTrace } from '../carte.js';
import { marquerVisite, annulerVisite, lienDetails, estVide } from '../services/visite.js';
import { ferie, tagFerie } from '../services/feries.js';

const COULEURS = ['#1E4FA0', '#C8371D', '#2E8540', '#6B4BA1', '#B25E09', '#0E7C86'];
const JOURS = ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'];
let map;
let echecTomTom = null;   // TomTom en échec pendant cette session : on n'insiste pas (bouton pour réessayer)


// Le calcul TomTom gardé correspond-il encore à la journée (mêmes étapes, même départ, même arrivée) ?
const proche = (a, b) => a && b && Math.abs(a[0] - b.lat) < 0.05 && Math.abs(a[1] - b.lon) < 0.05;
// trajets déjà demandés à TomTom pendant cette session : jamais deux fois le même (pas de boucle de calculs)
const demandes = new Set();
const cleTrajet = (t, pts) => t.id + pts.map(p => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`).join(';');
const aCalculer = (t, pts) => t.etapes.length && pts.length >= 2 && !traceTomTom(t, pts) && !demandes.has(cleTrajet(t, pts));
const traceTomTom = (t, pts) => { const legs = t.calcul?.legs;
  return t.calcul?.provider === 'tomtom' && legs?.length === pts.length - 1 && legs.every((l, k) => l.points?.length > 1 && proche(l.points[0], pts[k]) && proche(l.points.at(-1), pts[k + 1])); };

export async function render(el, params) {
  destroy();
  const s = await getSettings();
  relanceApres = s.relanceApres ?? 3;
  // sans date : la semaine en cours (le week-end : la suivante) ; les jours déjà passés sont repliés
  const auj = today(), jSem = new Date(auj + 'T12:00').getDay();
  const lundi = lundiDe(params.lundi || (jSem === 0 || jSem === 6 ? decale(auj, jSem === 6 ? 2 : 1) : auj));
  const nb = Math.max(1, Math.min(6, Number(s.joursTerrain) || 5));
  const dates = Array.from({ length: nb }, (_, i) => decale(lundi, i));
  const all = await magasinsEnrichis(s);
  const mags = new Map(all.map(m => [m.id, m]));
  const tours = await Promise.all(dates.map(getTournee));
  tours.forEach(t => { t.etapes = t.etapes.filter(e => mags.has(e.magasinId)); });
  // chaque départ est recalé d'après la nuit de la veille (vendredi soir → lundi : pas de lien, le week-end se passe à la maison)
  for (let i = 0; i < tours.length; i++) {
    const veille = i ? tours[i - 1] : null;
    if (chainer(veille, tours[i], mags) && (tours[i].etapes.length || tours[i].heureDebut)) await db.put('tournees', tours[i]);
  }
  const rdvs = await tousLesRdv();
  // visites faites cette semaine (« visité » depuis le jour, la fiche magasin ou un compte rendu) → étapes cochées
  const vus = new Map((await db.all('notes')).filter(n => n.type === 'Visite' && n.statut === 'Réalisée' && dates.includes(n.date)).map(n => [`${n.date}|${n.magasinId}`, n]));
  for (const t of tours) if (t.etapes.some(e => !e.fait && vus.has(`${t.id}|${e.magasinId}`))) { t.etapes.forEach(e => { if (vus.has(`${t.id}|${e.magasinId}`)) e.fait = true; }); await db.put('tournees', t); }
  const est = tours.map(t => estimer(t, mags, s, rdvs));
  const tot = { n: tours.reduce((a, t) => a + t.etapes.length, 0), km: est.reduce((a, p) => a + p.km, 0),
    nuits: tours.filter(t => t.etapes.length && !t.retour).length, detours: tours.reduce((a, t) => a + t.etapes.filter(e => e.detour).length, 0) };
  const departOk = s.depart.lat != null;

  el.innerHTML = `<div class="page wide">
    ${ongletsPlanning('semaine', lundi)}
    <header class="page-head">
      <div class="day-nav">
        <a class="btn-icon" href="#/semaine/${decale(lundi, -7)}" aria-label="Semaine précédente">‹</a>
        <h1>${tagSemaine(lundi)} Semaine du ${dateEnLettres(lundi).replace(/^lundi /, '')}</h1>
        <a class="btn-icon" href="#/semaine/${decale(lundi, 7)}" aria-label="Semaine suivante">›</a>
        ${boutonCalendrier('pick', lundi, 'Choisir une semaine')}
      </div>
    </header>
    ${departOk ? '' : '<div class="banner">Indique ton point de départ dans les <a href="#/reglages">Réglages</a> pour préparer la semaine.</div>'}
    <div class="tour-sum week-sum">
      <div><span class="big">${tot.n}</span> visites</div>
      <div><span class="big">${fmtKm(tot.km)}</span> de route (estim.)</div>
      <div><span class="big">${tot.nuits}</span> nuit${tot.nuits > 1 ? 's' : ''} sur place</div>
      <div><span class="big">${tot.detours}</span> détour${tot.detours > 1 ? 's' : ''} pour retard</div>
    </div>
    <div class="actions">
      <button class="btn primary" id="auto" ${departOk ? '' : 'disabled'}>Remplir automatiquement</button>
      <button class="btn" id="optSem" ${departOk && tot.n > 1 ? '' : 'disabled'}>Optimiser la semaine</button>
      <a class="btn" href="#/rdv?du=${lundi}&au=${dates[dates.length - 1]}">Demander les RDV</a>
      <button class="btn ghost plus-btn" id="plusS" aria-haspopup="dialog">Plus ⋯</button>
    </div>
    <div class="actions-cachees" id="plusSem" hidden>
      <a class="btn" href="#/simulation/${lundi}" title="Essayer un remplissage sans toucher à cette semaine, puis comparer">Simuler une tournée</a>
      <button class="btn" id="planRdv" title="Un RDV pris sur place ou au téléphone : magasin, jour, heure">Planifier un RDV</button>
      <button class="btn" id="versAgenda" title="Mettre les RDV acceptés de la semaine dans Google Agenda">RDV → Agenda</button>
      <button class="btn" id="exp" title="Pour ton fichier Excel de planning">Exporter le ${esc(PROFIL.planning.nom || 'planning')}</button>
      ${s.cleTomTom && echecTomTom && tours.some(t => t.etapes.length && t.calcul?.provider !== 'tomtom') ? '<button class="btn" id="reels" title="Remplace les temps estimés par les temps TomTom">Trajets réels (TomTom)</button>' : ''}
      <button class="btn ghost" id="vider" ${tot.n ? '' : 'disabled'}>Vider la semaine</button>
    </div>
    <div class="week">${tours.map((t, i) => colonne(t, i, est[i], mags, s, dates, rdvs, vus)).join('')}</div>
    <h2 class="h2">Carte de la semaine</h2>
    <p class="legend">${dates.map((d, i) => `<span><i style="background:${COULEURS[i]}"></i>${JOURS[i]} ${new Date(d + 'T12:00').getDate()}</span>`).join('')}</p>
    <div id="wmap" class="map-panel week-map"></div>
  </div>`;

  const save = async t => {
    t.calcul = null; if (t.retour) delete t.hotel;
    if (t.etapes.length || t.heureDebut) await db.put('tournees', t); else await db.del('tournees', t.id);
    const i = tours.indexOf(t), l = tours[i + 1];
    if (l && chainer(t, l, mags) && (l.etapes.length || l.heureDebut)) await db.put('tournees', l);   // le lendemain part du bon endroit
  };
  // changer l'heure de départ ne change pas les trajets : on garde le calcul TomTom
  const depart = async (i, h) => { const t = tours[i]; if (!h || h === s.heureDebut) delete t.heureDebut; else t.heureDebut = h; await db.put('tournees', t); render(el, { lundi }); };
  // trajets réels TomTom : calculés automatiquement pour les jours qui n'en ont pas (une seule fois, gardés ensuite)
  if (s.cleTomTom && s.itineraire === 'tomtom' && departOk && navigator.onLine && !echecTomTom && tours.some(t => aCalculer(t, pointsJour(t, mags, s)))) {
    (async () => {
      const hash = location.hash;
      for (const t of tours) {
        const pts = pointsJour(t, mags, s);
        if (!aCalculer(t, pts)) continue;
        demandes.add(cleTrajet(t, pts));
        const emp = empreinte(t);
        const r = await calculerTrajets(pts, s);
        if (r.provider !== 'tomtom') { echecTomTom = r.erreur || 'indisponible'; break; }
        const enBase = await db.get('tournees', t.id);
        if (!enBase || empreinte(enBase) !== emp) continue;   // modifiée entre-temps (onglet Jour…) : on ne l'écrase pas
        await db.put('tournees', { ...enBase, calcul: { ...r, ts: new Date().toISOString() } });
        await calibrer(pts, r.legs, s);
      }
      if (location.hash === hash && document.body.contains(el) && !document.querySelector('dialog[open]')) render(el, { lundi });
    })();
  }
  $('#reels')?.addEventListener('click', async e => {
    echecTomTom = null;
    const b = e.currentTarget; b.disabled = true;
    let n = 0, err = null;
    for (const t of tours) {
      const pts = pointsJour(t, mags, s);
      if (!t.etapes.length || pts.length < 2 || traceTomTom(t, pts)) continue;
      b.textContent = `Calcul… ${++n}`;
      const emp = empreinte(t);
      const r = await calculerTrajets(pts, s);
      if (r.erreur || r.sansCle) { err = r.erreur || 'clé TomTom manquante'; break; }
      const enBase = await db.get('tournees', t.id);
      if (!enBase || empreinte(enBase) !== emp) continue;
      await db.put('tournees', { ...enBase, calcul: { ...r, ts: new Date().toISOString() } });
      if (r.provider === 'tomtom') await calibrer(pts, r.legs, s);
    }
    toast(err ? `TomTom indisponible (${err}) : temps estimés` : 'Trajets réels calculés avec TomTom', err ? 'warn' : undefined);
    render(el, { lundi });
  });
  $$('[data-hdep]').forEach(x => x.onchange = () => depart(+x.dataset.hdep, x.value));
  // jours passés repliés (un clic sur l'en-tête les déplie) ; sur téléphone, on arrive directement sur aujourd'hui
  $$('.wday.passe > header').forEach(h => { h.title = 'Jour passé : cliquer pour afficher'; h.onclick = e => { if (e.target.closest('a')) return; h.parentElement.classList.toggle('ouvert'); }; });
  const jAuj = el.querySelector('.wday.auj');
  if (jAuj && !params.lundi && matchMedia('(max-width: 899px)').matches && el.querySelector('.wday.passe')) setTimeout(() => jAuj.scrollIntoView({ block: 'start', behavior: 'instant' }), 50);
  $$('[data-nuit]').forEach(b => b.onclick = async () => { const t = tours[+b.dataset.nuit]; if (await choisirNuit(t, all, s)) { await save(t); render(el, { lundi }); } });
  $$('[data-hrdv]').forEach(b => b.onclick = () => { const [i, h] = b.dataset.hrdv.split(/:(.+)/); depart(+i, h); });
  $('#pick').onchange = e => { location.hash = `#/semaine/${lundiDe(e.target.value)}`; };
  brancherCalendrier(el);
  brancherPlus($('#plusS'), $('#plusSem'), 'Semaine');
  $('#exp').onclick = () => exporterVersPlanning(lundi, s, { du: lundi, au: dates[dates.length - 1] });
  $('#vider').onclick = async () => {
    if (!(await confirmer('Vider la semaine', 'Retirer tous les magasins prévus cette semaine ? Les rendez-vous confirmés sont gardés.', 'Vider'))) return;
    for (const t of tours) { t.etapes = t.etapes.filter(e => e.rdv); t.depart = null; t.retour = true; await save(t); }
    render(el, { lundi });
  };
  $('#optSem').onclick = () => optimiserSemaineUI(tours, mags, s, rdvs).then(ok => ok && render(el, { lundi }));
  $('#auto').onclick = () => remplir(lundi, dates, tours, all, s, rdvs).then(ok => ok && render(el, { lundi }));
  $$('[data-add]').forEach(b => b.onclick = async () => {
    const t = tours[+b.dataset.add];
    if (await choisirMagasins(t, all, s, t.depart?.lat != null ? t.depart : s.depart)) { await save(t); render(el, { lundi }); }
  });
  // RDV acceptés (date confirmée dans la semaine) → Google Agenda : uniquement ceux-là
  $('#planRdv')?.addEventListener('click', async () => {
    const { planifierRdv } = await import('./planif-rdv.js');
    const auj = today();
    if (await planifierRdv({ date: dates.includes(auj) ? auj : lundi })) render(el, params);
  });
  $('#versAgenda')?.addEventListener('click', async () => {
    const { evenementRdv, proposerAgendaSemaine } = await import('../services/agenda.js');
    const cts = new Map((await db.all('contacts')).map(c => [c.id, c]));
    const evs = [...rdvs.values()].filter(r => ['acceptee', 'autreDate'].includes(r.statut) && mags.has(r.magasinId))
      .map(r => evenementRdv(mags.get(r.magasinId), r, s, cts.get(r.contactId), r.objet || ''))
      .filter(ev => dates.includes(ev.date)).sort((a, b) => (a.date + (a.heure || '')).localeCompare(b.date + (b.heure || '')));
    proposerAgendaSemaine(evs, `RDV acceptés · S${numSemaine(lundi)} · semaine du ${new Date(lundi + 'T12:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`);
  });
  $$('[data-vu]').forEach(b => b.onclick = async () => {
    const [i, k] = b.dataset.vu.split(':').map(Number);
    const t = tours[i], e = t.etapes[k], nom = mags.get(e.magasinId)?.nom || '';
    if (e.fait) { await annulerVisite(e.magasinId, t.id); render(el, { lundi }); return toast('Visite retirée'); }
    const v = await marquerVisite(e.magasinId, t.id);
    await render(el, { lundi });
    toast(`${nom} : visité`, '', { label: 'Ajouter des détails', href: lienDetails(v) });
  });
  $$('[data-del]').forEach(b => b.onclick = async () => {
    const [i, k] = b.dataset.del.split(':').map(Number);
    tours[i].etapes.splice(k, 1); await save(tours[i]); render(el, { lundi });
  });
  el.querySelectorAll('.wstops').forEach((ol, i) => glisser(ol, { onDeplace: async (de, vers) => { const t = tours[i]; const [x] = t.etapes.splice(de, 1); t.etapes.splice(vers, 0, x); await save(t); render(el, { lundi }); } }));
  $$('[data-duree]').forEach(b => b.onclick = async () => { const [i, k] = b.dataset.duree.split(':').map(Number); if (await modifierDuree(tours[i], k, mags, s)) { await db.put('tournees', tours[i]); render(el, { lundi }); } });
  $$('[data-move]').forEach(sel => sel.onchange = async () => {
    const [i, k] = sel.dataset.move.split(':').map(Number);
    const j = Number(sel.value);
    const [e] = tours[i].etapes.splice(k, 1);
    if (e.rdv && !(await confirmer('Déplacer un rendez-vous ?', 'Ce magasin a un rendez-vous confirmé ce jour-là. Le déplacer quand même ?', 'Déplacer'))) { render(el, { lundi }); return; }
    if (!tours[j].etapes.some(x => x.magasinId === e.magasinId)) tours[j].etapes.push({ ...e, rdv: undefined });
    await save(tours[i]); await save(tours[j]); render(el, { lundi });
  });

  // carte
  map = await carte($('#wmap'));
  const layers = departOk ? [repereDepart(s.depart)] : [];
  tours.forEach((t, i) => {
    const pts = pointsJour(t, mags, s);
    if (departOk && t.etapes.length && pts.length >= 2) {
      // tracé réel TomTom (routes) s'il correspond bien à la journée affichée ; sinon pointillés à vol d'oiseau en attendant le calcul
      const legs = t.calcul?.legs;
      if (traceTomTom(t, pts)) legs.forEach(l => layers.push(L.polyline(l.points, { color: COULEURS[i], weight: 3, opacity: .85 })));
      else layers.push(L.polyline(pts.map(p => [p.lat, p.lon]), { color: COULEURS[i], weight: 3, opacity: .7, dashArray: '6 8' }));
    }
    t.etapes.forEach((e, k) => { const m = mags.get(e.magasinId); if (m?.lat != null) layers.push(repere(m, k + 1, COULEURS[i]).bindPopup(`<strong>${esc(m.nom)}</strong><br>${dateEnLettres(t.id)}`)); });
  });
  if (layers.length) { const g = L.featureGroup(layers).addTo(map); map.fitBounds(g.getBounds().pad(0.08), { animate: false }); }
  if (document.getElementById('main')?.dataset.entree) animerTrace(layers);
}

// Heure de RDV : confirmée (étape) ou demandée au magasin pour ce jour-là (en attente de réponse)
let relanceApres = 3;
function rdvTxt(e, r, jour) {
  if (e.rdv) return ` <b class="ok-txt">· RDV ${esc(e.rdv.heure || 'confirmé')}</b>`;
  if (e.heureImposee) return ` <b class="ok-txt">· à ${esc(e.heureImposee)}</b>`;
  if (e.impose) return ` <span class="muted">· imposé</span>`;
  const x = tagEtatRdv(r, jour, relanceApres);
  return x ? ` ${x}` : '';
}

function colonne(t, i, p, mags, s, dates, rdvs, vus = new Map()) {
  const last = t.etapes.length ? mags.get(t.etapes[t.etapes.length - 1].magasinId) : null;
  const auj = today();
  const fer = ferie(t.id);
  return `<section class="wday${t.id < auj ? ' passe' : ''}${t.id === auj ? ' auj' : ''}${fer ? ' ferie' : ''}" style="--c:${COULEURS[i]}" data-jour="${t.id}">
    <header><a href="#/tournee/${t.id}"><strong>${JOURS[i]} ${new Date(t.id + 'T12:00').getDate()}</strong></a>
      <span class="muted">${t.etapes.length} magasin${t.etapes.length > 1 ? 's' : ''}</span></header>
    ${fer ? `<p class="wday-ferie">Férié · ${esc(fer)}${t.etapes.length ? ' — vérifie que les magasins sont ouverts' : ''}</p>` : ''}
    <div class="wdep"><label>Départ <input type="time" data-hdep="${i}" value="${esc(t.heureDebut || s.heureDebut)}" class="${t.heureDebut ? 'modifiee' : ''}"></label>${t.heureDebut ? `<button class="btn-link" data-hrdv="${i}:${esc(s.heureDebut)}" title="Revenir à l'heure habituelle">habituel ${esc(s.heureDebut.replace(':', 'h'))}</button>` : ''}
      ${(() => { const h = t.etapes.length ? departPourRdv(t, mags, s, rdvs) : null; return h && h !== (t.heureDebut || s.heureDebut) ? `<button class="btn small ${p.rdvRates ? 'primary' : 'ghost'}" data-hrdv="${i}:${h}" title="Pour arriver à l'heure au RDV">${h.replace(':', 'h')} pour le RDV</button>` : ''; })()}</div>
    ${t.etapes.length ? `<p class="wday-sum ${p.depasse ? 'over' : ''}">${p.estime ? '≈ ' : ''}${fmtKm(p.km)} · ${fmtDuree(p.conduite)} de route${p.estime ? '' : ' (TomTom)'} · fin ${p.estime ? 'vers ' : ''}${fmtHeure(p.fin)}${p.attente >= 20 ? ` · ${fmtDuree(p.attente)} d'attente avant RDV` : ''}${p.depasse ? ' — trop chargé' : ''}</p>` : ''}
    ${t.depart?.lat != null ? `<p class="wday-night">☾ départ ${esc(t.depart.adresse.replace(/^Nuit/, 'après la nuit'))}</p>` : ''}
    <ol class="wstops">${t.etapes.map((e, k) => { const m = mags.get(e.magasinId); const pe = p.etapes[k]; return `${pe?.leg ? `<li class="wleg" aria-label="Trajet"><span>${k === 0 ? (t.depart?.lat != null ? 'depuis l\'hôtel' : 'depuis la maison') : ''}</span>${p.estime ? '≈ ' : ''}${fmtKm(pe.leg.km)} · ${fmtDuree(pe.leg.min)}</li>` : ''}<li class="${pe?.hors ? 'hors' : ''} ${e.fait ? 'done' : ''}" data-k="${k}">
      <button type="button" class="poignee" aria-label="Changer l'ordre de ${esc(m.nom)} : glisser, ou flèches haut et bas" title="Glisser pour changer l'ordre"><i></i></button>
      <span class="pin num" style="--c:${enseigneColor(m.enseigne)}">${k + 1}</span>
      <div><a href="#/magasin/${encodeURIComponent(m.id)}">${esc(m.nom)}</a> ${prioTag(m.prio)}
        ${pe ? `<span class="hrs">${p.estime ? '≈ ' : ''}${fmtHeure(pe.arrivee)} – ${fmtHeure(pe.depart)} <button type="button" class="btn-link vis${e.duree ? ' modifiee' : ''}" data-duree="${i}:${k}" title="Changer le temps sur place">(${fmtDuree(pe.duree)} sur place)</button>${rdvTxt(e, rdvs.get(e.magasinId), t.id)}${pe.retardRdv ? ` <b class="late-txt">· arrivée ${pe.retardRdv} min après le RDV</b>` : ''}</span>` : ''}
        <small>${esc(m.ville)}${e.motif ? ` · <i>${esc(e.motif)}</i>` : ''}${e.detour ? ' · <b class="late-txt">détour : en retard</b>' : e.comble ? ' · <span class="chemin">en attendant le RDV</span>' : e.surChemin != null ? ` · <span class="chemin">sur le chemin${e.surChemin >= 1 ? ` (+${e.surChemin} min)` : ""}</span>` : m.enRetard ? ' · en retard' : ''}</small>
        <span class="wact">${t.id <= auj ? (() => { const v = vus.get(`${t.id}|${m.id}`); return v && !estVide(v) ? `<a class="btn small btn-visite fait" href="${lienDetails(v)}">Visité ✓</a>` : `<button class="btn small btn-visite${e.fait ? ' fait' : ''}" data-vu="${i}:${k}"${e.fait ? ' aria-pressed="true" title="Appuyer pour retirer"' : ''}>${e.fait ? 'Visité ✓' : 'Visité'}</button>`; })() : ''}<select data-move="${i}:${k}" aria-label="Déplacer ${esc(m.nom)}"><option value="${i}">Déplacer…</option>${dates.map((d, j) => j === i ? '' : `<option value="${j}">${JOURS[j]} ${new Date(d + 'T12:00').getDate()}</option>`).join('')}</select>
        <button class="btn-icon" data-del="${i}:${k}" aria-label="Retirer">✕</button></span></div></li>`; }).join('')}</ol>
    ${p.retour ? `<p class="wleg fin"><span>retour maison</span>${p.estime ? '≈ ' : ''}${fmtKm(p.retour.km)} · ${fmtDuree(p.retour.min)}</p>` : ''}
    ${p.versHotel ? `<p class="wleg fin"><span>jusqu'à l'hôtel</span>${p.estime ? '≈ ' : ''}${fmtKm(p.versHotel.km)} · ${fmtDuree(p.versHotel.min)}</p>` : ''}
    ${t.etapes.length && !t.retour && last ? `<p class="wday-night">☾ ${esc((lieuNuit(t, mags)?.adresse || 'Nuit sur place').replace(/^Nuit/, 'nuit'))} <button type="button" class="btn-link" data-nuit="${i}">${t.hotel?.choisi ? 'changer' : 'choisir la ville'}</button></p>`
      : t.etapes.length ? `<p class="wday-night muted"><button type="button" class="btn-link" data-nuit="${i}">dormir sur place ?</button></p>` : ''}
    <button class="btn small ghost" data-add="${i}">Ajouter des magasins</button>
  </section>`;
}

// Remplissage automatique : priorités + échéances, détour pour les retards, RDV conservés
// opts.sortie : au lieu d'enregistrer la semaine, rend le résultat (simulation : brouillon qui ne touche pas la vraie semaine)
export async function remplir(lundi, dates, tours, all, s, rdvs, opts = {}) {
  const deja = tours.some(t => t.etapes.length);
  const c = { ...DEFAULT_SETTINGS.ciblage, ...(s.ciblage || {}) };
  const modeMax = c.modeMax || (c.maxParJour ? 'fixe' : 'libre');
  const maxJours = Array.isArray(c.maxJours) ? c.maxJours : [];
  const p = modal({ titre: opts.titre || 'Remplir la semaine automatiquement', valider: opts.valider || 'Remplir la semaine', large: true, corps: `
    ${htmlImposes(all, 'La semaine se construit autour : choisis le jour, ou laisse « le meilleur jour » et l\'appli le place là où il fait le moins de route. L\'heure est facultative (comme un RDV).')}
    <fieldset><legend>Nombre de magasins par jour</legend>
      <div class="radio-col">
        <label class="check"><input type="radio" name="modeMax" value="libre" ${modeMax === 'libre' ? 'checked' : ''}> Pas de limite (autant que les horaires le permettent)</label>
        <label class="check"><input type="radio" name="modeMax" value="fixe" ${modeMax === 'fixe' ? 'checked' : ''}> Le même maximum chaque jour</label>
        <label class="indent mini-ligne"><input type="number" name="maxParJour" min="1" max="15" value="${c.maxParJour || 4}" class="mini-num" aria-label="Magasins maximum par jour"> magasins maximum par jour</label>
        <label class="check"><input type="radio" name="modeMax" value="variable" ${modeMax === 'variable' ? 'checked' : ''}> Variable selon le jour</label>
      </div>
      <div class="max-jours" id="maxJours" ${modeMax === 'variable' ? '' : 'hidden'}>${dates.map((d, i) => `<label>${JOURS[i]} ${new Date(d + 'T12:00').getDate()}<input type="number" name="maxJ:${i}" min="0" max="15" value="${maxJours[i] ?? ''}" placeholder="libre"></label>`).join('')}</div>
      <p class="hint" id="maxHint" ${modeMax === 'variable' ? '' : 'hidden'}>Vide = sans limite · 0 = pas de tournée ce jour-là (les RDV restent).</p>
      <div class="row"><label>Fin du dernier jour <small class="muted">(vide = ${s.heureFin})</small><input type="time" name="finDernierJour" value="${esc(c.finDernierJour || '')}"></label></div>
      <p class="small">Jours sans tournée cette semaine <span class="muted">(bureau, réunion, congé… les RDV de ce jour restent)</span></p>
      <div class="chips">${dates.map((d, i) => `<label class="chip-check"${ferie(d) ? ` title="Férié : ${esc(ferie(d))}"` : ''}><input type="checkbox" name="off:${i}" ${ferie(d) ? 'checked' : ''}><span>${JOURS[i]} ${new Date(d + 'T12:00').getDate()}${ferie(d) ? ' · férié' : ''}</span></label>`).join('')}</div>
      ${dates.some(ferie) ? `<p class="hint">Jour férié coché d'office : décoche-le si tu travailles ce jour-là.</p>` : ''}</fieldset>
    <fieldset><legend>Zone par jour</legend>
      <p class="hint">Pour rester dans le même coin toute la journée (ex. un RDV à Vannes : les autres magasins seront autour).</p>
      <div class="zones-jours">${dates.map((d, i) => { const t = tours[i]; const m0 = t.etapes.map(e => all.find(m => m.id === e.magasinId)).find(Boolean);
        return `<label>${JOURS[i]} ${new Date(d + 'T12:00').getDate()}<select name="zone:${i}">${optionsZone(all, { point: opts.zone, autour: m0 ? `Autour de ${m0.nom}${t.etapes.length > 1 ? ' et des magasins prévus' : ''}` : null,
          choisi: opts.zone?.lat != null ? 'point' : opts.zone?.dep ? 'dep:' + opts.zone.dep : m0 ? 'autour' : 'libre' })}</select></label>`; }).join('')}</div>
      <label class="mini-ligne">Autour = à moins de <input type="number" name="rayon" min="15" max="120" step="5" value="${c.rayonZone || 45}" class="mini-num"> min de route</label></fieldset>
    ${htmlCiblage(all, c, s)}
    <fieldset><legend>Organisation</legend>
      ${deja ? `<label class="check"><input type="checkbox" name="garder" checked> Garder les magasins déjà prévus cette semaine</label>` : ''}
      <label class="check"><input type="checkbox" name="boucles" ${c.boucles ? 'checked' : ''}> Organiser la semaine par coins : un coin par jour, en boucle <small class="muted">(plus de magasins P1 vus, un peu plus de route)</small></label>
      <label class="check"><input type="checkbox" name="nuits" ${s.decoucher ? 'checked' : ''}> Autoriser les nuits sur place (retour le ${['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][dates.length - 1]})</label>
      <p class="hint">Les rendez-vous (confirmés ou demandés pour un jour précis) sont toujours gardés, à leur jour et à leur heure : la journée s'organise autour, et si un RDV est tôt et loin, la veille se termine dans sa direction avec une nuit sur place. Horaires : ${s.heureDebut}–${s.heureFin}.</p>
      <label class="check"><input type="checkbox" name="memo" checked> Mémoriser ces choix pour les prochaines semaines</label></fieldset>` });
  const dlg = document.querySelector('dialog[open]');
  brancherImposes(dlg, dates.map((dd, k) => ({ v: k, lib: `${JOURS[k]} ${new Date(dd + 'T12:00').getDate()}${ferie(dd) ? ' (férié)' : ''}` })));
  dlg.querySelectorAll('input[name=modeMax]').forEach(x => x.onchange = () => { const v = dlg.querySelector('input[name=modeMax]:checked').value === 'variable'; dlg.querySelector('#maxJours').hidden = !v; dlg.querySelector('#maxHint').hidden = !v; });
  dlg.querySelector('input[name=maxParJour]').onfocus = () => { dlg.querySelector('input[name=modeMax][value=fixe]').checked = true; dlg.querySelector('#maxJours').hidden = true; dlg.querySelector('#maxHint').hidden = true; };
  const r = await p;
  if (!r) return false;
  const { imposes, erreur } = lireImposes(r, all);
  if (erreur) { toast(erreur, 'warn'); return false; }
  const lu = lireCiblage(r, all);
  if (lu.erreur) { toast(lu.erreur, 'warn'); return false; }
  const mode = r.modeMax || 'libre';
  const parJour = dates.map((_, i) => r['maxJ:' + i] === '' || r['maxJ:' + i] == null ? null : Math.max(0, Number(r['maxJ:' + i])));
  const cible = { ...lu.cible, modeMax: mode, maxParJour: Math.max(1, Number(r.maxParJour) || 4), maxJours: parJour, finDernierJour: r.finDernierJour || '', boucles: r.boucles === 'on' };

  if (r.memo === 'on') await saveSettings({ ciblage: { ...cible } });   // les jours sans tournée ne valent que pour cette semaine
  cible.joursOff = dates.map((_, i) => i).filter(i => r['off:' + i] === 'on' || (mode === 'variable' && parJour[i] === 0));
  cible.feriesDecides = true;   // les fériés ont été proposés ci-dessus : le choix de l'utilisateur fait foi
  // limite effective par jour (null = sans limite), transmise au planificateur
  cible.debuts = tours.map(t => t.heureDebut || null);
  cible.limites = dates.map((_, i) => mode === 'fixe' ? cible.maxParJour : mode === 'variable' ? parJour[i] : null);
  const limite = off => cible.limites[off] || 0;
  const garder = !deja || r.garder === 'on';
  const fixes = new Map(), exclus = new Set(), heures = new Map();
  tours.forEach((t, i) => {
    const ids = t.etapes.filter(e => garder || heureRdv(e, rdvs.get(e.magasinId), t.id) || e.rdv || e.impose).map(e => e.magasinId);
    t.etapes.forEach(e => { const h = heureRdv(e, rdvs.get(e.magasinId), t.id); if (h) heures.set(e.magasinId, h.heure); });
    if (ids.length) fixes.set(i, ids);
    ids.forEach(id => exclus.add(id));
  });
  // RDV acceptés ou demandés pour un jour de cette semaine : le magasin est posé ce jour-là, même s'il n'y était plus
  const magsIds = new Set(all.map(m => m.id));
  for (const rv of rdvs.values()) {
    if (!['acceptee', 'autreDate', 'envoyee', 'relancee'].includes(rv.statut) || !magsIds.has(rv.magasinId)) continue;
    const i = dates.indexOf(dateEffRdv(rv));
    if (i < 0 || (fixes.get(i) || []).includes(rv.magasinId)) continue;
    for (const ids of fixes.values()) { const k = ids.indexOf(rv.magasinId); if (k >= 0) ids.splice(k, 1); }
    fixes.set(i, [...(fixes.get(i) || []), rv.magasinId]); exclus.add(rv.magasinId);
    if (heureEffRdv(rv)) heures.set(rv.magasinId, heureEffRdv(rv));
  }
  // « À faire » qui arrivent à échéance d'ici la fin de la semaine : leurs magasins passent devant
  cible.urgents = await magasinsUrgents(dates[dates.length - 1]);
  const loc = all.filter(m => m.lat != null);
  // zone de chaque jour : autour des magasins déjà prévus (centre + rayon) ou un département (centre = moyenne des magasins)
  const rayon = Math.max(15, Number(r.rayon) || 45);
  cible.zones = dates.map((_, i) => lireZone(r['zone:' + i] || 'libre', all, { prevus: tours[i].etapes.map(e => loc.find(m => m.id === e.magasinId)), point: opts.zone, rayon }));
  if (r.memo === 'on') await saveSettings({ ciblage: { ...(await getSettings()).ciblage, rayonZone: rayon } });
  let retires = 0;
  const sPlan = { ...s, decoucher: r.nuits === 'on', detourRetard: lu.detour, joursTerrain: dates.length };
  // magasins imposés : un jour choisi → fixé ce jour-là ; « le meilleur jour » → placé là où il est le plus près de ce qui est prévu
  const fixer = (j, im) => { fixes.set(j, [...(fixes.get(j) || []).filter(id => id !== im.m.id), im.m.id]); exclus.add(im.m.id); if (im.heure) heures.set(im.m.id, im.heure); };
  for (const im of imposes) for (const ids of fixes.values()) { const k = ids.indexOf(im.m.id); if (k >= 0) ids.splice(k, 1); }   // déjà prévu ailleurs : il bouge
  imposes.filter(im => im.jour != null).forEach(im => fixer(im.jour, im));
  const flottants = imposes.filter(im => im.jour == null);
  if (flottants.length) {
    const essai = planifier(loc, sPlan, { debut: lundi, semaines: 1, fixes, exclus: new Set([...exclus, ...flottants.map(im => im.m.id)]), cible, heures });
    const byIdL = new Map(loc.map(m => [m.id, m]));
    const ouverts = dates.map((_, j) => j).filter(j => !cible.joursOff.includes(j));
    for (const im of flottants) {
      const cout = j => { const pj = essai.jours.find(x => x.offset === j);
        const pts = [...(fixes.get(j) || []), ...(pj?.etapes || [])].map(id => byIdL.get(id)).filter(Boolean);
        if (pj?.depart?.lat != null) pts.push(pj.depart);
        const d = pts.length ? Math.min(...pts.map(x => haversine(x, im.m))) : 9e9;
        const plein = cible.limites[j] && (fixes.get(j) || []).length >= cible.limites[j];
        return d + (plein ? 1e6 : 0); };
      const j = (ouverts.length ? ouverts : dates.map((_, k) => k)).reduce((a, b) => cout(b) < cout(a) ? b : a);
      fixer(j, im); im.jour = j;
    }
  }
  const plan = planifier(loc, sPlan, { debut: lundi, semaines: 1, fixes, exclus, cible, heures });
  const magsMap = new Map(all.map(m => [m.id, m]));
  let combles = 0;
  const travailles = plan.jours.filter(j => j.etapes.length).map(j => j.offset);
  const sDu = o => cible.finDernierJour && o === Math.max(...travailles) ? { ...s, heureFin: cible.finDernierJour } : s;
  for (const j of plan.jours) {
    const t = tours[j.offset];
    if (!t) continue;
    const anciens = new Map(t.etapes.map(e => [e.magasinId, e]));
    t.etapes = j.etapes.map(id => anciens.get(id) || { magasinId: id, fait: false, auto: true, detour: j.detours.includes(id), ...(id in (j.ajouts || {}) ? { surChemin: j.ajouts[id] } : {}) });
    for (const im of imposes.filter(x => x.jour === j.offset)) {   // repère les magasins imposés (et leur heure) pour les prochains remplissages
      const e = t.etapes.find(x => x.magasinId === im.m.id);
      if (e) { e.impose = true; if (im.heure) e.heureImposee = im.heure; else delete e.heureImposee; }
    }
    t.retour = j.retour; t.depart = j.depart; t.nuit = j.nuit || null; t.calcul = null; delete t.hotel;
    const jl = plan.jours.find(x => x.offset === j.offset + 1);   // nuit choisie près du RDV du lendemain (pas au dernier magasin)
    if (!j.retour && j.nuit && jl?.depart?.lat != null) t.hotel = { lat: jl.depart.lat, lon: jl.depart.lon, ville: j.nuit.replace(/^Nuit (près de|à) /, '') };
    t.offset = j.offset;
    retires += caserRendezVous(t, magsMap, sDu(j.offset), rdvs, new Set(fixes.get(j.offset) || []));
  }
  // attente avant un RDV : on la comble avec des magasins à voir proches, sans compromettre les RDV
  const prevus = new Set(tours.flatMap(t => t.etapes.map(e => e.magasinId)));
  const pool = loc.filter(m => !prevus.has(m.id) && m.urgence >= 0.5 && cible.priorites.includes(m.prio)
    && (!cible.departements.length || cible.departements.includes(String(m.departement)))
    && (cible.autres !== 'aucun' || !cible.enseignes.length || cible.enseignes.includes(m.enseigne)));
  for (const t of tours) if (!limite(t.offset) || t.etapes.length < limite(t.offset)) combles += comblerAttente(t, magsMap, sDu(t.offset), rdvs, pool, prevus, limite(t.offset));
  tours.forEach((t, i) => chainer(i ? tours[i - 1] : null, t, magsMap));
  tours.forEach(t => delete t.offset);
  const n = plan.jours.reduce((a, j) => a + j.etapes.length, 0), d = plan.jours.reduce((a, j) => a + j.detours.length, 0);
  const pc = plan.jours.reduce((a, j) => a + Object.keys(j.ajouts || {}).length, 0);
  if (opts.sortie) { await opts.sortie(tours, { n, pc, d, combles, retires }); return true; }
  for (const t of tours) { if (t.etapes.length || t.heureDebut) await db.put('tournees', t); else await db.del('tournees', t.id); }
  toast(`Semaine remplie : ${n} visites${pc ? `, dont ${pc} petit${pc > 1 ? 's' : ''} magasin${pc > 1 ? 's' : ''} sur le chemin` : ''}${d ? `, ${d} détour${d > 1 ? 's' : ''} pour retard` : ''}${combles ? `. ${combles} magasin${combles > 1 ? 's' : ''} ajouté${combles > 1 ? 's' : ''} pour remplir l'attente avant un RDV` : ''}${retires ? `. ${retires} magasin${retires > 1 ? 's' : ''} retiré${retires > 1 ? 's' : ''} pour tenir les heures de RDV` : ''}`);
  return true;
}

// ── Optimiser une semaine faite à la main ─────────────────────────────────────────
// Réordonne chaque journée (trajet le plus court, RDV à l'heure), recalcule les nuits sur place
// et, si demandé, déplace des magasins d'un jour à l'autre quand ça fait gagner de la route.
async function optimiserSemaineUI(tours, mags, s, rdvs) {
  const r = await modal({ titre: 'Optimiser la semaine', valider: 'Optimiser', corps: `
    <p>Tes magasins restent ceux que tu as choisis. L'appli :</p>
    <label class="check"><input type="checkbox" checked disabled> Remet chaque journée dans le meilleur ordre (moins de route, heures de RDV respectées)</label>
    <label class="check"><input type="checkbox" name="nuits" ${s.decoucher ? 'checked' : 'disabled'}> Recalcule les nuits sur place${s.decoucher ? ` (quand le retour dépasse ${s.seuilDecoucher} min et que le lendemain est plus près)` : ' (désactivées dans les Réglages)'}</label>
    <label class="check"><input type="checkbox" name="deplacer"> Déplace des magasins d'un jour à l'autre si ça fait gagner de la route</label>
    <p class="hint">Les magasins avec un RDV restent à leur jour, et les journées passées ne bougent pas.</p>` });
  if (!r) return false;
  const avant = bilan(tours, mags, s, rdvs);
  optimiserSemaine(tours, mags, s, rdvs, { nuits: r.nuits === 'on', deplacer: r.deplacer === 'on' });
  tours.forEach((t, i) => { if (t.retour) delete t.hotel; chainer(i ? tours[i - 1] : null, t, mags); });
  const apres = bilan(tours, mags, s, rdvs);
  for (const t of tours) { if (t.etapes.length) await db.put('tournees', t); else await db.del('tournees', t.id); }
  const gain = Math.round(avant.conduite - apres.conduite);
  toast(`${gain > 0 ? `${fmtDuree(gain)} de route en moins (${fmtKm(avant.km - apres.km)})` : 'Semaine déjà bien organisée'}`
    + `${apres.nuits !== avant.nuits ? ` · ${apres.nuits} nuit${apres.nuits > 1 ? 's' : ''} sur place` : ''}${apres.deplaces ? ` · ${apres.deplaces} magasin${apres.deplaces > 1 ? 's' : ''} changé${apres.deplaces > 1 ? 's' : ''} de jour` : ''}`
    + `${apres.rdvRates ? ` · attention : ${apres.rdvRates} RDV difficile${apres.rdvRates > 1 ? 's' : ''} à tenir` : ''}`, apres.rdvRates ? 'warn' : undefined);
  return true;
}
function bilan(tours, mags, s, rdvs) {
  const est = tours.map(t => estimer(t, mags, s, rdvs));
  return { km: est.reduce((a, p) => a + p.km, 0), conduite: est.reduce((a, p) => a + p.conduite, 0), rdvRates: est.reduce((a, p) => a + p.rdvRates, 0),
    nuits: tours.filter(t => t.etapes.length && !t.retour).length, deplaces: tours.reduce((a, t) => a + t.etapes.filter(e => e.deplace).length, 0) };
}
export function optimiserSemaine(tours, mags, s, rdvs, { nuits = true, deplacer = false } = {}) {
  const H = s.depart, auj = today();
  const cal = s.calibration || {};
  const dt = (a, b) => trajet(a, b, s).min;
  const pos = t => t.depart?.lat != null ? t.depart : H;
  const fixe = (t, e) => e.fait || e.rdv || heureRdv(e, rdvs.get(e.magasinId), t.id) || mags.get(e.magasinId)?.lat == null;
  const ordonner = t => {
    const loc = t.etapes.filter(e => mags.get(e.magasinId)?.lat != null);
    const ordre = optimiserOrdre(pos(t), loc.map(e => mags.get(e.magasinId)), t.retour, H);
    t.etapes = [...ordre.map(i => loc[i]), ...t.etapes.filter(e => !loc.includes(e))];
    t.calcul = null;
    placerRendezVous(t, mags, s, rdvs);
  };
  const cout = t => { if (!t.etapes.length) return 0; const p = estimer(t, mags, s, rdvs); return p.conduite + (p.depasse ? (p.fin - p.finJour) * 3 : 0) + p.rdvRates * 500; };
  const modifiables = tours.filter(t => t.id >= auj && !t.etapes.some(e => e.fait));
  modifiables.forEach(t => { t.calcul = null; t.etapes.forEach(e => delete e.deplace); });

  // 1. déplacer des magasins d'un jour à l'autre (seulement vers des jours déjà prévus)
  if (deplacer) {
    for (let passe = 0; passe < 3; passe++) {
      let bouge = false;
      for (const a of modifiables) for (const e of [...a.etapes]) {
        if (fixe(a, e)) continue;
        const sansE = { ...a, etapes: a.etapes.filter(x => x !== e) };
        const gainA = cout(a) - cout(sansE);
        let best = null;
        for (const b of modifiables) {
          if (b === a || !b.etapes.length || b.etapes.some(x => x.magasinId === e.magasinId)) continue;
          const cb = cout(b);
          for (let k = 0; k <= b.etapes.length; k++) {
            const essai = { ...b, etapes: [...b.etapes.slice(0, k), e, ...b.etapes.slice(k)] };
            const p = estimer(essai, mags, s, rdvs);
            if (p.depasse || p.rdvRates > estimer(b, mags, s, rdvs).rdvRates) continue;
            const surcout = cout(essai) - cb;
            if (surcout < gainA - 10 && (!best || surcout < best.surcout)) best = { surcout, b, etapes: essai.etapes };
          }
        }
        if (best) { a.etapes = sansE.etapes; best.b.etapes = best.etapes; e.deplace = true; ordonner(a); ordonner(best.b); bouge = true; }
      }
      if (!bouge) break;
    }
  }
  // 2. nuits sur place + ordre de chaque journée, dans l'ordre de la semaine
  let ici = H;
  tours.forEach((t, i) => {
    const modif = modifiables.includes(t);
    if (!t.etapes.length) { if (modif) { t.depart = null; t.retour = true; t.nuit = null; } ici = H; return; }
    if (!modif) { const last = mags.get(t.etapes.at(-1).magasinId); ici = t.retour || last?.lat == null ? H : { lat: last.lat, lon: last.lon, adresse: `Nuit près de ${last.ville}` }; return; }
    t.depart = ici === H ? null : { lat: ici.lat, lon: ici.lon, adresse: ici.adresse };
    if (nuits) {
      t.retour = true; ordonner(t);
      const suivant = tours[i + 1];
      const pts = (suivant?.etapes || []).map(e => mags.get(e.magasinId)).filter(m => m?.lat != null);
      const last = mags.get(t.etapes.at(-1).magasinId);
      if (s.decoucher && pts.length && last?.lat != null && dt(last, H) > (Number(s.seuilDecoucher) || 75)) {
        // nuit sur place si la journée du lendemain est plus près d'ici que de la maison
        t.retour = Math.min(...pts.map(m => dt(last, m))) >= Math.min(...pts.map(m => dt(H, m)));
      }
    }
    ordonner(t);
    const last = mags.get(t.etapes.at(-1).magasinId);
    t.nuit = t.retour || last?.lat == null ? null : `Nuit près de ${last.ville}`;
    ici = t.nuit ? { lat: last.lat, lon: last.lon, adresse: t.nuit } : H;
  });
  return tours;
}

// Si la journée déborde (attente avant un RDV, RDV tardif…), retire les magasins ajoutés
// automatiquement qui libèrent le plus de temps. Renvoie le nombre de magasins retirés.
function comblerAttente(t, mags, s, rdvs, pool, prevus, max = 0) {
  let n = 0;
  for (let essais = 0; essais < 8; essais++) {
    if (max && t.etapes.length >= max) return n;
    const p = estimer(t, mags, s, rdvs);
    if (p.attente < 40 || p.depasse) return n;
    const pts = t.etapes.map(e => mags.get(e.magasinId)).filter(m => m?.lat != null);
    if (!pts.length) return n;
    const proches = pool.filter(m => !prevus.has(m.id))
      .map(m => ({ m, d: Math.min(...pts.map(x => haversine(x, m))) })).sort((a, b) => a.d - b.d).slice(0, 12);
    let best = null;
    for (const { m } of proches) {
      for (let k = 0; k <= t.etapes.length; k++) {
        const essai = { ...t, etapes: [...t.etapes.slice(0, k), { magasinId: m.id, fait: false, auto: true, comble: true }, ...t.etapes.slice(k)] };
        const q = estimer(essai, mags, s, rdvs);
        if (q.depasse || q.rdvRates > p.rdvRates || q.attente >= p.attente) continue;
        const score = q.fin - p.fin - (p.attente - q.attente) * 0.5 - m.urgence * 10;
        if (!best || score < best.score) best = { score, etapes: essai.etapes, id: m.id };
      }
    }
    if (!best) return n;
    t.etapes = best.etapes; prevus.add(best.id); n++;
  }
  return n;
}

function caserRendezVous(t, mags, s, rdvs, gardes) {
  placerRendezVous(t, mags, s, rdvs);
  let n = 0;
  for (;;) {
    const p = estimer(t, mags, s, rdvs);
    if (!p.depasse && !p.rdvRates) return n;
    const amovibles = t.etapes.filter(e => !e.rdv && !gardes.has(e.magasinId) && !heureRdv(e, rdvs?.get(e.magasinId), t.id));
    if (!amovibles.length) return n;
    let best = null;
    for (const e of amovibles) {
      const essai = { ...t, etapes: t.etapes.filter(x => x !== e) };
      const q = estimer(essai, mags, s, rdvs);
      const m = mags.get(e.magasinId);
      // on retire d'abord ce qui fait gagner le plus, en sacrifiant plutôt les petits magasins et les priorités basses
      const score = (q.rdvRates ? 1000 : 0) + q.fin - (e.surChemin != null ? 30 : 0) - (m?.prio || 3) * 10;
      if (!best || score < best.score) best = { score, e };
    }
    t.etapes = t.etapes.filter(x => x !== best.e); n++;
    placerRendezVous(t, mags, s, rdvs);
  }
}

// ── Remplir UNE journée (vue Jour et simulation d'une journée) ──────────────────────
// Complète la journée : les magasins déjà prévus restent, l'appli ajoute autour d'eux
// (magasins à inclure obligatoirement, nombre maximum, zone, enseignes…). Les magasins
// prévus les autres jours de la semaine ne sont pas repris. Modifie t (sans l'enregistrer).
export async function remplirJour(date, t, all, s, rdvs, opts = {}) {
  const c = { ...DEFAULT_SETTINGS.ciblage, ...(s.ciblage || {}) };
  const lundi = lundiDe(date);
  const autres = new Map();   // magasin → jour où il est déjà prévu cette semaine
  for (let i = 0; i < 7; i++) {
    const d = decale(lundi, i);
    if (d === date) continue;
    (await db.get('tournees', d))?.etapes?.forEach(e => autres.set(e.magasinId, d));
  }
  const byId = new Map(all.map(m => [m.id, m]));
  const prevus = t.etapes.map(e => byId.get(e.magasinId)).filter(Boolean);
  const maxDefaut = c.modeMax === 'fixe' || (!c.modeMax && c.maxParJour) ? (c.maxParJour || 4) : '';
  const p = modal({ titre: opts.titre || 'Remplir la journée automatiquement', valider: opts.valider || 'Remplir la journée', large: true, corps: `
    <p class="hint">${prevus.length ? `Les ${prevus.length} magasin${prevus.length > 1 ? 's' : ''} déjà prévu${prevus.length > 1 ? 's' : ''} restent : l'appli complète autour.` : 'La journée est vide : l\'appli la construit selon les priorités et les retards de visite.'} Les magasins prévus les autres jours de la semaine ne sont pas repris.</p>
    ${htmlImposes(all, 'La journée se construit autour. L\'heure est facultative (comme un RDV).')}
    <fieldset><legend>Nombre de magasins</legend>
      <label class="mini-ligne">Maximum <input type="number" name="max" min="1" max="15" value="${esc(maxDefaut)}" placeholder="libre" class="mini-num" aria-label="Magasins maximum dans la journée"> magasins dans la journée <small class="muted">(déjà prévus compris · vide = autant que les horaires le permettent)</small></label>
      <div class="row"><label>Finir au plus tard à <small class="muted">(vide = ${s.heureFin})</small><input type="time" name="fin" value=""></label></div></fieldset>
    <fieldset><legend>Zone</legend>
      <label>Rester dans le coin de<select name="zone">${optionsZone(all, { autour: prevus.some(m => m.lat != null) ? `Autour de ${prevus[0].nom}${prevus.length > 1 ? ' et des magasins prévus' : ''}` : null, choisi: prevus.some(m => m.lat != null) ? 'autour' : 'libre' })}</select></label>
      <label class="mini-ligne">Autour = à moins de <input type="number" name="rayon" min="15" max="120" step="5" value="${c.rayonZone || 45}" class="mini-num"> min de route</label></fieldset>
    <details class="plus-options"><summary>Enseignes, priorités, départements</summary>
      ${htmlCiblage(all, c, s)}
    </details>
    <p class="hint">Les rendez-vous du jour sont toujours gardés, à leur heure. Horaires : ${t.heureDebut || s.heureDebut}–${s.heureFin}.</p>` });
  brancherImposes(document.querySelector('dialog[open]'));
  const r = await p;
  if (!r) return false;
  const { imposes, erreur } = lireImposes(r, all);
  if (erreur) { toast(erreur, 'warn'); return false; }
  const lu = lireCiblage(r, all);
  if (lu.erreur) { toast(lu.erreur, 'warn'); return false; }
  const prios = lu.cible.priorites;
  const max = r.max === '' || r.max == null ? null : Math.max(1, Number(r.max) || 1);
  const loc = all.filter(m => m.lat != null);
  const rayon = Math.max(15, Number(r.rayon) || 45);
  const zone = lireZone(r.zone || 'libre', all, { prevus: [...prevus, ...imposes.map(i => i.m)], rayon });
  const cible = {
    ...lu.cible, urgents: await magasinsUrgents(date),
    limites: [max], joursOff: [], feriesDecides: true, debuts: [t.heureDebut || null], finDernierJour: r.fin || '', zones: [zone],
  };
  // déjà prévus + imposés : gardés ; heures de RDV respectées
  const heures = new Map();
  t.etapes.forEach(e => { const h = heureRdv(e, rdvs.get(e.magasinId), date); if (h) heures.set(e.magasinId, h.heure); });
  imposes.forEach(im => { if (im.heure) heures.set(im.m.id, im.heure); });
  const ids = [...new Set([...t.etapes.map(e => e.magasinId), ...imposes.map(im => im.m.id)])];
  const fixes = new Map([[0, ids]]);
  const exclus = new Set([...ids, ...autres.keys()]);
  const sPlan = { ...s, decoucher: false, detourRetard: lu.detour, joursTerrain: 1 };
  const plan = planifier(loc, sPlan, { debut: date, semaines: 1, fixes, exclus, cible, heures });
  const j = plan.jours[0] || { etapes: [], detours: [], ajouts: {} };
  const anciens = new Map(t.etapes.map(e => [e.magasinId, e]));
  const avant = t.etapes.length;
  t.etapes = j.etapes.map(id => anciens.get(id) || { magasinId: id, fait: false, auto: true, detour: j.detours.includes(id), ...(id in (j.ajouts || {}) ? { surChemin: j.ajouts[id] } : {}) });
  for (const e of anciens.values()) if (!t.etapes.includes(e)) t.etapes.push(e);   // jamais perdre un magasin déjà prévu (non localisé…)
  for (const im of imposes) {
    let e = t.etapes.find(x => x.magasinId === im.m.id);
    if (!e) { e = { magasinId: im.m.id, fait: false }; t.etapes.push(e); }
    e.impose = true; if (im.heure) e.heureImposee = im.heure;
  }
  t.calcul = null;
  const sFin = r.fin ? { ...s, heureFin: r.fin } : s;
  const retires = caserRendezVous(t, byId, sFin, rdvs, new Set(ids));
  const dejaLa = new Set([...t.etapes.map(e => e.magasinId), ...autres.keys()]);
  const pool = loc.filter(m => !dejaLa.has(m.id) && m.urgence >= 0.5 && prios.includes(m.prio)
    && (!cible.departements.length || cible.departements.includes(String(m.departement)))
    && (cible.autres !== 'aucun' || !cible.enseignes.length || cible.enseignes.includes(m.enseigne)));
  const combles = !max || t.etapes.length < max ? comblerAttente(t, byId, sFin, rdvs, pool, dejaLa, max || 0) : 0;
  const ajoutes = t.etapes.length - avant;
  const dejaAilleurs = imposes.filter(im => autres.has(im.m.id)).map(im => `${im.m.nom} (aussi prévu le ${dateEnLettres(autres.get(im.m.id))})`);
  const res = { n: t.etapes.length, ajoutes, combles, retires, dejaAilleurs };
  if (opts.sortie) { await opts.sortie(t, res); return res; }
  toast(`${ajoutes > 0 ? `${ajoutes} magasin${ajoutes > 1 ? 's' : ''} ajouté${ajoutes > 1 ? 's' : ''}` : 'Aucun magasin à ajouter avec ces réglages'} · ${t.etapes.length} dans la journée`
    + `${retires ? ` · ${retires} retiré${retires > 1 ? 's' : ''} pour tenir les RDV` : ''}${dejaAilleurs.length ? ` · attention : ${dejaAilleurs.join(', ')}` : ''}`, dejaAilleurs.length ? 'warn' : undefined);
  return res;
}

// magasins dont un « À faire » ouvert arrive à échéance au plus tard ce jour-là
async function magasinsUrgents(jusquau) {
  const { estOuvert } = await import('../services/afaire.js');
  return new Set((await db.all('notes')).filter(n => estOuvert(n) && n.echeance && n.echeance <= jusquau).map(n => n.magasinId));
}

// « Optimiser la semaine » depuis la vue Jour : même traitement que le bouton de la Semaine
export async function optimiserSemaineDepuis(date, s) {
  const lundi = lundiDe(date);
  const nb = Math.max(1, Math.min(6, Number(s.joursTerrain) || 5));
  const dates = Array.from({ length: nb }, (_, i) => decale(lundi, i));
  const all = await magasinsEnrichis(s);
  const mags = new Map(all.map(m => [m.id, m]));
  const tours = await Promise.all(dates.map(getTournee));
  tours.forEach(t => { t.etapes = t.etapes.filter(e => mags.has(e.magasinId)); });
  if (tours.reduce((a, t) => a + t.etapes.length, 0) < 2) { toast('Pas assez de magasins prévus cette semaine pour optimiser', 'warn'); return false; }
  return optimiserSemaineUI(tours, mags, s, await tousLesRdv());
}

export function destroy() { if (map) { map.stop(); map.off(); map.remove(); map = null; } }
