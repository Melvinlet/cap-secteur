// Écran « Magasins » : liste filtrable + carte.
import { getSettings } from '../db.js';
import { magasinsEnrichis } from '../data.js';
import { $, $$, esc, borne, enseigneColor, norm, fmtDate, prioTag, modal, toast } from '../ui.js';
import { db } from '../db.js';
import { PRIORITES, ORDRE_PRIORITES } from '../config.js';
import { carte, repere } from '../carte.js';

let map, filtres = { q: '', dep: '', ens: '', etat: '', prio: '' }, vue = 'liste';

export async function render(el) {
  const s = await getSettings();
  const mags = await magasinsEnrichis(s);
  if (!mags.length) {
    el.innerHTML = `<div class="page"><h1>Magasins</h1>
      <div class="empty"><p>Aucun magasin pour l'instant. Importe ta base magasins (le fichier Excel « Magasins secteur.xlsx ») pour commencer.</p>
      <a class="btn primary" href="#/reglages">Importer la base magasins</a></div></div>`;
    return;
  }
  const deps = [...new Set(mags.map(m => m.departement))].sort();
  const ens = [...new Set(mags.map(m => m.enseigne))].sort();
  el.innerHTML = `<div class="page wide">
    <header class="page-head"><h1>Magasins</h1>
      <div class="seg" role="tablist" aria-label="Affichage">
        <button role="tab" data-vue="liste">Liste</button><button role="tab" data-vue="carte">Carte</button></div></header>
    <div class="filters">
      <input type="search" id="q" placeholder="Rechercher un magasin, une ville, un contact…" value="${esc(filtres.q)}" aria-label="Rechercher">
      <div class="bornes" role="group" aria-label="Départements">
        ${deps.map(d => `<button class="borne-btn" data-dep="${d}" aria-pressed="${filtres.dep === d}">${borne(d)}</button>`).join('')}
      </div>
      <select id="ens" aria-label="Enseigne"><option value="">Toutes les enseignes</option>${ens.map(e => `<option ${filtres.ens === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>
      <select id="prio" aria-label="Priorité"><option value="">Toutes priorités</option>${ORDRE_PRIORITES.map(p => `<option value="${p}" ${filtres.prio === String(p) ? 'selected' : ''}>${PRIORITES[p].label}</option>`).join('')}</select>
      <select id="etat" aria-label="Suivi">
        <option value="">Tous</option><option value="retard">Visite en retard</option><option value="jamais">Jamais visité</option>
        <option value="sav">SAV en cours</option><option value="nonloc">Non localisé</option></select>
    </div>
    <div class="count-row"><p class="count" id="count"></p><button class="btn small ghost" id="bulk">Changer la priorité des magasins affichés</button></div>
    <div id="liste" class="store-list"></div>
    <div id="carte" class="map-panel" hidden></div>
  </div>`;
  $('#etat').value = filtres.etat;

  const apply = () => {
    const q = norm(filtres.q);
    const list = mags.filter(m =>
      (!filtres.dep || m.departement === filtres.dep) && (!filtres.ens || m.enseigne === filtres.ens) &&
      (filtres.prio === '' ? m.prio !== 4 : m.prio === Number(filtres.prio)) &&
      (!q || norm(`${m.nom} ${m.ville} ${m.cp} ${m.societe} ${m.adresse} ${m.code} ${m.libellePlanning || ""} ${m.enseigne}`).includes(q)) &&
      (!filtres.etat || (filtres.etat === 'retard' && m.enRetard) || (filtres.etat === 'jamais' && !m.derniereVisite) ||
        (filtres.etat === 'sav' && m.savOuverts) || (filtres.etat === 'nonloc' && m.lat == null)));
    list.sort((a, b) => a.departement.localeCompare(b.departement) || a.ville.localeCompare(b.ville));
    $('#count').textContent = `${list.length} magasin${list.length > 1 ? 's' : ''}`;
    $('#liste').innerHTML = list.map(m => `
      <a class="store" href="#/magasin/${encodeURIComponent(m.id)}">
        ${borne(m.departement)}
        <span class="store-main"><span class="store-name"><i class="dot" style="--c:${enseigneColor(m.enseigne)}"></i>${esc(m.nom)} ${prioTag(m.prio)}</span>
          <span class="store-sub">${m.code ? `${esc(m.code)} · ` : ''}${esc(m.adresse || '')}${m.adresse ? ', ' : ''}${esc(m.cp)} ${esc(m.ville)}</span></span>
        <span class="store-meta">
          ${m.savOuverts ? `<span class="tag warn">${m.savOuverts} SAV</span>` : ''}
          ${m.derniereVisite ? `<span class="tag ${m.enRetard ? 'late' : ''}">Vu le ${fmtDate(m.derniereVisite)}</span>` : '<span class="tag muted">Jamais visité</span>'}
        </span></a>`).join('') || '<p class="empty">Aucun magasin ne correspond à ces filtres.</p>';
    if (vue === 'carte') dessinerCarte(list);
  };

  const setVue = v => {
    vue = v;
    $$('[data-vue]').forEach(b => b.setAttribute('aria-selected', b.dataset.vue === v));
    $('#liste').hidden = v !== 'liste'; $('#carte').hidden = v !== 'carte';
    apply();
  };
  $('#q').oninput = e => { filtres.q = e.target.value; apply(); };
  $('#ens').onchange = e => { filtres.ens = e.target.value; apply(); };
  $('#etat').onchange = e => { filtres.etat = e.target.value; apply(); };
  $('#prio').onchange = e => { filtres.prio = e.target.value; apply(); };
  $('#bulk').onclick = async () => {
    const ids = $$('#liste .store').map(a => decodeURIComponent(a.getAttribute('href').split('/').pop()));
    if (!ids.length) return;
    const r = await modal({ titre: 'Changer la priorité', valider: `Appliquer aux ${ids.length} magasins`, corps: `
      <p>Les <strong>${ids.length} magasins</strong> actuellement affichés (selon tes filtres) passeront à :</p>
      ${ORDRE_PRIORITES.map(p => `<label class="check"><input type="radio" name="p" value="${p}" ${p === 2 ? 'checked' : ''}> ${prioTag(p)} ${PRIORITES[p].label} — ${PRIORITES[p].freq ? `visite tous les ${(s.frequencesPriorite || {})[p] ?? PRIORITES[p].freq} jours` : PRIORITES[p].aide}</label>`).join('')}
      <p class="hint">Ces magasins garderont ce choix même si tu réimportes la base.</p>` });
    if (!r) return;
    const all = await db.all('magasins');
    const set = new Set(ids);
    await db.putMany('magasins', all.filter(m => set.has(m.id)).map(m => ({ ...m, priorite: Number(r.p), prioriteManuelle: true, maj: new Date().toISOString() })));
    toast(`Priorité mise à jour pour ${ids.length} magasins`);
    render(el);
  };
  $$('[data-dep]').forEach(b => b.onclick = () => {
    filtres.dep = filtres.dep === b.dataset.dep ? '' : b.dataset.dep;
    $$('[data-dep]').forEach(x => x.setAttribute('aria-pressed', x.dataset.dep === filtres.dep));
    apply();
  });
  $$('[data-vue]').forEach(b => b.onclick = () => setVue(b.dataset.vue));
  setVue(vue);
}

async function dessinerCarte(list) {
  const el = $('#carte');
  if (!map) map = await carte(el);
  else map.invalidateSize();
  map._layer?.remove();
  const pts = list.filter(m => m.lat != null);
  map._layer = L.layerGroup(pts.map(m => repere(m).bindPopup(
    `<strong>${esc(m.nom)}</strong><br>${esc(m.ville)}<br><a href="#/magasin/${encodeURIComponent(m.id)}">Ouvrir la fiche</a>`))).addTo(map);
  if (pts.length) map.fitBounds(L.latLngBounds(pts.map(m => [m.lat, m.lon])).pad(0.1), { animate: false });
  const manque = list.length - pts.length;
  el.dataset.note = manque ? `${manque} magasin(s) pas encore localisé(s) — Réglages > Localiser les magasins` : '';
}

export function destroy() { if (map) { map.remove(); map = null; } }
