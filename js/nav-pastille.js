// Menu : la pastille de l'onglet actif glisse d'un onglet à l'autre (comme la barre d'onglets iOS).
// Une seule pastille, déplacée en transform (fluide, sans relayout). Mouvements réduits : elle saute.
let pastille = null;

export function placerPastille({ animer = true } = {}) {
  const nav = document.querySelector('.nav');
  if (!nav) return;
  if (!pastille) {
    pastille = document.createElement('span');
    pastille.className = 'nav-pastille';
    pastille.setAttribute('aria-hidden', 'true');
    nav.prepend(pastille);
    animer = false;
    addEventListener('resize', () => placerPastille({ animer: false }));
  }
  const actif = nav.querySelector('a[aria-current]');
  if (!actif || !actif.offsetParent) { pastille.style.opacity = '0'; return; }
  const n = nav.getBoundingClientRect(), a = actif.getBoundingClientRect();
  pastille.classList.toggle('sans-anim', !animer);
  pastille.style.opacity = '1';
  pastille.style.width = `${a.width}px`;
  pastille.style.height = `${a.height}px`;
  pastille.style.transform = `translate(${a.left - n.left - nav.clientLeft}px, ${a.top - n.top - nav.clientTop}px)`;
}
