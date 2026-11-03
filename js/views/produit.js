// Fiche produit + création / modification.
import { db, uid } from '../db.js';
import { $, $$, esc, modal, confirmer, toast } from '../ui.js';
import { ENSEIGNES_LISTE, PROFIL } from '../config.js';
import { imageURL, reduireImage, oublierImage } from '../services/images.js';

const lignes = t => (t || '').split('\n').map(x => x.trim()).filter(Boolean);

export async function render(el, { id }) {
  const p = await db.get('produits', id);
  if (!p) { el.innerHTML = `<div class="page"><h1>Produit introuvable</h1><p><a href="#/catalogue">Retour au catalogue</a></p></div>`; return; }
  const imgs = [...(await Promise.all((p.images || []).map(i => imageURL(db, i)))).filter(Boolean), ...(p.imagesWeb || [])];
  const sources = lignes(p.sources).map(l => { const [a, b] = l.split(/\s*\|\s*/); return b ? { titre: a, url: b } : { titre: a.replace(/^https?:\/\/(www\.)?/, '').split('/')[0], url: a }; }).filter(s => /^https?:/.test(s.url));
  const carac = lignes(p.caracteristiques).map(l => l.split(/\s*:\s*/));
  el.innerHTML = `<div class="page wide">
    <a class="back" href="#/catalogue">Catalogue</a>
    <div class="product-detail">
      <div class="gallery">
        <div class="main-img">${imgs[0] ? `<img id="big" src="${esc(imgs[0])}" alt="${esc(p.nom)}" referrerpolicy="no-referrer">` : '<span class="noimg">Pas de photo</span>'}</div>
        ${imgs.length > 1 ? `<div class="thumbs">${imgs.map((u, i) => `<button data-i="${i}" aria-label="Photo ${i + 1}"><img src="${esc(u)}" alt="" referrerpolicy="no-referrer" loading="lazy"></button>`).join('')}</div>` : ''}
      </div>
      <div class="p-info">
        ${p.marque || p.gamme ? `<p class="p-brand">${esc([p.marque, p.gamme].filter(Boolean).join(' · '))}</p>` : ''}
        <h1>${esc(p.nom)}</h1>
        ${p.accroche ? `<p class="lead">${esc(p.accroche)}</p>` : ''}
        <div class="actions"><a class="btn primary" href="#/presenter/${p.id}">Présenter en plein écran</a><button class="btn ghost" id="edit">Modifier</button></div>
        ${lignes(p.points).length ? `<ul class="points">${lignes(p.points).map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
        ${p.description ? `<p>${esc(p.description).replace(/\n/g, '<br>')}</p>` : ''}
        ${carac.length ? `<h2 class="h2">Caractéristiques</h2><dl class="kv">${carac.map(([k, ...v]) => v.length ? `<dt>${esc(k)}</dt><dd>${esc(v.join(' : '))}</dd>` : `<dt></dt><dd>${esc(k)}</dd>`).join('')}</dl>` : ''}
        ${p.enseignes?.length ? `<h2 class="h2">Référencé chez</h2><ul class="ref-list">${ENSEIGNES_LISTE.map(e => `<li class="${p.enseignes.includes(e) ? 'on' : 'off'}">${esc(e)}${p.codesEnseigne?.[e] ? ` <small>code ${esc(p.codesEnseigne[e])}</small>` : ''}</li>`).join('')}</ul>` : ''}
        ${sources.length ? `<h2 class="h2">En savoir plus</h2><ul class="plain">${sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.titre)}</a></li>`).join('')}</ul>` : ''}
        <p class="muted">${p.ref ? `Réf. ${esc(p.ref)}` : ''}${p.ean ? ` · EAN ${esc(p.ean)}` : ''}</p>
      </div></div></div>`;
  $$('.thumbs [data-i]').forEach(b => b.onclick = () => { $('#big').src = imgs[+b.dataset.i]; });
  $('#edit').onclick = async () => { const r = await editProduit(p); if (r === 'deleted') location.hash = '#/catalogue'; else if (r) render(el, { id }); };
}

