// Barre d'onglets commune aux vues du planning : Jour / Semaine / Simulation / Secteur.
// On garde en mémoire le dernier jour consulté pour passer d'un onglet à l'autre sans perdre la date.
import { lundiDe, today } from '../ui.js';
let dernier = null;

export function ongletsPlanning(actif, date) {
  if (date && !(['semaine', 'simulation'].includes(actif) && dernier && lundiDe(dernier) === date)) dernier = date;   // la semaine garde le jour consulté
  const auj = today();
  const d = dernier && dernier >= auj ? dernier : auj;   // une date passée n'est pas gardée : on revient à aujourd'hui
  const o = (id, href, txt) => `<a href="${href}" role="tab" aria-selected="${actif === id}"${actif === id ? ' aria-current="page"' : ''}>${txt}</a>`;
  return `<nav class="seg onglets-planning" role="tablist" aria-label="Planning">
    ${o('jour', `#/tournee/${d}`, 'Jour')}${o('semaine', `#/semaine/${lundiDe(d)}`, 'Semaine')}${o('simulation', `#/simulation/${lundiDe(d)}`, 'Simulation')}${o('secteur', '#/plan', 'Secteur')}</nav>`;
}
