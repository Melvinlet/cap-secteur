// Écran « Magasins » : liste filtrable + carte.
import { getSettings } from '../db.js';
import { magasinsEnrichis } from '../data.js';
import { $, $$, esc, borne, enseigneColor, norm, fmtDate, prioTag, modal, toast } from '../ui.js';
import { db } from '../db.js';
import { PRIORITES, ORDRE_PRIORITES } from '../config.js';
import { carte, repere } from '../carte.js';

let map, filtres = { q: '', dep: '', ens: '', etat: '', prio: '', tri: 'lieu' }, vue = 'liste';

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
        <button role="tab" data-vue="liste">Liste</button><button role="tab" data-vue="carte">Carte</button><button role="tab" data-vue="stats">Stats</button></div></header>
    <div class="filters">
      <input type="search" id="q" placeholder="Rechercher un magasin, une ville, un contact…" value="${esc(filtres.q)}" aria-label="Rechercher">
      <div class="bornes" role="group" aria-label="Départements">
        ${deps.map(d => `<button class="borne-btn" data-dep="${d}" aria-pressed="${filtres.dep === d}">${borne(d)}</button>`).join('')}
      </div>
      <select id="ens" aria-label="Enseigne"><option value="">Toutes les enseignes</option>${ens.map(e => `<option ${filtres.ens === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>
      <select id="prio" aria-label="Priorité"><option value="">Toutes priorités</option>${ORDRE_PRIORITES.map(p => `<option value="${p}" ${filtres.prio === String(p) ? 'selected' : ''}>${PRIORITES[p].label}</option>`).join('')}</select>
      <select id="etat" aria-label="Suivi">
        <option value="">Tous</option><option value="retard">Visite en retard</option><option value="jamais">Jamais visité</option>
        <option value="sav">SAV en cours</option><option value="nonloc">Non localisé</option>
        <option value="ventes">Avec des ventes 2026</option><option value="sansventes">Sans vente 2026</option></select>
      <select id="tri" aria-label="Trier par"><option value="lieu">Tri : département, ville</option><option value="ventes">Tri : meilleures ventes 2026</option><option value="nom">Tri : nom</option><option value="visite">Tri : visite la plus ancienne</option></select>
    </div>
    <div class="count-row"><p class="count" id="count"></p><button class="btn small ghost" id="bulk">Changer la priorité des magasins affichés</button></div>
    <div id="liste" class="store-list"></div>
    <div id="carte" class="map-panel" hidden></div>
    <div id="stats" class="stats" hidden></div>
  </div>`;
  $('#etat').value = filtres.etat; $('#tri').value = filtres.tri;

  const apply = () => {
    const q = norm(filtres.q);
    const list = mags.filter(m =>
      (!filtres.dep || m.departement === filtres.dep) && (!filtres.ens || m.enseigne === filtres.ens) &&
      (filtres.prio === '' ? m.prio !== 4 : m.prio === Number(filtres.prio)) &&
      (!q || norm(`${m.nom} ${m.ville} ${m.cp} ${m.societe} ${m.adresse} ${m.code} ${m.libellePlanning || ""} ${m.enseigne}`).includes(q)) &&
      (!filtres.etat || (filtres.etat === 'retard' && m.enRetard) || (filtres.etat === 'jamais' && !m.derniereVisite) ||
        (filtres.etat === 'sav' && m.savOuverts) || (filtres.etat === 'nonloc' && m.lat == null) ||
        (filtres.etat === 'ventes' && m.ventes2026 > 0) || (filtres.etat === 'sansventes' && !(m.ventes2026 > 0))));
    const lieu = (a, b) => a.departement.localeCompare(b.departement) || a.ville.localeCompare(b.ville);
    list.sort({ ventes: (a, b) => (b.ventes2026 || 0) - (a.ventes2026 || 0) || lieu(a, b), nom: (a, b) => a.nom.localeCompare(b.nom),
      visite: (a, b) => (a.derniereVisite || '').localeCompare(b.derniereVisite || '') || lieu(a, b) }[filtres.tri] || lieu);
    $('#count').textContent = `${list.length} magasin${list.length > 1 ? 's' : ''}`;
    $('#liste').innerHTML = list.map(m => `
      <a class="store" href="#/magasin/${encodeURIComponent(m.id)}">
        ${borne(m.departement)}
        <span class="store-main"><span class="store-name"><i class="dot" style="--c:${enseigneColor(m.enseigne)}"></i>${esc(m.nom)} ${prioTag(m.prio)}</span>
          <span class="store-sub">${m.code ? `${esc(m.code)} · ` : ''}${esc(m.adresse || '')}${m.adresse ? ', ' : ''}${esc(m.cp)} ${esc(m.ville)}</span></span>
        <span class="store-meta">
          ${m.ventes2026 > 0 ? `<span class="tag ventes" title="Robots vendus en 2026">${m.ventes2026} robot${m.ventes2026 > 1 ? 's' : ''}</span>` : ''}
          ${m.savOuverts ? `<span class="tag warn">${m.savOuverts} SAV</span>` : ''}
          ${m.derniereVisite ? `<span class="tag ${m.enRetard ? 'late' : ''}">Vu le ${fmtDate(m.derniereVisite)}</span>` : '<span class="tag muted">Jamais visité</span>'}
        </span></a>`).join('') || '<p class="empty">Aucun magasin ne correspond à ces filtres.</p>';
    if (vue === 'carte') dessinerCarte(list);
    if (vue === 'stats') $('#stats').innerHTML = statistiques(list, mags);
  };

  const setVue = v => {
    vue = v;
    $$('[data-vue]').forEach(b => b.setAttribute('aria-selected', b.dataset.vue === v));
    $('#liste').hidden = v !== 'liste'; $('#carte').hidden = v !== 'carte'; $('#stats').hidden = v !== 'stats';
    $('#bulk').hidden = v === 'stats';
    apply();
  };
  $('#q').oninput = e => { filtres.q = e.target.value; apply(); };
  $('#ens').onchange = e => { filtres.ens = e.target.value; apply(); };
  $('#etat').onchange = e => { filtres.etat = e.target.value; apply(); };
  $('#prio').onchange = e => { filtres.prio = e.target.value; apply(); };
  $('#tri').onchange = e => { filtres.tri = e.target.value; apply(); };
  $('#stats').addEventListener('click', e => { if (e.target.id === 'voirSans') { filtres.etat = 'sansventes'; $('#etat').value = 'sansventes'; setVue('liste'); } });
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

// ── Stats des ventes (unités de robots 2026, aucun montant) sur les magasins affichés (les filtres s'appliquent) ──
function statistiques(list, tous) {
  const vend = list.filter(m => m.ventes2026 > 0);
  const total = vend.reduce((a, m) => a + m.ventes2026, 0);
  if (!list.length) return '<p class="empty">Aucun magasin ne correspond à ces filtres.</p>';
  const nb = n => n.toLocaleString('fr-FR');
  const groupe = cle => {
    const g = new Map();
    for (const m of list) { const k = m[cle] || '—'; const x = g.get(k) || { k, u: 0, n: 0, v: 0 }; x.n++; if (m.ventes2026 > 0) { x.u += m.ventes2026; x.v++; } g.set(k, x); }
    return [...g.values()].sort((a, b) => b.u - a.u || b.n - a.n);
  };
  const barres = (titre, lignes, libelle) => { const max = Math.max(1, ...lignes.map(l => l.u)); return `<section class="stat-bloc"><h2 class="h2">${titre}</h2>
    <ul class="barres">${lignes.map(l => `<li><span class="b-nom">${libelle(l)}</span><span class="b-barre"><i style="width:${(l.u / max * 100).toFixed(1)}%"></i></span>
      <span class="b-val"><b>${nb(l.u)}</b> <small>${l.v}/${l.n} mag.</small></span></li>`).join('')}</ul></section>`; };
  const top = [...vend].sort((a, b) => b.ventes2026 - a.ventes2026).slice(0, 15);
  const seuil = top.length ? top[Math.min(top.length, 15) - 1].ventes2026 : Infinity;
  const aVoir = vend.filter(m => m.ventes2026 >= seuil && (m.enRetard || !m.derniereVisite)).sort((a, b) => b.ventes2026 - a.ventes2026);
  const ligneMag = (m, i) => `<li><a href="#/magasin/${encodeURIComponent(m.id)}"><span class="rang">${i + 1}</span><span class="t-nom"><i class="dot" style="--c:${enseigneColor(m.enseigne)}"></i>${esc(m.nom)} ${prioTag(m.prio)}<small>${esc(m.ville)} · ${m.derniereVisite ? `vu le ${fmtDate(m.derniereVisite)}` : 'jamais visité'}</small></span><b>${nb(m.ventes2026)}</b></a></li>`;
  return `<div class="tour-sum stat-sum">
      <div><span class="big">${nb(total)}</span>robots vendus en 2026</div>
      <div><span class="big">${vend.length}</span>magasins vendeurs sur ${list.length}</div>
      <div><span class="big">${vend.length ? nb(Math.round(total / vend.length)) : '–'}</span>par magasin vendeur</div>
      <div><span class="big">${top[0] ? nb(top[0].ventes2026) : '–'}</span>meilleur magasin</div></div>
    <p class="hint">Ventes en unités tirées du fichier de l'entreprise. Les filtres en haut (département, enseigne, priorité, recherche) s'appliquent aussi aux stats.</p>
    <div class="stat-grille">
      ${barres('Par enseigne', groupe('enseigne'), l => `<i class="dot" style="--c:${enseigneColor(l.k)}"></i>${esc(l.k)}`)}
      ${barres('Par département', groupe('departement'), l => `${borne(l.k)}`)}
    </div>
    <section class="stat-bloc"><h2 class="h2">Top ${top.length} magasins</h2><ol class="top-mag">${top.map(ligneMag).join('')}</ol></section>
    ${aVoir.length ? `<section class="stat-bloc alerte-retard"><h2 class="h2">Gros vendeurs à aller voir</h2><p class="small">Dans le top, en retard de visite ou jamais visités.</p><ol class="top-mag">${aVoir.map((m, i) => ligneMag(m, i)).join('')}</ol></section>` : ''}
    <section class="stat-bloc"><h2 class="h2">Sans vente en 2026</h2><p>${list.length - vend.length} magasins affichés n'ont aucune vente dans le fichier, dont <strong>${list.filter(m => !(m.ventes2026 > 0) && m.prio === 1).length} en priorité P1</strong>. <button class="btn-link" id="voirSans">Les voir dans la liste</button></p></section>`;
}

export function destroy() { if (map) { map.remove(); map = null; } }
