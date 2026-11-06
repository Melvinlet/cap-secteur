// Fiche magasin : infos & contacts, visites, stock, commandes, SAV, implantations.
// Aucun prix n'est affiché ni saisi ici.
import { civiliteDevinee } from '../services/civilite.js';
import { db, uid, getSettings } from '../db.js';
import { magasinComplet, dureeVisite, prioriteDe, frequenceDe, produitsPour, numeroVisite, analyseStock, offertsDejaDonnes, roleDe, trierContacts } from '../data.js';
import { $, $$, esc, borne, prioTag, enseigneColor, fmtDate, toast, modal, confirmer, telLink, mailLink, today, downloadBlob } from '../ui.js';
import { STATUTS_SAV, TYPES_NOTE, PRIORITES, STATUTS_VISITE, OBJETS_VISITE, SAISON, ORDRE_PRIORITES, ROLES_CONTACT, PROFIL } from '../config.js';
import { lienGps } from '../services/routing.js';
import { exporterCommande } from '../services/excel.js';
import { ajouterEtape } from './tournee.js';
import { getRdv, labelStatut, dateEnLettres } from '../services/rdv.js';
import { carte, repere } from '../carte.js';
import { imageURL } from '../services/images.js';

const ONGLETS = [['infos', 'Infos'], ['suivi', 'Visites'], ['stock', 'Stock'], ['commandes', 'Commandes'], ['sav', 'SAV'], ['implantations', 'Implantations']];
let map;

export async function render(el, { id, onglet = 'infos' }) {
  onglet = onglet.split('?')[0];
  id = decodeURIComponent(id);
  const d = await magasinComplet(id);
  if (d?.m?.ventes2026 > 0) {   // rang du magasin parmi les vendeurs de la base (unités, aucun montant)
    const v = (await db.all('magasins')).map(x => Number(x.ventes2026) || 0).filter(n => n > 0);
    d.rangVentes = { rang: 1 + v.filter(n => n > d.m.ventes2026).length, sur: v.length };
  }
  if (!d) { el.innerHTML = `<div class="page"><h1>Magasin introuvable</h1><p><a href="#/magasins">Retour à la liste</a></p></div>`; return; }
  const s = await getSettings();
  d.produits = await db.all('produits');
  const { m } = d;
  const stock = analyseStock(d.notes, d.commandes, d.produits);
  const rdv = await getRdv(m.id);
  const rdvDate = rdv.statut === 'autreDate' ? rdv.dateRetenue : rdv.date;
  const cnt = { suivi: d.notes.length, stock: stock.filter(x => x.rupture).length, commandes: d.commandes.length,
    sav: d.sav.filter(x => x.statut !== 'Résolu').length, implantations: d.implantations.length };
  el.innerHTML = `<div class="page">
    <a class="back" href="#/magasins">Magasins</a>
    <header class="store-head" style="--c:${enseigneColor(m.enseigne)}">
      ${borne(m.departement, 'big')}
      <div><p class="store-ens">${esc(m.enseigne)}${m.code ? ` <span class="muted">· code ${esc(m.code)}</span>` : ''}${m.statut ? ` <span class="muted">· ${esc(m.statut)}</span>` : ''}</p>
        <h1>${esc(m.nom)} ${prioTag(prioriteDe(m))}</h1>
        <p class="muted">${esc(m.adresse || '')}${m.adresse ? ', ' : ''}${esc(m.cp)} ${esc(m.ville)}${m.telMagasin ? ` · ${telLink(m.telMagasin)}` : ''}</p></div>
    </header>
    <div class="actions">
      <button class="btn primary" id="visite">Noter une visite</button>
      <a class="btn" href="#/rdv?m=${encodeURIComponent(m.id)}">${rdv.statut === 'aFaire' ? 'Demander un RDV' : `RDV : ${esc(labelStatut(rdv.statut))}${rdvDate && ['acceptee', 'autreDate'].includes(rdv.statut) ? ` le ${esc(dateEnLettres(rdvDate))}${(rdv.statut === 'autreDate' ? rdv.heureRetenue : rdv.heure) ? ' à ' + esc(rdv.statut === 'autreDate' ? rdv.heureRetenue : rdv.heure) : ''}` : ''}`}</a>
      <button class="btn" id="addTour">Ajouter à la tournée du jour</button>
      ${m.lat != null ? `<a class="btn" href="${lienGps(s.gps, m)}" target="_blank" rel="noopener">Y aller (${s.gps === 'google' ? 'Google Maps' : 'Waze'})</a>` : ''}
    </div>
    <nav class="tabs" role="tablist">${ONGLETS.map(([k, l]) => `<a role="tab" href="#/magasin/${encodeURIComponent(id)}/${k}" aria-selected="${k === onglet}">${l}${cnt[k] ? ` <span class="badge ${k === 'stock' ? 'alert' : ''}">${cnt[k]}</span>` : ''}</a>`).join('')}</nav>
    <section id="tab"></section></div>`;

  $('#addTour').onclick = async () => { const r = await ajouterEtape(today(), m.id); toast(r ? 'Ajouté à la tournée du jour' : 'Déjà dans la tournée du jour'); };
  $('#visite').onclick = () => { location.hash = `#/cr/${encodeURIComponent(m.id)}`; };
  ({ infos, suivi, stock: vueStock, commandes, sav, implantations })[onglet]?.($('#tab'), d, s, stock);
}

