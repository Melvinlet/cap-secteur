// Espace « Activité » : historique des visites, rapport, notes de frais, objectifs, concurrence.
import { $, esc } from '../ui.js';

const ONGLETS = [
  ['visites', 'Visites', () => import('./act/visites.js')],
  ['rapport', 'Rapport', () => import('./act/rapport.js')],
  ['objectifs', 'Objectifs', () => import('./act/objectifs.js')],
  ['concurrence', 'Concurrence', () => import('./act/concurrence.js')],
  ['frais', 'Notes de frais', () => import('./act/frais.js')],
];
let courant = null;

export async function render(el, params) {
  const onglet = ONGLETS.find(o => o[0] === params.onglet) || ONGLETS[0];
  el.innerHTML = `<div class="page wide">
    <header class="page-head"><h1>Activité</h1><a class="btn-icon settings-link" href="#/reglages" aria-label="Réglages">⚙</a></header>
    <nav class="tabs" role="tablist">${ONGLETS.map(([k, l]) => `<a role="tab" href="#/activite/${k}" aria-selected="${k === onglet[0]}">${esc(l)}</a>`).join('')}</nav>
    <section id="act"></section></div>`;
  courant = await onglet[2]();
  await courant.render($('#act'), params);
}
export function destroy() { courant?.destroy?.(); }
