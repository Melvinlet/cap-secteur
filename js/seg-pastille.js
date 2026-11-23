// Onglets segmentés (Semaine/Mois/Année, Infos/Visites…, Jour/Semaine/Simulation/Secteur…) :
// la pastille blanche glisse d'un choix à l'autre, comme le contrôle segmenté d'iOS.
// Les écrans se redessinent souvent en entier : on garde la dernière position de chaque groupe
// d'onglets pour que la pastille parte de l'ancien choix et glisse vers le nouveau.
const SEL = '.seg, .tabs, .onglets-planning';
const memo = new Map();
let attente = false;

const choisi = seg => seg.querySelector(':scope > [aria-selected="true"], :scope > [aria-pressed="true"], :scope > [aria-current], :scope > .seg-r:has(input:checked)');
const cle = seg => {
  if (seg.classList.contains('onglets-planning')) return 'planning';
  const base = (location.hash.split('?')[0].match(/^#\/[^/]*/) || ['#/'])[0];
  return `${base}|${seg.getAttribute('aria-label') || seg.className}|${seg.children.length}`;
};
const poser = (p, r) => { p.style.width = `${r.w}px`; p.style.height = `${r.h}px`; p.style.transform = `translate(${r.x}px, ${r.y}px)`; };

function placer(seg) {
  const a = choisi(seg);
  let p = seg.querySelector(':scope > .seg-pastille');
  if (!a || !a.offsetParent) { if (p) p.style.opacity = '0'; return; }
  if (!p) { p = document.createElement('span'); p.className = 'seg-pastille'; p.setAttribute('aria-hidden', 'true'); seg.prepend(p); seg.classList.add('seg-anim'); }
  const r = { x: a.offsetLeft, y: a.offsetTop, w: a.offsetWidth, h: a.offsetHeight };
  const k = cle(seg), avant = memo.get(k);
  if (!p.dataset.pose) {
    // nouvelle pastille : elle part de l'ancienne position (écran redessiné) puis glisse
    p.classList.add('sans-anim');
    poser(p, avant && avant.n === seg.children.length ? avant : r);
    p.dataset.pose = '1';
    void p.offsetWidth;   // applique la position de départ avant d'animer
    p.classList.remove('sans-anim');
  }
  p.style.opacity = '1';
  poser(p, r);
  memo.set(k, { ...r, n: seg.children.length });
}

function tout() { attente = false; document.querySelectorAll(SEL).forEach(placer); }
const plus_tard = () => { if (!attente) { attente = true; requestAnimationFrame(tout); } };

export function initSegPastilles() {
  new MutationObserver(plus_tard).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected', 'aria-pressed', 'aria-current'] });
  document.addEventListener('change', e => { if (e.target.closest?.('.seg')) plus_tard(); });
  addEventListener('resize', () => { document.querySelectorAll('.seg-pastille').forEach(p => p.classList.add('sans-anim')); tout(); requestAnimationFrame(() => document.querySelectorAll('.seg-pastille').forEach(p => p.classList.remove('sans-anim'))); });
  document.fonts?.ready.then(plus_tard);
  plus_tard();
}
