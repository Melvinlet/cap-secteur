// Compte rendu de visite : horaires, interlocuteurs, actions réalisées, photos de rayon,
// relevé de stock, relevé concurrence et suite à donner. Enregistré dans l'historique des visites.
import { db, uid, getSettings } from '../db.js';
import { magasinComplet, produitsPour, numeroVisite, roleDe, trierContacts, frequenceDe } from '../data.js';
import { $, $$, esc, toast, today, confirmer, dictee, modal } from '../ui.js';
import { getRdv, changerStatut, dateEnLettres } from '../services/rdv.js';
import { evenementRdv, proposerAgenda } from '../services/agenda.js';
import { STATUTS_VISITE, OBJETS_VISITE, ACTIONS_VISITE, ETIQUETTES_PHOTO, MARQUES_CONCURRENTES, TYPES_CONCURRENCE } from '../config.js';
import { reduireImage, imageURL, oublierImage } from '../services/images.js';

const maintenant = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export async function render(el, { magasin, note }) {
  const id = decodeURIComponent(magasin);
  const d = await magasinComplet(id);
  if (!d) { el.innerHTML = '<div class="page"><h1>Magasin introuvable</h1></div>'; return; }
  const s = await getSettings();
  const produits = await db.all('produits');
  const { m } = d;
  const n = note ? (await db.get('notes', note)) : null;
  const neuf = !n;
  const cr = n || { id: uid('n'), type: 'Visite', magasinId: m.id, date: today(), statut: 'Réalisée', objet: s.objetDefaut, actions: [], photos: [], interlocuteurs: [] };
  if (neuf) { cr.numero = numeroVisite(d.notes, cr.date); const t = await db.get('tournees', cr.date); const e = t?.etapes.find(x => x.magasinId === m.id); if (e?.objet) cr.objet = e.objet; }
  const concur = (await db.byMagasin('concurrence', m.id)).filter(c => c.noteId === cr.id);
  const photos = [...(cr.photos || [])];          // [{ id, etiquette, legende }]
  const ajoutees = [];                              // photos prises pendant cette saisie (supprimées si on annule)
  const contacts = trierContacts(d.contacts);
  const vendables = produitsPour(produits, m.enseigne);

  el.innerHTML = `<div class="page cr">
    <a class="back" href="#/magasin/${encodeURIComponent(m.id)}/suivi">${esc(m.nom)}</a>
    <h1>Compte rendu de visite</h1>
    <form id="crf">
      <section class="cr-sec"><div class="row">
        <label>Date<input type="date" name="date" value="${esc(cr.date)}" required></label>
        <label>Arrivée<span class="row tight"><input type="time" name="arrivee" value="${esc(cr.arrivee || '')}"><button type="button" class="btn small" data-now="arrivee">Maintenant</button></span></label>
        <label>Départ<span class="row tight"><input type="time" name="depart" value="${esc(cr.depart || '')}"><button type="button" class="btn small" data-now="depart">Maintenant</button></span></label></div>
        <div class="row">
          <label>Statut<select name="statut">${STATUTS_VISITE.map(x => `<option ${x === cr.statut ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
          <label>Objet<select name="objet">${OBJETS_VISITE.map(x => `<option ${x === cr.objet ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
          <label class="qty">N° visite<input name="numero" value="${esc(cr.numero || '')}"></label></div>
      </section>

      <section class="cr-sec"><h2 class="h2">Interlocuteurs rencontrés</h2>
        <div class="chips">${contacts.map(c => `<label class="chip-check"><input type="checkbox" name="ic" value="${esc(c.id)}" ${(cr.interlocuteurs || []).includes(c.id) ? 'checked' : ''}><span>${esc(c.nom || 'Contact')}${roleDe(c) ? ` · ${esc(roleDe(c))}` : ''}</span></label>`).join('') || '<span class="muted">Aucun contact enregistré pour ce magasin.</span>'}</div>
        <label>Autre personne rencontrée<input name="contact" value="${esc(cr.contact || '')}" placeholder="Nom, fonction"></label>
      </section>

      <section class="cr-sec"><h2 class="h2">Actions réalisées</h2>
        <div class="chips">${ACTIONS_VISITE.map(a => `<label class="chip-check"><input type="checkbox" name="act" value="${esc(a)}" ${(cr.actions || []).includes(a) ? 'checked' : ''}><span>${esc(a)}</span></label>`).join('')}</div>
      </section>

      <section class="cr-sec"><h2 class="h2">Compte rendu <button type="button" class="btn small" id="mic" hidden>🎤 Dicter</button></h2>
        <textarea name="texte" rows="6" placeholder="Ce qui s'est dit, l'état du rayon, les besoins du magasin…">${esc(cr.texte || '')}</textarea>
      </section>

      <section class="cr-sec"><h2 class="h2">Photos de rayon</h2>
        <div class="photo-grid" id="photos"></div>
        <label class="btn" for="pic">📷 Prendre / ajouter des photos</label>
        <input type="file" id="pic" accept="image/*" capture="environment" multiple hidden>
      </section>

      ${vendables.length ? `<section class="cr-sec"><h2 class="h2">Relevé de stock</h2>
        <p class="hint">Laisse vide ce que tu n'as pas compté.</p>
        <div class="stock-grid">${vendables.filter(p => !/accessoire/i.test(p.gamme || '')).map(p => `<label class="stock-row"><span>${esc(p.nom)} <small>${esc(p.ref || '')}</small></span>
          <input type="number" min="0" inputmode="numeric" name="stock:${esc(p.id)}" value="${esc(cr.stock?.[p.id] ?? '')}" placeholder="–"></label>`).join('')}</div></section>` : ''}

      <section class="cr-sec"><h2 class="h2">Concurrence en rayon</h2>
        <div id="concur"></div>
        <button type="button" class="btn small" id="addConcur">Ajouter un relevé concurrence</button>
        <datalist id="marques">${MARQUES_CONCURRENTES.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
      </section>

      <section class="cr-sec"><h2 class="h2">Suite à donner</h2>
        <div class="row"><label class="grow">À faire / prochaine étape<input name="aFaire" value="${esc(cr.aFaire || '')}"></label>
        <label>Pour le<input type="date" name="echeance" value="${esc(cr.echeance || '')}"></label></div>
      </section>

      <div class="sticky-save cr-save">
        ${neuf ? '' : '<button type="button" class="btn danger" id="del">Supprimer</button>'}
        <a class="btn ghost" href="#/magasin/${encodeURIComponent(m.id)}/suivi" id="annuler">Annuler</a>
        <button class="btn primary" type="submit" name="suite" value="">Enregistrer le compte rendu</button>
      </div>
    </form></div>`;

  // horaires
  $$('[data-now]').forEach(b => b.onclick = () => { $(`[name=${b.dataset.now}]`).value = maintenant(); });
  dictee($('[name=texte]'), $('#mic'));

  // photos
  const dessinerPhotos = async () => {
    const urls = await Promise.all(photos.map(p => imageURL(db, p.id)));
    $('#photos').innerHTML = photos.map((p, i) => `<figure><img src="${urls[i]}" alt="">
      <select data-et="${i}" aria-label="Type de photo">${ETIQUETTES_PHOTO.map(x => `<option ${x === p.etiquette ? 'selected' : ''}>${x}</option>`).join('')}</select>
      <input data-leg="${i}" value="${esc(p.legende || '')}" placeholder="Légende">
      <button type="button" class="btn-icon" data-rm="${i}" aria-label="Retirer la photo">✕</button></figure>`).join('');
    $$('[data-et]').forEach(x => x.onchange = () => { photos[+x.dataset.et].etiquette = x.value; });
    $$('[data-leg]').forEach(x => x.oninput = () => { photos[+x.dataset.leg].legende = x.value; });
    $$('[data-rm]').forEach(x => x.onclick = () => { photos.splice(+x.dataset.rm, 1); dessinerPhotos(); });
  };
  $('#pic').onchange = async e => {
    for (const f of e.target.files) {
      const pid = uid('ph');
      await db.put('images', { id: pid, blob: await reduireImage(f, 1600, 0.8), type: 'rayon', magasinId: m.id, noteId: cr.id, date: cr.date });
      photos.push({ id: pid, etiquette: 'Rayon', legende: '' }); ajoutees.push(pid);
    }
    e.target.value = '';
    dessinerPhotos();
  };
  dessinerPhotos();

  // concurrence
  const ligneC = (c = {}) => `<div class="concur" data-cid="${esc(c.id || uid('cc'))}">
    <div class="row"><label>Marque<input class="c-marque" list="marques" value="${esc(c.marque || '')}" placeholder="Marque concurrente"></label>
    <label class="grow">Produit / gamme<input class="c-produit" value="${esc(c.produit || '')}"></label>
    <label>Type<select class="c-type">${TYPES_CONCURRENCE.map(x => `<option ${x === c.type ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>
    <label>Observation / offre constatée<input class="c-obs" value="${esc(c.observation || '')}" placeholder="ex. tête de gondole, promo -20 %, 3 modèles en facing…"></label>
    <button type="button" class="btn-icon c-rm" aria-label="Retirer ce relevé">✕</button></div>`;
  $('#concur').innerHTML = concur.map(ligneC).join('');
  const bindC = () => $$('.c-rm').forEach(b => b.onclick = () => { b.closest('.concur').remove(); });
  bindC();
  $('#addConcur').onclick = () => { $('#concur').insertAdjacentHTML('beforeend', ligneC()); bindC(); $('#concur .concur:last-child .c-marque').focus(); };

  // annuler : on retire les photos prises pendant cette saisie
  $('#annuler').onclick = async () => { for (const pid of ajoutees) { await db.del('images', pid); oublierImage(pid); } };
  $('#del')?.addEventListener('click', async () => {
    if (!(await confirmer('Supprimer le compte rendu', 'Le compte rendu, ses photos et ses relevés concurrence seront supprimés.'))) return;
    for (const p of photos) await db.del('images', p.id);
    for (const c of concur) await db.del('concurrence', c.id);
    await db.del('notes', cr.id);
    toast('Compte rendu supprimé');
    location.hash = `#/magasin/${encodeURIComponent(m.id)}/suivi`;
  });

  $('#crf').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const v = Object.fromEntries(f);
    const stock = {};
    for (const [k, val] of f) if (k.startsWith('stock:') && val !== '') stock[k.slice(6)] = Number(val);
    const rec = { ...cr, type: 'Visite', date: v.date, arrivee: v.arrivee, depart: v.depart, statut: v.statut, objet: v.objet, numero: v.numero,
      interlocuteurs: f.getAll('ic'), contact: v.contact || contacts.find(c => c.id === f.get('ic'))?.nom || '', actions: f.getAll('act'),
      texte: v.texte, photos, stock, aFaire: v.aFaire, echeance: v.echeance, maj: new Date().toISOString() };
    await db.put('notes', rec);
    // relevés concurrence : remplacés par ceux du formulaire
    for (const c of concur) await db.del('concurrence', c.id);
    for (const x of $$('.concur')) {
      const marque = $('.c-marque', x).value.trim();
      if (!marque && !$('.c-produit', x).value.trim()) continue;
      await db.put('concurrence', { id: x.dataset.cid, magasinId: m.id, noteId: rec.id, date: rec.date, marque, produit: $('.c-produit', x).value.trim(),
        type: $('.c-type', x).value, observation: $('.c-obs', x).value.trim(), maj: rec.maj });
    }
    for (const p of photos) { const img = await db.get('images', p.id); if (img) await db.put('images', { ...img, date: rec.date, etiquette: p.etiquette, legende: p.legende }); }
    if (rec.statut === 'Réalisée') {
      const t = await db.get('tournees', rec.date);
      const et = t?.etapes.find(x => x.magasinId === m.id);
      if (et) { et.fait = true; await db.put('tournees', t); }
    }
    toast('Compte rendu enregistré');
    const suite = neuf ? await etMaintenant(m, rec, contacts) : null;
    location.hash = suite === 'commande' ? `#/magasin/${encodeURIComponent(m.id)}/commandes?nouvelle=1` : `#/magasin/${encodeURIComponent(m.id)}/suivi`;
  };
}

// Après un nouveau compte rendu : fixer le prochain rendez-vous et/ou préparer une commande, sans changer d'écran
async function etMaintenant(m, rec, contacts) {
  const s = await getSettings();
  const freq = frequenceDe(m, s) || 30;
  const d = new Date((rec.date || today()) + 'T12:00'); d.setDate(d.getDate() + freq);
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
  const proposee = d.toISOString().slice(0, 10);
  let choix = null;
  const p = modal({ titre: 'Et maintenant ?', valider: 'Fixer ce rendez-vous', corps: `
    <button type="button" class="btn suite-cmd" id="suiteCmd">Préparer une commande</button>
    <h3 class="h2">Prochain rendez-vous</h3>
    <div class="row"><label>Date<input type="date" name="date" value="${proposee}" required></label>
    <label>Heure <small class="muted">(si convenue)</small><input type="time" name="heure"></label></div>
    <label>Objet<select name="objet">${OBJETS_VISITE.map(o => `<option ${o === rec.objet ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
    <label class="check"><input type="checkbox" name="agenda" checked> L'ajouter à mon agenda</label>
    <p class="hint">Proposé dans ${freq} jours (fréquence de visite du magasin). Le rendez-vous est ajouté à ta tournée de ce jour-là.</p>` });
  const dlg = document.querySelector('dialog[open]');
  const annuler = dlg.querySelector('footer [data-close]'); if (annuler) annuler.textContent = 'Plus tard';
  dlg.querySelector('#suiteCmd').onclick = () => { choix = 'commande'; dlg.close(); };
  const r = await p;
  if (choix) return choix;
  if (!r) return null;
  const { rdv, ajoute } = await changerStatut(await getRdv(m.id), 'acceptee', { date: r.date, heure: r.heure, objet: r.objet });
  toast(`Prochain rendez-vous le ${dateEnLettres(ajoute || r.date)}${r.heure ? ' à ' + r.heure : ''}`);
  if (r.agenda === 'on') await proposerAgenda(evenementRdv(m, rdv, s, contacts.find(c => c.principal) || contacts[0], r.objet));
  return null;
}
