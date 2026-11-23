// Écran « Tournée » : choix des magasins du jour, ordre optimisé, horaires, carte, GPS.
import { ongletsPlanning } from './onglets-planning.js';
import { db, getSettings, saveSettings } from '../db.js';
import { magasinsEnrichis, dureeVisite, numeroVisite } from '../data.js';
import { OBJETS_VISITE, STATUTS_VISITE, ENSEIGNES_LISTE, PRIORITES, PROFIL } from '../config.js';
import { exporterPlanning, heurePlanning, HEURES_PLANNING } from '../services/excel.js';
import { downloadBlob, $, $$, esc, borne, prioTag, enseigneColor, fmtKm, fmtDuree, fmtHeure, parseHeure, fmtDateLong, today, toast, modal, confirmer, norm, fmtDate, glisser, tagSemaine } from '../ui.js';
import { optimiserOrdre, calculerTrajets, lienGps, estimate, trajet, trajetBrut } from '../services/routing.js';
import { geocodeMagasin, haversine } from '../services/geo.js';
import { carte, repere, repereDepart, animerTrace } from '../carte.js';
import { tousLesRdv, labelStatut, tagEtatRdv } from '../services/rdv.js';
import { marquerVisite, annulerVisite, visitesDuJour, lienDetails, estVide } from '../services/visite.js';
import { ferie } from '../services/feries.js';
import { aFaireOuverts } from '../services/afaire.js';

let map;

// Empreinte d'une tournée (magasins, ordre, retour, départ) : un calcul lancé en arrière-plan n'enregistre
// son résultat que si la tournée n'a pas été modifiée entre-temps (ailleurs dans l'appli).
export const empreinte = t => JSON.stringify([(t.etapes || []).map(e => e.magasinId), !!t.retour, t.depart?.lat ?? null, t.depart?.lon ?? null, t.hotel?.lat ?? null, t.hotel?.lon ?? null]);

// ── Nuits ─────────────────────────────────────────────────────────────────────
// Une seule règle : le soir d'une journée « sans retour », on dort à l'hôtel choisi (t.hotel) sinon près du
// dernier magasin ; le lendemain part de là. Le départ du lendemain est TOUJOURS recalculé à partir de la veille
// (avant, il était enregistré une fois et restait faux si la veille changeait).
const dernierLoc = (t, mags) => [...t.etapes].reverse().map(e => mags.get(e.magasinId)).find(m => m?.lat != null);
export function lieuNuit(t, mags) {
  if (!t || t.retour || !t.etapes.length) return null;
  if (t.hotel?.lat != null) return { lat: t.hotel.lat, lon: t.hotel.lon, ville: t.hotel.ville, choisi: !!t.hotel.choisi, adresse: `Nuit ${t.hotel.choisi ? 'à' : 'près de'} ${t.hotel.ville}` };
  const d = dernierLoc(t, mags);
  return d ? { lat: d.lat, lon: d.lon, ville: d.ville, adresse: `Nuit près de ${d.ville}` } : null;
}
// Recale le départ de t d'après la veille (et le libellé de la nuit de la veille) ; renvoie true si t a changé
export function chainer(veille, t, mags) {
  const l = lieuNuit(veille, mags);
  if (veille) veille.nuit = l?.adresse || null;
  const dep = l ? { lat: l.lat, lon: l.lon, adresse: l.adresse } : null;
  const cle = d => d ? `${d.lat.toFixed(4)},${d.lon.toFixed(4)},${d.adresse}` : '';
  if (cle(t.depart?.lat != null ? t.depart : null) === cle(dep)) return false;
  t.depart = dep; t.calcul = null;
  return true;
}
// Points du trajet de la journée : départ, magasins, puis maison ou hôtel (si l'hôtel n'est pas au dernier magasin)
export function pointsJour(t, mags, s) {
  const dep = t.depart?.lat != null ? t.depart : s.depart;
  const mg = t.etapes.map(e => mags.get(e.magasinId)).filter(m => m?.lat != null);
  const fin = t.retour ? [s.depart] : t.hotel?.lat != null && (!mg.length || haversine(mg[mg.length - 1], t.hotel) > 1) ? [t.hotel] : [];
  return [dep, ...mg, ...fin];
}
// Le lendemain d'une journée modifiée part du bon endroit
export async function recalerLendemain(t, mags) {
  const l = await db.get('tournees', decale(t.id, 1));
  if (l && chainer(t, l, mags)) await db.put('tournees', l);
}

export async function getTournee(date) {
  return (await db.get('tournees', date)) || { id: date, etapes: [], retour: true, calcul: null };
}
export async function ajouterEtape(date, magasinId) {
  const t = await getTournee(date);
  if (t.etapes.some(e => e.magasinId === magasinId)) return false;
  t.etapes.push({ magasinId, fait: false });
  t.calcul = null;
  await db.put('tournees', t);
  return true;
}

