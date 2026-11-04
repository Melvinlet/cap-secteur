// Écran « Semaine » : les tournées de la semaine côte à côte, à ajuster à la main ou à
// remplir automatiquement selon les priorités (avec détour pour les magasins en retard).
import { ongletsPlanning } from './onglets-planning.js';
import { db, getSettings, saveSettings } from '../db.js';
import { DEFAULT_SETTINGS, PRIORITES, PROFIL } from '../config.js';
import { magasinsEnrichis, prioriteDe } from '../data.js';
import { $, $$, esc, prioTag, enseigneColor, fmtKm, fmtDuree, fmtHeure, parseHeure, toast, modal, confirmer, fmtDate } from '../ui.js';
import { getTournee, heureRdv, choisirMagasins, exporterVersPlanning, lundiDe, estimerJour as estimer, placerRendezVous } from './tournee.js';
import { planifier } from '../services/planificateur.js';
import { dateEnLettres, tousLesRdv } from '../services/rdv.js';
import { haversine } from '../services/geo.js';
import { estimate } from '../services/routing.js';
import { carte, repere, repereDepart } from '../carte.js';

const COULEURS = ['#1E4FA0', '#C8371D', '#2E8540', '#6B4BA1', '#B25E09', '#0E7C86'];
const JOURS = ['Lun.', 'Mar.', 'Mer.', 'Jeu.', 'Ven.', 'Sam.'];
let map;

const decale = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export async function render(el, params) {
  destroy();
  const s = await getSettings();
  const lundi = lundiDe(params.lundi || new Date().toISOString().slice(0, 10));
  const nb = Math.max(1, Math.min(6, Number(s.joursTerrain) || 5));
  const dates = Array.from({ length: nb }, (_, i) => decale(lundi, i));
  const all = await magasinsEnrichis(s);
  const mags = new Map(all.map(m => [m.id, m]));
  const tours = await Promise.all(dates.map(getTournee));
  tours.forEach(t => { t.etapes = t.etapes.filter(e => mags.has(e.magasinId)); });
  const rdvs = await tousLesRdv();
  const est = tours.map(t => estimer(t, mags, s, rdvs));
  const tot = { n: tours.reduce((a, t) => a + t.etapes.length, 0), km: est.reduce((a, p) => a + p.km, 0),
    nuits: tours.filter(t => t.etapes.length && !t.retour).length, detours: tours.reduce((a, t) => a + t.etapes.filter(e => e.detour).length, 0) };
  const departOk = s.depart.lat != null;

  el.innerHTML = `<div class="page wide">
    ${ongletsPlanning('semaine', lundi)}
    <header class="page-head">
      <div class="day-nav">
        <a class="btn-icon" href="#/semaine/${decale(lundi, -7)}" aria-label="Semaine précédente">‹</a>
        <h1>Semaine du ${dateEnLettres(lundi).replace(/^lundi /, '')}</h1>
        <a class="btn-icon" href="#/semaine/${decale(lundi, 7)}" aria-label="Semaine suivante">›</a>
        <input type="date" id="pick" value="${lundi}" aria-label="Choisir une semaine">
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
      <a class="btn" href="#/rdv?du=${lundi}&au=${dates[dates.length - 1]}">Demander les RDV</a>
      <button class="btn" id="exp">Exporter le ${esc(PROFIL.planning.nom || 'planning')}</button>
      <button class="btn ghost" id="vider" ${tot.n ? '' : 'disabled'}>Vider la semaine</button>
    </div>
    <div class="week">${tours.map((t, i) => colonne(t, i, est[i], mags, s, dates, rdvs, routeDuSoir(t, tours[i + 1], mags, s))).join('')}</div>
    <h2 class="h2">Carte de la semaine</h2>
    <p class="legend">${dates.map((d, i) => `<span><i style="background:${COULEURS[i]}"></i>${JOURS[i]} ${new Date(d + 'T12:00').getDate()}</span>`).join('')}</p>
    <div id="wmap" class="map-panel week-map"></div>
  </div>`;

  const save = async t => { t.calcul = null; if (t.etapes.length) await db.put('tournees', t); else await db.del('tournees', t.id); };
  $('#pick').onchange = e => { location.hash = `#/semaine/${lundiDe(e.target.value)}`; };
  $('#exp').onclick = () => exporterVersPlanning(lundi, s, { du: lundi, au: dates[dates.length - 1] });
  $('#vider').onclick = async () => {
    if (!(await confirmer('Vider la semaine', 'Retirer tous les magasins prévus cette semaine ? Les rendez-vous confirmés sont gardés.', 'Vider'))) return;
    for (const t of tours) { t.etapes = t.etapes.filter(e => e.rdv); t.depart = null; t.retour = true; await save(t); }
    render(el, { lundi });
  };
  $('#auto').onclick = () => remplir(lundi, dates, tours, all, s, rdvs).then(ok => ok && render(el, { lundi }));
  $$('[data-add]').forEach(b => b.onclick = async () => {
    const t = tours[+b.dataset.add];
    if (await choisirMagasins(t, all, s, t.depart?.lat != null ? t.depart : s.depart)) { await save(t); render(el, { lundi }); }
  });
  $$('[data-del]').forEach(b => b.onclick = async () => {
    const [i, k] = b.dataset.del.split(':').map(Number);
    tours[i].etapes.splice(k, 1); await save(tours[i]); render(el, { lundi });
  });
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
    const pts = [t.depart?.lat != null ? t.depart : s.depart, ...t.etapes.map(e => mags.get(e.magasinId)).filter(m => m?.lat != null)];
    if (t.retour) pts.push(s.depart);
    if (departOk && pts.length > 2) layers.push(L.polyline(pts.map(p => [p.lat, p.lon]), { color: COULEURS[i], weight: 3, opacity: .8 }));
    t.etapes.forEach((e, k) => { const m = mags.get(e.magasinId); if (m?.lat != null) layers.push(repere(m, k + 1, COULEURS[i]).bindPopup(`<strong>${esc(m.nom)}</strong><br>${dateEnLettres(t.id)}`)); });
  });
  if (layers.length) { const g = L.featureGroup(layers).addTo(map); map.fitBounds(g.getBounds().pad(0.08), { animate: false }); }
}

