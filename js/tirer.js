// « Tirer pour actualiser » (téléphone) : en haut d'un écran, tirer vers le bas puis relâcher
// lance une synchronisation (si un compte est configuré) et redessine l'écran.
import { vibrer } from './ui.js';

const SEUIL = 72;
let depY = null, dy = 0, ind = null, occupe = false;

const exclu = el => !!el.closest('dialog, .leaflet-container, .week, .chips-defile, .seg, .tabs, input, textarea, select, .barre-titre');

function indicateur() {
  if (ind) return ind;
  ind = document.createElement('div');
  ind.className = 'tirer'; ind.setAttribute('aria-hidden', 'true');
  ind.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 5v11M7 11l5 5 5-5"/></svg>';
  document.body.append(ind);
  return ind;
}

export function initTirer(rafraichir) {
  if (!('ontouchstart' in window)) return;
  addEventListener('touchstart', e => {
    if (occupe || scrollY > 0 || e.touches.length !== 1 || exclu(e.target)) { depY = null; return; }
    depY = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  addEventListener('touchmove', e => {
    if (depY == null) return;
    dy = Math.max(0, e.touches[0].clientY - depY);
    if (scrollY > 0) { depY = null; return; }
    const i = indicateur(), d = Math.min(110, dy * .5);
    i.style.transition = 'none';
    i.style.opacity = Math.min(1, dy / SEUIL);
    i.style.transform = `translate(-50%, ${d}px) rotate(${dy >= SEUIL ? 180 : 0}deg)`;
    i.classList.toggle('pret', dy >= SEUIL);
  }, { passive: true });
  addEventListener('touchend', async () => {
    if (depY == null || !ind) { depY = null; return; }
    const ok = dy >= SEUIL; depY = null;
    ind.style.transition = '';
    if (!ok) { ind.style.opacity = '0'; ind.style.transform = 'translate(-50%, 0)'; return; }
    occupe = true; vibrer(8);
    ind.classList.add('tourne'); ind.style.transform = 'translate(-50%, 46px)';
    try {
      const { synchroniser } = await import('./services/synchro.js');
      await Promise.race([synchroniser(), new Promise(r => setTimeout(r, 8000))]);
    } catch { /* hors ligne : on redessine quand même */ }
    await rafraichir();
    ind.classList.remove('tourne', 'pret'); ind.style.opacity = '0'; ind.style.transform = 'translate(-50%, 0)';
    occupe = false;
  });
}