// Bouton « Visité » (et lien vers les détails, facultatifs) d'une étape
export function boutonVisite(e, i, v, date) {
  if (date > today()) return '';
  if (!e.fait) return `<button class="btn small btn-visite" data-fait="${i}">Visité</button>`;
  if (v && !estVide(v)) return `<a class="btn small btn-visite fait" href="${lienDetails(v)}">Visité ✓ · compte rendu</a>`;
  return `<button class="btn small btn-visite fait" data-fait="${i}" aria-pressed="true" title="Appuyer pour retirer">Visité ✓</button>${v ? `<a class="btn-link" href="${lienDetails(v)}">ajouter des détails</a>` : ''}`;
}
let justeFait = null;   // magasin qu'on vient de marquer visité (petite animation)
const decale = (date, n) => { const d = new Date(date + 'T12:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// Horaires prévisionnels : départ, trajets, visites, pause déjeuner.
// Heure de rendez-vous à respecter : confirmée sur l'étape, ou demandée / souhaitée au magasin pour ce jour-là
const EN_COURS = ['aFaire', 'envoyee', 'relancee', 'autreDate', 'acceptee'];
export function heureRdv(e, r, jour) {
  if (e.rdv?.heure) return { heure: e.rdv.heure, confirme: true };
  if (e.heureImposee) return { heure: e.heureImposee, confirme: true };   // « doit contenir ce magasin à telle heure » (remplissage auto)
  if (r && r.date === jour && r.heure && EN_COURS.includes(r.statut)) return { heure: r.heure, confirme: false };
  return null;
}

export function planning(t, mags, s, rdvs = null) {
  const legs = t.calcul?.legs || [];
  let h = parseHeure(t.heureDebut || s.heureDebut), pause = false, km = 0, conduite = 0, attente = 0;
  const finJour = parseHeure(s.heureFin);
  const out = t.etapes.map((e, i) => {
    const leg = legs[i];
    if (leg) { h += leg.min; km += leg.km; conduite += leg.min; }
    if (!pause && h >= 12 * 60 && s.pauseMidi) { h += Number(s.pauseMidi); pause = true; }
    const m = mags.get(e.magasinId) || {};
    const duree = Number(e.duree || dureeVisite(m, s));
    const rv = heureRdv(e, rdvs?.get(e.magasinId), t.id);
    const cible = rv ? parseHeure(rv.heure) : null;
    if (cible != null && cible > h) { attente += cible - h; h = cible; }   // on attend l'heure du rendez-vous
    const arrivee = h; h += duree;
    const retardRdv = cible != null && arrivee > cible + 10 ? Math.round(arrivee - cible) : 0;
    const rr = rdvs?.get(e.magasinId);
    const rdvAttente = !rv && rr && rr.date === t.id && ['envoyee', 'relancee'].includes(rr.statut);   // demande partie, sans heure : on attend la réponse
    return { ...e, leg, arrivee, depart: h, duree, rdvHeure: rv?.heure, rdvConfirme: rv?.confirme, rdvAttente, retardRdv, hors: !!t.calcul && h > finJour };
  });
  const finLeg = legs[t.etapes.length];   // retour maison, ou route du soir jusqu'à l'hôtel
  const retour = t.retour && finLeg, versHotel = !t.retour && finLeg;
  if (finLeg) { h += finLeg.min; km += finLeg.km; conduite += finLeg.min; }
  return { etapes: out, fin: h, km, conduite, retour, versHotel, attente, depasse: h > finJour, finJour, nbHors: out.filter(e => e.hors).length, rdvRates: out.filter(e => e.retardRdv).length };
}

// Estimation d'une journée (TomTom si déjà calculée, sinon vol d'oiseau)
export function estimerJour(t, mags, s, rdvs) {
  // trajets TomTom gardés tels quels ; une ancienne estimation enregistrée est refaite avec le modèle actuel
  const reel = t.calcul?.provider === 'tomtom';
  if (reel || !t.etapes.length || s.depart.lat == null) return { ...planning(t, mags, s, rdvs), estime: !reel };
  return { ...planning({ ...t, calcul: estimate(pointsJour(t, mags, s), s) }, mags, s, rdvs), estime: true };
}

// Où dormir le soir d'une journée : maison, près du dernier magasin, ou une ville au choix
export async function choisirNuit(t, all, s) {
  const mags = new Map(all.map(m => [m.id, m]));
  const der = dernierLoc(t, mags);
  const lendemain = await db.get('tournees', decale(t.id, 1));
  const villes = [...new Set([...t.etapes, ...(lendemain?.etapes || [])].map(e => mags.get(e.magasinId)?.ville).filter(Boolean))].slice(0, 8);
  const mode = t.retour ? 'maison' : t.hotel?.choisi ? 'ville' : 'dernier';
  const p = modal({ titre: 'Où dors-tu ce soir-là ?', valider: 'Valider', corps: `
    <div class="radio-col">
      <label class="check"><input type="radio" name="mode" value="maison" ${mode === 'maison' ? 'checked' : ''}> Je rentre à la maison</label>
      ${der ? `<label class="check"><input type="radio" name="mode" value="dernier" ${mode === 'dernier' ? 'checked' : ''}> Près du dernier magasin (${esc(der.ville)})</label>` : ''}
      <label class="check"><input type="radio" name="mode" value="ville" ${mode === 'ville' ? 'checked' : ''}> Dans une autre ville</label></div>
    <label id="nuitL" ${mode === 'ville' ? '' : 'hidden'}>Ville de l'hôtel<input name="ville" value="${esc(t.hotel?.choisi ? t.hotel.ville : '')}" placeholder="ex. Lorient, Vannes…" autocomplete="off"></label>
    ${villes.length ? `<div class="chips" id="nuitV" ${mode === 'ville' ? '' : 'hidden'}>${villes.map(v => `<button type="button" class="chip" data-v="${esc(v)}">${esc(v)}</button>`).join('')}</div>` : ''}
    <p class="hint">Le lendemain partira de là, et la route du soir jusqu'à l'hôtel est comptée dans la journée.</p>` });
  const dlg = document.querySelector('dialog[open]');
  const maj = () => { const v = dlg.querySelector('input[name=mode]:checked')?.value === 'ville'; dlg.querySelector('#nuitL').hidden = !v; const c = dlg.querySelector('#nuitV'); if (c) c.hidden = !v; if (v) dlg.querySelector('input[name=ville]').focus(); };
  dlg.querySelectorAll('input[name=mode]').forEach(x => x.onchange = maj);
  dlg.querySelectorAll('[data-v]').forEach(b => b.onclick = () => { dlg.querySelector('input[name=ville]').value = b.dataset.v; });
  const r = await p;
  if (!r) return false;
  if (r.mode === 'maison') { t.retour = true; delete t.hotel; }
  else if (r.mode === 'dernier') { t.retour = false; delete t.hotel; }
  else {
    const v = (r.ville || '').trim();
    if (!v) { toast('Indique la ville de l\'hôtel', 'warn'); return false; }
    // un magasin de la base dans cette ville donne la position tout de suite (même sans réseau), sinon recherche de l'adresse
    const mg = all.find(m => m.lat != null && norm(m.ville) === norm(v));
    let pos = mg ? { lat: mg.lat, lon: mg.lon } : null;
    if (!pos) { try { const { geocodeAdresse } = await import('../services/geo.js'); pos = await geocodeAdresse(`${v}, France`, s.cleTomTom); } catch { /* hors ligne */ } }
    if (!pos) { toast(`Ville « ${v} » introuvable : vérifie l'orthographe`, 'warn'); return false; }
    t.retour = false; t.hotel = { lat: pos.lat, lon: pos.lon, ville: mg?.ville || v, choisi: true };
  }
  t.calcul = null;
  return true;
}

// Temps passé dans un magasin : pour cette visite seulement, ou toujours (fiche magasin)
export async function modifierDuree(t, k, mags, s) {
  const e = t.etapes[k], m = mags.get(e.magasinId);
  const habituelle = dureeVisite(m, s), actuelle = Number(e.duree) || habituelle;
  const choix = [20, 30, 45, 60, 90, 120, 150];
  const r = await modal({ titre: 'Temps sur place', valider: 'Appliquer', corps: `
    <p><strong>${esc(m.nom)}</strong><br><span class="muted">Habituellement ${habituelle} min${m.dureeVisite ? ' (réglé sur la fiche du magasin)' : ' (selon l\'enseigne)'}</span></p>
    <div class="chips">${choix.map(c => `<label class="chip-check"><input type="radio" name="rapide" value="${c}" ${c === actuelle ? 'checked' : ''}><span>${c < 60 ? c + ' min' : fmtDuree(c)}</span></label>`).join('')}</div>
    <label>Ou en minutes<input type="number" name="duree" min="5" max="600" step="5" value="${actuelle}" required></label>
    <label class="check"><input type="checkbox" name="toujours"> Toujours pour ce magasin (fiche du magasin et prochains plannings)</label>` });
  const dlg = document.querySelector('dialog[open]');
  dlg?.querySelectorAll('input[name=rapide]').forEach(x => x.onchange = () => { dlg.querySelector('input[name=duree]').value = x.value; });
  const res = await r;
  if (!res) return false;
  // un bouton rapide choisi (sans avoir retapé le nombre) l'emporte
  const tape = Number(res.duree), rapide = Number(res.rapide);
  const n = Math.max(5, rapide && rapide !== actuelle && tape === actuelle ? rapide : tape || rapide || habituelle);
  if (res.toujours === 'on') {
    const brut = await db.get('magasins', m.id);
    await db.put('magasins', { ...brut, dureeVisite: n, maj: new Date().toISOString() });
    m.dureeVisite = n; delete e.duree;
    toast(`${n} min désormais pour ${m.nom}`);
  } else if (n === habituelle) delete e.duree;
  else e.duree = n;
  return true;
}

// Heure de départ pour arriver pile à l'heure aux rendez-vous de la journée (5 min d'avance), ou null sans RDV
export function departPourRdv(t, mags, s, rdvs, marge = 5) {
  if (!t.etapes.some(e => heureRdv(e, rdvs?.get(e.magasinId), t.id))) return null;
  const aLheure = debut => {
    const p = estimerJour({ ...t, heureDebut: fmtHeure(debut) }, mags, s, rdvs);
    return p.etapes.every(e => !e.rdvHeure || e.arrivee <= parseHeure(e.rdvHeure));   // en avance, on attend : arrivée = heure du RDV
  };
  let lo = 4 * 60, hi = parseHeure(s.heureFin);          // départ entre 4h et l'heure de fin
  if (!aLheure(lo)) return null;                          // même en partant à 4h, impossible
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (aLheure(mid)) lo = mid; else hi = mid; }
  return fmtHeure(Math.floor((lo - marge) / 5) * 5);      // quelques minutes d'avance, arrondi aux 5 minutes
}

// Place chaque rendez-vous (confirmé ou demandé pour ce jour) à l'endroit de la journée qui respecte
// son heure en finissant le plus tôt.
export function placerRendezVous(t, mags, s, rdvs) {
  const aRdv = t.etapes.filter(x => heureRdv(x, rdvs?.get(x.magasinId), t.id));
  for (const e of aRdv) {
    const autres = t.etapes.filter(x => x !== e);
    let best = null;
    for (let k = 0; k <= autres.length; k++) {
      const essai = { ...t, etapes: [...autres.slice(0, k), e, ...autres.slice(k)] };
      const p = estimerJour(essai, mags, s, rdvs);
      const retard = p.etapes.reduce((a, x) => a + (x.retardRdv || 0), 0);
      const score = retard * 10 + p.fin;                       // en retard à un RDV = très pénalisé
      if (!best || score < best.score) best = { score, etapes: essai.etapes };
    }
    if (best) t.etapes = best.etapes;
  }
}
export async function render(el, { date = today() }) {
  destroy();
  const s = await getSettings();
  const all = await magasinsEnrichis(s);
  const mags = new Map(all.map(m => [m.id, m]));
  const t = await getTournee(date);
  t.etapes = t.etapes.filter(e => mags.has(e.magasinId));
  // départ recalé d'après la nuit de la veille (et le lendemain d'après ce soir)
  const veille = await db.get('tournees', decale(date, -1));
  if (chainer(veille, t, mags) && (t.etapes.length || t.heureDebut)) await db.put('tournees', t);
  const rdvs = await tousLesRdv();
  const vus = await visitesDuJour(date);
  const afaires = await aFaireOuverts();   // magasin → « à faire » encore ouverts (notés lors des visites précédentes)
  // une visite notée ailleurs (fiche magasin, compte rendu) coche aussi l'étape
  if (t.etapes.some(e => !e.fait && vus.has(e.magasinId))) { t.etapes.forEach(e => { if (vus.has(e.magasinId)) e.fait = true; }); await db.put('tournees', t); }
  const p = estimerJour(t, mags, s, rdvs);
  const dep = t.depart?.lat != null ? t.depart : s.depart;   // départ d'un hôtel (plan de secteur) ou du domicile
  const departOk = dep.lat != null && s.depart.lat != null;
  const dernier = t.etapes.length ? mags.get(t.etapes[t.etapes.length - 1].magasinId) : null;
  const hRdv = departOk ? departPourRdv(t, mags, s, rdvs) : null;
  // RDV du jour : acceptés (ou déplacés à ce jour), demandés pour ce jour, et ceux reportés à une autre date
  const dansTour = new Set(t.etapes.map(e => e.magasinId));
  const rdvJour = [...rdvs.values()].filter(r => mags.has(r.magasinId)).map(r => {
    const m = mags.get(r.magasinId);
    if (r.statut === 'autreDate' && r.dateRetenue === date) return { r, m, heure: r.heureRetenue || '', etat: 'ok', lib: 'Accepté (date déplacée)' };
    if (r.statut === 'acceptee' && r.date === date) return { r, m, heure: r.heure || '', etat: 'ok', lib: 'Accepté' };
    if (['envoyee', 'relancee'].includes(r.statut) && r.date === date) return { r, m, heure: r.heure || '', etat: 'attente', lib: `${labelStatut(r.statut)} · en attente` };
    if (r.statut === 'autreDate' && r.date === date && r.dateRetenue !== date) return { r, m, heure: r.heure || '', etat: 'reporte', lib: `Reporté au ${fmtDate(r.dateRetenue)}${r.heureRetenue ? ` à ${r.heureRetenue}` : ''}` };
    return null;
  }).filter(Boolean).sort((a, b) => (a.heure || '99').localeCompare(b.heure || '99'));

  el.innerHTML = `<div class="page wide tour">
    ${ongletsPlanning('jour', date)}
    <header class="page-head">
      <div class="day-nav">
        <a class="btn-icon" href="#/tournee/${decale(date, -1)}" aria-label="Jour précédent">‹</a>
        <h1>${fmtDateLong(date)} ${tagSemaine(date)}</h1>
        <a class="btn-icon" href="#/tournee/${decale(date, 1)}" aria-label="Jour suivant">›</a>
        <input type="date" id="pickDate" value="${date}" aria-label="Choisir une date">
      </div>
      ${ferie(date) ? `<p class="banner ferie">Jour férié : ${esc(ferie(date))}.${t.etapes.length ? ' Vérifie que les magasins sont ouverts avant d\'y aller.' : ' Pas de tournée prévue par défaut.'}</p>` : ''}
      <a class="btn ghost" href="#/rdv?du=${lundiDe(date)}&au=${vendrediDe(date)}">Demander les RDV de la semaine</a>
      <button class="btn ghost" id="expPlanning">Exporter le ${esc(PROFIL.planning.nom || 'planning')}</button>
    </header>
    ${departOk ? '' : `<div class="banner">Indique ton point de départ (domicile) dans les <a href="#/reglages">Réglages</a> pour calculer les trajets.</div>`}
    ${t.calcul && p.depasse ? `<div class="banner warn"><strong>Journée trop chargée :</strong> fin estimée à ${fmtHeure(p.fin)} au lieu de ${s.heureFin}.
      ${p.nbHors ? `${p.nbHors} magasin${p.nbHors > 1 ? 's' : ''} ne tien${p.nbHors > 1 ? 'nent' : 't'} pas dans tes horaires.
      <div class="actions"><button class="btn small" id="reporter">Reporter ${p.nbHors > 1 ? `les ${p.nbHors} magasins` : 'le magasin'} au ${fmtDateLong(prochainJour(date, s)).replace(/ \d{4}$/, '')}</button>
      ${t.etapes.length > 2 ? '<button class="btn small ghost" id="opt2">Essayer d\'abord d\'optimiser l\'ordre</button>' : ''}</div>` : 'Le retour au domicile est tardif : pense à une nuit sur place (décoche « Retour au domicile »).'}</div>` : ''}
    ${t.calcul?.erreur ? `<div class="banner warn">Trajets estimés à vol d'oiseau (${esc(t.calcul.erreur)}).</div>` : ''}
    <div class="tour-grid">
      <section class="tour-list">
        <div class="tour-sum">
          <div><span class="big">${t.etapes.length}</span> magasin${t.etapes.length > 1 ? 's' : ''}</div>
          <div><span class="big">${t.calcul ? fmtKm(p.km) : '–'}</span> de route</div>
          <div><span class="big">${t.calcul ? fmtDuree(p.conduite) : '–'}</span> de conduite</div>
          <div class="${p.depasse ? 'over' : ''}"><span class="big">${t.calcul ? fmtHeure(p.fin) : '–'}</span> fin estimée</div>
        </div>
        ${rdvJour.length ? `<section class="rdv-jour" aria-label="Rendez-vous du jour"><h2 class="h3">Rendez-vous du jour</h2>
          <ul class="plain">${rdvJour.map(x => `<li class="rdv-jour-l ${x.etat}"><span class="rdv-jour-h">${x.heure ? esc(x.heure.replace(':', 'h')) : '—'}</span>
            <span class="rdv-jour-m"><a href="#/magasin/${encodeURIComponent(x.m.id)}">${esc(x.m.nom)}</a> <small class="muted">${esc(x.m.ville || '')}</small><br><span class="tag ${x.etat === 'ok' ? 'ok' : x.etat === 'attente' ? 'wait' : ''}">${esc(x.lib)}</span>${x.r.objet ? ` <small class="muted">${esc(x.r.objet)}</small>` : ''}</span>
            ${x.etat !== 'reporte' && !dansTour.has(x.m.id) ? `<button class="btn small" data-addrdv="${esc(x.m.id)}">Ajouter à la tournée</button>` : x.etat !== 'reporte' ? '<small class="muted">dans la tournée</small>' : ''}</li>`).join('')}</ul>
          <a class="small" href="#/rdv?du=${date}&au=${date}">Tous les RDV de ce jour</a></section>` : ''}
        <div class="actions">
          <button class="btn primary" id="add">Ajouter des magasins</button>
          <button class="btn" id="autoJ" ${departOk ? '' : 'disabled'} title="Complète la journée selon les priorités et les retards de visite">Remplir automatiquement</button>
          <button class="btn" id="opt" ${t.etapes.length < 2 || !departOk ? 'disabled' : ''} title="Meilleur ordre, heures de RDV respectées, nuit sur place si le lendemain est plus près">Optimiser la journée</button>
          <button class="btn ghost" id="calc" ${!t.etapes.length || !departOk ? 'disabled' : ''}>Recalculer</button>
        </div>
        <div class="actions actions-2">
          <button class="btn small ghost" id="planRdv" title="Un RDV pris sur place ou au téléphone : magasin, jour, heure">Planifier un RDV</button>
          <a class="btn small ghost" href="#/simulation/${date}?jour=1" title="Essayer un remplissage sans toucher à cette journée, puis comparer">Simuler la journée</a>
          <button class="btn small ghost" id="optSem" ${departOk ? '' : 'disabled'} title="Réordonne toute la semaine de ce jour (moins de route, RDV respectés, nuits sur place)">Optimiser la semaine</button>
          <button class="btn small ghost" id="viderJ" ${t.etapes.some(e => !e.rdv && !e.fait) ? '' : 'disabled'}>Vider la journée</button>
        </div>
        <label class="check"><input type="checkbox" id="retour" ${t.retour ? 'checked' : ''}> Retour au domicile le soir (sinon nuit sur place)</label>
        <ol class="stops">
          ${departOk ? `<li class="stop home"><span></span><span class="time">${esc(t.heureDebut || s.heureDebut)}</span><span class="pin home">${dep === s.depart ? '⌂' : '☾'}</span><div><strong>Départ</strong>
            <label class="h-dep-l">à <input type="time" id="hDep" value="${esc(t.heureDebut || s.heureDebut)}" aria-label="Heure de départ" class="h-dep${t.heureDebut ? ' modifiee' : ''}"></label>${t.heureDebut ? ` <button class="btn-link" id="hDepReset">revenir à ${esc(s.heureDebut.replace(':', 'h'))}</button>` : ''}<p class="muted">${esc(dep.adresse)}</p>
            ${hRdv && hRdv !== (t.heureDebut || s.heureDebut) ? `<button class="btn small ${p.rdvRates ? 'primary' : ''}" id="hDepRdv">Partir à ${esc(hRdv.replace(':', 'h'))} pour être à l'heure au RDV</button>` : ''}</div></li>` : ''}
          ${p.etapes.map((e, i) => { const m = mags.get(e.magasinId); return `
          ${e.leg ? `<li class="drive ${e.leg.min > 150 ? 'long' : ''}">${fmtKm(e.leg.km)} · ${fmtDuree(e.leg.min)}${e.leg.min > 150 ? ' — trajet très long : vérifie la position de ce magasin' : ''}</li>` : ''}
          <li class="stop ${e.fait ? 'done' : ''} ${e.fait && e.magasinId === justeFait ? 'juste-fait' : ''} ${e.hors ? 'hors' : ''}" data-k="${i}">
            <button type="button" class="poignee" aria-label="Changer l'ordre de ${esc(m.nom)} : glisser, ou flèches haut et bas" title="Glisser pour changer l'ordre"><i></i></button>
            <span class="time">${t.calcul ? '' : '<small>≈</small>'}${fmtHeure(e.arrivee)}<small>→ ${fmtHeure(e.depart)}</small></span>
            <span class="pin num" style="--c:${enseigneColor(m.enseigne)}">${i + 1}</span>
            <div class="stop-body">
              <a href="#/magasin/${encodeURIComponent(m.id)}"><strong>${esc(m.nom)}</strong></a>
              ${afaires.get(e.magasinId)?.length ? `<p class="afaire-rappel">📌 À faire : ${afaires.get(e.magasinId).map(n => esc(n.aFaire)).join(' · ')}</p>` : ''}
              <p class="muted">${e.rdv ? `<span class="tag ok">RDV ${e.rdv.heure ? esc(e.rdv.heure) : 'confirmé'}</span> ` : e.heureImposee ? `<span class="tag ok">à ${esc(e.heureImposee)}</span> ` : `${tagEtatRdv(rdvs.get(e.magasinId), date, s.relanceApres)} `}${e.retardRdv ? `<span class="tag late">arrivée ${e.retardRdv} min après le RDV</span> ` : ''}${esc(m.ville)} · <button type="button" class="btn-link duree${t.etapes[i]?.duree ? ' modifiee' : ''}" data-duree="${i}" title="Changer le temps passé dans ce magasin">visite ${e.duree} min</button>${m.savOuverts ? ` · <span class="tag warn">${m.savOuverts} SAV</span>` : ''}${m.lat == null ? ' · <span class="tag late">non localisé</span>' : ''}</p>
              <div class="stop-actions">
                ${m.lat != null ? `<a class="btn small" href="${lienGps(s.gps, m)}" target="_blank" rel="noopener">GPS</a>` : ''}
                <button class="btn small" data-avant="${i}" title="Contact, RDV, à faire, dernier compte rendu, chiffres">Avant d'entrer${afaires.get(e.magasinId)?.length ? ` <span class="badge">${afaires.get(e.magasinId).length}</span>` : ''}</button>
                ${boutonVisite(e, i, vus.get(e.magasinId), date)}
                <select class="objet" data-objet="${i}" aria-label="Objet de la visite">${OBJETS_VISITE.map(o => `<option ${o === (e.objet || s.objetDefaut) ? 'selected' : ''}>${o}</option>`).join('')}</select>
                <input class="motif" data-motif="${i}" value="${esc(e.motif || '')}" placeholder="Pourquoi j'y vais (précision)" aria-label="Précision sur l'objet de la visite">
                <span class="ordre"><button class="btn-icon" data-del="${i}" aria-label="Retirer de la tournée">✕</button></span>
              </div>
            </div></li>`; }).join('')}
          ${p.retour ? `<li class="drive">${fmtKm(p.retour.km)} · ${fmtDuree(p.retour.min)}</li><li class="stop home"><span></span><span class="time">${fmtHeure(p.fin)}</span><span class="pin home">⌂</span><div><strong>Retour</strong></div></li>` : ''}
          ${p.versHotel ? `<li class="drive">${fmtKm(p.versHotel.km)} · ${fmtDuree(p.versHotel.min)} jusqu'à l'hôtel</li>` : ''}
          ${!t.retour && dernier && t.etapes.length ? `<li class="stop home"><span></span><span class="time">${fmtHeure(p.fin)}</span><span class="pin home">☾</span><div><strong>${esc(lieuNuit(t, mags)?.adresse || 'Nuit sur place')}</strong>
            <button type="button" class="btn-link" id="nuitVille">${t.hotel?.choisi ? 'changer' : 'choisir la ville'}</button></div></li>` : ''}
        </ol>
        ${t.etapes.length ? '' : '<p class="empty">Aucun magasin prévu ce jour-là. Ajoute ceux que tu veux visiter : l\'ordre et les horaires se calculent tout seuls.</p>'}
        ${t.etapes.length > 1 && s.gps === 'google' ? `<a class="btn" target="_blank" rel="noopener" href="${lienGps('google', ...gpsTout(t, mags, s))}">Ouvrir toute la tournée dans Google Maps</a>` : ''}
        ${t.calcul ? `<p class="hint">Trajets : ${t.calcul.provider === 'tomtom' ? 'TomTom (sans trafic)' : `estimation à vol d'oiseau × ${s.coefRoute}`}.${t.calcul.sansCle ? ' Ajoute ta clé TomTom dans les <a href="#/reglages">Réglages</a> pour des temps de trajet réels.' : ''}</p>` : ''}
      </section>
      <section class="tour-map"><div id="map"></div></section>
    </div></div>`;

  const save = async (recalc = true) => { if (recalc) t.calcul = null; await db.put('tournees', t); await recalerLendemain(t, mags); await render(el, { date }); if (recalc && departOk && t.etapes.length) calculer(false); };
  $('#pickDate').onchange = e => { location.hash = `#/tournee/${e.target.value}`; };
  $('#retour').onchange = e => { t.retour = e.target.checked; if (t.retour) delete t.hotel; save(); };
  $('#nuitVille')?.addEventListener('click', async () => { if (await choisirNuit(t, all, s)) save(); });
  const changerDepart = async h => { if (!h || h === s.heureDebut) delete t.heureDebut; else t.heureDebut = h; await save(false); toast(`Départ à ${(t.heureDebut || s.heureDebut).replace(':', 'h')} ce jour-là`); };
  $('#hDep')?.addEventListener('change', e => changerDepart(e.target.value));
  $('#hDepReset')?.addEventListener('click', () => changerDepart(''));
  $('#hDepRdv')?.addEventListener('click', () => changerDepart(hRdv));
  $('#add').onclick = () => choisirMagasins(t, all, s).then(ch => ch && save());
  $('#autoJ').onclick = async () => {
    const { remplirJour } = await import('./semaine.js');
    if (await remplirJour(date, t, all, s, rdvs)) save();
  };
  $('#planRdv').onclick = async () => {
    const { planifierRdv } = await import('./planif-rdv.js');
    if (await planifierRdv({ date })) render(el, { date });
  };
  $('#optSem').onclick = async () => {
    const { optimiserSemaineDepuis } = await import('./semaine.js');
    if (await optimiserSemaineDepuis(date, s)) render(el, { date });
  };
  $('#viderJ').onclick = async () => {
    if (!(await confirmer('Vider la journée', 'Retirer les magasins prévus ce jour-là ? Les rendez-vous confirmés et les magasins déjà visités sont gardés.', 'Vider'))) return;
    t.etapes = t.etapes.filter(e => e.rdv || e.fait);
    save();
  };
  $$('[data-addrdv]').forEach(b => b.onclick = async () => {
    const id = b.dataset.addrdv;
    if (t.etapes.some(e => e.magasinId === id)) return;
    const x = rdvJour.find(y => y.m.id === id);
    t.etapes.push({ magasinId: id, fait: false, ...(x?.etat === 'ok' ? { rdv: { heure: x.heure, statut: 'Confirmée' } } : {}), ...(x?.r.objet ? { objet: x.r.objet } : {}) });
    placerRendezVous(t, mags, s, rdvs);
    save();
  });
  $('#opt').onclick = () => calculer(true);
  $('#calc').onclick = () => calculer(false);
  $('#opt2')?.addEventListener('click', () => calculer(true));
  $('#reporter')?.addEventListener('click', async () => {
    const jour = prochainJour(date, s);
    const hors = p.etapes.filter(e => e.hors).map(e => e.magasinId);
    const suivant = await getTournee(jour);
    for (const id of hors) if (!suivant.etapes.some(e => e.magasinId === id)) suivant.etapes.push({ magasinId: id, fait: false });
    suivant.calcul = null;
    await db.put('tournees', suivant);
    t.etapes = t.etapes.filter(e => !hors.includes(e.magasinId));
    toast(`${hors.length} magasin(s) reporté(s) au ${fmtDateLong(jour)}`);
    save();
  });
  $$('[data-del]').forEach(b => b.onclick = () => { t.etapes.splice(+b.dataset.del, 1); save(); });
  const liste = el.querySelector('.stops');
  if (liste) glisser(liste, { onDeplace: (de, vers) => { const [x] = t.etapes.splice(de, 1); t.etapes.splice(vers, 0, x); save(); } });
  $$('[data-duree]').forEach(b => b.onclick = async () => { if (await modifierDuree(t, +b.dataset.duree, mags, s)) save(false); });
  setTimeout(() => { justeFait = null; }, 0);
  $$('[data-avant]').forEach(b => b.onclick = async () => {
    const e = t.etapes[+b.dataset.avant];
    const { ouvrirFicheAvant } = await import('./fiche-avant.js');
    if (await ouvrirFicheAvant(e.magasinId, date)) { e.fait = true; justeFait = e.magasinId; await save(false); }
    else render(el, { date });   // des « à faire » ont pu être cochés
  });
  $$('[data-fait]').forEach(b => b.onclick = async () => {
    const e = t.etapes[+b.dataset.fait];
    if (date > today()) return toast('Ce jour n\'est pas encore arrivé', 'warn');
    if (!e.fait) {
      const v = await marquerVisite(e.magasinId, date);
      e.fait = true; justeFait = e.magasinId; await save(false);
      toast(`${mags.get(e.magasinId).nom} : visité`, '', { label: 'Ajouter des détails', href: lienDetails(v) });
    } else {
      const v = vus.get(e.magasinId);
      if (v && !estVide(v)) { location.hash = lienDetails(v); return; }   // un compte rendu existe : on l'ouvre
      await annulerVisite(e.magasinId, date);
      e.fait = false; justeFait = null; await save(false);
      toast('Visite retirée');
    }
  });
  $$('[data-objet]').forEach(x => x.onchange = async () => { t.etapes[+x.dataset.objet].objet = x.value; await db.put('tournees', t); });
  $$('[data-motif]').forEach(x => x.onchange = async () => { t.etapes[+x.dataset.motif].motif = x.value.trim(); await db.put('tournees', t); });
  $('#expPlanning').onclick = () => exporterVersPlanning(date, s);

  async function calculer(optimiser) {
    const hash0 = location.hash, emp0 = empreinte(t);
    const btn = $(optimiser ? '#opt' : '#calc');
    if (btn) { btn.disabled = true; btn.textContent = 'Calcul…'; }
    // localise d'abord les magasins qui ne le sont pas encore
    for (const e of t.etapes) {
      const m = mags.get(e.magasinId);
      if (m.lat != null) continue;
      try {
        const g = await geocodeMagasin(m, s.cleTomTom);
        if (g) { Object.assign(m, { lat: g.lat, lon: g.lon, precision: g.precision }); const { derniereVisite, joursDepuisVisite, frequenceEff, enRetard, savOuverts, nbCommandes, ...brut } = m; await db.put('magasins', brut); }
      } catch { /* hors ligne */ }
    }
    const loc = t.etapes.filter(e => mags.get(e.magasinId).lat != null);
    if (loc.length < t.etapes.length) toast(`${t.etapes.length - loc.length} magasin(s) sans position ignoré(s)`, 'warn');
    const avecRdv = t.etapes.some(e => heureRdv(e, rdvs.get(e.magasinId), t.id));
    let suivant = null;
    if (optimiser && s.decoucher && loc.length && !t.etapes.some(e => e.fait)) {
      // nuit sur place ou retour : selon la distance de la maison et la tournée du lendemain
      const locM = loc.map(e => mags.get(e.magasinId));
      const last = locM[optimiserOrdre(dep, locM, true, s.depart).at(-1)];
      suivant = await getTournee(decale(date, 1));
      const pts = suivant.etapes.map(e => mags.get(e.magasinId)).filter(m => m?.lat != null);
      const dtm = (a, b) => trajet(a, b, s).min;
      t.retour = !(pts.length && dtm(last, s.depart) > (Number(s.seuilDecoucher) || 75)
        && Math.min(...pts.map(m => dtm(last, m))) < Math.min(...pts.map(m => dtm(s.depart, m))));
    }
    if (t.retour) delete t.hotel;
    const finJour = t.retour ? s.depart : t.hotel?.lat != null ? t.hotel : null;   // la tournée se termine à la maison, à l'hôtel choisi, ou au dernier magasin
    if (optimiser) {
      const ordre = optimiserOrdre(dep, loc.map(e => mags.get(e.magasinId)), !!finJour, finJour || s.depart);
      t.etapes = [...ordre.map(i => loc[i]), ...t.etapes.filter(e => !loc.includes(e))];
      if (avecRdv) { t.calcul = null; placerRendezVous(t, mags, s, rdvs); }   // l'ordre respecte les heures de RDV
    }
    const etapesLoc = t.etapes.filter(e => mags.get(e.magasinId).lat != null);
    const pts = pointsJour(t, mags, s);
    const finFixe = pts.length > etapesLoc.length + 1;   // dernier point = maison ou hôtel (sinon le dernier magasin)
    const r = await calculerTrajets(pts, s, { optimiser: optimiser && !avecRdv });
    if (r.ordre && optimiser) {
      // TomTom a trouvé un meilleur ordre : on l'applique (les étapes intermédiaires seulement)
      const inter = finFixe ? etapesLoc : etapesLoc.slice(0, -1);
      const reord = r.ordre.map(i => inter[i]);
      t.etapes = [...reord, ...(finFixe ? [] : etapesLoc.slice(-1)), ...t.etapes.filter(e => !etapesLoc.includes(e))];
    }
    t.calcul = { ...r, ts: new Date().toISOString() };
    if (suivant) toast(t.retour ? 'Optimisé : retour à la maison le soir' : `Optimisé : ${lieuNuit(t, mags)?.adresse.toLowerCase()} (le lendemain est plus près)`);
    const enBase = await db.get('tournees', t.id);
    if (enBase && empreinte(enBase) !== emp0) return;   // modifiée ailleurs pendant le calcul : on garde la version la plus récente
    if (enBase) t.heureDebut = enBase.heureDebut;
    await db.put('tournees', t);
    await recalerLendemain(t, mags);
    if (r.provider === 'tomtom') await calibrer(pts, r.legs, s);
    if (r.erreur) toast('Service d\'itinéraire indisponible : estimation à vol d\'oiseau', 'warn');
    if (location.hash === hash0 && document.body.contains(el)) await render(el, { date });
  }

  // carte
  map = await carte($('#map'));
  const layers = [];
  if (departOk) layers.push(repereDepart(dep, dep !== s.depart));
  if (departOk && dep !== s.depart && t.retour) layers.push(repereDepart(s.depart));
  if (departOk && !t.retour && t.hotel?.lat != null) layers.push(repereDepart({ ...t.hotel, adresse: `Nuit à ${t.hotel.ville}` }, true));
  t.etapes.forEach((e, i) => { const m = mags.get(e.magasinId); if (m.lat != null) layers.push(repere(m, i + 1).bindPopup(esc(m.nom))); });
  (t.calcul?.legs || []).forEach(l => layers.push(L.polyline(l.points, { color: '#1E4FA0', weight: 4, opacity: 0.8, dashArray: t.calcul.provider === 'tomtom' ? null : '6 8' })));
  const g = L.featureGroup(layers).addTo(map);
  if (document.getElementById('main')?.dataset.entree) animerTrace(layers);
  if (layers.length) map.fitBounds(g.getBounds().pad(0.15), { animate: false });
  // tournée créée par le plan de secteur : trajets calculés à la première ouverture
  if (!t.calcul && t.etapes.length && departOk) calculer(false);
}

// Heures proposées : celles de la liste déroulante du planning (07:00 → 21:00 par quarts d'heure)
const heuresListe = h => { const { pas, min, max } = HEURES_PLANNING(), r = [];
  for (let x = min; x <= max; x += pas) r.push(`${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`);
  return h && !r.includes(h) ? [h, ...r] : r; };
// Export des tournées d'une période au format du planning de l'entreprise (colonnes du profil)
export async function exporterVersPlanning(date, s, periode = null) {
  const d = new Date(date + 'T12:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const lundi = d.toISOString().slice(0, 10);
  d.setDate(d.getDate() + 4);
  // depuis la vue semaine, la période est connue : on passe directement à la vérification
  const r = periode || await modal({ titre: `Exporter le ${PROFIL.planning.nom || 'planning'}`, valider: 'Suivant', corps: `
    <p>Crée un fichier Excel avec une ligne par visite, dans les colonnes de ton planning : il suffit de copier-coller.
    L'étape suivante te permet de vérifier l'heure, l'objet et le « pourquoi j'y vais » de chaque visite.</p>
    <div class="row"><label>Du<input type="date" name="du" value="${lundi}" required></label><label>Au<input type="date" name="au" value="${d.toISOString().slice(0, 10)}" required></label></div>
    ${s.commercial ? '' : '<p class="hint">Astuce : renseigne ton nom dans les Réglages pour remplir la colonne « Chef de secteur ».</p>'}` });
  if (!r) return;
  const [mags, notes, tournees, rdvs, contacts] = await Promise.all([magasinsEnrichis(s), db.all('notes'), db.all('tournees'), tousLesRdv(), db.all('contacts')]);
  const byId = new Map(mags.map(m => [m.id, m]));
  const ctById = new Map(contacts.map(c => [c.id, c]));
  const lignes = [];
  const arrondi = min => heurePlanning(fmtHeure(min));   // au quart d'heure, comme la liste déroulante du planning
  // enseigne telle que la liste du planning la connaît (« Sans enseigne » → réseau d'origine, sinon vide)
  const enseigneDe = m => ENSEIGNES_LISTE.includes(m.enseigne) && !/^Sans enseigne$|^Briconautes$/.test(m.enseigne) ? m.enseigne
    : ENSEIGNES_LISTE.find(x => new RegExp(`Réseau ${x.replace('.', '\\.')}\\b`).test(m.statut || '')) || '';
  // statut du RDV → statut de visite du planning (Planifiée, Confirmée, Réalisée, Reportée, Annulée)
  const statutRdv = (rv, jour) => {
    if (!rv) return null;
    const date = rv.statut === 'autreDate' ? rv.dateRetenue : rv.date;
    if (date !== jour) return rv.statut === 'autreDate' && rv.date === jour ? 'Reportée' : null;
    return { acceptee: 'Confirmée', autreDate: 'Confirmée', refusee: 'Annulée' }[rv.statut] || 'Planifiée';
  };
  const jours = tournees.filter(x => x.id >= r.du && x.id <= r.au && x.etapes.length).sort((a, b) => a.id.localeCompare(b.id));
  for (const t of jours) {
    const p = estimerJour(t, byId, s, rdvs);
    p.etapes.forEach((e, k) => {
      const m = byId.get(e.magasinId);
      if (!m) return;
      const nm = notes.filter(n => n.magasinId === m.id);
      const v = nm.find(n => n.type === 'Visite' && n.date === t.id);
      const rv = rdvs.get(m.id);
      const rvJour = rv && (rv.statut === 'autreDate' ? rv.dateRetenue : rv.date) === t.id ? rv : null;
      const ct = rvJour && ctById.get(rvJour.contactId);
      lignes.push({ t, k, jour: t.id, heure: heurePlanning(e.heureFixee || e.rdv?.heure || e.heureImposee || e.rdvHeure || '') || (e.arrivee != null ? arrondi(e.arrivee) : ''), chef: s.commercial || '',
        enseigne: enseigneDe(m), magasin: m.libellePlanning || `${m.cp} ${m.ville.toUpperCase()} – ${m.nom}`, nom: m.nom,
        statut: v?.statut || (e.fait ? 'Réalisée' : e.statutPlanning || statutRdv(rv, t.id) || (e.rdv ? 'Confirmée' : 'Planifiée')),
        objet: v?.objet || e.objet || rvJour?.objet || s.objetDefaut,
        motif: e.motif || '', numero: v?.numero || numeroVisite(nm, t.id),
        interlocuteur: e.interlocuteur ?? (v?.contact || ct?.nom || ''), rdv: !!e.rdvHeure, ferie: ferie(t.id) });
    });
  }
  if (!lignes.length) return toast('Aucune visite prévue sur cette période', 'warn');
  lignes.sort((a, b) => a.jour.localeCompare(b.jour) || (a.heure || '99').localeCompare(b.heure || '99'));   // comme le planning : par jour puis par heure
  // vérification ligne par ligne : heure, objet et « pourquoi j'y vais »
  const v = await modal({ titre: `Planning du ${fmtDate(r.du)} au ${fmtDate(r.au)}`, valider: 'Valider', large: true, corps: `
    ${s.commercial ? '' : '<p class="hint">Astuce : renseigne ton nom dans les Réglages pour remplir la colonne « Chef de secteur ».</p>'}
    <p class="hint">Heures au quart d'heure, comme dans ton planning. Statut et interlocuteur viennent de tes RDV (accepté → Confirmée, refusé → Annulée, autre date → Reportée le jour prévu). Tout est modifiable ici et gardé dans tes tournées.</p>
    <div class="exp-list">${lignes.map((l, i) => `<div class="exp-row ${i && lignes[i - 1].jour !== l.jour ? 'new-day' : ''}">
      <span class="exp-j">${fmtDate(l.jour)}${l.ferie ? ` <span class="tag ferie" title="${esc(l.ferie)}">férié</span>` : ''}</span>
      <select name="h:${i}" aria-label="Heure"><option value="">—</option>${heuresListe(l.heure).map(h => `<option ${h === l.heure ? 'selected' : ''}>${h}</option>`).join('')}</select>
      <span class="exp-m"><strong>${esc(l.nom)}</strong>${l.rdv ? ' <span class="tag ok">RDV</span>' : ''}</span>
      <select name="st:${i}" aria-label="Statut">${STATUTS_VISITE.map(o => `<option ${o === l.statut ? 'selected' : ''}>${o}</option>`).join('')}</select>
      <select name="o:${i}" aria-label="Objet">${[...new Set([...OBJETS_VISITE, l.objet])].map(o => `<option ${o === l.objet ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
      <input name="i:${i}" value="${esc(l.interlocuteur)}" placeholder="Interlocuteur" aria-label="Interlocuteur" list="ctl-${i}">
      <datalist id="ctl-${i}">${contacts.filter(c => c.magasinId === l.t.etapes[l.k].magasinId && c.nom).map(c => `<option value="${esc(c.nom)}">`).join('')}</datalist>
      <input name="p:${i}" value="${esc(l.motif)}" placeholder="Pourquoi j'y vais (précision)" aria-label="Précision"></div>`).join('')}</div>
    <fieldset class="exp-sortie"><legend>Pour ton planning</legend>
      <label class="check"><input type="radio" name="sortie" value="copier" checked> <span><strong>Copier les lignes</strong> (recommandé) : dans ton planning, clique la 1re case vide de la colonne Jour, puis Ctrl+V. Les couleurs, listes et formules de ton fichier sont gardées.</span></label>
      <label class="check"><input type="radio" name="sortie" value="excel"> <span><strong>Fichier Excel</strong> à part</span></label>
      <label class="check exp-motif"><input type="checkbox" name="colMotif" checked> Dans le fichier : ajouter les précisions dans une colonne à part (à droite, hors zone à coller)</label></fieldset>` });
  if (!v) return;
  const modifiees = new Set();
  lignes.forEach((l, i) => {
    const e = l.t.etapes[l.k];
    const h = v['h:' + i] || '', o = v['o:' + i], pr = (v['p:' + i] || '').trim(), stt = v['st:' + i] || l.statut, it = (v['i:' + i] || '').trim();
    if (h !== l.heure) e.heureFixee = h; if (o !== (e.objet || s.objetDefaut)) e.objet = o; if (pr !== (e.motif || '')) e.motif = pr;
    if (it !== l.interlocuteur) e.interlocuteur = it;
    if (stt !== l.statut) e.statutPlanning = stt;
    if (h !== l.heure || o !== l.objet || pr !== l.motif || it !== l.interlocuteur || stt !== l.statut) modifiees.add(l.t);
    Object.assign(l, { heure: h, objet: o, motif: pr, statut: stt, interlocuteur: it });
  });
  for (const t of modifiees) await db.put('tournees', t);
  if (v.sortie === 'excel') {
    downloadBlob(await exporterPlanning(lignes, `Planning ${s.commercial || ''} du ${fmtDate(r.du)} au ${fmtDate(r.au)}`.replace('  ', ' '), v.colMotif === 'on'), `Planning ${r.du} au ${r.au}.xlsx`);
    toast(`${lignes.length} visites exportées`);
    return;
  }
  await copierPlanning(lignes);
}

// Lignes du planning en texte brut (une ligne par visite, colonnes séparées par des tabulations, de Jour à Interlocuteur).
// Collé dans Excel, du texte brut ne remplace QUE les valeurs : la mise en forme conditionnelle (couleurs par enseigne),
// les listes déroulantes et les formules du fichier restent. Date en AAAA-MM-JJ : Excel la reconnaît dans toutes les langues
// (le jour est envoyé en numéro de série : voir plus bas).
async function copierPlanning(lignes) {
  const net = x => String(x ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  // le jour part en numéro de série Excel (ex. 46349) : un nombre collé garde le format de la colonne (« Mon 23/11/26 »),
  // alors qu'une date écrite en texte fait changer le format de la case (ex. 11/23/2026 sur un Excel américain)
  const serie = iso => { const [y, m, d] = iso.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };
  const tsv = lignes.map(l => [serie(l.jour), heurePlanning(l.heure) || '', l.chef, l.enseigne, l.magasin, l.statut, l.objet, l.numero, l.interlocuteur].map(net).join('\t')).join('\r\n');
  const msg = `${lignes.length} visite${lignes.length > 1 ? 's' : ''} copiée${lignes.length > 1 ? 's' : ''}. Dans ton planning : clique la 1re case vide de la colonne Jour, puis Ctrl+V.`;
  try { await navigator.clipboard.writeText(tsv); toast(msg); return; } catch { /* copie refusée : on montre le texte */ }
  const p = modal({ titre: 'Copier les lignes', valider: 'Fermer', large: true, corps: `
    <p>Le texte est sélectionné : fais <strong>Ctrl+C</strong>, puis dans ton planning clique la 1re case vide de la colonne Jour et fais <strong>Ctrl+V</strong>.</p>
    <textarea class="exp-tsv" rows="10" readonly>${esc(tsv)}</textarea>` });
  const ta = document.querySelector('dialog[open] .exp-tsv'); ta?.focus(); ta?.select();
  await p;
}

export const lundiDe = date => { const d = new Date(date + 'T12:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const vendrediDe = date => { const d = new Date(lundiDe(date) + 'T12:00'); d.setDate(d.getDate() + 4); return d.toISOString().slice(0, 10); };

// Prochain jour de terrain (lundi → jours de terrain par semaine)
export function prochainJour(date, s) {
  const d = new Date(date + 'T12:00');
  do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() > Number(s.joursTerrain || 5) || ferie(d.toISOString().slice(0, 10)));
  return d.toISOString().slice(0, 10);
}

// Calibrage automatique : compare les temps TomTom à l'estimation à vol d'oiseau
// pour que le plan de secteur colle à la réalité de tes routes.
export async function calibrer(pts, legs, s) {
  let estMin = 0, estKm = 0, reelMin = 0, reelKm = 0;
  legs.forEach((l, i) => {
    const e = trajetBrut(pts[i], pts[i + 1], s);
    estKm += e.km; estMin += e.min; reelKm += l.km; reelMin += l.min;
  });
  if (estMin < 20) return;
  const c = s.calibration?.modele === 2 ? s.calibration : { temps: 1, km: 1, n: 0 };   // calibrage refait pour le nouveau modèle
  const n = Math.min(c.n || 0, 19);
  const borne = x => Math.min(2.5, Math.max(0.5, x));
  await saveSettings({ calibration: {
    temps: (c.temps * n + borne(reelMin / estMin)) / (n + 1),
    km: (c.km * n + borne(reelKm / estKm)) / (n + 1), n: n + 1, modele: 2 } });
}

function gpsTout(t, mags, s) {
  const pts = t.etapes.map(e => mags.get(e.magasinId)).filter(m => m.lat != null);
  return t.retour && s.depart.lat != null ? [s.depart, pts] : [pts[pts.length - 1], pts.slice(0, -1)];  // départ = position actuelle du téléphone
}

// Fenêtre de choix des magasins : recherche, filtres, magasins proches ou en retard en premier.
// Choix des magasins à ajouter : filtres (enseigne, priorité, à voir, département) et tri,
// dont le « détour » = minutes en plus pour l'insérer au meilleur endroit de la journée.
let choix = { ens: [], prio: '', voir: '', tri: '', vue: 'liste' };
export async function choisirMagasins(t, all, s, depart = t.depart?.lat != null ? t.depart : s.depart) {
  const dans = new Set(t.etapes.map(e => e.magasinId));
  const mags = new Map(all.map(m => [m.id, m]));
  // la journée telle qu'elle est : départ → magasins (numérotés comme dans la tournée) → retour / hôtel
  const fin = t.retour !== false ? (s.depart?.lat != null ? s.depart : null) : t.hotel?.lat != null ? t.hotel : null;
  const arrets = [{ p: depart, lib: 'départ', idx: 0 }];
  t.etapes.forEach((e, i) => { const m = mags.get(e.magasinId); if (m?.lat != null) arrets.push({ p: m, lib: String(i + 1), idx: i + 1 }); });
  if (fin) arrets.push({ p: fin, lib: 'fin', idx: t.etapes.length, fin: true });
  const aDesEtapes = t.etapes.length > 0;
  const T = (a, b) => trajet(a, b, s);
  // fin de journée actuelle (estimée comme dans la vue Jour)
  const rdvs = aDesEtapes ? await tousLesRdv() : null;
  const base = aDesEtapes && s.depart?.lat != null ? estimerJour(t, mags, s, rdvs) : null;
  const finJour = parseHeure(s.heureFin);
  // meilleure place pour un magasin : entre deux arrêts consécutifs, là où le détour est le plus court
  const placeDe = m => {
    if (m.lat == null || depart?.lat == null) return null;
    if (arrets.length === 1) { const a = T(arrets[0].p, m); return { det: a.min * 2, km: a.km * 2, aller: a.min, k: 1, entre: null }; }
    let best = null;
    for (let k = 1; k < arrets.length; k++) {
      const a = arrets[k - 1], b = arrets[k], ab = T(a.p, b.p), am = T(a.p, m), mb = T(m, b.p);
      const det = am.min + mb.min - ab.min;
      if (!best || det < best.det) best = { det, km: am.km + mb.km - ab.km, k, a, b };
    }
    if (!fin && arrets.length > 1) {   // pas de retour prévu : on peut aussi le mettre en dernier
      const a = arrets[arrets.length - 1], am = T(a.p, m);
      if (am.min < best.det) best = { det: am.min, km: am.km, k: arrets.length, a, b: null };
    }
    best.entre = best.a.idx === 0 && (!best.b || best.b.fin) ? 'seul' : best.a.idx === 0 ? `en 1er (avant ${best.b.lib})` : !best.b || best.b.fin ? `en dernier (après ${best.a.lib})` : `entre ${best.a.lib} et ${best.b.lib}`;
    return best;
  };
  const detourDe = m => placeDe(m)?.det ?? null;
  const list = all.map(m => { const pl = placeDe(m); return { ...m, det: pl?.det ?? null, pl,
    finApres: base && pl ? base.fin + pl.det + Number(dureeVisite(m, s)) : null }; });
  const deps = [...new Set(all.map(m => m.departement))].sort();
  const enseignes = [...new Set(all.map(m => m.enseigne).filter(Boolean))].sort();
  if (!choix.tri) choix.tri = aDesEtapes ? 'detour' : 'urgence';
  const TRIS = { detour: 'Détour le plus court', urgence: 'Les plus urgents', distance: 'Les plus proches de chez moi', enseigne: 'Enseigne puis ville' };
  const p = modal({ titre: 'Ajouter des magasins', valider: 'Ajouter à la tournée', large: true, corps: `
    <div class="pick-top"><input type="search" id="pickQ" placeholder="Ville, magasin…" aria-label="Rechercher">
      <div class="seg pick-vue" role="group" aria-label="Affichage"><button type="button" data-vue="liste" aria-pressed="${choix.vue !== 'carte'}">Liste</button><button type="button" data-vue="carte" aria-pressed="${choix.vue === 'carte'}">Carte</button></div></div>
    <details class="pick-filtres"><summary>Filtres et tri</summary>
    <div class="pick-f">
      <select id="pickDep" aria-label="Département"><option value="">Tous départements</option>${deps.map(d => `<option>${d}</option>`).join('')}</select>
      <select id="pickPrio" aria-label="Priorité"><option value="">Toutes priorités</option>${[1, 2, 3].map(k => `<option value="${k}" ${choix.prio === String(k) ? 'selected' : ''}>${PRIORITES[k].label} seulement</option>`).join('')}<option value="12" ${choix.prio === '12' ? 'selected' : ''}>P1 et P2</option></select>
      <select id="pickVoir" aria-label="À voir"><option value="">Tous les magasins</option><option value="avoir" ${choix.voir === 'avoir' ? 'selected' : ''}>À voir (en retard ou jamais vus)</option><option value="retard" ${choix.voir === 'retard' ? 'selected' : ''}>En retard seulement</option></select>
      <select id="pickTri" aria-label="Trier par">${Object.entries(TRIS).map(([k, l]) => `<option value="${k}" ${choix.tri === k ? 'selected' : ''}>Tri : ${l}</option>`).join('')}</select>
    </div>
    <div class="chips pick-ens">${enseignes.map(e => `<button type="button" class="chip" data-e="${esc(e)}" aria-pressed="${choix.ens.includes(e)}"><i class="dot" style="background:${enseigneColor(e)}"></i>${esc(e)}</button>`).join('')}</div>
    </details>
    <p class="hint" id="pickHint"></p>
    <div class="pick-carte" id="pickCarte" hidden><div id="pickMap" class="pick-map" role="application" aria-label="Carte des magasins : touche un point puis « Ajouter »"></div>
      <p class="pick-leg small"><span><i class="pk pk-tour"></i>dans ta journée</span><span><i class="pk pk-sel"></i>sélectionné</span><span><i class="pk pk-retard"></i>en retard / jamais vu</span><span><i class="pk"></i>autres</span></p></div>
    <div class="pick-list" id="pickList"></div>` });
  if (matchMedia('(min-width: 641px)').matches) document.querySelector('dialog[open] .pick-filtres')?.setAttribute('open', '');
  const coches = new Set();
  const row = m => `<label class="pick">
      <input type="checkbox" name="m:${esc(m.id)}" ${dans.has(m.id) ? 'checked disabled' : coches.has(m.id) ? 'checked' : ''}>
      ${borne(m.departement)}<span class="pick-info"><strong>${esc(m.nom)} ${prioTag(m.prio)}</strong><small>${esc(m.ville)} · ${m.derniereVisite ? `vu le ${fmtDate(m.derniereVisite)}` : 'jamais visité'}${m.enRetard ? ' · <b class="late-txt">en retard</b>' : ''}</small></span>
      ${m.det != null ? `<span class="pick-droite"><span class="pick-det ${m.det <= 15 ? 'ok' : m.det <= 40 ? '' : 'loin'}">${aDesEtapes ? `+${Math.round(m.det)} min` : `${Math.round(m.det / 2)} min`}</span>
        ${aDesEtapes && m.pl ? `<small>${esc(m.pl.entre)} · +${Math.max(0, Math.round(m.pl.km))} km${m.finApres != null ? `<br>fin <b class="${m.finApres > finJour ? 'late-txt' : ''}">${fmtHeure(m.finApres)}</b>` : ''}</small>` : ''}</span>` : ''}</label>`;
  // ── carte : les magasins filtrés en points, un clic → fiche courte + « Ajouter » ──
  let pmap = null, couche = null, filtres = [];
  const marqueurs = new Map();
  const styleDe = m => coches.has(m.id) ? { radius: 9, color: '#111', weight: 2.5, fillColor: '#F2C230', fillOpacity: 1 }
    : { radius: m.prio === 1 ? 7 : m.prio === 2 ? 6 : 5, color: m.enRetard || !m.derniereVisite ? '#1B2430' : '#fff', weight: m.enRetard || !m.derniereVisite ? 2.5 : 1.5, fillColor: enseigneColor(m.enseigne), fillOpacity: .9 };
  const popupDe = m => `<div class="pick-pop"><strong>${esc(m.nom)}</strong> ${prioTag(m.prio)}<br><small>${esc(m.ville)} · ${m.derniereVisite ? `vu le ${fmtDate(m.derniereVisite)}` : 'jamais visité'}${m.enRetard ? ' · <b class="late-txt">en retard</b>' : ''}</small>
    ${m.det != null ? `<br><small>${aDesEtapes ? `+${Math.round(m.det)} min de route · ${esc(m.pl?.entre || '')}${m.finApres != null ? ` · fin ${fmtHeure(m.finApres)}` : ''}` : `${Math.round(m.det / 2)} min depuis ton départ`}</small>` : ''}
    <br><button type="button" class="btn small ${coches.has(m.id) ? '' : 'primary'}" data-pk="${esc(m.id)}">${coches.has(m.id) ? 'Retirer de la sélection' : 'Ajouter'}</button></div>`;
  const basculer = id => {
    coches.has(id) ? coches.delete(id) : coches.add(id);
    const mk = marqueurs.get(id), m = list.find(x => x.id === id);
    if (mk && m) { mk.setStyle(styleDe(m)); mk.setPopupContent(popupDe(m)); if (coches.has(id)) mk.bringToFront(); }
    const cb = document.querySelector(`dialog[open] input[name="m:${CSS.escape(id)}"]`); if (cb && !cb.disabled) cb.checked = coches.has(id);
    compte();
  };
  const compte = () => { const n = coches.size; const v = document.querySelector('dialog[open] footer .btn.primary'); if (v) v.textContent = n ? `Ajouter ${n} magasin${n > 1 ? 's' : ''} à la tournée` : 'Ajouter à la tournée'; };
  const dessinerCarte = (cadrer = false) => {
    if (!pmap) return;
    couche.clearLayers(); marqueurs.clear();
    // la journée telle qu'elle est (départ, magasins numérotés, retour)
    const trace = arrets.map(a => [a.p.lat, a.p.lon]);
    if (trace.length > 1) L.polyline(trace, { color: '#1E4FA0', weight: 3, opacity: .55, dashArray: '6 8' }).addTo(couche);
    if (depart?.lat != null) repereDepart(depart, depart !== s.depart).addTo(couche);
    for (const m of filtres) {
      if (m.lat == null || dans.has(m.id)) continue;
      const mk = L.circleMarker([m.lat, m.lon], styleDe(m)).bindPopup(popupDe(m), { autoPanPadding: [20, 20] }).addTo(couche);
      marqueurs.set(m.id, mk);
    }
    t.etapes.forEach((e, i) => { const m = mags.get(e.magasinId); if (m?.lat != null) repere(m, i + 1).bindPopup(`<strong>${esc(m.nom)}</strong><br><small>déjà dans ta journée (n° ${i + 1})</small>`).addTo(couche); });
    if (cadrer) {
      // cadrage : ta journée et ses environs, sinon tous les magasins affichés
      const pts = arrets.length > 1 ? arrets.map(a => a.p) : filtres.filter(m => m.lat != null);
      if (pts.length) map0(pts);
    }
  };
  const map0 = pts => { const b = L.latLngBounds(pts.map(p => [p.lat, p.lon])); pmap.fitBounds(arrets.length > 1 ? b.pad(0.35) : b.pad(0.05), { animate: false, maxZoom: 11 }); };
  const ouvrirCarte = async () => {
    const box = document.querySelector('dialog[open] #pickMap');
    if (!box) return;
    if (!pmap) {
      pmap = await carte(box, { keyboard: false });
      couche = L.featureGroup().addTo(pmap);
      pmap.on('popupopen', ev => { const b = ev.popup.getElement()?.querySelector('[data-pk]'); if (b) b.onclick = () => { basculer(b.dataset.pk); pmap.closePopup(); }; });
      dessinerCarte(true);
    }
    setTimeout(() => { pmap?.invalidateSize(); box.scrollIntoView({ block: 'nearest' }); }, 30);
  };
  const vue = v => {
    choix.vue = v;
    $$('[data-vue]').forEach(b => b.setAttribute('aria-pressed', b.dataset.vue === v));
    $('#pickCarte').hidden = v !== 'carte'; $('#pickList').hidden = v === 'carte';
    maj(); if (v === 'carte') ouvrirCarte();
  };
  const maj = () => {
    const q = norm($('#pickQ').value), d = $('#pickDep').value;
    choix.prio = $('#pickPrio').value; choix.voir = $('#pickVoir').value; choix.tri = $('#pickTri').value;
    const l = list.filter(m => (!q || norm(m.nom + ' ' + m.ville + ' ' + m.cp).includes(q)) && (!d || m.departement === d)
      && (!choix.ens.length || choix.ens.includes(m.enseigne))
      && (!choix.prio || choix.prio.includes(String(m.prio)))
      && (!choix.voir || (choix.voir === 'retard' ? m.enRetard : m.enRetard || !m.derniereVisite)));
    const urg = (a, b) => b.urgence - a.urgence || a.prio - b.prio;
    const cmp = { detour: (a, b) => (a.det ?? 1e9) - (b.det ?? 1e9) || urg(a, b), urgence: (a, b) => urg(a, b) || (a.det ?? 1e9) - (b.det ?? 1e9),
      distance: (a, b) => (a.lat == null) - (b.lat == null) || haversine(s.depart, a) - haversine(s.depart, b),
      enseigne: (a, b) => a.enseigne.localeCompare(b.enseigne) || a.ville.localeCompare(b.ville) }[choix.tri];
    l.sort((a, b) => (dans.has(a.id) - dans.has(b.id)) || (coches.has(b.id) - coches.has(a.id)) || cmp(a, b));
    filtres = l;
    if (choix.vue === 'carte') { dessinerCarte(); $('#pickHint').textContent = `${l.filter(m => m.lat != null && !dans.has(m.id)).length} magasins sur la carte. Touche un point pour voir le détour, puis « Ajouter ».`; return; }
    $('#pickList').innerHTML = l.slice(0, 150).map(row).join('') || '<p class="empty">Aucun magasin ne correspond à ces filtres.</p>';
    $('#pickHint').textContent = `${l.length} magasin${l.length > 1 ? 's' : ''}${l.length > 150 ? ' (150 premiers affichés, affine les filtres)' : ''}. `
      + (aDesEtapes ? `À droite : la route en plus pour le placer au meilleur endroit de ta journée (« entre 1 et 2 » = entre tes magasins n° 1 et 2), et ta nouvelle heure de fin${base ? ` (actuellement ${fmtHeure(base.fin)})` : ''}, visite comprise. Il sera ajouté à cette place.` : 'Le chiffre à droite = temps de route depuis ton départ (estimation).');
  };
  $$('[data-e]').forEach(b => b.onclick = () => {
    const e = b.dataset.e; choix.ens = choix.ens.includes(e) ? choix.ens.filter(x => x !== e) : [...choix.ens, e];
    b.setAttribute('aria-pressed', choix.ens.includes(e)); maj();
  });
  $('#pickList').onchange = e => { const i = e.target; if (i.name?.startsWith('m:')) { i.checked ? coches.add(i.name.slice(2)) : coches.delete(i.name.slice(2)); compte(); } };
  $('#pickQ').oninput = maj; ['#pickDep', '#pickPrio', '#pickVoir', '#pickTri'].forEach(x => { $(x).onchange = maj; });
  $$('[data-vue]').forEach(b => b.onclick = () => vue(b.dataset.vue));
  maj();
  if (choix.vue === 'carte') vue('carte');
  const r = await p;
  if (pmap) { pmap.off(); pmap.remove(); pmap = null; }
  if (!r) return false;
  const ids = [...new Set([...coches, ...Object.keys(r).filter(k => k.startsWith('m:')).map(k => k.slice(2))])].filter(id => !dans.has(id));
  // chaque magasin est inséré à sa meilleure place (recalculée après chaque ajout), pas simplement à la fin
  for (const id of ids) {
    const m = mags.get(id), e = { magasinId: id, fait: false };
    if (m?.lat == null || depart?.lat == null || !t.etapes.length) { t.etapes.push(e); continue; }
    const pts = [{ p: depart, i: 0 }]; t.etapes.forEach((x, i) => { const mm = mags.get(x.magasinId); if (mm?.lat != null) pts.push({ p: mm, i: i + 1 }); });
    if (fin) pts.push({ p: fin, i: t.etapes.length });
    let best = { det: Infinity, at: t.etapes.length };
    for (let k = 1; k < pts.length; k++) { const det = T(pts[k - 1].p, m).min + T(m, pts[k].p).min - T(pts[k - 1].p, pts[k].p).min; if (det < best.det) best = { det, at: pts[k - 1].i }; }
    if (!fin) { const det = T(pts[pts.length - 1].p, m).min; if (det < best.det) best = { det, at: t.etapes.length }; }
    t.etapes.splice(best.at, 0, e);
  }
  return ids.length > 0;
}

export function destroy() { if (map) { map.stop(); map.off(); map.remove(); map = null; } }
