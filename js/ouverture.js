// Écran de lancement de Cap Secteur : le logo apparaît au centre (on devine qu'il arrive vite et freine,
// sans le voir traverser l'écran), le titre, une barre de chargement et une petite phrase différente à chaque lancement.
// Il reste le temps que l'appli soit prête derrière (événement « cap-pret »), puis s'efface. Un appui le passe.
// Une seule fois par lancement ; « mouvements réduits » = simples fondus.
(() => {
  const o = document.getElementById('ouverture');
  if (!o) return;
  let deja = false;
  try { deja = sessionStorage.getItem('capOuverture') === '1'; sessionStorage.setItem('capOuverture', '1'); } catch { /* stockage indisponible : on joue */ }
  if (deja || !o.animate) { o.remove(); return; }

  const PHRASES = [
    'On fait le plein et on prend la route.',
    'Les bornes sont alignées, le secteur t\'attend.',
    'Café chargé, GPS prêt.',
    'On vérifie que les magasins ont bien ouvert.',
    'Les rendez-vous se rangent dans le bon ordre.',
    'On compte les kilomètres à ta place.',
    'Waze s\'étire avant la journée.',
    'Les robots aspirateurs font une dernière vérif.',
    'Ta tournée se prépare toute seule.',
    'Petit tour des « à faire » avant de partir.',
    'Les P1 n\'ont qu\'à bien se tenir.',
    'On dépoussière les rayons… façon Dreame.',
    'Le secteur Ouest se réveille.',
    'On cire la voiture de fonction.',
  ];
  let n = Math.floor(Math.random() * PHRASES.length);
  try { const prec = Number(localStorage.getItem('cap-phrase')); if (n === prec) n = (n + 1) % PHRASES.length; localStorage.setItem('cap-phrase', n); } catch { /* */ }
  o.querySelector('.ov-phrase').textContent = PHRASES[n];

  o.hidden = false;
  const reduit = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = s => o.querySelector(s);
  const ressort = 'cubic-bezier(.2, .9, .25, 1)';
  const debut = performance.now();
  const anims = [];
  const A = (el, images, opts) => { const a = el.animate(images, { fill: 'both', ...opts }); anims.push(a); return a; };

  if (reduit) {
    A($('.ov-scene'), [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
  } else {
    // le logo « arrive » : flou de vitesse, léger écrasement, il freine et se pose (déplacement de quelques pixels seulement)
    A($('.ov-logo img'), [
      { opacity: 0, transform: 'translateX(-22px) scale(.9, .94)', filter: 'blur(7px)' },
      { opacity: 1, transform: 'translateX(4px) scale(1.04, .97)', filter: 'blur(0)', offset: .55 },
      { opacity: 1, transform: 'translateX(-1px) scale(.99, 1.01)', offset: .8 },
      { opacity: 1, transform: 'none', filter: 'blur(0)' },
    ], { duration: 720, easing: ressort });
    // traînée lumineuse à gauche du logo : elle s'éteint pendant qu'il freine
    A($('.ov-trainee'), [
      { opacity: 0, transform: 'translateX(10px) scaleX(.3)' },
      { opacity: .9, transform: 'translateX(-6px) scaleX(1)', offset: .35 },
      { opacity: 0, transform: 'translateX(-26px) scaleX(.6)' },
    ], { duration: 620, easing: 'ease-out' });
    A($('.ov-titre'), [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 450, delay: 260, easing: ressort });
    A($('.ov-barre'), [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 380 });
    A($('.ov-phrase'), [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 460, easing: ressort });
  }
  // la barre avance jusqu'à 85 % en attendant l'appli, puis se termine quand elle est prête
  const barre = $('.ov-barre i');
  const remplir = barre.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(.85)' }], { duration: 1500, delay: reduit ? 0 : 380, easing: 'cubic-bezier(.3, .7, .4, 1)', fill: 'both' });

  let fini = false;
  const terminer = (vite = false) => {
    if (fini) return; fini = true;
    const reste = vite ? 0 : Math.max(0, 1500 - (performance.now() - debut));
    setTimeout(() => {
      remplir.pause();
      const actuel = getComputedStyle(barre).transform;
      barre.animate([{ transform: actuel }, { transform: 'scaleX(1)' }], { duration: vite ? 80 : 260, easing: 'ease-out', fill: 'both' }).onfinish = () => {
        const f = o.animate([{ opacity: 1 }, { opacity: 0 }], { duration: vite ? 150 : 380, easing: 'ease-in', fill: 'both' });
        if (!reduit) $('.ov-scene').animate([{ transform: 'none' }, { transform: 'scale(1.06)' }], { duration: 380, easing: 'ease-in', fill: 'both' });
        f.onfinish = () => o.remove();
      };
    }, reste);
  };
  addEventListener('cap-pret', () => terminer(), { once: true });
  setTimeout(() => terminer(), 5000);            // au cas où : jamais plus de 5 s
  o.onclick = () => { anims.forEach(a => a.finish()); terminer(true); };
})();
