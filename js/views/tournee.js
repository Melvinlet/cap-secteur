// Écran « Tournée » : choix des magasins du jour, ordre optimisé, horaires, carte, GPS.
import { db, getSettings, saveSettings } from '../db.js';
import { magasinsEnrichis, dureeVisite, numeroVisite } from '../data.js';
import { OBJETS_VISITE, ENSEIGNES_LISTE, PRIORITES, PROFIL } from '../config.js';
import { exporterPlanning } from '../services/excel.js';
import { downloadBlob, $, $$, esc, borne, prioTag, enseigneColor, fmtKm, fmtDuree, fmtHeure, parseHeure, fmtDateLong, today, toast, modal, norm, fmtDate } from '../ui.js';
import { optimiserOrdre, calculerTrajets, lienGps, estimate } from '../services/routing.js';
import { geocodeMagasin, haversine } from '../services/geo.js';
import { carte, repere, repereDepart } from '../carte.js';
import { tousLesRdv } from '../services/rdv.js';

let map;

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

const decale = (date, n) => { const d = new Date(date + 'T12:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// Horaires prévisionnels : départ, trajets, visites, pause déjeuner.
// Heure de rendez-vous à respecter : confirmée sur l'étape, ou demandée / souhaitée au magasin pour ce jour-là
const EN_COURS = ['aFaire', 'envoyee', 'relancee', 'autreDate', 'acceptee'];
export function heureRdv(e, r, jour) {
  if (e.rdv?.heure) return { heure: e.rdv.heure, confirme: true };
  if (r && r.date === jour && r.heure && EN_COURS.includes(r.statut)) return { heure: r.heure, confirme: false };
  return null;
}

export function planning(t, mags, s, rdvs = null) {
  const legs = t.calcul?.legs || [];
  let h = parseHeure(s.heureDebut), pause = false, km = 0, conduite = 0, attente = 0;
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
    return { ...e, leg, arrivee, depart: h, duree, rdvHeure: rv?.heure, rdvConfirme: rv?.confirme, retardRdv, hors: !!t.calcul && h > finJour };
  });
  const retour = t.retour && legs[t.etapes.length];
  if (retour) { h += retour.min; km += retour.km; conduite += retour.min; }
  return { etapes: out, fin: h, km, conduite, retour, attente, depasse: h > finJour, finJour, nbHors: out.filter(e => e.hors).length, rdvRates: out.filter(e => e.retardRdv).length };
}