// Heure de RDV : confirmée (étape) ou demandée au magasin pour ce jour-là (en attente de réponse)
function rdvTxt(e, r, jour) {
  if (e.rdv) return ` <b class="ok-txt">· RDV ${esc(e.rdv.heure || 'confirmé')}</b>`;
  if (r && ['envoyee', 'relancee'].includes(r.statut) && r.date === jour) return ` <b class="wait-txt">· RDV demandé${r.heure ? ' ' + esc(r.heure) : ''}</b>`;
  if (r && r.statut === 'aFaire' && r.date === jour && r.heure) return ` <span class="muted">· RDV souhaité ${esc(r.heure)}</span>`;
  return '';
}

// nuit sur place loin du dernier magasin (RDV tôt le lendemain) : route du soir jusqu'à l'hôtel
function routeDuSoir(t, suivant, mags, s) {
  if (t.retour || !t.etapes.length || suivant?.depart?.lat == null) return 0;
  const last = mags.get(t.etapes[t.etapes.length - 1].magasinId);
  if (last?.lat == null) return 0;
  const min = estimate([last, suivant.depart], s).legs[0]?.min || 0;
  return min >= 20 ? min : 0;
}

function colonne(t, i, p, mags, s, dates, rdvs, soir = 0) {
  const last = t.etapes.length ? mags.get(t.etapes[t.etapes.length - 1].magasinId) : null;
  return `<section class="wday" style="--c:${COULEURS[i]}">
    <header><a href="#/tournee/${t.id}"><strong>${JOURS[i]} ${new Date(t.id + 'T12:00').getDate()}</strong></a>
      <span class="muted">${t.etapes.length} magasin${t.etapes.length > 1 ? 's' : ''}</span></header>
    ${t.etapes.length ? `<p class="wday-sum ${p.depasse ? 'over' : ''}">${fmtKm(p.km)} · ${fmtDuree(p.conduite)} de route · fin ${p.estime ? 'vers ' : ''}${fmtHeure(p.fin)}${p.attente >= 20 ? ` · ${fmtDuree(p.attente)} d'attente avant RDV` : ''}${p.depasse ? ' — trop chargé' : ''}</p>` : ''}
    ${t.depart?.lat != null ? `<p class="wday-night">☾ départ ${esc(t.depart.adresse.replace(/^Nuit/, 'après la nuit'))}</p>` : ''}
    <ol class="wstops">${t.etapes.map((e, k) => { const m = mags.get(e.magasinId); const pe = p.etapes[k]; return `${pe?.leg ? `<li class="wleg" aria-label="Trajet"><span>${k === 0 ? (t.depart?.lat != null ? 'depuis l\'hôtel' : 'depuis la maison') : ''}</span>${p.estime ? '≈ ' : ''}${fmtKm(pe.leg.km)} · ${fmtDuree(pe.leg.min)}</li>` : ''}<li class="${pe?.hors ? 'hors' : ''} ${e.fait ? 'done' : ''}">
      <span class="pin num" style="--c:${enseigneColor(m.enseigne)}">${k + 1}</span>
      <div><a href="#/magasin/${encodeURIComponent(m.id)}">${esc(m.nom)}</a> ${prioTag(m.prio)}
        ${pe ? `<span class="hrs">${p.estime ? '≈ ' : ''}${fmtHeure(pe.arrivee)} – ${fmtHeure(pe.depart)} <span class="vis">(${fmtDuree(pe.duree)} sur place)</span>${rdvTxt(e, rdvs.get(e.magasinId), t.id)}${pe.retardRdv ? ` <b class="late-txt">· arrivée ${pe.retardRdv} min après le RDV</b>` : ''}</span>` : ''}
        <small>${esc(m.ville)}${e.motif ? ` · <i>${esc(e.motif)}</i>` : ''}${e.detour ? ' · <b class="late-txt">détour : en retard</b>' : e.comble ? ' · <span class="chemin">en attendant le RDV</span>' : e.surChemin != null ? ` · <span class="chemin">sur le chemin${e.surChemin >= 1 ? ` (+${e.surChemin} min)` : ""}</span>` : m.enRetard ? ' · en retard' : ''}</small>
        <span class="wact"><select data-move="${i}:${k}" aria-label="Déplacer ${esc(m.nom)}"><option value="${i}">Déplacer…</option>${dates.map((d, j) => j === i ? '' : `<option value="${j}">${JOURS[j]} ${new Date(d + 'T12:00').getDate()}</option>`).join('')}</select>
        <button class="btn-icon" data-del="${i}:${k}" aria-label="Retirer">✕</button></span></div></li>`; }).join('')}</ol>
    ${p.retour ? `<p class="wleg fin"><span>retour maison</span>${p.estime ? '≈ ' : ''}${fmtKm(p.retour.km)} · ${fmtDuree(p.retour.min)}</p>` : ''}
    ${soir ? `<p class="wday-night">→ ${fmtDuree(soir)} de route le soir jusqu'à l'hôtel (RDV tôt le lendemain), arrivée vers ${fmtHeure(p.fin + soir)}</p>` : ''}
    ${t.etapes.length && !t.retour && last ? `<p class="wday-night">☾ ${t.nuit ? esc(t.nuit.replace(/^Nuit/, 'nuit')) : `nuit près de ${esc(last.ville)}`}</p>` : ''}
    <button class="btn small ghost" data-add="${i}">Ajouter des magasins</button>
  </section>`;
}

