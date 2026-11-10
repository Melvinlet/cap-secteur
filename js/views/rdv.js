// Écran « Rendez-vous » : choisir des magasins, générer la demande (mail / SMS) avec
// les contacts du magasin, et suivre la réponse (envoyée, acceptée, autre date, refusée).
import { civiliteDevinee } from '../services/civilite.js';
import { db, getSettings } from '../db.js';
import { magasinsEnrichis, trierContacts, roleDe } from '../data.js';
import { $, $$, esc, borne, prioTag, fmtDate, fmtHeure, toast, modal, norm, today } from '../ui.js';
import { STATUTS_RDV, OBJETS_VISITE } from '../config.js';
import { getRdv, tousLesRdv, genererMessage, lienMail, lienSms, estMobile, changerStatut, aRelancer, modeles, dateEnLettres, lienMailCci, separateurMails } from '../services/rdv.js';
import { planning } from './tournee.js';
import { evenementRdv, proposerAgenda } from '../services/agenda.js';
import { ferie } from '../services/feries.js';

let etat = { mode: 'semaine', du: null, au: null, q: '', dep: '', statut: '' };

function semaineSuivante() {
  const d = new Date(); d.setHours(12);
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  const du = d.toISOString().slice(0, 10);
  d.setDate(d.getDate() + 4);
  return [du, d.toISOString().slice(0, 10)];
}