// Estimation d'une journée (TomTom si déjà calculée, sinon vol d'oiseau)
export function estimerJour(t, mags, s, rdvs) {
  if (t.calcul || !t.etapes.length || s.depart.lat == null) return { ...planning(t, mags, s, rdvs), estime: !t.calcul };
  const dep = t.depart?.lat != null ? t.depart : s.depart;
  const pts = [dep, ...t.etapes.map(e => mags.get(e.magasinId)).filter(m => m?.lat != null), ...(t.retour ? [s.depart] : [])];
  return { ...planning({ ...t, calcul: estimate(pts, s) }, mags, s, rdvs), estime: true };
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
  const rdvs = await tousLesRdv();
  const p = t.calcul ? planning(t, mags, s, rdvs) : estimerJour(t, mags, s, rdvs);
  const dep = t.depart?.lat != null ? t.depart : s.depart;   // départ d'un hôtel (plan de secteur) ou du domicile
  const departOk = dep.lat != null && s.depart.lat != null;
  const dernier = t.etapes.length ? mags.get(t.etapes[t.etapes.length - 1].magasinId) : null;

  el.innerHTML = `<div class="page wide tour">
    <header class="page-head">
      <div class="day-nav">
        <a class="btn-icon" href="#/tournee/${decale(date, -1)}" aria-label="Jour précédent">‹</a>
        <h1>${fmtDateLong(date)}</h1>
        <a class="btn-icon" href="#/tournee/${decale(date, 1)}" aria-label="Jour suivant">›</a>
        <input type="date" id="pickDate" value="${date}" aria-label="Choisir une date">
      </div>
      <a class="btn" href="#/semaine/${lundiDe(date)}">Vue semaine</a>
      <a class="btn" href="#/plan">Plan de secteur</a>
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
        <div class="actions">
          <button class="btn primary" id="add">Ajouter des magasins</button>
          <button class="btn" id="opt" ${t.etapes.length < 2 || !departOk ? 'disabled' : ''}>Optimiser l'ordre</button>
          <button class="btn ghost" id="calc" ${!t.etapes.length || !departOk ? 'disabled' : ''}>Recalculer</button>
        </div>
        <label class="check"><input type="checkbox" id="retour" ${t.retour ? 'checked' : ''}> Retour au domicile le soir (sinon nuit sur place)</label>
        <ol class="stops">
          ${departOk ? `<li class="stop home"><span class="time">${s.heureDebut}</span><span class="pin home">${dep === s.depart ? '⌂' : '☾'}</span><div><strong>Départ</strong><p class="muted">${esc(dep.adresse)}</p></div></li>` : ''}
          ${p.etapes.map((e, i) => { const m = mags.get(e.magasinId); return `
          ${e.leg ? `<li class="drive ${e.leg.min > 150 ? 'long' : ''}">${fmtKm(e.leg.km)} · ${fmtDuree(e.leg.min)}${e.leg.min > 150 ? ' — trajet très long : vérifie la position de ce magasin' : ''}</li>` : ''}
          <li class="stop ${e.fait ? 'done' : ''} ${e.hors ? 'hors' : ''}">
            <span class="time">${t.calcul ? '' : '<small>≈</small>'}${fmtHeure(e.arrivee)}<small>→ ${fmtHeure(e.depart)}</small></span>
            <span class="pin num" style="--c:${enseigneColor(m.enseigne)}">${i + 1}</span>
            <div class="stop-body">
              <a href="#/magasin/${encodeURIComponent(m.id)}"><strong>${esc(m.nom)}</strong></a>
              <p class="muted">${e.rdv ? `<span class="tag ok">RDV ${e.rdv.heure ? esc(e.rdv.heure) : 'confirmé'}</span> ` : e.rdvHeure ? `<span class="tag">RDV demandé ${esc(e.rdvHeure)}</span> ` : ''}${e.retardRdv ? `<span class="tag late">arrivée ${e.retardRdv} min après le RDV</span> ` : ''}${esc(m.ville)} · visite ${e.duree} min${m.savOuverts ? ` · <span class="tag warn">${m.savOuverts} SAV</span>` : ''}${m.lat == null ? ' · <span class="tag late">non localisé</span>' : ''}</p>
              <div class="stop-actions">
                ${m.lat != null ? `<a class="btn small" href="${lienGps(s.gps, m)}" target="_blank" rel="noopener">GPS</a>` : ''}
                <button class="btn small" data-fait="${i}">${e.fait ? 'Visité ✓' : 'Marquer visité'}</button>
                <select class="objet" data-objet="${i}" aria-label="Objet de la visite">${OBJETS_VISITE.map(o => `<option ${o === (e.objet || s.objetDefaut) ? 'selected' : ''}>${o}</option>`).join('')}</select>
                <input class="motif" data-motif="${i}" value="${esc(e.motif || '')}" placeholder="Pourquoi j'y vais (précision)" aria-label="Précision sur l'objet de la visite">
                <button class="btn-icon" data-up="${i}" aria-label="Monter" ${i === 0 ? 'disabled' : ''}>↑</button>
                <button class="btn-icon" data-down="${i}" aria-label="Descendre" ${i === p.etapes.length - 1 ? 'disabled' : ''}>↓</button>
                <button class="btn-icon" data-del="${i}" aria-label="Retirer de la tournée">✕</button>
              </div>
            </div></li>`; }).join('')}
          ${p.retour ? `<li class="drive">${fmtKm(p.retour.km)} · ${fmtDuree(p.retour.min)}</li><li class="stop home"><span class="time">${fmtHeure(p.fin)}</span><span class="pin home">⌂</span><div><strong>Retour</strong></div></li>` : ''}
          ${!t.retour && dernier && t.etapes.length ? `<li class="stop home"><span class="time">${t.calcul ? fmtHeure(p.fin) : ''}</span><span class="pin home">☾</span><div><strong>Nuit sur place</strong><p class="muted">${t.nuit ? esc(t.nuit.replace(/^Nuit près/, 'Près')) + ' (RDV tôt le lendemain : route du soir jusqu\'à l\'hôtel)' : `Près de ${esc(dernier.ville)}`}</p></div></li>` : ''}
        </ol>
        ${t.etapes.length ? '' : '<p class="empty">Aucun magasin prévu ce jour-là. Ajoute ceux que tu veux visiter : l\'ordre et les horaires se calculent tout seuls.</p>'}
        ${t.etapes.length > 1 && s.gps === 'google' ? `<a class="btn" target="_blank" rel="noopener" href="${lienGps('google', ...gpsTout(t, mags, s))}">Ouvrir toute la tournée dans Google Maps</a>` : ''}
        ${t.calcul ? `<p class="hint">Trajets : ${t.calcul.provider === 'tomtom' ? 'TomTom (sans trafic)' : `estimation à vol d'oiseau × ${s.coefRoute}`}.${t.calcul.sansCle ? ' Ajoute ta clé TomTom dans les <a href="#/reglages">Réglages</a> pour des temps de trajet réels.' : ''}</p>` : ''}
      </section>
      <section class="tour-map"><div id="map"></div></section>
    </div></div>`;

  const save = async (recalc = true) => { if (recalc) t.calcul = null; await db.put('tournees', t); await render(el, { date }); if (recalc && departOk && t.etapes.length) calculer(false); };
  $('#pickDate').onchange = e => { location.hash = `#/tournee/${e.target.value}`; };
  $('#retour').onchange = e => { t.retour = e.target.checked; save(); };
  $('#add').onclick = () => choisirMagasins(t, all, s).then(ch => ch && save());
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
  $$('[data-up]').forEach(b => b.onclick = () => { const i = +b.dataset.up; [t.etapes[i - 1], t.etapes[i]] = [t.etapes[i], t.etapes[i - 1]]; save(); });
  $$('[data-down]').forEach(b => b.onclick = () => { const i = +b.dataset.down; [t.etapes[i + 1], t.etapes[i]] = [t.etapes[i], t.etapes[i + 1]]; save(); });
  $$('[data-fait]').forEach(b => b.onclick = () => { const e = t.etapes[+b.dataset.fait]; e.fait = !e.fait; save(false); });
  $$('[data-objet]').forEach(x => x.onchange = async () => { t.etapes[+x.dataset.objet].objet = x.value; await db.put('tournees', t); });
  $$('[data-motif]').forEach(x => x.onchange = async () => { t.etapes[+x.dataset.motif].motif = x.value.trim(); await db.put('tournees', t); });
  $('#expPlanning').onclick = () => exporterVersPlanning(date, s);

  async function calculer(optimiser) {
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
    if (optimiser) {
      const ordre = optimiserOrdre(dep, loc.map(e => mags.get(e.magasinId)), t.retour, s.depart);
      t.etapes = [...ordre.map(i => loc[i]), ...t.etapes.filter(e => !loc.includes(e))];
      if (avecRdv) { t.calcul = null; placerRendezVous(t, mags, s, rdvs); }   // l'ordre respecte les heures de RDV
    }
    const etapesLoc = t.etapes.filter(e => mags.get(e.magasinId).lat != null);
    const pts = [dep, ...etapesLoc.map(e => mags.get(e.magasinId)), ...(t.retour ? [s.depart] : [])];
    const r = await calculerTrajets(pts, s, { optimiser: optimiser && !avecRdv });
    if (r.ordre && optimiser) {
      // TomTom a trouvé un meilleur ordre : on l'applique (les étapes intermédiaires seulement)
      const inter = t.retour ? etapesLoc : etapesLoc.slice(0, -1);
      const reord = r.ordre.map(i => inter[i]);
      t.etapes = [...reord, ...(t.retour ? [] : etapesLoc.slice(-1)), ...t.etapes.filter(e => !etapesLoc.includes(e))];
    }
    t.calcul = { ...r, ts: new Date().toISOString() };
    await db.put('tournees', t);
    if (r.provider === 'tomtom') await calibrer(pts, r.legs, s);
    if (r.erreur) toast('Service d\'itinéraire indisponible : estimation à vol d\'oiseau', 'warn');
    await render(el, { date });
  }

  // carte
  map = await carte($('#map'));
  const layers = [];
  if (departOk) layers.push(repereDepart(dep, dep !== s.depart));
  if (departOk && dep !== s.depart && t.retour) layers.push(repereDepart(s.depart));
  t.etapes.forEach((e, i) => { const m = mags.get(e.magasinId); if (m.lat != null) layers.push(repere(m, i + 1).bindPopup(esc(m.nom))); });
  (t.calcul?.legs || []).forEach(l => layers.push(L.polyline(l.points, { color: '#1E4FA0', weight: 4, opacity: 0.8, dashArray: t.calcul.provider === 'tomtom' ? null : '6 8' })));
  const g = L.featureGroup(layers).addTo(map);
  if (layers.length) map.fitBounds(g.getBounds().pad(0.15), { animate: false });
  // tournée créée par le plan de secteur : trajets calculés à la première ouverture
  if (!t.calcul && t.etapes.length && departOk) calculer(false);
}

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
  const [mags, notes, tournees, rdvs] = await Promise.all([magasinsEnrichis(s), db.all('notes'), db.all('tournees'), tousLesRdv()]);
  const byId = new Map(mags.map(m => [m.id, m]));
  const lignes = [];
  const arrondi = min => fmtHeure(Math.round(min / 5) * 5);
  const jours = tournees.filter(x => x.id >= r.du && x.id <= r.au && x.etapes.length).sort((a, b) => a.id.localeCompare(b.id));
  for (const t of jours) {
    const p = t.calcul ? planning(t, byId, s, rdvs) : estimerJour(t, byId, s, rdvs);
    p.etapes.forEach((e, k) => {
      const m = byId.get(e.magasinId);
      if (!m) return;
      const nm = notes.filter(n => n.magasinId === m.id);
      const v = nm.find(n => n.type === 'Visite' && n.date === t.id);
      lignes.push({ t, k, jour: t.id, heure: e.heureFixee || e.rdvHeure || (e.arrivee != null ? arrondi(e.arrivee) : ''), chef: s.commercial || '',
        enseigne: ENSEIGNES_LISTE.find(x => m.enseigne.startsWith(x.split('.')[0])) || m.enseigne,
        magasin: m.libellePlanning || `${m.cp} ${m.ville.toUpperCase()} – ${m.nom}`, nom: m.nom,
        statut: v?.statut || (e.fait ? 'Réalisée' : e.rdv ? 'Confirmée' : 'Planifiée'), objet: v?.objet || e.objet || s.objetDefaut,
        motif: e.motif || '', numero: v?.numero || numeroVisite(nm, t.id), interlocuteur: v?.contact || '', rdv: !!e.rdvHeure });
    });
  }
  if (!lignes.length) return toast('Aucune visite prévue sur cette période', 'warn');
  // vérification ligne par ligne : heure, objet et « pourquoi j'y vais »
  const v = await modal({ titre: `Planning du ${fmtDate(r.du)} au ${fmtDate(r.au)}`, valider: 'Créer le fichier Excel', large: true, corps: `
    ${s.commercial ? '' : '<p class="hint">Astuce : renseigne ton nom dans les Réglages pour remplir la colonne « Chef de secteur ».</p>'}
    <p class="hint">Heures estimées d'après ta tournée (arrondies à 5 min) ; les heures de RDV sont reprises telles quelles. Tout est modifiable ici et gardé dans tes tournées.</p>
    <div class="exp-list">${lignes.map((l, i) => `<div class="exp-row ${i && lignes[i - 1].jour !== l.jour ? 'new-day' : ''}">
      <span class="exp-j">${fmtDate(l.jour)}</span>
      <input type="time" name="h:${i}" value="${esc(l.heure)}" aria-label="Heure">
      <span class="exp-m"><strong>${esc(l.nom)}</strong>${l.rdv ? ' <span class="tag ok">RDV</span>' : ''}</span>
      <select name="o:${i}" aria-label="Objet">${[...new Set([...OBJETS_VISITE, l.objet])].map(o => `<option ${o === l.objet ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
      <input name="p:${i}" value="${esc(l.motif)}" placeholder="Pourquoi j'y vais (précision)" aria-label="Précision"></div>`).join('')}</div>
    <label class="check"><input type="checkbox" name="colMotif" checked> Ajouter les précisions dans une colonne à part (à droite, hors zone à coller)</label>` });
  if (!v) return;
  const modifiees = new Set();
  lignes.forEach((l, i) => {
    const e = l.t.etapes[l.k];
    const h = v['h:' + i] || '', o = v['o:' + i], pr = (v['p:' + i] || '').trim();
    if (h !== l.heure) e.heureFixee = h; if (o !== (e.objet || s.objetDefaut)) e.objet = o; if (pr !== (e.motif || '')) e.motif = pr;
    if (h !== l.heure || o !== l.objet || pr !== l.motif) modifiees.add(l.t);
    Object.assign(l, { heure: h, objet: o, motif: pr });
  });
  for (const t of modifiees) await db.put('tournees', t);
  downloadBlob(await exporterPlanning(lignes, `Planning ${s.commercial || ''} du ${fmtDate(r.du)} au ${fmtDate(r.au)}`.replace('  ', ' '), v.colMotif === 'on'), `Planning ${r.du} au ${r.au}.xlsx`);
  toast(`${lignes.length} visites exportées`);
}

export const lundiDe = date => { const d = new Date(date + 'T12:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const vendrediDe = date => { const d = new Date(lundiDe(date) + 'T12:00'); d.setDate(d.getDate() + 4); return d.toISOString().slice(0, 10); };

// Prochain jour de terrain (lundi → jours de terrain par semaine)
export function prochainJour(date, s) {
  const d = new Date(date + 'T12:00');
  do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() > Number(s.joursTerrain || 5));
  return d.toISOString().slice(0, 10);
}

// Calibrage automatique : compare les temps TomTom à l'estimation à vol d'oiseau
// pour que le plan de secteur colle à la réalité de tes routes.
async function calibrer(pts, legs, s) {
  let estMin = 0, estKm = 0, reelMin = 0, reelKm = 0;
  legs.forEach((l, i) => {
    const k = haversine(pts[i], pts[i + 1]) * s.coefRoute;
    estKm += k; estMin += k / s.vitesseMoyenne * 60; reelKm += l.km; reelMin += l.min;
  });
  if (estMin < 20) return;
  const c = s.calibration || { temps: 1, km: 1, n: 0 };
  const n = Math.min(c.n || 0, 19);
  const borne = x => Math.min(2.5, Math.max(0.5, x));
  await saveSettings({ calibration: {
    temps: (c.temps * n + borne(reelMin / estMin)) / (n + 1),
    km: (c.km * n + borne(reelKm / estKm)) / (n + 1), n: n + 1 } });
}

function gpsTout(t, mags, s) {
  const pts = t.etapes.map(e => mags.get(e.magasinId)).filter(m => m.lat != null);
  return t.retour && s.depart.lat != null ? [s.depart, pts] : [pts[pts.length - 1], pts.slice(0, -1)];  // départ = position actuelle du téléphone
}

// Fenêtre de choix des magasins : recherche, filtres, magasins proches ou en retard en premier.
// Choix des magasins à ajouter : filtres (enseigne, priorité, à voir, département) et tri,
// dont le « détour » = minutes en plus pour l'insérer au meilleur endroit de la journée.
let choix = { ens: [], prio: '', voir: '', tri: '' };
export async function choisirMagasins(t, all, s, depart = t.depart?.lat != null ? t.depart : s.depart) {
  const dans = new Set(t.etapes.map(e => e.magasinId));
  const route = [depart, ...t.etapes.map(e => all.find(m => m.id === e.magasinId))].filter(m => m?.lat != null);
  if (t.retour !== false && s.depart?.lat != null) route.push(s.depart);
  const cal = s.calibration || {};
  const dt = (a, b) => haversine(a, b) * s.coefRoute * (cal.temps || 1) / s.vitesseMoyenne * 60;
  const aDesEtapes = route.length > 2 || (route.length === 2 && t.etapes.length);
  const detourDe = m => {
    if (m.lat == null || route.length < 1) return null;
    if (route.length === 1) return dt(route[0], m) * 2;
    let best = Infinity;
    for (let k = 1; k < route.length; k++) best = Math.min(best, dt(route[k - 1], m) + dt(m, route[k]) - dt(route[k - 1], route[k]));
    return best;
  };
  const list = all.map(m => ({ ...m, det: detourDe(m) }));
  const deps = [...new Set(all.map(m => m.departement))].sort();
  const enseignes = [...new Set(all.map(m => m.enseigne).filter(Boolean))].sort();
  if (!choix.tri) choix.tri = aDesEtapes ? 'detour' : 'urgence';
  const TRIS = { detour: 'Détour le plus court', urgence: 'Les plus urgents', distance: 'Les plus proches de chez moi', enseigne: 'Enseigne puis ville' };
  const p = modal({ titre: 'Ajouter des magasins', valider: 'Ajouter à la tournée', large: true, corps: `
    <div class="pick-f">
      <input type="search" id="pickQ" placeholder="Ville, magasin…" aria-label="Rechercher">
      <select id="pickDep" aria-label="Département"><option value="">Tous départements</option>${deps.map(d => `<option>${d}</option>`).join('')}</select>
      <select id="pickPrio" aria-label="Priorité"><option value="">Toutes priorités</option>${[1, 2, 3].map(k => `<option value="${k}" ${choix.prio === String(k) ? 'selected' : ''}>${PRIORITES[k].label} seulement</option>`).join('')}<option value="12" ${choix.prio === '12' ? 'selected' : ''}>P1 et P2</option></select>
      <select id="pickVoir" aria-label="À voir"><option value="">Tous les magasins</option><option value="avoir" ${choix.voir === 'avoir' ? 'selected' : ''}>À voir (en retard ou jamais vus)</option><option value="retard" ${choix.voir === 'retard' ? 'selected' : ''}>En retard seulement</option></select>
      <select id="pickTri" aria-label="Trier par">${Object.entries(TRIS).map(([k, l]) => `<option value="${k}" ${choix.tri === k ? 'selected' : ''}>Tri : ${l}</option>`).join('')}</select>
    </div>
    <div class="chips pick-ens">${enseignes.map(e => `<button type="button" class="chip" data-e="${esc(e)}" aria-pressed="${choix.ens.includes(e)}"><i class="dot" style="background:${enseigneColor(e)}"></i>${esc(e)}</button>`).join('')}</div>
    <p class="hint" id="pickHint"></p>
    <div class="pick-list" id="pickList"></div>` });
  const coches = new Set();
  const row = m => `<label class="pick">
      <input type="checkbox" name="m:${esc(m.id)}" ${dans.has(m.id) ? 'checked disabled' : coches.has(m.id) ? 'checked' : ''}>
      ${borne(m.departement)}<span class="pick-info"><strong>${esc(m.nom)} ${prioTag(m.prio)}</strong><small>${esc(m.ville)} · ${m.derniereVisite ? `vu le ${fmtDate(m.derniereVisite)}` : 'jamais visité'}${m.enRetard ? ' · <b class="late-txt">en retard</b>' : ''}</small></span>
      ${m.det != null ? `<span class="pick-det ${m.det <= 15 ? 'ok' : m.det <= 40 ? '' : 'loin'}">${aDesEtapes ? `+${Math.round(m.det)} min` : `${Math.round(m.det / 2)} min`}</span>` : ''}</label>`;
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
    $('#pickList').innerHTML = l.slice(0, 150).map(row).join('') || '<p class="empty">Aucun magasin ne correspond à ces filtres.</p>';
    $('#pickHint').textContent = `${l.length} magasin${l.length > 1 ? 's' : ''}${l.length > 150 ? ' (150 premiers affichés, affine les filtres)' : ''}. `
      + (aDesEtapes ? 'Le chiffre à droite = minutes de route en plus pour l\'ajouter au meilleur endroit de la journée (estimation).' : 'Le chiffre à droite = temps de route depuis ton départ (estimation).');
  };
  $$('[data-e]').forEach(b => b.onclick = () => {
    const e = b.dataset.e; choix.ens = choix.ens.includes(e) ? choix.ens.filter(x => x !== e) : [...choix.ens, e];
    b.setAttribute('aria-pressed', choix.ens.includes(e)); maj();
  });
  $('#pickList').onchange = e => { const i = e.target; if (i.name?.startsWith('m:')) i.checked ? coches.add(i.name.slice(2)) : coches.delete(i.name.slice(2)); };
  $('#pickQ').oninput = maj; ['#pickDep', '#pickPrio', '#pickVoir', '#pickTri'].forEach(x => { $(x).onchange = maj; });
  maj();
  const r = await p;
  if (!r) return false;
  const ids = [...new Set([...coches, ...Object.keys(r).filter(k => k.startsWith('m:')).map(k => k.slice(2))])].filter(id => !dans.has(id));
  ids.forEach(id => t.etapes.push({ magasinId: id, fait: false }));
  return ids.length > 0;
}

export function destroy() { if (map) { map.stop(); map.off(); map.remove(); map = null; } }
