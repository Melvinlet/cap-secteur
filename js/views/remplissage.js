// Morceaux communs aux fenêtres « Remplir la semaine », « Remplir la journée » et aux simulations :
// magasins imposés, ciblage (enseignes, autres magasins, priorités, départements, détours) et zones.
// Une seule version pour tous les outils de remplissage.
import { esc } from '../ui.js';
import { PRIORITES } from '../config.js';
import { prioriteDe } from '../data.js';
import { datalistMagasins, trouverMagasin, messageIntrouvable } from '../champ-magasin.js';
import { ic } from '../icones.js';

export const enseignesDe = all => [...new Set(all.map(m => m.enseigne).filter(Boolean))]
  .sort((a, b) => all.filter(m => m.enseigne === b).length - all.filter(m => m.enseigne === a).length);
export const departementsDe = all => [...new Set(all.map(m => String(m.departement)))].sort();
export const centre = l => l.length ? { lat: l.reduce((a, m) => a + m.lat, 0) / l.length, lon: l.reduce((a, m) => a + m.lon, 0) / l.length } : null;

// ── Magasins imposés ─────────────────────────────────────────────────────────
// jours : [{ v, lib }] pour choisir le jour (semaine) ; absent = la journée en cours
export const htmlImposes = (all, hint) => `<fieldset><legend>Magasins à inclure obligatoirement</legend>
  <p class="hint">${hint}</p>
  <div class="imposes" data-imposes></div>
  ${datalistMagasins('dlImposes', all.filter(m => m.lat != null))}
  <button type="button" class="btn small" data-add-impose>+ Ajouter un magasin</button></fieldset>`;

export function brancherImposes(dlg, jours = null) {
  let n = 0;
  dlg.querySelector('[data-add-impose]').onclick = () => {
    const i = n++; const d = document.createElement('div'); d.className = 'imp-ligne';
    d.innerHTML = `<input name="impM:${i}" list="dlImposes" placeholder="Tape le nom ou la ville du magasin" aria-label="Magasin" autocomplete="off">
      ${jours ? `<select name="impJ:${i}" aria-label="Jour"><option value="auto">Le meilleur jour</option>${jours.map(j => `<option value="${j.v}">${esc(j.lib)}</option>`).join('')}</select>` : ''}
      <input type="time" name="impH:${i}" aria-label="Heure (facultatif)" title="Heure (facultatif)">
      <button type="button" class="btn-icon" aria-label="Retirer">${ic('croix')}</button>`;
    d.querySelector('button').onclick = () => d.remove();
    dlg.querySelector('[data-imposes]').append(d); d.querySelector('input').focus();
  };
}

// → { imposes: [{ m, jour, heure }], erreur } (erreur = message à afficher si un magasin est introuvable)
export function lireImposes(r, all) {
  const loc = all.filter(m => m.lat != null), imposes = [], inconnus = [];
  for (const k of Object.keys(r).filter(k => k.startsWith('impM:'))) {
    const i = k.slice(5), txt = (r[k] || '').trim();
    if (!txt) continue;
    const m = trouverMagasin(txt, loc);
    if (!m) { inconnus.push(txt); continue; }
    const j = r['impJ:' + i];
    imposes.push({ m, jour: j == null || j === 'auto' ? null : Number(j), heure: r['impH:' + i] || '' });
  }
  return { imposes, erreur: inconnus.length ? messageIntrouvable(inconnus.join(', ')) : null };
}

// ── Ciblage : enseignes prioritaires, autres magasins, priorités, départements, détour pour retard ──
export function htmlCiblage(all, c, s) {
  const ens = enseignesDe(all), deps = departementsDe(all);
  const nb = e => all.filter(m => m.enseigne === e && PRIORITES[prioriteDe(m)]?.freq != null).length;
  return `<fieldset><legend>Enseignes prioritaires</legend>
      <div class="chips">${ens.map(e => `<label class="chip-check"><input type="checkbox" name="ens:${esc(e)}" ${c.enseignes.includes(e) ? 'checked' : ''}><span>${esc(e)} <small>${nb(e)}</small></span></label>`).join('')}</div>
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
      <div class="chips">${deps.map(d => `<label class="chip-check"><input type="checkbox" name="dep:${d}" ${c.departements.map(String).includes(d) ? 'checked' : ''}><span>${d}</span></label>`).join('')}</div>
      <label>Détour accepté pour un magasin en retard de visite (minutes)<input type="number" name="detour" min="0" step="5" value="${s.detourRetard ?? 40}"></label></fieldset>`;
}

// → { cible, detour, erreur }
export function lireCiblage(r, all) {
  const cible = {
    enseignes: enseignesDe(all).filter(e => r['ens:' + e] === 'on'), autres: r.autres || 'detour', detourPetit: Number(r.detourPetit) || 0,
    completer: r.completer === 'on', priorites: [1, 2, 3].filter(k => r['prio:' + k] === 'on'),
    departements: departementsDe(all).filter(d => r['dep:' + d] === 'on'),
  };
  return { cible, detour: Number(r.detour) || 0, erreur: cible.priorites.length ? null : 'Coche au moins une priorité' };
}

// ── Zones ────────────────────────────────────────────────────────────────────
// options d'un <select> de zone ; v = valeur choisie : 'libre' | 'autour' | 'point' | 'dep:XX'
export const optionsZone = (all, { autour = null, point = null, choisi = '' } = {}) => `<option value="libre">Libre</option>
  ${point?.lat != null ? `<option value="point" ${choisi === 'point' ? 'selected' : ''}>Autour de ${esc(point.nom)}</option>` : ''}
  ${autour ? `<option value="autour" ${choisi === 'autour' ? 'selected' : ''}>${esc(autour)}</option>` : ''}
  ${departementsDe(all).map(dp => `<option value="dep:${dp}" ${choisi === 'dep:' + dp ? 'selected' : ''}>Département ${dp}</option>`).join('')}`;

// valeur du <select> → zone pour le planificateur ({ lat, lon, rayon } ou { lat, lon, dep }) ou null
export function lireZone(v, all, { prevus = [], point = null, rayon = 45 } = {}) {
  const loc = all.filter(m => m.lat != null);
  if (v === 'autour') { const c0 = centre(prevus.filter(m => m?.lat != null)); return c0 ? { ...c0, rayon } : null; }
  if (v === 'point' && point?.lat != null) return { lat: point.lat, lon: point.lon, rayon };
  if (v?.startsWith('dep:')) { const dep = v.slice(4); const c0 = centre(loc.filter(m => String(m.departement) === dep)); return c0 ? { ...c0, dep } : null; }
  return null;
}
