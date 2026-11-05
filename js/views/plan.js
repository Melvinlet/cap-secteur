// Écran « Plan de secteur » : visites programmées sur plusieurs semaines selon les priorités.
import { ongletsPlanning } from './onglets-planning.js';
import { db, getSettings } from '../db.js';
import { magasinsEnrichis } from '../data.js';
import { $, $$, esc, borne, fmtKm, fmtDuree, fmtHeure, fmtDate, toast, confirmer } from '../ui.js';
import { planifier, dateDuJour, prochainLundi } from '../services/planificateur.js';
import { PRIORITES } from '../config.js';
import { carte, repere, repereDepart } from '../carte.js';

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const COULEURS = ['#1E4FA0', '#C8371D', '#2E8540', '#6B4BA1', '#B25E09', '#0E7C86', '#8A2B17', '#5B6573'];
let map;

const getPlan = async () => (await db.get('reglages', 'plan'))?.valeur || null;
const savePlan = p => db.put('reglages', { cle: 'plan', valeur: p });

export async function render(el) {
  destroy();
  const s = await getSettings();
  const mags = await magasinsEnrichis(s);
  const byId = new Map(mags.map(m => [m.id, m]));
  const loc = mags.filter(m => m.lat != null);
  const plan = await getPlan();
  const departOk = s.depart.lat != null;
  const nbP = n => mags.filter(m => m.prio === n).length;
  const freqP = n => (s.frequencesPriorite || {})[n] ?? PRIORITES[n].freq;

  el.innerHTML = `<div class="page wide">
    ${ongletsPlanning('secteur')}
    <header class="page-head"><h1>Plan de secteur</h1></header>
    <p class="muted">Les visites sont programmées selon la priorité de chaque magasin :
      ${[1, 2, 3].map(n => `<b>${PRIORITES[n].label}</b> tous les ${freqP(n)} j (${nbP(n)})`).join(' · ')}${[0, 5, 4].filter(nbP).map(n => ` · ${nbP(n)} ${PRIORITES[n].label.toLowerCase()}`).join('')} (hors tournées).
      Journées de ${plan?.heureDebut || s.heureDebut} à ${s.heureFin}, ${s.joursTerrain} jours par semaine${s.decoucher ? `, nuit sur place quand le retour dépasse ${s.seuilDecoucher} min (retour le ${JOURS[s.joursTerrain - 1].toLowerCase()})` : ', retour chaque soir'}.
      <a href="#/reglages">Réglages</a> · <a href="#/magasins">Changer les priorités</a></p>
    ${departOk ? '' : '<div class="banner">Indique d\'abord ton point de départ dans les <a href="#/reglages">Réglages</a>.</div>'}
    ${mags.length - loc.length ? `<div class="banner warn">${mags.length - loc.length} magasin(s) pas encore localisé(s) ne seront pas dans le plan. <a href="#/reglages">Les localiser</a></div>` : ''}
    <form class="plan-form" id="pf">
      <label>À partir du lundi<input type="date" name="debut" value="${plan?.debut || prochainLundi()}" required></label>
      <label>Départ le matin<input type="time" name="heureDebut" value="${esc(plan?.heureDebut || s.heureDebut)}" required></label>
      <label>Sur<select name="semaines">${[2, 4, 6, 8, 12].map(n => `<option value="${n}" ${(plan?.semaines || 8) === n ? 'selected' : ''}>${n} semaines</option>`).join('')}</select></label>
      <button class="btn ${plan ? '' : 'primary'}" ${departOk && loc.length ? '' : 'disabled'}>${plan ? 'Recalculer le plan' : 'Calculer le plan'}</button>
    </form>
    ${plan ? vuePlan(plan, byId, s) : `<div class="empty"><p>Le plan répartit tes visites sur les semaines à venir : les magasins prioritaires reviennent souvent, les occasionnels moins, les zones éloignées sont regroupées avec nuits sur place, et chaque semaine se termine à la maison.</p></div>`}
  </div>`;

  $('#pf').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (new Date(f.debut + 'T12:00').getDay() !== 1) return toast('Choisis un lundi comme premier jour', 'warn');
    const p = planifier(loc, { ...s, heureDebut: f.heureDebut || s.heureDebut }, { debut: f.debut, semaines: Number(f.semaines) });
    if (f.heureDebut && f.heureDebut !== s.heureDebut) p.heureDebut = f.heureDebut;
    await savePlan(p);
    toast(`Plan calculé : ${p.totaux.visites} visites en ${p.totaux.jours} journées`);
    render(el);
  };
  if (!plan) return;

  $('#prog').onclick = () => programmer(plan);
  map = await carte($('#planMap'));
  const couches = plan.jours.map(j => {
    if (!j.etapes.length) return null;
    const col = COULEURS[(j.semaine - 1) % COULEURS.length];
    const pts = [j.depart || s.depart, ...j.etapes.map(id => byId.get(id)).filter(Boolean)];
    if (j.retour) pts.push(s.depart);
    return L.featureGroup([
      L.polyline(pts.map(p => [p.lat, p.lon]), { color: col, weight: 3, opacity: .75 }),
      ...j.etapes.map((id, k) => byId.get(id) && repere(byId.get(id), k + 1).bindPopup(`<strong>${esc(byId.get(id).nom)}</strong><br>${fmtDate(dateDuJour(plan.debut, j.offset))}`)).filter(Boolean),
    ]);
  });
  const tout = L.featureGroup([repereDepart(s.depart), ...couches.filter(Boolean).map(c => c.getLayers()[0])]).addTo(map);
  map.fitBounds(tout.getBounds().pad(0.05), { animate: false });
  let actif = null;
  $$('[data-jour]').forEach(b => b.onclick = () => {
    const c = couches[+b.dataset.jour];
    if (!c) return;
    if (actif) map.removeLayer(actif);
    const off = actif === c;
    $$('[data-jour]').forEach(x => x.setAttribute('aria-pressed', x === b && !off));
    if (off) { actif = null; tout.addTo(map); map.fitBounds(tout.getBounds().pad(0.05), { animate: false }); return; }
    map.removeLayer(tout);
    actif = c.addTo(map);
    map.fitBounds(actif.getBounds().pad(0.2), { animate: false });
    if (innerWidth < 1000) $('#planMap').scrollIntoView({ behavior: 'smooth' });
  });
}

