// Animation d'ouverture de Cap Secteur : le chapeau jaune tombe et se clipse (moelleux) sur la borne,
// qui démarre en se cabrant sur son coin bas gauche, retombe, freine au centre ; puis fondu sur l'appli.
// Une seule fois par lancement (pas en changeant de page) ; un appui la passe ; « mouvements réduits » = simple fondu.
(() => {
  const o = document.getElementById('ouverture');
  if (!o) return;
  let deja = false;
  try { deja = sessionStorage.getItem('capOuverture') === '1'; sessionStorage.setItem('capOuverture', '1'); } catch { /* stockage indisponible : on joue */ }
  if (deja || !o.animate) { o.remove(); return; }
  o.hidden = false;
  const T = 2500;   // durée totale (ms)
  const ease = { tombe: 'cubic-bezier(.55,0,1,.45)', sort: 'cubic-bezier(.2,.8,.2,1)', acc: 'cubic-bezier(.5,0,.75,0)', lin: 'linear' };
  const $ = s => o.querySelector(s);

  function jouer({ vitesse = 1, reduit = false } = {}) {
    const anims = [];
    const A = (el, images, opts) => { const a = el.animate(images, { duration: T, fill: 'both', ...opts }); anims.push(a); return a; };

    if (reduit) {   // réglage « mouvements réduits » : simple fondu, sans déplacement
      A($('#ov-roule'), [{ opacity: 0 }, { opacity: 1, offset: .3 }, { opacity: 1 }]);
      A($('#ov-chapeau'), [{ transform: 'none' }, { transform: 'none' }]);
      A(o, [{ opacity: 1 }, { opacity: 1, offset: .7 }, { opacity: 0 }]);
    } else {
      // Seul le clip est moelleux ; ensuite la borne reste rigide et bouge d'un seul bloc.
      // 1. le clip (0 → 0,8 s) : le chapeau tombe tout droit d'en haut, et au contact les deux parties
      //    s'écrasent l'une sur l'autre puis rebondissent, moelleux, avant de se stabiliser
      A($('#ov-chapeau'), [
        { transform: 'translate(0,-340px) scale(1,1)', opacity: 0, offset: 0 },
        { transform: 'translate(0,-300px) scale(.97,1.05)', opacity: 1, offset: .04, easing: ease.tombe },   // légèrement étiré par la chute
        { transform: 'translate(0,0) scale(.97,1.05)', offset: .22, easing: ease.sort },                   // 550 ms : contact
        { transform: 'translate(0,10px) scale(1.12,.78)', offset: .245, easing: 'ease-out' },              // s'écrase (la borne aussi, d'où le +10)
        { transform: 'translate(0,-5px) scale(.94,1.09)', offset: .275, easing: 'ease-in-out' },           // rebondit en s'étirant
        { transform: 'translate(0,3px) scale(1.04,.95)', offset: .3, easing: 'ease-in-out' },
        { transform: 'translate(0,-1px) scale(.99,1.02)', offset: .32, easing: 'ease-in-out' },
        { transform: 'translate(0,0) scale(1,1)', offset: .34 },                                            // stabilisé
        { transform: 'translate(0,0) scale(1,1)', offset: 1 },
      ]);
      A($('#ov-corps'), [
        { transform: 'scale(1,1)', offset: 0 },
        { transform: 'scale(1,1)', offset: .22, easing: 'ease-out' },
        { transform: 'scale(1.05,.94)', offset: .245, easing: 'ease-in-out' },     // encaisse le choc
        { transform: 'scale(.98,1.03)', offset: .275, easing: 'ease-in-out' },
        { transform: 'scale(1.015,.985)', offset: .3, easing: 'ease-in-out' },
        { transform: 'scale(1,1)', offset: .34 },
        { transform: 'scale(1,1)', offset: 1 },
      ]);
      // 2. le départ (0,9 → 2 s) : elle roule vers la droite en partant de la gauche et finit au centre
      A($('#ov-roule'), [
        { transform: 'translateX(-120px)', offset: 0 },
        { transform: 'translateX(-120px)', offset: .36, easing: 'cubic-bezier(.6,0,.9,.6)' },   // accélère fort
        { transform: 'translateX(-30px)', offset: .62, easing: 'cubic-bezier(.2,.6,.3,1)' },
        { transform: 'translateX(0)', offset: .78 },                                              // freine jusqu'au centre
        { transform: 'translateX(0)', offset: 1 },
      ]);
      // à l'accélération, elle se cabre sur son coin bas gauche : le coin bas droit décolle, puis elle retombe
      A($('#ov-cabre'), [
        { transform: 'rotate(0deg)', offset: 0 },
        { transform: 'rotate(0deg)', offset: .36, easing: ease.sort },
        { transform: 'rotate(-12deg)', offset: .45, easing: 'ease-in-out' },     // l'avant se lève
        { transform: 'rotate(-10deg)', offset: .56, easing: ease.tombe },        // tenu pendant l'accélération
        { transform: 'rotate(0deg)', offset: .64, easing: ease.sort },           // retombe sur le sol
        { transform: 'rotate(-2.5deg)', offset: .675, easing: ease.tombe },      // petit rebond
        { transform: 'rotate(0deg)', offset: .71 },
        { transform: 'rotate(0deg)', offset: 1 },
      ]);
      // au freinage, elle pique légèrement du nez sur son coin bas droit, puis se pose
      A($('#ov-freine'), [
        { transform: 'rotate(0deg)', offset: 0 },
        { transform: 'rotate(0deg)', offset: .72, easing: ease.sort },
        { transform: 'rotate(4deg)', offset: .78, easing: 'ease-in-out' },
        { transform: 'rotate(0deg)', offset: .85 },
        { transform: 'rotate(0deg)', offset: 1 },
      ]);
      // l'ombre au sol rétrécit quand l'avant est en l'air
      A($('#ov-ombre'), [
        { transform: 'scaleX(1)', opacity: .35, offset: 0 }, { transform: 'scaleX(1)', opacity: .35, offset: .36 },
        { transform: 'scaleX(.72)', opacity: .25, offset: .45 }, { transform: 'scaleX(.76)', opacity: .27, offset: .56 },
        { transform: 'scaleX(1)', opacity: .35, offset: .64 }, { transform: 'scaleX(1)', opacity: .35, offset: 1 },
      ]);
      // le « clac » : un éclair blanc sur la jointure
      A($('#ov-clip'), [{ opacity: 0, offset: 0 }, { opacity: 0, offset: .32 }, { opacity: .95, offset: .335 }, { opacity: 0, offset: .39 }, { opacity: 0 }]);   // « clac » une fois stabilisé
      // traits de vitesse pendant l'accélération
      o.querySelectorAll('.vitesse').forEach((l, i) => A(l, [
        { opacity: 0, transform: 'translateX(-60px) scaleX(.1)', offset: 0 },
        { opacity: 0, transform: 'translateX(-60px) scaleX(.1)', offset: .4 + i * .02 },
        { opacity: 1, transform: 'translateX(-20px) scaleX(1)', offset: .48 + i * .02, easing: ease.lin },
        { opacity: .9, transform: 'translateX(10px) scaleX(1.1)', offset: .6 + i * .015 },
        { opacity: 0, transform: 'translateX(-30px) scaleX(.4)', offset: .7 + i * .015 },
        { opacity: 0, transform: 'translateX(-30px) scaleX(.4)', offset: 1 },
      ]));
      // fondu de l'écran bleu : l'appli apparaît derrière
      A(o, [{ opacity: 1, offset: 0 }, { opacity: 1, offset: .88 }, { opacity: 0, offset: 1 }], { easing: ease.lin });
    }
    anims.forEach(a => { a.playbackRate = vitesse; });
    anims.at(-1).onfinish = () => o.remove();
    o.onclick = () => { anims.forEach(a => a.finish()); };   // un appui passe l'animation
  }

  jouer({ reduit: matchMedia('(prefers-reduced-motion: reduce)').matches });
})();
