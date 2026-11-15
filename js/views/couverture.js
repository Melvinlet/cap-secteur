// Carte de couverture du secteur : chaque magasin coloré selon l'ancienneté de ta dernière visite
// (par rapport à la fréquence voulue pour sa priorité), un bilan par département,
// et un lien direct pour simuler une semaine dans une zone (autour d'un magasin ou dans un département).
import { ongletsPlanning } from './onglets-planning.js';
import { getSettings } from '../db.js';
import { magasinsEnrichis } from '../data.js';
import { $, $$, esc, fmtDate } from '../ui.js';
import { carte, repereDepart } from '../carte.js';
import { prochainLundi } from '../services/planificateur.js';

let map = null;
const ETATS = [
  { k: 'jour', lib: 'À jour', c: '#2E8540' },
  { k: 'bientot', lib: 'À revoir bientôt', c: '#D99A00' },
  { k: 'retard', lib: 'En retard', c: '#C8371D' },
  { k: 'jamais', lib: 'Jamais visité', c: '#6B2E8A' },
];
const etatDe = m => !m.derniereVisite ? 'jamais' : m.urgence >= 1 ? 'retard' : m.urgence >= 0.75 ? 'bientot' : 'jour';
const filtre = { prios: new Set([1, 2, 3]), etats: new Set(ETATS.map(e => e.k)) };

export async function render(el) {
  destroy();
  const s = await getSettings();
  const tous = (await magasinsEnrichis(s)).filter(m => [1, 2, 3].includes(m.prio));   // en pause, fermés, refus : hors couverture
  const lundi = prochainLundi();
  const sim = q => `#/simulation/${lundi}?${q}`;

  // bilan par département (tous les magasins actifs, sans filtre)
  const deps = new Map();
  for (const m of tous) {
    const d = String(m.departement || '?');
    if (!deps.has(d)) deps.set(d, { n: 0, jour: 0, bientot: 0, retard: 0, jamais: 0 });
    const x = deps.get(d); x.n++; x[etatDe(m)]++;
  }
  const tot = { n: tous.length, ...Object.fromEntries(ETATS.map(e => [e.k, tous.filter(m => etatDe(m) === e.k).length])) };
  const pct = (a, n) => n ? Math.round(100 * a / n) : 0;

  el.innerHTML = `<div class="page wide">
    ${ongletsPlanning('secteur')}
    <header class="page-head"><h1>Couverture du secteur</h1>
      <a class="btn ghost" href="#/plan">Plan sur plusieurs semaines</a></header>
    <p class="hint">Chaque point est un magasin, coloré selon ta dernière visite par rapport à la fréquence voulue pour sa priorité. Touche un magasin, ou un département dans le tableau, pour simuler une semaine dans ce coin.</p>
    <div class="couv-legende">${ETATS.map(e => `<label class="chip-check"><input type="checkbox" data-etat="${e.k}" ${filtre.etats.has(e.k) ? 'checked' : ''}><span><i class="pastille" style="--c:${e.c}"></i>${e.lib} <small>${tot[e.k]}</small></span></label>`).join('')}
      <span class="couv-sep"></span>
      ${[1, 2, 3].map(p => `<label class="chip-check"><input type="checkbox" data-prio="${p}" ${filtre.prios.has(p) ? 'checked' : ''}><span>P${p}</span></label>`).join('')}</div>
    <div class="couv-grille">
      <div id="couvMap" class="map couv-map" role="img" aria-label="Carte des magasins colorés par ancienneté de visite"></div>
      <section class="card couv-deps"><h2 class="h2">Par département <span class="tag ok">${pct(tot.jour, tot.n)} % à jour</span></h2>
        <table class="table"><thead><tr><th>Dép.</th><th class="num">Magasins</th><th class="num">À jour</th><th class="num">En retard</th><th class="num">Jamais vus</th><th></th></tr></thead><tbody>
        ${[...deps].sort((a, b) => (b[1].retard + b[1].jamais) / b[1].n - (a[1].retard + a[1].jamais) / a[1].n).map(([d, x]) => `<tr>
          <th scope="row">${esc(d)}</th><td class="num">${x.n}</td>
          <td class="num"><span class="barre-pct" style="--p:${pct(x.jour, x.n)}%"></span>${pct(x.jour, x.n)} %</td>
          <td class="num ${x.retard ? 'ko-txt' : ''}">${x.retard}</td><td class="num">${x.jamais}</td>
          <td><a class="btn small" href="${sim(`dep=${encodeURIComponent(d)}`)}" title="Simuler une semaine dans le ${esc(d)}">Simuler</a></td></tr>`).join('')}
        </tbody></table>
        <p class="hint">Trié du département le moins couvert au mieux couvert. « Simuler » prépare la semaine du ${fmtDate(lundi)} dans ce département, sans toucher à ton planning.</p></section>
    </div></div>`;

  map = await carte($('#couvMap'));
  const couche = L.featureGroup().addTo(map);
  const dessiner = () => {
    couche.clearLayers();
    for (const m of tous) {
      const e = etatDe(m);
      if (m.lat == null || !filtre.etats.has(e) || !filtre.prios.has(m.prio)) continue;
      const et = ETATS.find(x => x.k === e);
      L.circleMarker([m.lat, m.lon], { radius: m.prio === 1 ? 8 : m.prio === 2 ? 6.5 : 5, color: '#fff', weight: 1.5, fillColor: et.c, fillOpacity: .92 })
        .bindPopup(`<strong>${esc(m.nom)}</strong><br><span class="small">${esc(m.ville || '')} · P${m.prio}</span><br>
          ${m.derniereVisite ? `Dernière visite : ${fmtDate(m.derniereVisite)} (il y a ${m.joursDepuisVisite} j)` : 'Jamais visité'}<br>
          <span style="color:${et.c};font-weight:600">${et.lib}</span><br>
          <a class="btn small primary" style="margin-top:.4rem" href="${sim(`autour=${encodeURIComponent(m.id)}`)}">Simuler une semaine autour d'ici</a>
          <a class="btn small" style="margin-top:.4rem" href="#/magasin/${encodeURIComponent(m.id)}">Fiche</a>`)
        .addTo(couche);
    }
  };
  dessiner();
  if (s.depart?.lat != null) repereDepart(s.depart).addTo(map);
  if (couche.getLayers().length) map.fitBounds(couche.getBounds().pad(0.05), { animate: false });
  $$('[data-etat]', el).forEach(c => c.onchange = () => { c.checked ? filtre.etats.add(c.dataset.etat) : filtre.etats.delete(c.dataset.etat); dessiner(); });
  $$('[data-prio]', el).forEach(c => c.onchange = () => { const p = +c.dataset.prio; c.checked ? filtre.prios.add(p) : filtre.prios.delete(p); dessiner(); });
}

export function destroy() { if (map) { map.stop(); map.off(); map.remove(); map = null; } }