// Remplissage automatique : priorités + échéances, détour pour les retards, RDV conservés
async function remplir(lundi, dates, tours, all, s, rdvs) {
  const deja = tours.some(t => t.etapes.length);
  const c = { ...DEFAULT_SETTINGS.ciblage, ...(s.ciblage || {}) };
  const enseignes = [...new Set(all.map(m => m.enseigne).filter(Boolean))]
    .sort((a, b) => all.filter(m => m.enseigne === b).length - all.filter(m => m.enseigne === a).length);
  const deps = [...new Set(all.map(m => String(m.departement)))].sort();
  const nb = e => all.filter(m => m.enseigne === e && PRIORITES[prioriteDe(m)]?.freq != null).length;
  const p = modal({ titre: 'Remplir la semaine automatiquement', valider: 'Remplir la semaine', large: true, corps: `
    <fieldset><legend>Enseignes prioritaires</legend>
      <div class="chips">${enseignes.map(e => `<label class="chip-check"><input type="checkbox" name="ens:${esc(e)}" ${c.enseignes.includes(e) ? 'checked' : ''}><span>${esc(e)} <small>${nb(e)}</small></span></label>`).join('')}</div>
      <p class="hint">Les journées sont construites autour de ces magasins. Rien de coché = toutes les enseignes à égalité.</p>
      <div class="radio-col">
        <label class="check"><input type="radio" name="autres" value="detour" ${c.autres === 'detour' ? 'checked' : ''}> Les autres magasins seulement s'ils sont sur le chemin</label>
        <label class="indent">Détour maximum par petit magasin (minutes)<input type="number" name="detourPetit" min="0" step="5" value="${c.detourPetit}"></label>
        <label class="check indent"><input type="checkbox" name="completer" ${c.completer ? 'checked' : ''}> Quand plus aucun magasin prioritaire n'est à voir, remplir la journée avec les autres</label>
        <label class="check"><input type="radio" name="autres" value="normal" ${c.autres === 'normal' ? 'checked' : ''}> Les autres magasins normalement (sans préférence)</label>
        <label class="check"><input type="radio" name="autres" value="aucun" ${c.autres === 'aucun' ? 'checked' : ''}> Uniquement les enseignes prioritaires</label>
      </div></fieldset>
    <fieldset><legend>Filtres</legend>
      <p class="small">Priorités</p>
      <div class="chips">${[1, 2, 3].map(k => `<label class="chip-check"><input type="checkbox" name="prio:${k}" ${c.priorites.includes(k) ? 'checked' : ''}><span>${PRIORITES[k].label}</span></label>`).join('')}</div>
      <p class="small">Départements <span class="muted">(aucun coché = tous)</span></p>
      <div class="chips">${deps.map(d => `<label class="chip-check"><input type="checkbox" name="dep:${d}" ${c.departements.map(String).includes(d) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div></fieldset>
    <fieldset><legend>Organisation</legend>
      ${deja ? `<label class="check"><input type="checkbox" name="garder" checked> Garder les magasins déjà prévus cette semaine</label>` : ''}
      <label class="check"><input type="checkbox" name="nuits" ${s.decoucher ? 'checked' : ''}> Autoriser les nuits sur place (retour le ${['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][dates.length - 1]})</label>
      <label>Détour accepté pour un magasin en retard de visite (minutes)<input type="number" name="detour" min="0" step="5" value="${s.detourRetard ?? 40}"></label>
      <p class="hint">Les rendez-vous (confirmés ou demandés pour un jour précis) sont toujours gardés, à leur jour et à leur heure : la journée s'organise autour, et si un RDV est tôt et loin, la veille se termine dans sa direction avec une nuit sur place. Horaires : ${s.heureDebut}–${s.heureFin}.</p>
      <label class="check"><input type="checkbox" name="memo" checked> Mémoriser ces choix pour les prochaines semaines</label></fieldset>` });
  const r = await p;
  if (!r) return false;
  const cible = {
    enseignes: enseignes.filter(e => r['ens:' + e] === 'on'), autres: r.autres || 'detour', detourPetit: Number(r.detourPetit) || 0,
    completer: r.completer === 'on', priorites: [1, 2, 3].filter(k => r['prio:' + k] === 'on'), departements: deps.filter(d => r['dep:' + d] === 'on'),
  };
  if (!cible.priorites.length) { toast('Coche au moins une priorité', 'warn'); return false; }
  if (r.memo === 'on') await saveSettings({ ciblage: cible });
  const garder = !deja || r.garder === 'on';
  const fixes = new Map(), exclus = new Set(), heures = new Map();
  tours.forEach((t, i) => {
    const ids = t.etapes.filter(e => garder || heureRdv(e, rdvs.get(e.magasinId), t.id) || e.rdv).map(e => e.magasinId);
    t.etapes.forEach(e => { const h = heureRdv(e, rdvs.get(e.magasinId), t.id); if (h) heures.set(e.magasinId, h.heure); });
    if (ids.length) fixes.set(i, ids);
    ids.forEach(id => exclus.add(id));
  });
  const loc = all.filter(m => m.lat != null);
  let retires = 0;
  const plan = planifier(loc, { ...s, decoucher: r.nuits === 'on', detourRetard: Number(r.detour) || 0, joursTerrain: dates.length },
    { debut: lundi, semaines: 1, fixes, exclus, cible, heures });
  const magsMap = new Map(all.map(m => [m.id, m]));
  let combles = 0;
  for (const j of plan.jours) {
    const t = tours[j.offset];
    if (!t) continue;
    const anciens = new Map(t.etapes.map(e => [e.magasinId, e]));
    t.etapes = j.etapes.map(id => anciens.get(id) || { magasinId: id, fait: false, auto: true, detour: j.detours.includes(id), ...(id in (j.ajouts || {}) ? { surChemin: j.ajouts[id] } : {}) });
    t.retour = j.retour; t.depart = j.depart; t.nuit = j.nuit || null; t.calcul = null;
    retires += caserRendezVous(t, magsMap, s, rdvs, new Set(fixes.get(j.offset) || []));
  }
  // attente avant un RDV : on la comble avec des magasins à voir proches, sans compromettre les RDV
  const prevus = new Set(tours.flatMap(t => t.etapes.map(e => e.magasinId)));
  const pool = loc.filter(m => !prevus.has(m.id) && m.urgence >= 0.5 && cible.priorites.includes(m.prio)
    && (!cible.departements.length || cible.departements.includes(String(m.departement)))
    && (cible.autres !== 'aucun' || !cible.enseignes.length || cible.enseignes.includes(m.enseigne)));
  for (const t of tours) combles += comblerAttente(t, magsMap, s, rdvs, pool, prevus);
  for (const t of tours) { if (t.etapes.length) await db.put('tournees', t); else await db.del('tournees', t.id); }
  const n = plan.jours.reduce((a, j) => a + j.etapes.length, 0), d = plan.jours.reduce((a, j) => a + j.detours.length, 0);
  const pc = plan.jours.reduce((a, j) => a + Object.keys(j.ajouts || {}).length, 0);
  toast(`Semaine remplie : ${n} visites${pc ? `, dont ${pc} petit${pc > 1 ? 's' : ''} magasin${pc > 1 ? 's' : ''} sur le chemin` : ''}${d ? `, ${d} détour${d > 1 ? 's' : ''} pour retard` : ''}${combles ? `. ${combles} magasin${combles > 1 ? 's' : ''} ajouté${combles > 1 ? 's' : ''} pour remplir l'attente avant un RDV` : ''}${retires ? `. ${retires} magasin${retires > 1 ? 's' : ''} retiré${retires > 1 ? 's' : ''} pour tenir les heures de RDV` : ''}`);
  return true;
}

// Si la journée déborde (attente avant un RDV, RDV tardif…), retire les magasins ajoutés
// automatiquement qui libèrent le plus de temps. Renvoie le nombre de magasins retirés.
function comblerAttente(t, mags, s, rdvs, pool, prevus) {
  let n = 0;
  for (let essais = 0; essais < 8; essais++) {
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

export function destroy() { if (map) { map.stop(); map.off(); map.remove(); map = null; } }