export async function render(el, params = {}) {
  const s = await getSettings();
  if (!etat.du) [etat.du, etat.au] = semaineSuivante();
  if (params.du) { etat.mode = 'semaine'; etat.du = params.du; etat.au = params.au || params.du; }
  if (params.m) { etat.mode = 'tous'; etat.q = ''; }
  const [mags, rdvs, contacts, tournees] = await Promise.all([magasinsEnrichis(s), tousLesRdv(), db.all('contacts'), db.all('tournees')]);
  const byId = new Map(mags.map(m => [m.id, m]));
  const ctBy = new Map();
  for (const c of contacts) { if (!ctBy.has(c.magasinId)) ctBy.set(c.magasinId, []); ctBy.get(c.magasinId).push(c); }

  // lignes : magasins des tournées de la période, ou tous les magasins
  let lignes = [];
  if (etat.mode === 'semaine') {
    for (const t of tournees.filter(x => x.id >= etat.du && x.id <= etat.au).sort((a, b) => a.id.localeCompare(b.id))) {
      const p = planning(t, byId, s);
      p.etapes.forEach(e => { const m = byId.get(e.magasinId); if (m) lignes.push({ m, date: t.id, heure: t.calcul ? fmtHeure(e.arrivee) : '', objet: e.objet }); });
    }
  } else {
    lignes = mags.filter(m => ![0, 4, 5].includes(m.prio)).sort((a, b) => b.urgence - a.urgence || a.prio - b.prio).map(m => ({ m, date: '', heure: '' }));
  }
  if (params.m) lignes = lignes.filter(l => l.m.id === decodeURIComponent(params.m));
  // un magasin présent sur plusieurs jours n'apparaît qu'une fois (le jour du rendez-vous s'il est fixé)
  const vus = new Map();
  for (const l of lignes) {
    const r = rdvs.get(l.m.id);
    const jourRdv = r && (r.statut === 'autreDate' ? r.dateRetenue : r.date);
    if (!vus.has(l.m.id) || l.date === jourRdv) vus.set(l.m.id, l);
  }
  lignes = [...vus.values()];
  lignes.forEach(l => {
    l.rdv = rdvs.get(l.m.id) || { id: `rdv-${l.m.id}`, magasinId: l.m.id, statut: 'aFaire', historique: [] };
    l.relance = aRelancer(l.rdv, s.relanceApres);
    l.contacts = trierContacts(ctBy.get(l.m.id) || []);
  });
  const q = norm(etat.q);
  const compte = st => lignes.filter(l => st === 'relancer' ? l.relance : l.rdv.statut === st).length;
  const visibles = lignes.filter(l => (!q || norm(`${l.m.nom} ${l.m.ville} ${l.m.cp}`).includes(q)) && (!etat.dep || l.m.departement === etat.dep)
    && (!etat.statut || (etat.statut === 'relancer' ? l.relance : l.rdv.statut === etat.statut)));
  const deps = [...new Set(lignes.map(l => l.m.departement))].sort();

  el.innerHTML = `<div class="page wide">
    <header class="page-head"><h1>Rendez-vous</h1>
      <div class="seg" role="tablist" aria-label="Magasins"><button role="tab" data-mode="semaine" aria-selected="${etat.mode === 'semaine'}">Mes tournées</button><button role="tab" data-mode="tous" aria-selected="${etat.mode === 'tous'}">Tous les magasins</button></div></header>
    ${params.m ? `<p><a href="#/rdv">Voir tous les rendez-vous</a></p>` : ''}
    <div class="rdv-f">
      ${etat.mode === 'semaine' ? `<div class="row"><label>Du<input type="date" id="du" value="${etat.du}"></label><label>Au<input type="date" id="au" value="${etat.au}"></label></div>` : ''}
      <input type="search" id="q" placeholder="Rechercher un magasin, une ville…" value="${esc(etat.q)}" aria-label="Rechercher">
      <select id="dep" aria-label="Département"><option value="">Tous départements</option>${deps.map(d => `<option ${etat.dep === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
    </div>
    <div class="chips" role="group" aria-label="Statut">
      <button class="chip" data-st="" aria-pressed="${!etat.statut}">Tous (${lignes.length})</button>
      ${Object.entries(STATUTS_RDV).map(([k, v]) => `<button class="chip st-${k}" data-st="${k}" aria-pressed="${etat.statut === k}">${v.court} (${compte(k)})</button>`).join('')}
      <button class="chip st-relancer" data-st="relancer" aria-pressed="${etat.statut === 'relancer'}">À relancer (${compte('relancer')})</button>
    </div>
    ${etat.mode === 'semaine' && !lignes.length ? `<div class="empty"><p>Aucune tournée prévue du ${fmtDate(etat.du)} au ${fmtDate(etat.au)}. Prépare d'abord tes tournées (ou ton plan de secteur), ou passe sur « Tous les magasins ».</p><a class="btn" href="#/tournee/${etat.du}">Ouvrir la tournée du ${fmtDate(etat.du)}</a></div>` : ''}
    ${visibles.length ? `<div class="actions"><label class="check"><input type="checkbox" id="all"> Tout sélectionner</label>
      <button class="btn primary" id="lot" disabled>Préparer les demandes</button>
      <button class="btn" id="tous" title="Un seul mail générique (sans prénom ni adresse), tous les contacts en copie cachée">Un seul mail à tous</button></div>` : ''}
    <ul class="rdv-list">${visibles.map((l, i) => ligneHTML(l, i)).join('')}</ul>
  </div>`;

  $$('[data-mode]').forEach(b => b.onclick = () => { etat.mode = b.dataset.mode; location.hash = '#/rdv'; render(el); });
  $('#du')?.addEventListener('change', e => { etat.du = e.target.value; if (etat.au < etat.du) etat.au = etat.du; render(el); });
  $('#au')?.addEventListener('change', e => { etat.au = e.target.value; render(el); });
  $('#q').oninput = e => { etat.q = e.target.value; clearTimeout(etat.t); etat.t = setTimeout(() => render(el).then(() => { const i = $('#q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 250); };
  $('#dep').onchange = e => { etat.dep = e.target.value; render(el); };
  $$('[data-st]').forEach(b => b.onclick = () => { etat.statut = b.dataset.st; render(el); });
  const majLot = () => { const n = $$('.rdv-sel:checked').length; const b = $('#lot'); if (b) { b.disabled = !n; b.textContent = n ? `Préparer ${n} demande${n > 1 ? 's' : ''}` : 'Préparer les demandes'; } };
  $('#all')?.addEventListener('change', e => { $$('.rdv-sel').forEach(c => { c.checked = e.target.checked; }); majLot(); });
  $$('.rdv-sel').forEach(c => c.onchange = majLot);
  $('#lot')?.addEventListener('click', () => rediger($$('.rdv-sel:checked').map(c => visibles[+c.dataset.i]), s, () => render(el)));
  $$('[data-ecrire]').forEach(b => b.onclick = () => rediger([visibles[+b.dataset.ecrire]], s, () => render(el)));
  $('#tous')?.addEventListener('click', () => { const sel = $$('.rdv-sel:checked').map(c => visibles[+c.dataset.i]); mailGroupe(sel.length ? sel : visibles, s, () => render(el)); });
  $$('[data-agenda]').forEach(b => b.onclick = () => agenda(visibles[+b.dataset.agenda], visibles[+b.dataset.agenda].rdv, s));
  $$('[data-statut]').forEach(sel => sel.onchange = async () => {
    const l = visibles[+sel.dataset.statut];
    await reponse(l, sel.value, s);
    render(el);
  });
}

function ligneHTML(l, i) {
  const r = l.rdv, m = l.m;
  const date = r.statut === 'autreDate' ? r.dateRetenue : (r.date || l.date);
  const heure = r.statut === 'autreDate' ? r.heureRetenue : (r.heure || l.heure);
  const c = l.contacts.find(x => x.id === r.contactId) || l.contacts[0];
  return `<li class="rdv st-${r.statut}">
    <input type="checkbox" class="rdv-sel" data-i="${i}" aria-label="Sélectionner ${esc(m.nom)}">
    ${borne(m.departement)}
    <div class="rdv-main">
      <span class="rdv-nom"><a href="#/magasin/${encodeURIComponent(m.id)}"><strong>${esc(m.nom)}</strong></a> ${prioTag(m.prio)}</span>
      <small>${c ? `${esc(c.nom || 'Contact')}${c.email ? ` · ${esc(c.email)}` : ''}${c.tel ? ` · ${esc(c.tel)}` : ''}` : m.telMagasin ? `Magasin · ${esc(m.telMagasin)}` : '<span class="late-txt">Aucun contact</span>'}</small>
      <small>${date ? `${r.statut === 'autreDate' ? 'Nouvelle date : ' : ''}${esc(dateEnLettres(date))}${heure ? ` · ${esc(heure)}` : ''}` : 'Date à proposer'}
        ${r.dateEnvoi ? ` · envoyée le ${fmtDate(r.dateEnvoi)}` : ''}${r.relances ? ` · ${r.relances} relance${r.relances > 1 ? 's' : ''}` : ''}${l.relance ? ' · <b class="late-txt">à relancer</b>' : ''}</small>
    </div>
    <div class="rdv-act">
      <select data-statut="${i}" aria-label="Réponse du magasin" class="st-sel">${Object.entries(STATUTS_RDV).map(([k, v]) => `<option value="${k}" ${k === r.statut ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      ${['acceptee', 'autreDate'].includes(r.statut) && date ? `<button class="btn small" data-agenda="${i}" title="Ajouter à mon agenda">Agenda</button>` : ''}
      <button class="btn small ${r.statut === 'aFaire' || l.relance ? 'primary' : ''}" data-ecrire="${i}">${r.statut === 'aFaire' ? 'Rédiger' : l.relance ? 'Relancer' : ['acceptee', 'autreDate'].includes(r.statut) ? 'Confirmer' : 'Écrire'}</button>
    </div></li>`;
}

// Réponse du magasin : acceptée (ajout à la tournée), autre date (on demande laquelle), refusée…
async function reponse(l, statut, s) {
  const r = l.rdv;
  const extra = {};
  if (statut === 'acceptee' || statut === 'autreDate') {
    const autre = statut === 'autreDate';
    const f = await modal({ titre: autre ? 'Nouvelle date proposée par le magasin' : 'Rendez-vous accepté', valider: 'Enregistrer', corps: `
      <p><strong>${esc(l.m.nom)}</strong></p>
      <div class="row"><label>Date<input type="date" name="date" value="${esc((autre ? r.dateRetenue : r.date) || l.date || today())}" required></label>
      <label>Heure<input type="time" name="heure" value="${esc((autre ? r.heureRetenue : r.heure) || l.heure || '')}"></label></div>
      <p class="hint">Le magasin sera ajouté à ta tournée de ce jour-là, avec l'heure du rendez-vous.</p>` });
    if (!f) return;
    Object.assign(extra, autre ? { dateRetenue: f.date, heureRetenue: f.heure } : { date: f.date, heure: f.heure });
  }
  const { ajoute, rdv } = await changerStatut(r, statut, extra);
  toast(ajoute ? `Rendez-vous ajouté à ta tournée du ${dateEnLettres(ajoute)}` : `${STATUTS_RDV[statut].label}`);
  if (statut === 'acceptee' || statut === 'autreDate') await agenda(l, rdv, s, 'Rendez-vous confirmé : l\'ajouter à ton agenda ?');
}
function agenda(l, r, s, titre) {
  const c = l.contacts.find(x => x.id === r.contactId) || l.contacts[0];
  const objet = OBJETS_VISITE.find(o => (o.id || o) === r.objet);
  return proposerAgenda(evenementRdv(l.m, r, s, c, objet?.label || objet || r.objet || ''), titre ? { titre } : {});
}

// Rédaction (une ou plusieurs demandes à la suite)
function rediger(file, s, fin) {
  let i = 0;
  const d = document.createElement('dialog');
  d.className = 'modal large composer';
  document.body.append(d);
  d.onclose = () => { d.remove(); fin(); };

  const afficher = async () => {
    const l = file[i];
    const r = l.rdv;
    if (!r.date && l.date) { r.date = l.date; r.heure = l.heure; }
    if (!r.objet) r.objet = l.objet || s.objetDefaut;
    const type0 = l.relance || r.statut === 'envoyee' || r.statut === 'relancee' ? 'relance' : ['acceptee', 'autreDate'].includes(r.statut) ? 'confirmation' : 'demande';
    const mods = modeles(s);
    d.innerHTML = `<form method="dialog">
      <header><h2>${esc(l.m.nom)}</h2>${file.length > 1 ? `<span class="muted">${i + 1} / ${file.length}</span>` : ''}<button type="button" class="btn-icon" data-close aria-label="Fermer">✕</button></header>
      <div class="modal-body">
        <div class="row">
          <label>Contact<select id="cCt">${l.contacts.map(c => `<option value="${c.id}" ${c.id === r.contactId ? 'selected' : ''}>${esc(c.nom || 'Contact')}${roleDe(c) ? ` (${esc(roleDe(c))})` : ''}${c.email ? ` — ${esc(c.email)}` : ''}${!c.email && c.tel ? ` — ${esc(c.tel)}` : ''}</option>`).join('') || '<option value="">Aucun contact enregistré</option>'}</select></label>
          <label>Civilité<select id="cCiv"></select></label>
          <label>Message<select id="cType">${Object.entries(mods).filter(([, m]) => !m.groupe).map(([k, m]) => `<option value="${k}" ${k === type0 ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label></div>
        <div class="row">
          <label>Date proposée<input type="date" id="cDate" value="${esc(r.date || '')}"><small class="tag ferie" id="cFer" hidden></small></label>
          <label>Heure<input type="time" id="cHeure" value="${esc(r.heure || '')}"></label>
          <label>Objet<select id="cObjet">${OBJETS_VISITE.map(o => `<option ${o === r.objet ? 'selected' : ''}>${o}</option>`).join('')}</select></label></div>
        <label id="lSujet">Objet du mail<input id="cSujet"></label>
        <label>Texte<textarea id="cCorps" rows="12"></textarea></label>
        <p class="hint">Tu peux modifier le texte avant l'envoi. ${s.commercial ? '' : 'Renseigne ton nom, ton téléphone et ton e-mail pro dans les Réglages pour la signature.'}</p>
      </div>
      <footer class="composer-actions">
        <span class="spacer"></span>
        <a class="btn" id="cTel">Appeler</a>
        <a class="btn" id="cSms">Envoyer par SMS</a>
        <button type="button" class="btn" id="cCopy">Copier le texte</button>
        <a class="btn primary" id="cMail">${r.mailOuvert ? `Messagerie ouverte le ${fmtDate(r.mailOuvert)} · rouvrir` : 'Ouvrir dans ma messagerie'}</a>
        ${file.length > 1 ? `<button type="button" class="btn ghost" id="cNext">${i < file.length - 1 ? 'Suivant' : 'Terminer'}</button>` : ''}
      </footer></form>`;
    if (!d.open) d.showModal();
    $$('[data-close]', d).forEach(b => b.onclick = () => d.close());

    const contact = () => l.contacts.find(c => c.id === $('#cCt', d).value) || l.contacts[0];
    const LIB = { M: 'Monsieur', Mme: 'Madame', MmeM: 'Madame, Monsieur' };
    const remplirCiv = () => {   // « Auto » = devinée d'après le nom ; le choix est gardé sur le contact
      const c = contact() || {}, g = civiliteDevinee(c);
      $('#cCiv', d).innerHTML = `<option value="">Auto (${g ? LIB[g] : 'sans civilité'})</option><option value="M">Monsieur</option><option value="Mme">Madame</option><option value="MmeM">Madame, Monsieur</option><option value="aucune">Sans (« Bonjour »)</option>`;
      $('#cCiv', d).value = c.civilite || '';
    };
    $('#cCiv', d).onchange = async () => {
      const c = contact(); if (!c) return;
      c.civilite = $('#cCiv', d).value || undefined;
      const brut = await db.get('contacts', c.id); if (brut) await db.put('contacts', { ...brut, civilite: c.civilite, maj: new Date().toISOString() });
      maj();
    };
    const maj = () => {
      r.date = $('#cDate', d).value; r.heure = $('#cHeure', d).value; r.objet = $('#cObjet', d).value; r.contactId = contact()?.id;
      const type = $('#cType', d).value;
      const msg = genererMessage(type, { m: l.m, contact: contact(), rdv: r, s });
      $('#cSujet', d).value = msg.sujet; $('#cCorps', d).value = msg.corps;
      const fer = ferie(r.date); $('#cFer', d).hidden = !fer; $('#cFer', d).textContent = fer ? `Férié · ${fer}` : '';
      $('#lSujet', d).hidden = type === 'sms';
      const c = contact() || {};
      const tel = c.tel || c.tel2 || l.m.telMagasin;
      const mob = [c.tel, c.tel2].find(estMobile);
      $('#cTel', d).hidden = !tel; if (tel) $('#cTel', d).href = `tel:${tel.replace(/\s/g, '')}`;
      $('#cSms', d).hidden = !mob;
      $('#cMail', d).hidden = !c.email; $('#cMail', d).classList.toggle('primary', !!c.email && !r.mailOuvert); $('#cMail', d).classList.toggle('deja', !!r.mailOuvert);
    };
    ['#cType', '#cDate', '#cHeure', '#cObjet'].forEach(k => $(k, d).onchange = maj);
    $('#cCt', d).onchange = () => { remplirCiv(); maj(); };
    remplirCiv(); maj();

    // l'envoi marque la demande comme envoyée (ou relancée)
    const marquer = async () => {
      const type = $('#cType', d).value;
      const base = { contactId: r.contactId, date: r.date, heure: r.heure, objet: r.objet };
      if (type === 'confirmation') { await db.put('rdv', { ...r, ...base, maj: new Date().toISOString() }); return; }
      const st = r.statut === 'aFaire' ? 'envoyee' : (['envoyee', 'relancee'].includes(r.statut) ? 'relancee' : r.statut);
      const res = await changerStatut(r, st, base);
      l.rdv = res.rdv;
      toast(st === 'relancee' ? 'Marquée comme relancée' : 'Marquée comme envoyée');
    };
    $('#cMail', d).onclick = async e => {
      const b = e.currentTarget;
      b.href = lienMail(contact()?.email, $('#cSujet', d).value, $('#cCorps', d).value);
      r.mailOuvert = new Date().toISOString().slice(0, 10);
      b.classList.add('deja'); b.classList.remove('primary'); b.textContent = 'Messagerie ouverte ✓ · rouvrir';   // on voit qu'on a déjà appuyé
      await marquer(); l.rdv.mailOuvert = r.mailOuvert; await db.put('rdv', { ...l.rdv, mailOuvert: r.mailOuvert });
    };
    $('#cSms', d).onclick = e => { const c = contact(); e.currentTarget.href = lienSms([c.tel, c.tel2].find(estMobile), $('#cCorps', d).value); marquer(); };
    $('#cCopy', d).onclick = async () => {
      const t = ($('#cType', d).value === 'sms' ? '' : `Objet : ${$('#cSujet', d).value}\n\n`) + $('#cCorps', d).value;
      try { await navigator.clipboard.writeText(t); toast('Texte copié'); } catch { $('#cCorps', d).select(); document.execCommand('copy'); toast('Texte copié'); }
      marquer();
    };
    $('#cNext', d)?.addEventListener('click', () => { if (i < file.length - 1) { i++; afficher(); } else d.close(); });
  };
  afficher();
}

// ── Un seul mail à tous : texte générique, contacts en copie cachée (Cci) ──────────────
async function mailGroupe(lignes, s, fin) {
  const avecMail = lignes.map(l => ({ l, c: l.contacts.find(c => c.id === l.rdv.contactId && c.email) || l.contacts.find(c => c.email) })).filter(x => x.c);
  const emails = [...new Set(avecMail.map(x => x.c.email.trim().toLowerCase()))];
  const sans = lignes.length - avecMail.length;
  if (!emails.length) return toast('Aucune adresse e-mail parmi ces magasins', 'warn');
  const msg = genererMessage('groupe', { s, rdv: { objet: s.objetDefaut } });
  const p = modal({ titre: 'Un seul mail à tous', valider: 'Fermer', large: true, corps: `
    <p><strong>${emails.length} adresse${emails.length > 1 ? 's' : ''}</strong> en copie cachée (personne ne voit les autres)${sans ? ` · <span class="muted">${sans} magasin${sans > 1 ? 's' : ''} sans e-mail : à faire au cas par cas</span>` : ''}.</p>
    <label>Objet<select id="gObjet">${OBJETS_VISITE.map(o => `<option ${o === s.objetDefaut ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
    <label>Objet du mail<input id="gSujet" value="${esc(msg.sujet)}"></label>
    <label>Texte<textarea id="gCorps" rows="11">${esc(msg.corps)}</textarea></label>
    <label class="check"><input type="checkbox" id="gMarquer" checked> Marquer ces demandes comme envoyées</label>
    <div class="actions"><a class="btn primary" id="gMail">Ouvrir dans ma messagerie</a><button type="button" class="btn" id="gCopie">Copier les adresses</button></div>
    <p class="hint">Avant d'envoyer, vérifie que les adresses sont bien dans <strong>Cci</strong> et que « À » est vide. Texte générique, sans prénom ni nom de magasin. Pour un message personnalisé, utilise « Écrire » sur chaque magasin, comme d'habitude.</p>` });
  const dlg = document.querySelector('dialog[open]');
  const q = x => dlg.querySelector(x);
  q('#gObjet').onchange = () => { const m = genererMessage('groupe', { s, rdv: { objet: q('#gObjet').value } }); q('#gSujet').value = m.sujet; q('#gCorps').value = m.corps; };
  const copier = async () => { try { await navigator.clipboard.writeText(emails.join(separateurMails() + ' ')); return true; } catch { return false; } };
  q('#gCopie').onclick = async () => toast(await copier() ? `${emails.length} adresses copiées : colle-les dans le champ Cci` : 'Copie impossible sur cet appareil', 'warn');
  q('#gMail').onclick = async e => {
    const b = e.currentTarget;
    const lien = lienMailCci(emails, q('#gSujet').value, q('#gCorps').value);
    if (lien) b.href = lien;
    else { await copier(); b.href = lienMail('', q('#gSujet').value, q('#gCorps').value); toast(`Trop d'adresses pour les mettre dans le lien : elles sont copiées, colle-les dans le champ Cci`); }
    b.classList.add('deja'); b.classList.remove('primary'); b.textContent = 'Messagerie ouverte ✓ · rouvrir';
    if (q('#gMarquer').checked && !b.dataset.fait) {
      b.dataset.fait = '1';
      const jour = new Date().toISOString().slice(0, 10);
      for (const { l } of avecMail) {
        const r = l.rdv, st = r.statut === 'aFaire' ? 'envoyee' : ['envoyee', 'relancee'].includes(r.statut) ? 'relancee' : null;
        if (st) { const res = await changerStatut(r, st, { objet: q('#gObjet').value }); await db.put('rdv', { ...res.rdv, mailOuvert: jour }); }
      }
      toast(`${avecMail.length} demande${avecMail.length > 1 ? 's' : ''} marquée${avecMail.length > 1 ? 's' : ''} comme envoyée${avecMail.length > 1 ? 's' : ''}`);
    }
  };
  await p;
  fin();
}
