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
    // la barre change de taille (polices chargées, rotation, barre cachée puis réaffichée) : on replace la pastille
    if ('ResizeObserver' in window) new ResizeObserver(() => placerPastille({ animer: false })).observe(nav);
    document.fonts?.ready.then(() => placerPastille({ animer: false }));
  }
  const actif = nav.querySelector('a[aria-current]');
  if (!actif || !actif.offsetParent) { pastille.style.opacity = '0'; return; }
  // mesures de mise en page (offset*) : insensibles à l'effet d'appui (scale) et au zoom du navigateur
  const x = actif.offsetLeft, y = actif.offsetTop;   // les liens sont des enfants directs de la barre (positionnée)
  pastille.classList.toggle('sans-anim', !animer);
  pastille.style.opacity = '1';
  pastille.style.width = `${actif.offsetWidth}px`;
  pastille.style.height = `${actif.offsetHeight}px`;
  pastille.style.transform = `translate(${x}px, ${y}px)`;
}
