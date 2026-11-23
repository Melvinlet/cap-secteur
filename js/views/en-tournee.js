// Mode tournée : l'écran du téléphone en journée. Le prochain magasin en grand, GPS en un geste,
// « Je suis arrivé » puis « Visité » (les heures notées servent à apprendre la vraie durée de tes visites),
// les à faire du magasin sous les yeux, et la suite de la journée en dessous. L'écran reste allumé.
import { db, getSettings } from '../db.js';
import { magasinsEnrichis } from '../data.js';
import { $, esc, fmtHeure, fmtDateLong, today, toast, enseigneColor, prioTag } from '../ui.js';
import { getTournee, estimerJour } from './tournee.js';
import { tousLesRdv, tagEtatRdv } from '../services/rdv.js';
import { aFaireOuverts, listeAFaire, brancherCoches } from '../services/afaire.js';
import { marquerVisite, lienDetails, visitesDuJour } from '../services/visite.js';
import { lienGps } from '../services/routing.js';

let minuteur = null, veille = null;
const maintenant = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const enMin = h => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
const hh = min => fmtHeure(min).replace(':', 'h');
const adresseDe = m => m.adresse && m.cp && m.adresse.includes(m.cp) ? m.adresse : [m.adresse, `${m.cp || ''} ${m.ville || ''}`.trim()].filter(Boolean).join(', ');

