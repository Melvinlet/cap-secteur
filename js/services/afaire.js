// « À faire » notés dans les comptes rendus (champ « À faire / prochaine étape ») :
// ils restent ouverts jusqu'à ce qu'on les coche, et réapparaissent quand le magasin revient dans la tournée.
import { db } from '../db.js';
import { esc, fmtDate, today } from '../ui.js';

export const estOuvert = n => !!(n.aFaire || '').trim() && !n.aFaireFait;

// magasinId → à faire ouverts (le plus ancien d'abord)
export async function aFaireOuverts() {
  const r = new Map();
  for (const n of (await db.all('notes')).filter(estOuvert).sort((a, b) => a.date.localeCompare(b.date))) {
    if (!r.has(n.magasinId)) r.set(n.magasinId, []);
    r.get(n.magasinId).push(n);
  }
  return r;
}

export async function marquerFait(noteId, fait = true) {
  const n = await db.get('notes', noteId);
  if (!n) return;
  await db.put('notes', { ...n, aFaireFait: fait ? today() : undefined, maj: new Date().toISOString() });
}

// Liste cochable (data-afaire = id de la note) ; à brancher avec brancherCoches()
export const listeAFaire = (notes, { magasin } = {}) => `<ul class="plain afaire-liste">${notes.map(n => `<li>
  <label class="check"><input type="checkbox" data-afaire="${esc(n.id)}"> <span>${esc(n.aFaire)}</span></label>
  <small class="muted">${magasin ? `${esc(magasin(n.magasinId) || '')} · ` : ''}noté le ${fmtDate(n.date)}${n.echeance ? ` · <span class="${n.echeance < today() ? 'late-txt' : ''}">pour le ${fmtDate(n.echeance)}</span>` : ''}</small></li>`).join('')}</ul>`;

export function brancherCoches(racine, apres) {
  racine.querySelectorAll('[data-afaire]').forEach(c => c.onchange = async () => {
    await marquerFait(c.dataset.afaire, c.checked);
    c.closest('li')?.classList.toggle('fait', c.checked);
    apres?.(c.dataset.afaire, c.checked);
  });
}
