// Champ « magasin » commun (planifier un RDV, à faire, remplir la journée / la semaine…) :
// une liste de suggestions « Nom — CP Ville » et la recherche tolérante (accents, morceau du nom ou de la ville).
import { esc, norm } from './ui.js';

export const etiquetteMagasin = m => `${m.nom} — ${m.cp || ''} ${m.ville || ''}`.trim();

// <datalist> à placer une fois dans la fenêtre ; l'<input list="id"> s'y rattache
export const datalistMagasins = (id, mags) => `<datalist id="${id}">${mags.map(m => `<option value="${esc(etiquetteMagasin(m))}">`).join('')}</datalist>`;

// Retrouve le magasin saisi : libellé exact, sinon un seul magasin qui contient le texte. null si introuvable ou ambigu.
export function trouverMagasin(txt, mags) {
  const q = norm(txt || '').trim();
  if (!q) return null;
  const exact = mags.find(m => norm(etiquetteMagasin(m)) === q);
  if (exact) return exact;
  const l = mags.filter(m => norm(etiquetteMagasin(m)).includes(q));
  return l.length === 1 ? l[0] : null;
}
export const messageIntrouvable = txt => `Magasin introuvable : « ${txt} ». Choisis-le dans la liste proposée.`;