export async function render(el, params = {}) {
  destroy();
  const date = params.date || today();
  const s = await getSettings();
  const [all, t, rdvs, afaires, vus] = await Promise.all([magasinsEnrichis(s), getTournee(date), tousLesRdv(), aFaireOuverts(), visitesDuJour(date)]);
  const mags = new Map(all.map(m => [m.id, m]));
  t.etapes = t.etapes.filter(e => mags.has(e.magasinId));
  if (!t.etapes.length) {
    el.innerHTML = `<div class="page tm"><header class="tm-tete"><a class="btn-icon" href="#/tournee/${date}" aria-label="Retour au planning">‹</a><div><p class="tm-date">${fmtDateLong(date)}</p></div></header>
      <div class="empty"><p>Aucun magasin prévu ce jour-là.</p><p><a class="btn primary" href="#/tournee/${date}">Préparer la journée</a></p></div></div>`;
    return;
  }
  const p = estimerJour(t, mags, s, rdvs);
  const faits = t.etapes.filter(e => e.fait).length;
  // magasin affiché : celui choisi (?k=), sinon celui où tu es arrivé, sinon le premier pas encore visité
  const choisi = params.k != null && t.etapes[+params.k] && !t.etapes[+params.k].fait ? +params.k : null;
  const k = choisi ?? (t.etapes.findIndex(e => !e.fait && e.arriveeReelle) >= 0 ? t.etapes.findIndex(e => !e.fait && e.arriveeReelle) : t.etapes.findIndex(e => !e.fait));
  const e = t.etapes[k], m = e && mags.get(e.magasinId), pe = e && p.etapes[k];
  const af = e ? afaires.get(e.magasinId) || [] : [];

  const carte = m ? `<article class="tm-carte" style="--c:${enseigneColor(m.enseigne)}">
      <p class="tm-etiq">${e.arriveeReelle ? 'Sur place' : choisi != null ? 'Magasin choisi' : faits ? 'Prochain magasin' : 'Premier magasin'} · ${k + 1} sur ${t.etapes.length}</p>
      <h1>${esc(m.nom)}</h1>
      <p class="tm-adr">${esc(adresseDe(m))} ${prioTag(m.prio)}</p>
      <p class="tm-heure">${e.arriveeReelle ? `Arrivé à ${e.arriveeReelle.replace(':', 'h')} · <b id="tmMin">${Math.max(0, enMin(maintenant()) - enMin(e.arriveeReelle))}</b> min sur place`
        : `Arrivée prévue vers ${hh(pe.arrivee)}`}
        ${e.rdv ? `<span class="rdv-et rdv-ok">RDV ${esc(e.rdv.heure || 'confirmé')}</span>` : tagEtatRdv(rdvs.get(e.magasinId), date, s.relanceApres)}</p>
      ${af.length ? `<div class="tm-afaire"><p>📌 À faire ici</p>${listeAFaire(af)}</div>` : ''}
      <div class="tm-actions">
        ${e.arriveeReelle ? '<button class="btn primary tm-gros" id="tmVisite">Visité ✓</button>'
          : `${m.lat != null ? `<a class="btn primary tm-gros" href="${lienGps(s.gps, m)}" target="_blank" rel="noopener">Y aller</a>` : ''}<button class="btn tm-gros" id="tmArrive">Je suis arrivé</button>`}
        <button class="btn" id="tmAvant">Avant d'entrer${af.length ? ` <span class="badge">${af.length}</span>` : ''}</button>
        ${m.telMagasin ? `<a class="btn" href="tel:${esc(m.telMagasin.replace(/\s/g, ''))}">Appeler</a>` : ''}
      </div>
      <p class="tm-liens">${e.arriveeReelle ? '<button type="button" class="btn-link" id="tmAnnuler">Annuler l\'arrivée</button> · ' : ''}${m.positionManuelle ? '' : '<button type="button" class="btn-link" id="tmIci">📍 Je suis devant le magasin</button> · '}<a href="#/magasin/${encodeURIComponent(m.id)}">Fiche</a></p>
    </article>`
    : `<article class="tm-carte tm-fin">
      <p class="tm-etiq">Journée terminée</p><h1>Bravo, ${faits} visite${faits > 1 ? 's' : ''} 🎉</h1>
      ${s.depart?.lat != null && t.retour !== false ? `<div class="tm-actions"><a class="btn primary tm-gros" href="${lienGps(s.gps, s.depart)}" target="_blank" rel="noopener">Rentrer à la maison</a></div>` : ''}
      ${[...vus.values()].some(v => !(v.texte || '').trim()) ? `<p class="small">Comptes rendus à compléter :</p><ul class="plain tm-cr">${[...vus.values()].filter(v => !(v.texte || '').trim()).map(v => `<li><a href="${lienDetails(v)}">${esc(mags.get(v.magasinId)?.nom || '')}</a></li>`).join('')}</ul>` : ''}
    </article>`;

  el.innerHTML = `<div class="page tm">
    <header class="tm-tete"><a class="btn-icon" href="#/tournee/${date}" aria-label="Retour au planning">‹</a>
      <div><p class="tm-date">${fmtDateLong(date)}</p><p class="tm-prog">${faits} visité${faits > 1 ? 's' : ''} sur ${t.etapes.length} · fin vers ${hh(p.fin)}</p></div></header>
    <div class="tm-barre" role="progressbar" aria-label="Visites faites" aria-valuemin="0" aria-valuemax="${t.etapes.length}" aria-valuenow="${faits}"><i style="width:${Math.round(100 * faits / t.etapes.length)}%"></i></div>
    ${carte}
    <section class="tm-suite"><h2>La journée</h2><ol class="tm-liste">${t.etapes.map((x, i) => { const mm = mags.get(x.magasinId);
      return `<li class="${x.fait ? 'fait' : ''} ${i === k ? 'courant' : ''}" style="--c:${enseigneColor(mm.enseigne)}">
        <span class="tm-h">${x.fait ? '✓' : hh(p.etapes[i].arrivee)}</span><span class="tm-n">${esc(mm.nom)}${x.rdv ? ` <small class="rdv-et rdv-ok">RDV ${esc(x.rdv.heure || '')}</small>` : ''}</span>
        ${!x.fait && i !== k ? `<a class="btn small ghost" href="#/en-tournee/${date}?k=${i}">Y aller</a>` : ''}</li>`; }).join('')}</ol></section>
  </div>`;

  const save = async () => { await db.put('tournees', t); render(el, { date }); };
  $('#tmArrive')?.addEventListener('click', () => { e.arriveeReelle = maintenant(); save(); });
  $('#tmAnnuler')?.addEventListener('click', () => { delete e.arriveeReelle; save(); });
  $('#tmVisite')?.addEventListener('click', async () => {
    const depart = maintenant();
    const v = await marquerVisite(m.id, date);
    const v2 = { ...v, arrivee: v.arrivee || e.arriveeReelle, depart: v.depart || depart, maj: new Date().toISOString() };
    await db.put('notes', v2);
    const t2 = await getTournee(date), e2 = t2.etapes.find(x => x.magasinId === m.id);
    if (e2) { e2.fait = true; e2.arriveeReelle = e.arriveeReelle; e2.departReel = depart; await db.put('tournees', t2); }
    toast(`${m.nom} : visité`, '', { label: 'Ajouter des détails', href: lienDetails(v2) });
    render(el, { date });
  });
  $('#tmAvant')?.addEventListener('click', async () => { const { ouvrirFicheAvant } = await import('./fiche-avant.js'); if (await ouvrirFicheAvant(m.id, date)) render(el, { date }); });
  $('#tmIci')?.addEventListener('click', async () => { const { jeSuisDevant } = await import('../services/emplacements.js'); if (await jeSuisDevant(m.id)) render(el, params); });
  brancherCoches(el);
  if (e?.arriveeReelle) minuteur = setInterval(() => { const b = document.getElementById('tmMin'); if (b) b.textContent = Math.max(0, enMin(maintenant()) - enMin(e.arriveeReelle)); }, 30000);
  // l'écran reste allumé pendant le mode tournée (si le téléphone le permet)
  try { veille = await navigator.wakeLock?.request('screen'); } catch { /* refusé ou non géré */ }
}

export function destroy() {
  if (minuteur) { clearInterval(minuteur); minuteur = null; }
  try { veille?.release(); } catch { /* */ }
  veille = null;
}
