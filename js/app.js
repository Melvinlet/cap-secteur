// ─────────────────────────────────────────────────────────────────────────────
// Cap Secteur — point d'entrée : navigation entre les écrans.
// Pour ajouter un écran : crée js/views/mon-ecran.js (export render(el, params))
// puis ajoute une ligne dans ROUTES.
// ─────────────────────────────────────────────────────────────────────────────
import { persistStorage, chargerProfil } from './db.js';
import { $, $$, esc } from './ui.js';

const ROUTES = [
  [/^\/?$/, 'aujourdhui', () => import('./views/aujourdhui.js')],
  [/^\/tournee(?:\/(\d{4}-\d{2}-\d{2}))?$/, 'tournee', () => import('./views/tournee.js'), ['date']],
  [/^\/plan$/, 'tournee', () => import('./views/plan.js')],
  [/^\/semaine(?:\/(\d{4}-\d{2}-\d{2}))?$/, 'tournee', () => import('./views/semaine.js'), ['lundi']],
  [/^\/rdv$/, 'rdv', () => import('./views/rdv.js')],
  [/^\/cr\/([^/]+)(?:\/([^/]+))?$/, 'magasins', () => import('./views/cr.js'), ['magasin', 'note']],
  [/^\/activite(?:\/(\w+))?$/, 'activite', () => import('./views/activite.js'), ['onglet']],
  [/^\/magasins$/, 'magasins', () => import('./views/magasins.js')],
  [/^\/magasin\/([^/]+)(?:\/(\w+))?$/, 'magasins', () => import('./views/magasin.js'), ['id', 'onglet']],
  [/^\/catalogue$/, 'catalogue', () => import('./views/catalogue.js')],
  [/^\/produit\/([^/]+)$/, 'catalogue', () => import('./views/produit.js'), ['id']],
  [/^\/presenter\/([^/]+)$/, 'catalogue', () => import('./views/presenter.js'), ['id']],
  [/^\/reglages$/, 'reglages', () => import('./views/reglages.js')],
];

let current = null;

async function route() {
  const path = decodeURIComponent(location.hash.replace(/^#/, '').split('?')[0]);
  const query = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''));
  const main = $('#main');
  const hit = ROUTES.find(([re]) => re.test(path));
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  if (current?.destroy) { try { current.destroy(); } catch { /* ignoré */ } }
  if (!hit) { main.innerHTML = `<div class="page"><h1>Page introuvable</h1><p><a href="#/">Revenir à l'accueil</a></p></div>`; return; }
  const [re, nav, loader, names = []] = hit;
  const m = path.match(re);
  const params = { ...query };
  names.forEach((n, i) => { if (m[i + 1]) params[n] = m[i + 1]; });
  $$('.nav a[data-route]').forEach(a => a.toggleAttribute('aria-current', a.dataset.route === nav));
  document.body.dataset.view = nav;
  try {
    current = await loader();
    main.innerHTML = '';
    await current.render(main, params);
    if (!params.keepScroll) window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="page"><h1>Cet écran n'a pas pu s'afficher</h1><p class="muted">${esc(e.message)}</p><p><a href="#/">Revenir à l'accueil</a></p></div>`;
  }
}

function netStatus() { $('#netStatus').hidden = navigator.onLine; }

window.addEventListener('hashchange', route);
window.addEventListener('online', netStatus);
window.addEventListener('offline', netStatus);
netStatus();
persistStorage();
await chargerProfil();   // enseignes, campagne, messages… propres à l'entreprise (stockés sur l'appareil)
route();
// positions : affinage à l'adresse en arrière-plan (quelques secondes après l'ouverture, puis au retour du réseau)
import('./services/affinage.js').then(({ affinerPositions }) => {
  setTimeout(() => affinerPositions(), 8000);
  addEventListener('online', () => setTimeout(() => affinerPositions(), 5000));
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // updateViaCache: 'none' → le navigateur vérifie sw.js à chaque ouverture ; nouvelle version → rechargement automatique
  const avait = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(e => console.warn('Service worker non installé', e));
  let recharge = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!avait || recharge || document.querySelector('dialog[open]')) return;   // pas pendant une saisie
    recharge = true; location.reload();
  });
}