const rerender = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
const go = h => { if (location.hash === h) rerender(); else location.hash = h; };
const stamp = o => ({ ...o, maj: new Date().toISOString() });
const kv = (k, v) => v ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : '';

// ── Infos & contacts ─────────────────────────────────────────────────────────
function infos(el, { m, contacts, rangVentes }, s) {
  const p = prioriteDe(m);
  el.innerHTML = `
    <div class="grid2">
      <div>
        <h2 class="h2">Contacts <button class="btn small" id="addContact">Ajouter</button></h2>
        <ul class="contacts">${trierContacts(contacts).map(c => `<li>
          <div><strong>${c.principal ? '<span class="star" title="Interlocuteur principal">★</span> ' : ''}${esc(c.nom || 'Contact magasin')}</strong>
          ${roleDe(c) ? `<span class="role">${esc(roleDe(c))}</span>` : ''}${c.fonction && c.fonction.toLowerCase() !== roleDe(c).toLowerCase() ? ` <span class="muted">${esc(c.fonction)}</span>` : ''}
          <div class="links">${telLink(c.tel)} ${telLink(c.tel2)} ${mailLink(c.email)}</div>
          ${c.note ? `<p class="note">${esc(c.note)}</p>` : ''}</div>
          <button class="btn-icon" data-edit="${c.id}" aria-label="Modifier">✎</button></li>`).join('') || '<li class="muted">Aucun contact enregistré.</li>'}</ul>
        ${m.classement || m.remarqueReseau || m.notesReseau || m.meuble || m.ventes2026 != null ? `<h2 class="h2">Infos ${esc(PROFIL.reseau || 'réseau')}</h2><dl class="kv">
          ${m.ventes2026 != null ? kv('Ventes robots 2026', `${m.ventes2026} unité${m.ventes2026 > 1 ? 's' : ''}${rangVentes ? ` · ${rangVentes.rang}${rangVentes.rang === 1 ? "er" : "e"} sur ${rangVentes.sur} magasins vendeurs de ton secteur` : ''}`) : ''}
          ${kv('Classement', m.classement)}${kv('Meuble / PLV', m.meuble)}${kv('Remarque visite', m.remarqueReseau)}${kv('Notes', m.notesReseau)}</dl>` : ''}
      </div>
      <div>
        <h2 class="h2">Informations <button class="btn small" id="editMag">Modifier</button></h2>
        <dl class="kv">
          ${kv('Société', m.societe)}${kv('Code magasin', m.code)}
          ${kv('Priorité', `${PRIORITES[p].label}${m.prioriteManuelle ? ' (choisie par toi)' : m.prioriteRaison && m.prioriteRaison.toLowerCase() !== PRIORITES[p].label.toLowerCase() ? ` (${m.prioriteRaison})` : ''}`)}
          ${kv('Visite', frequenceDe(m, s) ? `tous les ${frequenceDe(m, s)} jours` : 'hors tournées')}
          ${kv('Durée de visite', `${dureeVisite(m, s)} min${m.dureeVisite ? '' : ' (selon l’enseigne)'}`)}${kv('Commentaire', m.commentaire)}${kv('Livraisons', m.livraisons)}
          ${kv('Position', m.lat != null ? (m.precision === 'ville' ? 'Centre de la ville (approximatif)' : m.precision === 'commune' ? 'Centre de la commune (affinée automatiquement à l\'adresse dès que tu as du réseau)' : m.positionManuelle ? 'Placée à la main' : 'Adresse trouvée') : 'Pas encore localisé')}
        </dl>
        <div id="miniMap" class="mini-map"></div>
        <p class="hint">Mauvaise position ? Clique sur la carte à l'endroit exact du magasin.</p>
      </div>
    </div>`;
  $('#addContact').onclick = () => editContact(m);
  $$('[data-edit]').forEach(b => b.onclick = () => editContact(m, contacts.find(c => c.id === b.dataset.edit)));
  $('#editMag').onclick = () => editMagasin(m, s);
  miniCarte(m);
}

async function miniCarte(m) {
  map = await carte($('#miniMap'));
  let mk;
  if (m.lat != null) { mk = repere(m).addTo(map); map.setView([m.lat, m.lon], 14); }
  map.on('click', async e => {
    if (!(await modal({ titre: 'Déplacer le magasin ?', corps: '<p>Placer le magasin à cet endroit sur la carte ?</p>', valider: 'Placer ici' }))) return;
    Object.assign(m, { lat: e.latlng.lat, lon: e.latlng.lng, precision: 'adresse', positionManuelle: true });
    await db.put('magasins', stamp(m));
    mk?.remove(); mk = repere(m).addTo(map);
    toast('Position enregistrée');
  });
}

