// Catalogue produits : vitrine à montrer en magasin (sans prix).
import { db } from '../db.js';
import { $, $$, esc, norm } from '../ui.js';
import { ENSEIGNES_LISTE } from '../config.js';
import { imageURL } from '../services/images.js';
import { editProduit } from './produit.js';

let filtre = { q: '', gamme: '', ens: '' };

export async function render(el) {
  const produits = (await db.all('produits')).sort((a, b) => (a.ordre ?? 999) - (b.ordre ?? 999) || a.nom.localeCompare(b.nom));
  const gammes = [...new Set(produits.map(p => p.gamme).filter(Boolean))].sort();
  el.innerHTML = `<div class="page wide">
    <header class="page-head"><h1>Catalogue</h1><button class="btn primary" id="new">Nouveau produit</button></header>
    ${produits.length ? `<div class="filters cat">
      <input type="search" id="q" placeholder="Rechercher un produit, une référence…" value="${esc(filtre.q)}" aria-label="Rechercher">
      <div class="chips" role="group" aria-label="Gammes"><button class="chip" data-g="" aria-pressed="${!filtre.gamme}">Toutes</button>
      ${gammes.map(g => `<button class="chip" data-g="${esc(g)}" aria-pressed="${filtre.gamme === g}">${esc(g)}</button>`).join('')}</div>
      <select id="ens" aria-label="Enseigne"><option value="">Toutes les enseignes</option>${ENSEIGNES_LISTE.map(e => `<option ${filtre.ens === e ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></div>
      <div class="products" id="grid"></div>`
    : `<div class="empty"><p>Ton catalogue est vide. Ajoute tes produits avec leurs photos et leurs points forts : tu pourras les présenter en plein écran aux chefs de rayon, même sans réseau.</p>
       <p class="muted">Le catalogue de ton entreprise arrive avec le kit entreprise (<a href="#/compte">Compte et équipe</a>). Un collègue t'a envoyé un pack catalogue ? Importe-le dans Réglages → Avancé.</p></div>`}
  </div>`;
  $('#new').onclick = async () => { const p = await editProduit(); if (p) location.hash = `#/produit/${p.id}`; };
  if (!produits.length) return;

  const apply = async () => {
    const q = norm(filtre.q);
    const list = produits.filter(p => (!filtre.gamme || p.gamme === filtre.gamme) && (!filtre.ens || !p.enseignes?.length || p.enseignes.includes(filtre.ens)) && (!q || norm(`${p.nom} ${p.ref} ${p.gamme} ${p.marque} ${p.accroche}`).includes(q)));
    const imgs = await Promise.all(list.map(async p => (await imageURL(db, p.images?.[0])) || p.imagesWeb?.[0]));
    $('#grid').innerHTML = list.map((p, i) => `<a class="product" href="#/produit/${p.id}">
      <span class="ph">${imgs[i] ? `<img src="${esc(imgs[i])}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="noimg">${esc(p.ref || 'Pas de photo')}</span>`}</span>
      <span class="p-body">${p.marque ? `<span class="p-brand">${esc(p.marque)}</span>` : ''}<strong>${esc(p.nom)}</strong>
      ${p.accroche ? `<span class="muted">${esc(p.accroche)}</span>` : ''}${p.ref ? `<small>Réf. ${esc(p.ref)}</small>` : ''}</span></a>`).join('') || '<p class="empty">Aucun produit ne correspond.</p>';
  };
  $('#q').oninput = e => { filtre.q = e.target.value; apply(); };
  $('#ens').onchange = e => { filtre.ens = e.target.value; apply(); };
  $$('[data-g]').forEach(b => b.onclick = () => { filtre.gamme = b.dataset.g; $$('[data-g]').forEach(x => x.setAttribute('aria-pressed', x === b)); apply(); });
  apply();
}
