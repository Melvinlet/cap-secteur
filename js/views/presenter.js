// Mode présentation : un produit en grand, à montrer au chef de rayon.
// Flèches / balayage pour passer au produit suivant de la même gamme. Échap pour sortir.
import { db } from '../db.js';
import { esc } from '../ui.js';
import { imageURL } from '../services/images.js';

let onKey;

export async function render(el, { id }) {
  const all = (await db.all('produits')).sort((a, b) => (a.gamme || '').localeCompare(b.gamme || '') || a.nom.localeCompare(b.nom));
  const p = all.find(x => x.id === id);
  if (!p) { location.hash = '#/catalogue'; return; }
  const meme = all.filter(x => x.gamme === p.gamme);
  const idx = meme.indexOf(p);
  const prev = meme[(idx - 1 + meme.length) % meme.length], next = meme[(idx + 1) % meme.length];
  const imgs = [...(await Promise.all((p.images || []).map(i => imageURL(db, i)))).filter(Boolean), ...(p.imagesWeb || [])];
  let k = 0;
  document.body.classList.add('presenting');
  el.innerHTML = `<div class="show">
    <div class="show-img">${imgs.length ? `<img id="si" src="${esc(imgs[0])}" alt="${esc(p.nom)}" referrerpolicy="no-referrer">` : '<span class="noimg">Pas de photo</span>'}
      ${imgs.length > 1 ? `<div class="dots">${imgs.map((_, i) => `<button data-k="${i}" aria-label="Photo ${i + 1}" aria-pressed="${i === 0}"></button>`).join('')}</div>` : ''}</div>
    <div class="show-txt">
      ${p.marque ? `<p class="p-brand">${esc(p.marque)}</p>` : ''}
      <h1>${esc(p.nom)}</h1>
      ${p.accroche ? `<p class="lead">${esc(p.accroche)}</p>` : ''}
      <ul class="points">${(p.points || '').split('\n').filter(l => l.trim()).map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    </div>
    <nav class="show-nav">
      <a href="#/produit/${p.id}" class="btn ghost">Quitter</a>
      ${meme.length > 1 ? `<span class="muted">${idx + 1} / ${meme.length}${p.gamme ? ` · ${esc(p.gamme)}` : ''}</span>
      <a class="btn" href="#/presenter/${prev.id}" aria-label="Produit précédent">‹</a><a class="btn" href="#/presenter/${next.id}" aria-label="Produit suivant">›</a>` : ''}
      <button class="btn ghost" id="fs">Plein écran</button>
    </nav></div>`;
  const setImg = i => { k = (i + imgs.length) % imgs.length; el.querySelector('#si').src = imgs[k]; el.querySelectorAll('.dots button').forEach((b, j) => b.setAttribute('aria-pressed', j === k)); };
  el.querySelectorAll('[data-k]').forEach(b => b.onclick = () => setImg(+b.dataset.k));
  el.querySelector('#fs').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
  onKey = e => {
    if (e.key === 'Escape' && !document.fullscreenElement) location.hash = `#/produit/${p.id}`;
    if (e.key === 'ArrowRight') location.hash = `#/presenter/${next.id}`;
    if (e.key === 'ArrowLeft') location.hash = `#/presenter/${prev.id}`;
    if (e.key === 'ArrowDown' && imgs.length > 1) setImg(k + 1);
    if (e.key === 'ArrowUp' && imgs.length > 1) setImg(k - 1);
  };
  document.addEventListener('keydown', onKey);
  let x0 = null;
  el.ontouchstart = e => { x0 = e.touches[0].clientX; };
  el.ontouchend = e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) < 60) return;
    if (imgs.length > 1) setImg(k + (dx < 0 ? 1 : -1));
    else if (meme.length > 1) location.hash = `#/presenter/${(dx < 0 ? next : prev).id}`;
  };
}

export function destroy() {
  document.body.classList.remove('presenting');
  document.removeEventListener('keydown', onKey);
  if (document.fullscreenElement && !location.hash.startsWith('#/presenter/')) document.exitFullscreen();
}