function vuePlan(plan, byId, s) {
  const t = plan.totaux;
  const semaines = [...new Set(plan.jours.map(j => j.semaine))];
  const nonProg = (plan.nonProgrammes || []).map(id => byId.get(id)).filter(Boolean);
  return `
    <div class="tour-sum plan-sum">
      <div><span class="big">${t.visites}</span> visites</div>
      <div><span class="big">${t.couverts}/${t.magasins}</span> magasins vus</div>
      <div><span class="big">${t.nuits}</span> nuit${t.nuits > 1 ? 's' : ''} sur place</div>
      <div><span class="big">${fmtKm(t.km)}</span> estimés</div>
    </div>
    ${charge(plan, byId, s)}
    ${nonProg.length ? `<div class="banner warn">${nonProg.length} magasin(s) n'ont pas pu entrer dans ces ${plan.semaines} semaines : allonge la période ou baisse leur priorité.
      <details><summary>Voir la liste</summary>${nonProg.map(m => esc(m.nom)).join(', ')}</details></div>` : ''}
    <div class="actions"><button class="btn primary" id="prog">Programmer dans mes tournées</button></div>
    <p class="hint">Calculé le ${fmtDate(plan.cree)}. Trajets estimés${plan.parametres.calibration !== 1 ? `, corrigés d'après tes tournées TomTom (×${plan.parametres.calibration.toFixed(2)})` : ''} ; les temps réels sont recalculés à l'ouverture de chaque journée. Clique sur une journée pour la voir sur la carte.</p>
    <div class="tour-grid">
      <section class="plan-list">
        ${semaines.map(w => `<h2 class="h2">Semaine ${w} <small class="muted">du ${fmtDate(dateDuJour(plan.debut, (w - 1) * 7))}</small></h2><ol class="days">
          ${plan.jours.map((j, i) => [j, i]).filter(([j]) => j.semaine === w).map(([j, i]) => {
            const ms = j.etapes.map(id => byId.get(id)).filter(Boolean);
            const date = dateDuJour(plan.debut, j.offset);
            if (!ms.length) return `<li><div class="day libre"><span class="day-n">${JOURS[j.jourSemaine].slice(0, 3)}.<small>${new Date(date + 'T12:00').getDate()}</small></span><span class="day-body"><strong>Libre</strong><small>Aucune visite due : bureau, rattrapage ou prospection</small></span></div></li>`;
            const deps = [...new Set(ms.map(m => m.departement))];
            const villes = ms.map(m => m.ville).filter((v, k, a) => a.indexOf(v) === k);
            return `<li><button class="day" data-jour="${i}" aria-pressed="false" style="--c:${COULEURS[(w - 1) % COULEURS.length]}">
              <span class="day-n">${JOURS[j.jourSemaine].slice(0, 3)}.<small>${new Date(date + 'T12:00').getDate()}</small></span>
              <span class="day-body">
                <span class="day-deps">${deps.map(d => borne(d)).join('')}</span>
                <strong>${ms.length} magasin${ms.length > 1 ? 's' : ''} · ${esc(villes.slice(0, 4).join(', '))}${villes.length > 4 ? '…' : ''}</strong>
                <small>${j.depart ? `Départ après la ${esc(j.depart.adresse.replace(/^Nuit/, 'nuit'))}` : 'Départ du domicile'} · ${fmtKm(j.km)} · ${fmtDuree(j.conduite)} de route · fin vers ${fmtHeure(j.fin)}
                ${j.retour ? '' : ` · <b>nuit près de ${esc(ms[ms.length - 1]?.ville || '')}</b>`}${j.depasse ? ' · <b class="late-txt">journée chargée</b>' : ''}</small>
              </span></button></li>`;
          }).join('')}</ol>`).join('')}
      </section>
      <section class="tour-map"><div id="planMap"></div></section>
    </div>`;
}

// Charge demandée par les priorités vs ce que tu peux réellement faire en une semaine
function charge(plan, byId, s) {
  const mags = [...byId.values()].filter(m => m.lat != null && m.frequenceEff);
  const demande = mags.reduce((a, m) => a + 7 / m.frequenceEff, 0);
  const capacite = plan.totaux.visites / plan.semaines;
  if (demande <= capacite * 1.05) return `<p class="hint">Tes priorités demandent environ ${Math.round(demande)} visites par semaine ; le plan en tient ${Math.round(capacite)} : ça passe.</p>`;
  return `<div class="banner warn"><strong>Secteur trop chargé pour ces priorités :</strong> elles demandent environ ${Math.round(demande)} visites par semaine, alors que tes journées en permettent environ ${Math.round(capacite)}.
    Espace les visites (Réglages → fréquence par priorité) ou passe des magasins en priorité plus basse.</div>`;
}

async function programmer(plan) {
  const jours = plan.jours.map(j => ({ ...j, date: dateDuJour(plan.debut, j.offset) }));
  const existantes = (await Promise.all(jours.map(j => db.get('tournees', j.date)))).filter(t => t?.etapes?.length);
  const manuelles = existantes.filter(t => !t.plan);
  if (manuelles.length && !(await confirmer('Remplacer des tournées ?', `${manuelles.length} journée(s) que tu as préparées à la main entre le ${fmtDate(jours[0].date)} et le ${fmtDate(jours[jours.length - 1].date)} seront remplacées par le plan.`, 'Remplacer'))) return;
  for (const j of jours) {
    if (j.etapes.length) await db.put('tournees', { id: j.date, etapes: j.etapes.map(magasinId => ({ magasinId, fait: false })), retour: j.retour, depart: j.depart, calcul: null, plan: plan.cree, ...(plan.heureDebut ? { heureDebut: plan.heureDebut } : {}) });
    else if (existantes.find(t => t.id === j.date)) await db.del('tournees', j.date);
  }
  const premier = jours.find(j => j.etapes.length);
  toast(`Plan programmé du ${fmtDate(jours[0].date)} au ${fmtDate(jours[jours.length - 1].date)}`);
  if (premier) location.hash = `#/tournee/${premier.date}`;
}

export function destroy() { if (map) { map.stop(); map.off(); map.remove(); map = null; } }
