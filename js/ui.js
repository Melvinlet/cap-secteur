// Petits outils d'affichage partagés par tous les écrans.
import { ENSEIGNES, ENSEIGNE_AUTRE } from './config.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Échappe le texte avant de l'insérer dans du HTML.
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const enseigneColor = e => {
  for (const [k, c] of Object.entries(ENSEIGNES)) if ((e || '').startsWith(k)) return c;
  return ENSEIGNE_AUTRE;
};

// Pastille de priorité (P1 / P2 / P3 / Hors)
export const prioTag = p => `<span class="prio p${p}" title="Priorité">${({ 0: 'Pause', 4: 'Fermé', 5: 'Refus' })[p] || 'P' + p}</span>`;

// La « borne » : numéro de département façon borne kilométrique.
export const borne = (dep, extra = '') => `<span class="borne ${extra}" title="Département ${esc(dep)}"><span>${esc(dep)}</span></span>`;

export const fmtDate = d => d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const fmtDateLong = d => new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
export const fmtKm = km => km == null ? '–' : (km < 10 ? km.toFixed(1) : Math.round(km)) + ' km';
export const fmtDuree = min => {
  if (min == null) return '–';
  min = Math.round(min);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
};
export const fmtHeure = min => { min = Math.round(min); return `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; };
export const parseHeure = s => { const [h, m] = (s || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
export const today = () => new Date().toISOString().slice(0, 10);
export const joursDepuis = d => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null;
export const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function toast(msg, type = '') {
  document.querySelectorAll('.toast').forEach(x => x.remove());   // un seul message à la fois
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.setAttribute('role', 'status');
  t.textContent = msg;
  const duree = Math.min(6000, Math.max(2600, msg.length * 45));   // les messages longs restent plus longtemps
  t.style.setProperty('--duree', `${duree - 250}ms`);
  document.body.append(t);
  setTimeout(() => t.classList.add('out'), duree);
  setTimeout(() => t.remove(), duree + 300);
}

// ── Animations légères (transform / opacity uniquement ; coupées si « réduire les animations ») ──
export const animationsReduites = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Les chiffres d'un bandeau montent jusqu'à leur valeur (« 186 km », « 2 h 47 », « 17:28 »)
export function animerChiffres(racine) {
  if (animationsReduites()) return;
  racine.querySelectorAll('.tour-sum .big').forEach(b => {
    const final = b.textContent;
    const heure = /^(\d{1,2}):(\d{2})$/.exec(final.trim());
    const nombres = [...final.matchAll(/\d+(?:[.,]\d+)?/g)];
    if (!nombres.length) return;
    const t0 = performance.now(), D = 600;
    const pas = t => {
      if (!b.isConnected) return;
      const k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3);
      if (heure) { const fin = +heure[1] * 60 + +heure[2], v = Math.round(480 + (fin - 480) * e); b.textContent = fin < 480 ? final : `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; }
      else { let i = 0; b.textContent = final.replace(/\d+(?:[.,]\d+)?/g, n => { const v = parseFloat(n.replace(',', '.')) * e; const dec = (n.split(/[.,]/)[1] || '').length; i++; return dec ? v.toFixed(dec).replace('.', n.includes(',') ? ',' : '.') : String(Math.round(v)); }); }
      if (k < 1) requestAnimationFrame(pas); else b.textContent = final;
    };
    requestAnimationFrame(pas);
  });
}
// Entrée d'un écran : fondu + légère montée, listes en cascade, chiffres qui défilent
export function animerEntree(main) {
  if (animationsReduites()) return;
  const vue = main.firstElementChild;
  if (vue) { vue.classList.remove('vue-entre'); void vue.offsetWidth; vue.classList.add('vue-entre'); }
  main.querySelectorAll('.stops > li, .mini-stops > li, .wstops > li').forEach((li, i) => li.style.setProperty('--i', Math.min(i, 12)));
  main.classList.add('anim');
  clearTimeout(main._anim); main._anim = setTimeout(() => main.classList.remove('anim'), 1400);
  animerChiffres(main);
}

// Fenêtre modale : renvoie l'objet des champs du formulaire, ou null si annulé.
export function modal({ titre, corps, valider = 'Enregistrer', danger = false, large = false }) {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'modal' + (large ? ' large' : '');
    d.innerHTML = `<form method="dialog">
      <header><h2>${esc(titre)}</h2><button type="button" class="btn-icon" data-close aria-label="Fermer">✕</button></header>
      <div class="modal-body">${corps}</div>
      <footer><button type="button" class="btn ghost" data-close>Annuler</button>
      <button type="submit" class="btn ${danger ? 'danger' : 'primary'}" value="ok">${esc(valider)}</button></footer></form>`;
    document.body.append(d);
    const form = d.querySelector('form');
    d.querySelectorAll('[data-close]').forEach(b => b.onclick = () => d.close());
    form.onsubmit = e => {
      if (!form.reportValidity()) { e.preventDefault(); return; }
      const data = {};
      new FormData(form).forEach((v, k) => { data[k] = v; });
      d._data = data;
    };
    d.onclose = () => { resolve(d.returnValue === 'ok' ? (d._data || {}) : null); d.remove(); };
    d.showModal();
    if (!matchMedia('(pointer: coarse)').matches) d.querySelector('input:not([type=hidden]),textarea,select')?.focus();   // sur téléphone, pas de clavier qui surgit
  });
}

export const confirmer = (titre, texte, valider = 'Supprimer') =>
  modal({ titre, corps: `<p>${esc(texte)}</p>`, valider, danger: true }).then(r => r !== null);

export function downloadBlob(blob, nom) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nom;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function pickFile(accept, multiple = false) {
  return new Promise(resolve => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept; i.multiple = multiple;
    i.onchange = () => resolve(multiple ? [...i.files] : i.files[0] || null);
    i.click();
  });
}

export const telLink = t => t ? `<a href="tel:${esc(t.replace(/\s/g, ''))}">${esc(t)}</a>` : '';
export const mailLink = m => m ? `<a href="mailto:${esc(m)}">${esc(m)}</a>` : '';

// Dictée vocale (Chrome, Edge, Safari, Android) : le texte dicté s'ajoute à la fin du champ.
export function dictee(champ, bouton) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || !champ || !bouton) return;
  bouton.hidden = false;
  let rec = null;
  bouton.onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = 'fr-FR'; rec.continuous = true; rec.interimResults = false;
    rec.onresult = e => {
      const txt = [...e.results].slice(e.resultIndex).map(r => r[0].transcript).join(' ').trim();
      if (txt) champ.value = (champ.value ? champ.value.replace(/\s*$/, ' ') : '') + txt.charAt(0).toUpperCase() + txt.slice(1);
    };
    rec.onend = () => { rec = null; bouton.textContent = '🎤 Dicter'; bouton.classList.remove('rec'); };
    rec.onerror = ev => { if (ev.error === 'not-allowed') toast('Autorise le micro pour dicter', 'warn'); };
    rec.start();
    bouton.textContent = '■ Arrêter'; bouton.classList.add('rec');
  };
}
