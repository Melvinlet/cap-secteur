// « À faire » : toutes les prochaines étapes notées pendant les visites (et ajoutées à la main),
// rangées par échéance, à cocher quand c'est fait. Les faits restent consultables.
import { db, uid, getSettings } from '../db.js';
import { magasinsEnrichis } from '../data.js';
import { $, $$, esc, fmtDate, modal, toast, today, norm, prioTag, decale, vibrer } from '../ui.js';
import { marquerFait } from '../services/afaire.js';
import { datalistMagasins, trouverMagasin, messageIntrouvable } from '../champ-magasin.js';
import { lienDetails } from '../services/visite.js';
import { dateEnLettres } from '../services/rdv.js';
import { ic } from '../icones.js';

let etat = { vue: 'ouverts', q: '', dep: '', tri: 'echeance' };
const lienNote = n => n.type === 'Visite' ? lienDetails(n) : `#/magasin/${encodeURIComponent(n.magasinId)}/suivi`;

export async function render(el) {
  const s = await getSettings();
  const [mags, notes, tournees] = await Promise.all([magasinsEnrichis(s), db.all('notes'), db.all('tournees')]);
  const byId = new Map(mags.map(m => [m.id, m]));
  const auj = today(), dans7 = decale(auj, 7);
  // prochain passage prévu dans une tournée (14 jours)
  const prochain = new Map();
  for (const t of tournees.filter(x => x.id >= auj && x.id <= decale(auj, 14)).sort((a, b) => a.id.localeCompare(b.id)))
    for (const e of t.etapes || []) if (!e.fait && !prochain.has(e.magasinId)) prochain.set(e.magasinId, t.id);

  const avecAF = notes.filter(n => (n.aFaire || '').trim() && byId.has(n.magasinId));
  const ouverts = avecAF.filter(n => !n.aFaireFait), faits = avecAF.filter(n => n.aFaireFait);
  const q = norm(etat.q);
  const filtre = n => { const m = byId.get(n.magasinId);
    return (!etat.dep || String(m.departement) === etat.dep) && (!q || norm(`${n.aFaire} ${m.nom} ${m.ville} ${m.cp} ${n.contact || ''}`).includes(q)); };
  const liste = (etat.vue === 'faits' ? faits : ouverts).filter(filtre);
  const deps = [...new Set(avecAF.map(n => String(byId.get(n.magasinId).departement)))].sort();

  // groupes
  let groupes;
  if (etat.vue === 'faits') {
    groupes = [['Faits', liste.sort((a, b) => b.aFaireFait.localeCompare(a.aFaireFait))]];
  } else if (etat.tri === 'magasin') {
    const g = new Map();
    for (const n of liste.sort((a, b) => byId.get(a.magasinId).nom.localeCompare(byId.get(b.magasinId).nom) || a.date.localeCompare(b.date))) {
      if (!g.has(n.magasinId)) g.set(n.magasinId, []); g.get(n.magasinId).push(n);
    }
    groupes = [...g].map(([id, l]) => [byId.get(id).nom, l, id]);
  } else {
    const par = (a, b) => (a.echeance || '9999').localeCompare(b.echeance || '9999') || a.date.localeCompare(b.date);
    const l = liste.sort(par);
    groupes = [
      ['En retard', l.filter(n => n.echeance && n.echeance < auj), null, 'late'],
      ['Aujourd\'hui', l.filter(n => n.echeance === auj)],
      ['Dans les 7 jours', l.filter(n => n.echeance > auj && n.echeance <= dans7)],
      ['Plus tard', l.filter(n => n.echeance > dans7)],
      ['Magasin dans ta tournée (14 jours)', l.filter(n => !n.echeance && prochain.has(n.magasinId))],
      ['Sans échéance', l.filter(n => !n.echeance && !prochain.has(n.magasinId)).sort((a, b) => a.date.localeCompare(b.date))],
    ];
  }

  const item = n => { const m = byId.get(n.magasinId), pr = prochain.get(n.magasinId);
    return `<li class="af-item${n.aFaireFait ? ' fait' : ''}">
      <input type="checkbox" class="af-rond" id="af-${esc(n.id)}" data-afaire="${esc(n.id)}" ${n.aFaireFait ? 'checked' : ''} aria-label="Fait : ${esc(n.aFaire)}">
      <div class="af-corps"><label class="af-txt" for="af-${esc(n.id)}">${esc(n.aFaire)}</label>
      <div class="af-meta small">
        ${etat.tri === 'magasin' && etat.vue !== 'faits' ? '' : `<a href="#/magasin/${encodeURIComponent(m.id)}">${esc(m.nom)}</a> ${prioTag(m.prio)} · `}
        <span class="muted">noté le ${fmtDate(n.date)}${n.contact ? ` · avec ${esc(n.contact)}` : ''}</span>
        ${n.echeance ? ` · <span class="${!n.aFaireFait && n.echeance < auj ? 'late-txt' : ''}">pour le ${fmtDate(n.echeance)}</span>` : ''}
        ${n.aFaireFait ? ` · <span class="ok-txt">fait le ${fmtDate(n.aFaireFait)}</span>` : pr ? ` · <a class="af-tour" href="#/tournee/${pr}">${ic('lieu')} dans ta tournée ${pr === auj ? 'aujourd\'hui' : `du ${esc(dateEnLettres(pr))}`}</a>` : ''}
      </div></div>
      <div class="af-act"><a class="btn-link small" href="${lienNote(n)}">${n.type === 'Visite' ? 'compte rendu' : 'note'}</a>
        <button type="button" class="btn-icon" data-ed="${esc(n.id)}" aria-label="Modifier">${ic('crayon')}</button></div></li>`; };

  const nbRetard = ouverts.filter(n => n.echeance && n.echeance < auj).length;
  el.innerHTML = `<div class="page">
    <header class="page-head"><h1>À faire</h1>
      <button class="btn primary" id="ajout">Ajouter un à faire</button></header>
    <p class="hint">Les « prochaines étapes » notées dans tes comptes rendus. Coche quand c'est fait : elles restent dans « Faits ». Un à faire ouvert réapparaît quand le magasin revient dans ta tournée.</p>
    <div class="seg" role="tablist" aria-label="Afficher">
      <button role="tab" data-vue="ouverts" aria-selected="${etat.vue === 'ouverts'}">En cours (${ouverts.length})${nbRetard ? ` <span class="badge alert">${nbRetard}</span>` : ''}</button>
      <button role="tab" data-vue="faits" aria-selected="${etat.vue === 'faits'}">Faits (${faits.length})</button></div>
    <div class="rdv-f af-f">
      <input type="search" id="q" placeholder="Rechercher : texte, magasin, ville…" value="${esc(etat.q)}" aria-label="Rechercher">
      <select id="dep" aria-label="Département"><option value="">Tous départements</option>${deps.map(d => `<option ${etat.dep === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
      ${etat.vue === 'ouverts' ? `<select id="tri" aria-label="Classer"><option value="echeance" ${etat.tri === 'echeance' ? 'selected' : ''}>Par échéance</option><option value="magasin" ${etat.tri === 'magasin' ? 'selected' : ''}>Par magasin</option></select>` : ''}
    </div>
    ${groupes.filter(g => g[1].length).map(([titre, l, id, cls]) => `<section class="af-grp ${cls || ''}">
      <h2 class="h2">${id ? `<a href="#/magasin/${encodeURIComponent(id)}">${esc(titre)}</a>` : esc(titre)} <span class="badge">${l.length}</span></h2>
      <ul class="plain af-liste">${l.map(item).join('')}</ul></section>`).join('')
      || `<div class="empty"><p>${q || etat.dep ? 'Rien ne correspond à ta recherche.' : etat.vue === 'faits' ? 'Aucun à faire coché pour l\'instant.' : 'Rien en attente.'}</p>${etat.vue === 'ouverts' && !q && !etat.dep ? '<p class="muted">Note une « prochaine étape » dans un compte rendu de visite, ou ajoute-en une ici.</p>' : ''}</div>`}
  </div>`;

  $$('[data-vue]', el).forEach(b => b.onclick = () => { etat.vue = b.dataset.vue; render(el); });
  $('#q', el).oninput = e => { etat.q = e.target.value; clearTimeout(etat.t); etat.t = setTimeout(() => render(el).then(() => { const i = $('#q', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 250); };
  $('#dep', el).onchange = e => { etat.dep = e.target.value; render(el); };
  $('#tri', el)?.addEventListener('change', e => { etat.tri = e.target.value; render(el); });
  $$('[data-afaire]', el).forEach(c => c.onchange = async () => {
    if (c.checked) vibrer(12);
    await marquerFait(c.dataset.afaire, c.checked);
    c.closest('li').classList.toggle('fait', c.checked);
    const ici = () => location.hash.startsWith('#/afaire');   // pas de rafraîchissement si on a changé d'écran entre-temps
    toast(c.checked ? 'Fait ✓' : 'Remis dans « En cours »', '', { label: 'Annuler', onclick: async () => { await marquerFait(c.dataset.afaire, !c.checked); if (ici()) render(el); } });
    setTimeout(() => { if (ici()) render(el); }, 900);
  });
  $$('[data-ed]', el).forEach(b => b.onclick = async () => { if (await editer(await db.get('notes', b.dataset.ed), mags)) render(el); });
  $('#ajout', el).onclick = async () => { if (await editer(null, mags)) render(el); };
}

// Ajouter (note « À faire » rattachée à un magasin) ou modifier le texte / l'échéance
async function editer(n, mags) {
  const m0 = n ? mags.find(m => m.id === n.magasinId) : null;
  const p = modal({ titre: n ? 'Modifier l\'à faire' : 'Ajouter un à faire', valider: 'Enregistrer', corps: `
    ${n ? `<p><strong>${esc(m0?.nom || '')}</strong></p>` : `<label>Magasin<input name="mag" list="dlAF" placeholder="Tape le nom ou la ville du magasin" autocomplete="off" required></label>
      ${datalistMagasins('dlAF', mags)}`}
    <label>À faire<input name="aFaire" value="${esc(n?.aFaire || '')}" placeholder="ex. Rappeler le chef de rayon pour la PLV" required></label>
    <label>Pour le <small class="muted">(facultatif)</small><input type="date" name="echeance" value="${esc(n?.echeance || '')}"></label>
    ${n ? '<button type="button" class="btn small danger" id="sansAF">Retirer cet à faire</button>' : ''}` });
  let retire = false;
  document.querySelector('dialog[open] #sansAF')?.addEventListener('click', e => { retire = true; e.target.closest('dialog').close(); });
  const r = await p;
  if (retire && n) {
    await db.put('notes', { ...n, aFaire: '', echeance: '', aFaireFait: undefined, maj: new Date().toISOString() });
    toast('À faire retiré (la note reste sur la fiche magasin)');
    return true;
  }
  if (r === null) return false;
  if (n) {
    await db.put('notes', { ...n, aFaire: r.aFaire.trim(), echeance: r.echeance || '', maj: new Date().toISOString() });
    toast('À faire modifié');
    return true;
  }
  const m = trouverMagasin(r.mag, mags);
  if (!m) { toast(messageIntrouvable(r.mag), 'warn'); return false; }
  await db.put('notes', { id: uid('n'), magasinId: m.id, type: 'Note', date: today(), texte: '', aFaire: r.aFaire.trim(), echeance: r.echeance || '', maj: new Date().toISOString() });
  toast(`À faire ajouté : ${m.nom}`);
  return true;
}
