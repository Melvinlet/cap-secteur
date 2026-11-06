// Barre d'onglets commune aux 3 vues du planning : Jour / Semaine / Secteur.
// On garde en mémoire le dernier jour consulté pour passer d'un onglet à l'autre sans perdre la date.
let dernier = null;
const lundiDe = d => { const x = new Date(d + 'T12:00'); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); };

export function ongletsPlanning(actif, date) {
  if (date && !(actif === 'semaine' && dernier && lundiDe(dernier) === date)) dernier = date;   // la semaine garde le jour consulté
  const auj = new Date().toISOString().slice(0, 10);
  const d = dernier && dernier >= auj ? dernier : auj;   // une date passée n'est pas gardée : on revient à aujourd'hui
  const o = (id, href, txt) => `<a href="${href}" role="tab" aria-selected="${actif === id}"${actif === id ? ' aria-current="page"' : ''}>${txt}</a>`;
  return `<nav class="seg onglets-planning" role="tablist" aria-label="Planning">
    ${o('jour', `#/tournee/${d}`, 'Jour')}${o('semaine', `#/semaine/${lundiDe(d)}`, 'Semaine')}${o('secteur', '#/plan', 'Secteur')}</nav>`;
}
