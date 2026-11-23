// Écran de lancement de Cap Secteur. La borne reste au centre : le chapeau jaune tombe et se clipse (moelleux),
// puis elle démarre sur place (elle se cabre, les traits de vitesse filent derrière), freine et pique du nez :
// on devine le déplacement sans la voir traverser l'écran. Dessous : le titre, une barre de chargement et une phrase
// différente à chaque lancement, affichée assez longtemps pour être lue. L'écran attend que l'appli soit prête
// (événement « cap-pret »). Une seule fois par lancement ; un appui le passe ; « mouvements réduits » = simples fondus.
(() => {
  const o = document.getElementById('ouverture');
  if (!o) return;
  let deja = false;
  try { deja = sessionStorage.getItem('capOuverture') === '1'; sessionStorage.setItem('capOuverture', '1'); } catch { /* stockage indisponible : on joue */ }
  if (deja || !o.animate) { o.remove(); return; }

  const PHRASES = [
    'On fait le plein et on prend la route.',
    'Café chargé, GPS prêt.',
    'On vérifie les horaires d\'ouverture des magasins.',
    'Les rendez-vous se rangent dans le bon ordre.',
    'On compte les kilomètres à ta place.',
    'Waze s\'étire avant la journée.',
    'Les robots aspirateurs font une dernière vérif.',
    'Petit tour des « à faire » avant de partir.',
    'On range les comptes rendus d\'hier.',
    'On cherche une place sur le parking du magasin.',
    'Ceinture attachée, rétros réglés.',
    'On recharge les itinéraires.',
    'Le secteur Ouest se réveille.',
    'On cire la voiture de fonction.',
  ];
  let n = Math.floor(Math.random() * PHRASES.length);
  try { const prec = Number(localStorage.getItem('cap-phrase')); if (n === prec) n = (n + 1) % PHRASES.length; localStorage.setItem('cap-phrase', n); } catch { /* */ }
  const phrase = PHRASES[n];
  o.querySelector('.ov-phrase').textContent = phrase;

  o.hidden = false;
  const reduit = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const T = 2500;   // durée de l'animation de la borne (ms)
  const APPARITION_PHRASE = 500;
  const LECTURE = Math.max(2600, phrase.length * 60);   // temps minimum pour lire la phrase
  const ease = { tombe: 'cubic-bezier(.55,0,1,.45)', sort: 'cubic-bezier(.2,.8,.2,1)', lin: 'linear' };
  const ressort = 'cubic-bezier(.2, .9, .25, 1)';
  const $ = s => o.querySelector(s);
  const debut = performance.now();
  const anims = [];
  const A = (el, images, opts) => { const a = el.animate(images, { duration: T, fill: 'both', ...opts }); anims.push(a); return a; };

  if (reduit) {
    A($('.ov-scene'), [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
  } else {
    // 1. le clip (0 → 0,85 s) : le chapeau tombe tout droit, les deux parties s'écrasent puis rebondissent
    A($('#ov-chapeau'), [
      { transform: 'translate(0,-340px) scale(1,1)', opacity: 0, offset: 0 },
      { transform: 'translate(0,-300px) scale(.97,1.05)', opacity: 1, offset: .04, easing: ease.tombe },
      { transform: 'translate(0,0) scale(.97,1.05)', offset: .22, easing: ease.sort },
      { transform: 'translate(0,10px) scale(1.12,.78)', offset: .245, easing: 'ease-out' },
      { transform: 'translate(0,-5px) scale(.94,1.09)', offset: .275, easing: 'ease-in-out' },
      { transform: 'translate(0,3px) scale(1.04,.95)', offset: .3, easing: 'ease-in-out' },
      { transform: 'translate(0,-1px) scale(.99,1.02)', offset: .32, easing: 'ease-in-out' },
      { transform: 'translate(0,0) scale(1,1)', offset: .34 },
      { transform: 'translate(0,0) scale(1,1)', offset: 1 },
    ]);
    A($('#ov-corps'), [
      { transform: 'scale(1,1)', opacity: 0, offset: 0 },
      { transform: 'scale(1,1)', opacity: 1, offset: .06 },
      { transform: 'scale(1,1)', offset: .22, easing: 'ease-out' },
      { transform: 'scale(1.05,.94)', offset: .245, easing: 'ease-in-out' },
      { transform: 'scale(.98,1.03)', offset: .275, easing: 'ease-in-out' },
      { transform: 'scale(1.015,.985)', offset: .3, easing: 'ease-in-out' },
      { transform: 'scale(1,1)', offset: .34 },
      { transform: 'scale(1,1)', offset: 1 },
    ]);
    // 2. le départ, sur place : à l'accélération elle se cabre sur son coin bas gauche, puis retombe
    A($('#ov-cabre'), [
      { transform: 'rotate(0deg)', offset: 0 },
      { transform: 'rotate(0deg)', offset: .36, easing: ease.sort },
      { transform: 'rotate(-12deg)', offset: .45, easing: 'ease-in-out' },
      { transform: 'rotate(-10deg)', offset: .56, easing: ease.tombe },
      { transform: 'rotate(0deg)', offset: .64, easing: ease.sort },
      { transform: 'rotate(-2.5deg)', offset: .675, easing: ease.tombe },
      { transform: 'rotate(0deg)', offset: .71 },
      { transform: 'rotate(0deg)', offset: 1 },
    ]);
    // tout le bloc recule un peu à l'accélération et avance au freinage : juste assez pour sentir l'élan
    A($('#ov-roule'), [
      { transform: 'translateX(0)', offset: 0 },
      { transform: 'translateX(0)', offset: .36, easing: 'ease-out' },
      { transform: 'translateX(-10px)', offset: .5, easing: 'ease-in-out' },
      { transform: 'translateX(6px)', offset: .76, easing: ease.sort },
      { transform: 'translateX(0)', offset: .86 },
      { transform: 'translateX(0)', offset: 1 },
    ]);
    // 3. le freinage : elle pique légèrement du nez sur son coin bas droit, puis se pose
    A($('#ov-freine'), [
      { transform: 'rotate(0deg)', offset: 0 },
      { transform: 'rotate(0deg)', offset: .72, easing: ease.sort },
      { transform: 'rotate(4deg)', offset: .78, easing: 'ease-in-out' },
      { transform: 'rotate(0deg)', offset: .85 },
      { transform: 'rotate(0deg)', offset: 1 },
    ]);
    A($('#ov-ombre'), [
      { transform: 'scaleX(1)', opacity: .35, offset: 0 }, { transform: 'scaleX(1)', opacity: .35, offset: .36 },
      { transform: 'scaleX(.72)', opacity: .25, offset: .45 }, { transform: 'scaleX(.76)', opacity: .27, offset: .56 },
      { transform: 'scaleX(1)', opacity: .35, offset: .64 }, { transform: 'scaleX(1)', opacity: .35, offset: 1 },
    ]);
    A($('#ov-clip'), [{ opacity: 0, offset: 0 }, { opacity: 0, offset: .32 }, { opacity: .95, offset: .335 }, { opacity: 0, offset: .39 }, { opacity: 0 }]);
    // traits de vitesse : ils filent derrière elle pendant l'accélération (c'est eux qui « font » le déplacement)
    o.querySelectorAll('.vitesse').forEach((l, i) => A(l, [
      { opacity: 0, transform: 'translateX(40px) scaleX(.1)', offset: 0 },
      { opacity: 0, transform: 'translateX(40px) scaleX(.1)', offset: .38 + i * .02 },
      { opacity: 1, transform: 'translateX(0) scaleX(1)', offset: .46 + i * .02, easing: ease.lin },
      { opacity: .9, transform: 'translateX(-40px) scaleX(1.15)', offset: .6 + i * .015 },
      { opacity: 0, transform: 'translateX(-90px) scaleX(.5)', offset: .72 + i * .015 },
      { opacity: 0, transform: 'translateX(-90px) scaleX(.5)', offset: 1 },
    ]));
    A($('.ov-titre'), [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 450, delay: 250, easing: ressort });
    A($('.ov-barre'), [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 350 });
    A($('.ov-phrase'), [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: APPARITION_PHRASE, easing: ressort });
  }

  // la barre avance pendant l'animation, se termine quand l'appli est prête ET la phrase lue
  const DUREE_MIN = reduit ? APPARITION_PHRASE + LECTURE - 600 : Math.max(T, APPARITION_PHRASE + LECTURE);
  const barre = $('.ov-barre i');
  const remplir = barre.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(.9)' }], { duration: DUREE_MIN - 350, delay: 350, easing: 'cubic-bezier(.35, .6, .5, 1)', fill: 'both' });

  let pret = false, fini = false;
  const terminer = (vite = false) => {
    if (fini) return; fini = true;
    remplir.pause();
    const actuel = getComputedStyle(barre).transform;
    barre.animate([{ transform: actuel }, { transform: 'scaleX(1)' }], { duration: vite ? 80 : 280, easing: 'ease-out', fill: 'both' }).onfinish = () => {
      const f = o.animate([{ opacity: 1 }, { opacity: 0 }], { duration: vite ? 150 : 420, easing: 'ease-in', fill: 'both' });
      if (!reduit) $('.ov-scene').animate([{ transform: 'none' }, { transform: 'scale(1.05)' }], { duration: 420, easing: 'ease-in', fill: 'both' });
      f.onfinish = () => o.remove();
    };
  };
  const peutFinir = () => { if (pret && performance.now() - debut >= DUREE_MIN) terminer(); };
  addEventListener('cap-pret', () => { pret = true; peutFinir(); }, { once: true });
  setTimeout(peutFinir, DUREE_MIN + 20);
  setTimeout(() => terminer(), Math.max(DUREE_MIN, 7000));   // au cas où l'appli tarde : jamais plus de 7 s
  o.onclick = () => { anims.forEach(a => a.finish()); terminer(true); };
})();
