// Grand titre qui se réduit (comme sur iPhone) : quand le titre de la page sort de l'écran en défilant,
// une petite barre de verre le rappelle en haut. Un appui dessus remonte en haut de la page.
let barre = null, attente = false;
const TITRES = '#main .page-head h1, #main .hello h1, #main .page > h1, #main .tm-tete .tm-date';

function maj() {
  attente = false;
  const h1 = document.querySelector(TITRES);
  const visible = !!h1 && !document.body.classList.contains('terrain-plein') && h1.getBoundingClientRect().bottom < 4;
  if (visible) { const t = h1.textContent.replace(/\s+/g, ' ').trim(); if (barre.textContent !== t) barre.textContent = t; }
  barre.classList.toggle('visible', visible);
}

export function initBarreTitre() {
  if (barre) return;
  barre = document.createElement('button');
  barre.type = 'button'; barre.className = 'barre-titre'; barre.tabIndex = -1; barre.setAttribute('aria-hidden', 'true');
  barre.onclick = () => scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  document.body.append(barre);
  addEventListener('scroll', () => { if (!attente) { attente = true; requestAnimationFrame(maj); } }, { passive: true });
}
export const majBarreTitre = () => { if (barre) maj(); };