async function editContact(m, c = {}) {
  const r = await modal({ titre: c.id ? 'Modifier le contact' : 'Nouveau contact', corps: `
    <div class="row"><label>Civilité<select name="civilite"><option value="">Auto${(g => g ? ` (${({ M: 'Monsieur', Mme: 'Madame', MmeM: 'Madame, Monsieur' })[g]})` : '')(civiliteDevinee(c))}</option><option value="M" ${c.civilite === 'M' ? 'selected' : ''}>Monsieur</option><option value="Mme" ${c.civilite === 'Mme' ? 'selected' : ''}>Madame</option><option value="MmeM" ${c.civilite === 'MmeM' ? 'selected' : ''}>Madame, Monsieur</option><option value="aucune" ${c.civilite === 'aucune' ? 'selected' : ''}>Sans</option></select></label>
    <label>Nom<input name="nom" value="${esc(c.nom)}"></label></div>
    <div class="row"><label>Rôle<select name="role"><option value="">—</option>${ROLES_CONTACT.map(r => `<option ${r === roleDe(c) ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
    <label>Précision<input name="fonction" value="${esc(c.fonction)}" placeholder="ex. rayon jardin, adjoint…"></label></div>
    <label class="check"><input type="checkbox" name="principal" ${c.principal ? 'checked' : ''}> Interlocuteur principal (proposé en premier pour les rendez-vous)</label>
    <div class="row"><label>Téléphone<input name="tel" type="tel" value="${esc(c.tel)}"></label>
    <label>Téléphone 2<input name="tel2" type="tel" value="${esc(c.tel2)}"></label></div>
    <label>E-mail<input name="email" type="email" value="${esc(c.email)}"></label>
    <label>Note<textarea name="note" rows="2">${esc(c.note)}</textarea></label>
    ${c.id ? `<button type="button" class="btn danger small" id="delC" data-cid="${esc(c.id)}">Supprimer ce contact</button>` : ''}` });
  if (!r) return;
  r.principal = r.principal === 'on';
  if (!r.civilite) r.civilite = undefined;   // « Auto » : devinée d'après le nom
  const id = c.id || uid('c');
  if (r.principal) for (const x of await db.byMagasin('contacts', m.id)) if (x.id !== id && x.principal) await db.put('contacts', stamp({ ...x, principal: false }));
  await db.put('contacts', stamp({ ...c, ...r, id, magasinId: m.id, source: c.source || 'appli' }));
  rerender();
}
document.addEventListener('click', async e => {
  if (e.target.id !== 'delC') return;
  const id = e.target.dataset.cid;
  e.target.closest('dialog').close();
  const c = await db.get('contacts', id);
  if (c && await confirmer('Supprimer le contact', `Supprimer ${c.nom || 'ce contact'} ?`)) { await db.del('contacts', c.id); rerender(); }
});

async function editMagasin(m, s) {
  const r = await modal({ titre: 'Modifier le magasin', corps: `
    <label>Nom<input name="nom" value="${esc(m.nom)}" required></label>
    <label>Adresse<input name="adresse" value="${esc(m.adresse)}"></label>
    <div class="row"><label>Code postal<input name="cp" value="${esc(m.cp)}" required pattern="\\d{5}"></label><label>Ville<input name="ville" value="${esc(m.ville)}" required></label></div>
    <div class="row"><label>Code magasin<input name="code" value="${esc(m.code)}"></label><label>Téléphone magasin<input name="telMagasin" type="tel" value="${esc(m.telMagasin)}"></label></div>
    <div class="row"><label>Priorité<select name="priorite">
      ${ORDRE_PRIORITES.map(p => `<option value="${p}" ${prioriteDe(m) === p ? 'selected' : ''}>${PRIORITES[p].label} — ${PRIORITES[p].aide}</option>`).join('')}</select></label>
    <label>Visite tous les (jours)<input name="frequence" type="number" min="1" value="${esc(m.frequence || '')}" placeholder="selon la priorité"></label></div>
    <label>Durée de visite (min)<input name="dureeVisite" type="number" min="5" step="5" value="${esc(m.dureeVisite || '')}" placeholder="${dureeVisite({ enseigne: m.enseigne }, s)}"></label>
    <label>Commentaire<textarea name="commentaire" rows="3">${esc(m.commentaire)}</textarea></label>` });
  if (!r) return;
  const adresseChangee = r.adresse !== m.adresse || r.cp !== m.cp || r.ville !== m.ville;
  const p = Number(r.priorite);
  await db.put('magasins', stamp({ ...m, ...r, priorite: p, prioriteManuelle: m.prioriteManuelle || p !== prioriteDe(m),
    ...(adresseChangee ? { lat: null, lon: null, positionManuelle: false } : {}) }));
  rerender();
}

// ── Visites & notes ──────────────────────────────────────────────────────────
function suivi(el, d) {
  const { notes, produits } = d;
  el.innerHTML = `<h2 class="h2">Visites & notes <a class="btn small primary" href="#/cr/${encodeURIComponent(d.m.id)}">Compte rendu de visite</a><button class="btn small" id="addNote">Note / appel</button></h2>
    <ol class="timeline">${notes.map(n => `<li data-type="${esc(n.type)}" data-statut="${esc(n.statut || '')}">
      <div class="tl-head"><strong>${esc(n.type === 'Visite' ? `Visite ${n.numero || ''}` : n.type)}</strong> <time>${fmtDate(n.date)}</time>
      ${n.statut && n.statut !== 'Réalisée' ? `<span class="tag">${esc(n.statut)}</span>` : ''}${n.objet ? `<span class="muted">${esc(n.objet)}</span>` : ''}
      ${n.contact ? `<span class="muted">· avec ${esc(n.contact)}</span>` : ''}<button class="btn-icon" data-id="${n.id}" aria-label="Modifier">✎</button></div>
      ${n.texte ? `<p>${esc(n.texte).replace(/\n/g, '<br>')}</p>` : ''}
      ${n.stock && Object.keys(n.stock).length ? `<p class="muted small">Stock relevé : ${Object.entries(n.stock).map(([pid, q]) => `${esc(produits.find(p => p.id === pid)?.nom || pid)} ${esc(q)}`).join(' · ')}</p>` : ''}
      ${n.actions?.length ? `<p class="acts">${n.actions.map(a => `<span class="tag">${esc(a)}</span>`).join(' ')}</p>` : ''}
      ${n.arrivee || n.depart ? `<p class="muted small">En magasin ${esc(n.arrivee || '?')} – ${esc(n.depart || '?')}</p>` : ''}
      ${n.photos?.length ? `<div class="thumbs-row">${n.photos.slice(0, 6).map(p => `<img data-ph="${esc(p.id)}" alt="${esc(p.etiquette || '')}">`).join('')}${n.photos.length > 6 ? `<span class="muted">+${n.photos.length - 6}</span>` : ''}</div>` : ''}
      ${n.aFaire ? `<p class="todo">À faire : ${esc(n.aFaire)}${n.echeance ? ` (pour le ${fmtDate(n.echeance)})` : ''}</p>` : ''}</li>`).join('') ||
      '<li class="muted">Rien de noté pour ce magasin. Après ta visite, note ce qui s\'est dit, le stock relevé et ce qu\'il reste à faire.</li>'}</ol>`;
  $('#addNote').onclick = () => editNote(d, { type: 'Note' });
  $$('[data-id]', el).forEach(b => b.onclick = () => {
    const n = notes.find(x => x.id === b.dataset.id);
    if (n.type === 'Visite') location.hash = `#/cr/${encodeURIComponent(d.m.id)}/${n.id}`; else editNote(d, n);
  });
  $$('[data-ph]', el).forEach(async img => { img.src = await imageURL(db, img.dataset.ph); });
}

async function editNote(d, n) {
  const { m, contacts, notes, produits } = d;
  const date0 = n.date || today();
  const vendables = produitsPour(produits, m.enseigne).filter(p => !/accessoire/i.test(p.gamme || ''));
  const accessoires = produitsPour(produits, m.enseigne).filter(p => /accessoire/i.test(p.gamme || ''));
  const stockRow = p => `<label class="stock-row"><span>${esc(p.nom)}${p.ref ? ` <small>${esc(p.ref)}</small>` : ''}</span>
    <input type="number" min="0" inputmode="numeric" name="stock:${esc(p.id)}" value="${esc(n.stock?.[p.id] ?? '')}" placeholder="–"></label>`;
  const p = modal({ titre: n.id ? 'Modifier' : n.type === 'Visite' ? 'Noter une visite' : 'Nouvelle note', large: true, corps: `
    <div class="row"><label>Type<select name="type" id="nType">${TYPES_NOTE.map(t => `<option ${t === n.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label>Date<input type="date" name="date" id="nDate" value="${esc(date0)}" required></label></div>
    <div class="visite-only">
      <div class="row"><label>Statut<select name="statut">${STATUTS_VISITE.map(t => `<option ${t === (n.statut || 'Réalisée') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Objet de la visite<select name="objet">${OBJETS_VISITE.map(t => `<option ${t === n.objet ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="qty">N° visite<input name="numero" id="nNum" value="${esc(n.numero || numeroVisite(notes, date0, n.id))}"></label></div>
    </div>
    <label>Interlocuteur<input name="contact" list="ctList" value="${esc(n.contact)}"></label>
    <datalist id="ctList">${contacts.filter(c => c.nom).map(c => `<option value="${esc(c.nom)}">`).join('')}</datalist>
    <label>Compte rendu<textarea name="texte" rows="4">${esc(n.texte)}</textarea></label>
    <label>À faire / prochaine étape<input name="aFaire" value="${esc(n.aFaire)}"></label>
    ${produits.length ? `<fieldset class="visite-only"><legend>Relevé de stock en magasin</legend>
      <p class="hint">Laisse vide ce que tu n'as pas compté. Les ventes et le risque de rupture se calculent d'une visite à l'autre.</p>
      <div class="stock-grid">${vendables.map(stockRow).join('')}</div>
      ${accessoires.length ? `<details><summary>Accessoires</summary><div class="stock-grid">${accessoires.map(stockRow).join('')}</div></details>` : ''}</fieldset>` : ''}` });
  const maj = () => $$('.visite-only').forEach(x => { x.hidden = $('#nType').value !== 'Visite'; });
  $('#nType').onchange = maj; maj();
  $('#nDate').onchange = e => { if (!n.numero) $('#nNum').value = numeroVisite(notes, e.target.value, n.id); };
  const r = await p;
  if (!r) return;
  const stock = {};
  for (const [k, v] of Object.entries(r)) if (k.startsWith('stock:')) { if (v !== '') stock[k.slice(6)] = Number(v); delete r[k]; }
  if (r.type !== 'Visite') { delete r.statut; delete r.objet; delete r.numero; }
  await db.put('notes', stamp({ ...n, ...r, stock: r.type === 'Visite' ? stock : undefined, id: n.id || uid('n'), magasinId: m.id }));
  if (r.type === 'Visite' && r.statut === 'Réalisée') {
    const t = await db.get('tournees', r.date);
    const e = t?.etapes.find(x => x.magasinId === m.id);
    if (e) { e.fait = true; await db.put('tournees', t); }
  }
  toast('Enregistré');
  go(`#/magasin/${encodeURIComponent(m.id)}/suivi`);
}

// ── Stock ────────────────────────────────────────────────────────────────────
function vueStock(el, d, s, stock) {
  el.innerHTML = `<h2 class="h2">Stock en magasin <button class="btn small" id="releve">Faire un relevé</button></h2>
    ${stock.length ? `<table class="table stock-table"><thead><tr><th>Produit</th><th class="num">Dernier stock</th><th class="num">Vendu / visite</th><th>Couverture</th><th>Relevés</th></tr></thead><tbody>
      ${stock.map(x => `<tr class="${x.rupture ? 'risk' : ''}"><td>${esc(x.produit.nom)}</td>
        <td class="num">${x.dernier.stock}<small class="muted"> au ${fmtDate(x.dernier.date)}</small></td>
        <td class="num">${x.moyenne == null ? '–' : x.moyenne.toFixed(1)}</td>
        <td>${x.dernier.stock === 0 ? '<b class="late-txt">Rupture</b>' : x.moyenne === 0 ? '<span class="muted">Aucune vente relevée</span>' : x.couverture == null ? '<span class="muted">2 relevés nécessaires</span>' : x.rupture ? `<b class="late-txt">Moins d'une visite</b>` : `${x.couverture.toFixed(1)} visite${x.couverture >= 2 ? 's' : ''}`}</td>
        <td class="muted small">${x.pts.map(p => `${fmtDate(p.date).replace(/ \d{4}$/, '')} : ${p.stock}`).join(' → ')}</td></tr>`).join('')}</tbody></table>
      <p class="hint">Vendu = stock du relevé précédent + quantités commandées entre-temps − stock actuel. En rouge : risque de rupture avant ta prochaine visite.</p>`
    : '<p class="muted">Aucun relevé de stock pour l\'instant. Note une visite et compte les produits en rayon : l\'appli calculera les ventes et te préviendra des ruptures.</p>'}`;
  $('#releve').onclick = () => { location.hash = `#/cr/${encodeURIComponent(m.id)}`; };
}

// ── Commandes (préparation, sans prix) ───────────────────────────────────────
async function commandes(el, d, s) {
  const { m, commandes: cmds, produits, contacts } = d;
  const hors = c => !!SAISON.commandeDebut && (c.date < SAISON.commandeDebut || c.date > SAISON.commandeFin);
  el.innerHTML = `<h2 class="h2">Commandes ${esc(SAISON.nom)} <button class="btn small" id="addCmd">Préparer une commande</button></h2>
    <p class="hint">Préparation sans prix, à reporter dans le ${esc(PROFIL.commande.bon || 'bon de commande officiel')} (onglet ${esc(m.enseigne)}).${SAISON.commandeDebut ? ` Commandes du ${fmtDate(SAISON.commandeDebut)} au ${fmtDate(SAISON.commandeFin)}, livraisons du ${fmtDate(SAISON.livraisonDebut)} au ${fmtDate(SAISON.livraisonFin)}.` : ''}</p>
    ${cmds.map(c => {
      const tot = c.lignes.reduce((a, l) => a + (Number(l.qte) || 0), 0);
      const dum = c.lignes.reduce((a, l) => a + (Number(l.dummy) || 0), 0);
      return `<article class="cmd"><header><strong>${fmtDate(c.date)}</strong>${c.reference ? ` <span class="muted">${esc(c.reference)}</span>` : ''}
        <span class="tag">${tot} unité${tot > 1 ? 's' : ''}</span>${dum ? `<span class="tag">${dum} ${esc(dum > 1 ? SAISON.libelleOfferts : SAISON.libelleOffert)}</span>` : ''}${hors(c) ? '<span class="tag late">hors période</span>' : ''}
        <span class="spacer"></span><button class="btn small" data-xls="${c.id}">Excel</button><button class="btn-icon" data-id="${c.id}" aria-label="Modifier">✎</button></header>
        <table class="lines"><tbody>${c.lignes.map(l => { const p = produits.find(x => x.id === l.produitId); return `<tr><td>${esc(p?.ref || '')}</td><td>${esc(p?.nom || '')}</td><td class="num">${esc(l.qte)}</td><td class="muted num">${Number(l.dummy) ? `+${l.dummy} ${esc(SAISON.libelleOffert)}` : ''}</td></tr>`; }).join('')}</tbody></table>
        <p class="muted small">${[c.modeLivraison, c.livraison && `livraison souhaitée le ${fmtDate(c.livraison)}`, c.reliquats && `reliquats : ${c.reliquats}`, c.engagement && 'engagement signé'].filter(Boolean).map(esc).join(' · ')}</p>
        ${c.note ? `<p class="note">${esc(c.note)}</p>` : ''}</article>`;
    }).join('') || '<p class="muted">Aucune commande pour ce magasin.</p>'}
    ${saisonPrecedente(m)}`;
  $('#addCmd').onclick = () => editCommande(d, {});
  if (location.hash.includes('nouvelle=1')) { history.replaceState(null, '', location.hash.replace(/\?nouvelle=1/, '')); editCommande(d, {}); }
  $$('[data-id]', el).forEach(b => b.onclick = () => editCommande(d, cmds.find(c => c.id === b.dataset.id)));
  $$('[data-xls]', el).forEach(b => b.onclick = async () => {
    const c = cmds.find(x => x.id === b.dataset.xls);
    const blob = await exporterCommande(c, m, contacts, produits, s, SAISON);
    downloadBlob(blob, `Commande ${m.nom} ${c.date}.xlsx`.replace(/[\\/:*?"<>|]/g, '-'));
  });
}

// Saison précédente : ce que le magasin a commandé (quantités, sans prix) et son implantation
function saisonPrecedente(m) {
  const s = m.saisonPrecedente;
  if (!s || (!s.commandes.length && !s.implantation.length)) return '';
  const tot = new Map();
  s.commandes.forEach(c => tot.set(c.produit, (tot.get(c.produit) || 0) + c.qte));
  const total = [...tot.values()].reduce((a, b) => a + b, 0);
  const parCde = new Map();
  s.commandes.forEach(c => { const k = c.commande || '—'; if (!parCde.has(k)) parCde.set(k, { ...c, lignes: [] }); parCde.get(k).lignes.push(c); });
  const vus = new Set();
  const expo = s.implantation.filter(i => /meuble|ecran|écran|expo|modele|modèle/i.test(i.produit))
    .sort((a, b) => (b.livraison ? 1 : 0) - (a.livraison ? 1 : 0)).filter(i => { const k = i.produit.toUpperCase(); if (vus.has(k)) return false; vus.add(k); return true; });
  const lib = esc(PROFIL.saisonPrecedente || 'Saison précédente');
  return `<h2 class="h2">${lib} <span class="tag">${total} unités commandées</span></h2>
    <div class="grid2"><section><table class="table"><thead><tr><th>Produit</th><th class="num">Commandé</th></tr></thead><tbody>
      ${[...tot].sort((a, b) => b[1] - a[1]).map(([p, q]) => `<tr><td>${esc(p)}</td><td class="num"><strong>${q}</strong></td></tr>`).join('')}</tbody></table></section>
    <section>${expo.length ? `<p class="small muted">Implantation / PLV</p><ul class="plain">${expo.map(i => `<li>${esc(i.produit.replace(/MODELE D'EXPO/i, 'Modèle d\'expo'))}${i.qte > 1 ? ` × ${i.qte}` : ''}${i.livraison ? ` <span class="muted">(${esc(i.livraison)})</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted small">Pas de meuble ni d\'écran.</p>'}</section></div>
    <details><summary>Détail des ${parCde.size} commandes</summary>
      <table class="table"><thead><tr><th>Date</th><th>N°</th><th>Mode</th><th>Produits</th></tr></thead><tbody>
      ${[...parCde.values()].sort((a, b) => (a.date || '9').localeCompare(b.date || '9')).map(c => `<tr><td>${c.date ? fmtDate(c.date) : '–'}</td><td class="small">${esc(c.commande)}</td><td>${esc(c.mode)}${c.type ? ` <small class="muted">${esc(c.type)}</small>` : ''}</td>
        <td>${c.lignes.map(l => `${esc(l.produit)} × ${l.qte}`).join('<br>')}</td></tr>`).join('')}</tbody></table></details>
    <p class="hint">Source : fichiers de l'enseigne (quantités uniquement). Sert de repère pour la campagne en cours.</p>`;
}

async function editCommande(d, c) {
  const { m, commandes: cmds, produits, contacts } = d;
  const indep = SAISON.independants.includes(m.enseigne);
  const deja = offertsDejaDonnes(cmds, c.id);
  const liste = produitsPour(produits, m.enseigne);
  const q = Object.fromEntries((c.lignes || []).map(l => [l.produitId, l.qte]));
  const cad = c.cadencier || [];
  const an26 = new Map();
  (m.saisonPrecedente?.commandes || []).forEach(x => { if (x.ean) an26.set(x.ean, (an26.get(x.ean) || 0) + x.qte); });
  const pr = modal({ titre: c.id ? 'Modifier la commande' : 'Préparer une commande', large: true, valider: 'Enregistrer la commande', corps: `
    <div class="row"><label>Date<input type="date" name="date" value="${esc(c.date || today())}" required></label>
    <label>Référence / n° (facultatif)<input name="reference" value="${esc(c.reference)}" placeholder="PS27-…"></label></div>
    <div class="row"><label>Contact<input name="contact" list="ctList2" value="${esc(c.contact || contacts[0]?.nom || '')}"></label>
    <label>E-mail magasin<input name="email" type="email" value="${esc(c.email || contacts.find(x => x.email)?.email || '')}"></label></div>
    <datalist id="ctList2">${contacts.filter(x => x.nom).map(x => `<option value="${esc(x.nom)}">`).join('')}</datalist>
    <div class="row"><label>Mode de livraison<select name="modeLivraison">${SAISON.modesLivraison.map(x => `<option ${x === c.modeLivraison ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    <label>Livraison souhaitée<input type="date" name="livraison" min="${SAISON.livraisonDebut}" max="${SAISON.livraisonFin}" value="${esc(c.livraison || '')}"></label></div>
    ${indep ? `<div class="row"><label>Maintien reliquats<select name="reliquats" required><option value="">— à renseigner —</option>${['Oui', 'Non'].map(x => `<option ${x === c.reliquats ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="engagement" ${c.engagement ? 'checked' : ''}> Engagement magasin signé</label></div>` : ''}
    <fieldset><legend>Quantités</legend>
      <p class="hint">${liste.length === produits.length ? 'Tous les produits du catalogue.' : `Produits référencés chez ${esc(m.enseigne)}.`}${SAISON.offertPour ? ` 1 ${esc(SAISON.libelleOffert)} pour ${SAISON.offertPour} unités, un seul par magasin et par produit.` : ''}</p>
      <div class="qty-grid">${liste.map(p => `<label class="stock-row"><span>${esc(p.nom)} <small>${esc(p.ref || '')}${an26.has(String(p.ean)) ? ` · <b>${an26.get(String(p.ean))} commandés (${esc((PROFIL.saisonPrecedente || 'saison précédente').toLowerCase())})</b>` : ''}</small>
        <small class="dum" data-dum="${p.id}">${deja.has(p.id) && SAISON.offertPour ? `${esc(SAISON.libelleOffert)} déjà offert` : ''}</small></span>
        <input type="number" min="0" inputmode="numeric" name="q:${esc(p.id)}" data-pid="${p.id}" value="${esc(q[p.id] ?? '')}" placeholder="0"></label>`).join('') || '<p class="muted">Catalogue vide : importe le pack catalogue (Réglages).</p>'}</div>
      <p class="tot" id="cmdTot"></p></fieldset>
    <details ${cad.length ? 'open' : ''}><summary>Cadencier de livraison (jusqu'à ${SAISON.maxLivraisons} dates)</summary><div class="row">
      ${Array.from({ length: SAISON.maxLivraisons }, (_, i) => `<label>Livraison ${i + 1}<input type="date" name="cad${i}" min="${SAISON.livraisonDebut}" max="${SAISON.livraisonFin}" value="${esc(cad[i] || '')}"></label>`).join('')}</div></details>
    <label>Note<textarea name="note" rows="2">${esc(c.note)}</textarea></label>` });
  const calc = () => {
    let u = 0, dm = 0;
    $$('[data-pid]').forEach(i => {
      const n = Number(i.value) || 0; u += n;
      const dd = deja.has(i.dataset.pid) ? 0 : (SAISON.offertPour && n >= SAISON.offertPour ? 1 : 0); dm += dd;
      const t = document.querySelector(`[data-dum="${i.dataset.pid}"]`);
      if (t) t.textContent = !SAISON.offertPour ? '' : deja.has(i.dataset.pid) ? `${SAISON.libelleOffert} déjà offert` : dd ? `+1 ${SAISON.libelleOffert}` : '';
    });
    $('#cmdTot').textContent = `${u} unité${u > 1 ? 's' : ''}${dm ? ` · ${dm} ${dm > 1 ? SAISON.libelleOfferts : SAISON.libelleOffert}` : ''}`;
  };
  $$('[data-pid]').forEach(i => { i.oninput = calc; }); calc();
  const r = await pr;
  if (!r) return;
  const lignes = liste.map(p => ({ produitId: p.id, qte: Number(r['q:' + p.id]) || 0 })).filter(l => l.qte > 0)
    .map(l => ({ ...l, dummy: deja.has(l.produitId) ? 0 : (SAISON.offertPour && l.qte >= SAISON.offertPour ? 1 : 0) }));
  const cadencier = Array.from({ length: SAISON.maxLivraisons }, (_, i) => r['cad' + i]).filter(Boolean);
  await db.put('commandes', stamp({ ...c, id: c.id || uid('k'), magasinId: m.id, date: r.date, reference: r.reference, contact: r.contact, email: r.email,
    modeLivraison: r.modeLivraison, livraison: r.livraison, reliquats: r.reliquats || '', engagement: r.engagement === 'on', cadencier, note: r.note, lignes }));
  if (r.date < SAISON.commandeDebut || r.date > SAISON.commandeFin) toast(`Attention : date hors période de commande ${SAISON.nom}`, 'warn');
  else toast('Commande enregistrée');
  rerender();
}

// ── SAV ──────────────────────────────────────────────────────────────────────
function sav(el, { m, sav: list, produits }) {
  el.innerHTML = `<h2 class="h2">SAV <button class="btn small" id="addSav">Nouveau dossier</button></h2>
    <ul class="sav-list">${list.map(x => `<li class="sav s-${esc(x.statut).replace(/\s/g, '')}">
      <div><strong>${esc(x.produit || 'Produit non précisé')}</strong> <span class="status">${esc(x.statut)}</span>
      <p>${esc(x.probleme)}</p><p class="muted">Ouvert le ${fmtDate(x.date)}${x.numero ? ` · n° ${esc(x.numero)}` : ''}${x.client ? ` · client ${esc(x.client)}` : ''}</p>
      ${x.suivi ? `<p class="note">${esc(x.suivi)}</p>` : ''}</div>
      <button class="btn-icon" data-id="${x.id}" aria-label="Modifier">✎</button></li>`).join('') || '<li class="muted">Aucun retour SAV pour ce magasin.</li>'}</ul>`;
  $('#addSav').onclick = () => editSav(m, {}, produits);
  $$('[data-id]', el).forEach(b => b.onclick = () => editSav(m, list.find(x => x.id === b.dataset.id), produits));
}

async function editSav(m, x, produits) {
  const r = await modal({ titre: x.id ? 'Dossier SAV' : 'Nouveau dossier SAV', corps: `
    <div class="row"><label>Date<input type="date" name="date" value="${esc(x.date || today())}" required></label>
    <label>Statut<select name="statut">${STATUTS_SAV.map(st => `<option ${st === (x.statut || 'Ouvert') ? 'selected' : ''}>${st}</option>`).join('')}</select></label></div>
    <label>Produit<input name="produit" list="prodList" value="${esc(x.produit)}"></label>
    <datalist id="prodList">${produits.map(p => `<option value="${esc(p.nom)}">`).join('')}</datalist>
    <div class="row"><label>N° de dossier<input name="numero" value="${esc(x.numero)}"></label><label>Client final<input name="client" value="${esc(x.client)}"></label></div>
    <label>Problème<textarea name="probleme" rows="3" required>${esc(x.probleme)}</textarea></label>
    <label>Suivi<textarea name="suivi" rows="3">${esc(x.suivi)}</textarea></label>` });
  if (!r) return;
  await db.put('sav', stamp({ ...x, ...r, id: x.id || uid('s'), magasinId: m.id }));
  toast('Dossier SAV enregistré'); rerender();
}

// ── Implantations ────────────────────────────────────────────────────────────
function implantations(el, { m, implantations: list }) {
  el.innerHTML = `<h2 class="h2">Implantations <button class="btn small" id="addImp">Ajouter</button></h2>
    <table class="table"><thead><tr><th>Produit / meuble</th><th class="num">Qté</th><th>Infos</th><th></th></tr></thead><tbody>
    ${list.map(x => `<tr><td>${esc(x.produit)}</td><td class="num">${esc(x.qte)}</td><td class="muted">${esc([x.engagement && 'Engagement : ' + x.engagement, x.code && 'Code ' + x.code, x.divers].filter(Boolean).join(' · '))}</td>
      <td><button class="btn-icon" data-id="${x.id}" aria-label="Modifier">✎</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Aucun meuble ou PLV enregistré.</td></tr>'}</tbody></table>`;
  const edit = async (x = {}) => {
    const r = await modal({ titre: 'Implantation', corps: `<label>Produit / meuble<input name="produit" value="${esc(x.produit)}" required></label>
      <label>Quantité<input type="number" name="qte" min="0" value="${esc(x.qte ?? 1)}"></label><label>Infos<input name="divers" value="${esc(x.divers)}"></label>` });
    if (r) { await db.put('implantations', stamp({ ...x, ...r, id: x.id || uid('i'), magasinId: m.id, source: x.source || 'appli' })); rerender(); }
  };
  $('#addImp').onclick = () => edit();
  $$('[data-id]', el).forEach(b => b.onclick = () => edit(list.find(x => x.id === b.dataset.id)));
}

export function destroy() { if (map) { map.remove(); map = null; } }