// Formulaire produit. Renvoie le produit enregistré, 'deleted', ou null.
export async function editProduit(p = {}) {
  const existing = await Promise.all((p.images || []).map(async i => ({ id: i, url: await imageURL(db, i) })));
  const prom = modal({ titre: p.id ? 'Modifier le produit' : 'Nouveau produit', large: true, corps: `
    <div class="row"><label class="grow">Nom<input name="nom" value="${esc(p.nom)}" required></label><label>Référence<input name="ref" value="${esc(p.ref)}"></label></div>
    <div class="row"><label>Marque<input name="marque" value="${esc(p.marque)}" list="marques"></label><label>Gamme<input name="gamme" value="${esc(p.gamme)}" placeholder="Famille de produits"></label><label>EAN<input name="ean" value="${esc(p.ean)}"></label></div>
    <datalist id="marques">${(PROFIL.marques || []).map(x => `<option value="${esc(x)}">`).join('')}</datalist>
    <label>Accroche (une phrase)<input name="accroche" value="${esc(p.accroche)}"></label>
    <label>Points forts (un par ligne)<textarea name="points" rows="4">${esc(p.points)}</textarea></label>
    <label>Description<textarea name="description" rows="4">${esc(p.description)}</textarea></label>
    <label>Caractéristiques (une par ligne, « Nom : valeur »)<textarea name="caracteristiques" rows="4" placeholder="Surface : 1 000 m²&#10;Autonomie : 90 min">${esc(p.caracteristiques)}</textarea></label>
    <fieldset><legend>Référencé chez</legend><div class="row">${ENSEIGNES_LISTE.map(e => `<label class="check"><input type="checkbox" name="ens:${esc(e)}" ${(p.enseignes || []).includes(e) ? 'checked' : ''}> ${esc(e)}</label>`).join('')}</div>
      <p class="hint">Sert à ne proposer, dans un magasin, que les produits que son enseigne peut commander.</p></fieldset>
    <fieldset><legend>Photos</legend>
      <div class="img-edit" id="imgs">${existing.map(x => `<span data-img="${x.id}"><img src="${x.url}" alt=""><button type="button" class="btn-icon" aria-label="Retirer la photo">✕</button></span>`).join('')}</div>
      <input type="file" name="_files" id="files" accept="image/*" multiple>
      <p class="hint">La première photo sert de vignette. Les photos sont réduites automatiquement.</p>
      <label>Images depuis le web (une adresse par ligne)<textarea name="imagesWeb" rows="3" placeholder="https://…/photo.jpg">${esc((p.imagesWeb || []).join('\n'))}</textarea></label>
      <p class="hint">Clic droit (ou appui long) sur une photo du site fournisseur → « Copier l'adresse de l'image », puis colle-la ici. Elle est gardée en mémoire pour le mode hors connexion après le premier affichage.
        <a href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent([p.nom, p.ean].filter(Boolean).join(' '))}" target="_blank" rel="noopener">Chercher des images de ce produit</a></p></fieldset>
    <label>Liens utiles (un par ligne, « Titre | adresse »)<textarea name="sources" rows="2" placeholder="Fiche fournisseur | https://…">${esc(p.sources || '')}</textarea></label>
    ${p.id ? '<button type="button" class="btn danger small" id="delP">Supprimer ce produit</button>' : ''}` });
  const removed = new Set();
  let deleted = false;
  $$('#imgs [data-img] button').forEach(b => b.onclick = () => { const s = b.parentElement; removed.add(s.dataset.img); s.remove(); });
  const files = $('#files');
  let picked = [];
  files.onchange = () => { picked = [...files.files]; };
  $('#delP')?.addEventListener('click', async () => {
    $('#delP').closest('dialog').close();
    if (await confirmer('Supprimer le produit', `Supprimer « ${p.nom} » du catalogue ?`)) {
      for (const i of p.images || []) { await db.del('images', i); oublierImage(i); }
      await db.del('produits', p.id); deleted = true; toast('Produit supprimé');
    }
  });
  const r = await prom;
  if (deleted) return 'deleted';
  if (!r) return null;
  delete r._files;
  r.imagesWeb = lignes(r.imagesWeb).filter(u => /^https?:\/\//.test(u));
  r.enseignes = ENSEIGNES_LISTE.filter(e => r['ens:' + e] === 'on');
  for (const e of ENSEIGNES_LISTE) delete r['ens:' + e];
  const images = (p.images || []).filter(i => !removed.has(i));
  for (const i of removed) { await db.del('images', i); oublierImage(i); }
  for (const f of picked) {
    const id = uid('img');
    await db.put('images', { id, blob: await reduireImage(f) });
    images.push(id);
  }
  const out = { ...p, ...r, id: p.id || uid('p'), images, maj: new Date().toISOString() };
  await db.put('produits', out);
  toast('Produit enregistré');
  return out;
}
