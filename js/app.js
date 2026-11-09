// ─────────────────────────────────────────────────────────────────────────────
// Cap Secteur — point d'entrée : navigation entre les écrans.
// Pour ajouter un écran : crée js/views/mon-ecran.js (export render(el, params))
// puis ajoute une ligne dans ROUTES.
// ─────────────────────────────────────────────────────────────────────────────
import { persistStorage, chargerProfil } from './db.js';
import { $, $$, esc, animerEntree } from './ui.js';

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
  [/^\/compte$/, 'reglages', () => import('./views/compte.js')],
  [/^\/bienvenue$/, 'aujourdhui', () => import('./views/bienvenue.js')],
];

let current = null;

async function route(_, { garder = false } = {}) {
  if (/[#&](access_token|error_description)=/.test(location.hash)) {   // lien reçu par mail ouvert dans un onglet déjà ouvert
    const n = await import('./services/nuage.js'); await n.lireConfig();
    window.__retourMail = await n.lireRetourMail().catch(() => null);
  }
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
    if (garder) delete main.dataset.entree; else main.dataset.entree = '1';   // les écrans animent leur carte seulement à l'arrivée
    await current.render(main, params);
    if (!params.keepScroll && !garder) window.scrollTo(0, 0);
    if (!garder) animerEntree(main);
    delete main.dataset.entree;
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
// retour d'un lien reçu par mail (confirmation de compte, mot de passe oublié)
const nuage = await import('./services/nuage.js');
await nuage.lireConfig();
window.__retourMail = await nuage.lireRetourMail().catch(() => null);
// appareil vierge : écran de premier démarrage
if (!window.__retourMail && /^#?\/?$/.test(location.hash)) {
  try { if (await (await import('./views/bienvenue.js')).aMontrer()) history.replaceState(null, '', location.pathname + '#/bienvenue'); } catch { /* accueil normal */ }
}
route();
// synchronisation automatique entre appareils (si un compte est configuré)
import('./services/synchro.js').then(({ demarrer }) => demarrer());
// étapes cochées « visité » avant la v1.8.4 : la visite manquante est créée (une fois, puis plus rien à faire)
import('./services/visite.js').then(({ rattraperVisites }) => rattraperVisites()).then(n => { if (n) route(null, { garder: true }); }).catch(() => {});
// petit indicateur de synchronisation (visible seulement si elle dure ou si quelque chose a été échangé)
{
  const ind = document.createElement('div');
  ind.className = 'sync-ind'; ind.hidden = true; ind.setAttribute('role', 'status');
  ind.innerHTML = `<svg viewBox="0 0 40 40" aria-hidden="true" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 30h19a7 7 0 0 0 .5-14A10 10 0 0 0 11 18a6 6 0 0 0 0 12z"/>
    <g class="fleches"><path d="M16 23a4 4 0 0 1 7-2.6M24 23a4 4 0 0 1-7 2.6"/><path d="M23 18v2.5h-2.5M17 28v-2.5h2.5"/></g>
    <path class="coche" d="M15 23.5l3.5 3.5 6.5-7"/></svg><span></span>`;
  document.body.append(ind);
  let montre = null, cache = null;
  addEventListener('cap-synchro-etat', ({ detail: d }) => {
    clearTimeout(cache);
    if (d.enCours) {
      ind.classList.remove('fini'); ind.querySelector('span').textContent = 'Synchronisation…';
      montre = setTimeout(() => { ind.hidden = false; ind.classList.add('tourne'); }, 700);
      return;
    }
    clearTimeout(montre);
    if (d.erreur || (ind.hidden && !d.echanges)) { ind.hidden = true; ind.classList.remove('tourne'); return; }
    ind.hidden = false; ind.classList.remove('tourne'); ind.classList.add('fini'); ind.querySelector('span').textContent = 'À jour';
    cache = setTimeout(() => { ind.hidden = true; ind.classList.remove('fini'); }, 1800);
  });
}
addEventListener('cap-synchro', async () => {
  // données reçues d'un autre appareil : on rafraîchit l'écran, sauf pendant une saisie
  const actif = document.activeElement;
  if (document.querySelector('dialog[open]') || (actif && /INPUT|TEXTAREA|SELECT/.test(actif.tagName))) return;
  const y = scrollY; await chargerProfil(); await route(null, { garder: true }); scrollTo(0, y);
});
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
