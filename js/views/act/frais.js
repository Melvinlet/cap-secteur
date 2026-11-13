// Notes de frais : dépenses, ce qui m'est dû, ce qui a été remboursé, justificatifs, export.
import { db, uid, getSettings } from '../../db.js';
import { $, $$, esc, fmtDate, modal, toast, downloadBlob, confirmer } from '../../ui.js';
import { STATUTS_FRAIS, DEFAULT_SETTINGS, PROFIL } from '../../config.js';
import { periode, decaler, libellePeriode } from '../../services/activite.js';
import { reduireImage, imageURL } from '../../services/images.js';
import { loadExcelJS } from '../../services/excel.js';
import { genererNdf, genererNdfPdf, nomFichierNdf, colonneNdf, estIkm, baremeProfil, estPdf } from '../../services/ndf.js';

const today = () => new Date().toISOString().slice(0, 10);
const euros = v => `${(Math.round((Number(v) || 0) * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
let f = { type: 'mois', du: null, au: null, statut: '', cat: '', ouverts: new Set() };
const pdfDe = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
const du = x => x.payeur === 'moi' && x.remboursable && !['remboursee', 'refusee'].includes(x.statut);

// La liste est rangée par étape : à déclarer → déclarées (en attente de remboursement) → remboursées / refusées (repliées)
const GROUPES = [['aDeclarer', 'À déclarer', 'Tout marquer « Déclarée »'], ['declaree', 'Déclarées · en attente de remboursement', 'Tout marquer « Remboursée »'],
  ['remboursee', 'Remboursées', ''], ['refusee', 'Refusées', '']];
const ligne = x => `<tr class="${du(x) ? 'du' : ''}"><td>${fmtDate(x.date)}</td><td>${esc(x.categorie)}${x.km ? ` <small class="muted">${x.km} km</small>` : ''}</td>
      <td>${esc(x.libelle || '')}${x.justificatif ? ' <span title="Justificatif joint">📎</span>' : ''}</td>
      <td>${x.payeur === 'moi' ? 'Moi' : 'Carte société'}${x.payeur === 'moi' && !x.remboursable ? ' <small class="muted">(non remb.)</small>' : ''}</td>
      <td class="num">${euros(x.montant)}</td>
      <td><select data-st="${x.id}" aria-label="Statut">${Object.entries(STATUTS_FRAIS).map(([k, v]) => `<option value="${k}" ${x.statut === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><button class="btn-icon" data-ed="${x.id}" aria-label="Modifier">✎</button></td></tr>`;

export async function render(el) {
  const s = await getSettings();
  if (!f.du) [f.du, f.au] = periode(f.type, today());
  const tous = (await db.all('frais')).sort((a, b) => b.date.localeCompare(a.date));
  const liste = tous.filter(x => x.date >= f.du && x.date <= f.au && (!f.statut || x.statut === f.statut) && (!f.cat || x.categorie === f.cat));
  const somme = arr => arr.reduce((a, x) => a + (Number(x.montant) || 0), 0);
  const resteGlobal = somme(tous.filter(du));                 // tout ce qu'on me doit encore, toutes périodes confondues
  const ANCIENNES = 'Hôtel,Repas,Carburant,Péage,Parking,Transport,Fournitures,Téléphone,Autre';   // ancienne liste par défaut → remplacée par celle du profil
  const base = (s.categoriesFrais || []).join(',') === ANCIENNES ? DEFAULT_SETTINGS.categoriesFrais : (s.categoriesFrais || []);
  const cats = [...new Set([...base, ...tous.map(x => x.categorie).filter(Boolean)])];

  el.innerHTML = `
    <div class="periode">
      <div class="seg">${[['mois', 'Mois'], ['annee', 'Année'], ['perso', 'Dates']].map(([k, l]) => `<button data-type="${k}" aria-selected="${f.type === k}">${l}</button>`).join('')}</div>
      ${f.type === 'perso' ? `<label>Du<input type="date" id="du" value="${f.du}"></label><label>Au<input type="date" id="au" value="${f.au}"></label>`
        : `<button class="btn-icon" id="prev" aria-label="Précédent">‹</button><strong class="per-lab">${esc(libellePeriode(f.type, f.du, f.au))}</strong><button class="btn-icon" id="next" aria-label="Suivant">›</button>`}
    </div>
    <div class="tour-sum frais-sum">
      <div><span class="big">${euros(somme(liste))}</span> dépensé sur la période</div>
      <div><span class="big">${euros(somme(liste.filter(x => x.payeur === 'moi')))}</span> avancé par moi</div>
      <div><span class="big">${euros(somme(liste.filter(x => x.statut === 'remboursee')))}</span> remboursé</div>
      <div class="${resteGlobal ? 'over' : ''}"><span class="big">${euros(resteGlobal)}</span> on me doit (au total)</div>
    </div>
    <div class="actions">
      <button class="btn primary" id="add">Ajouter une dépense</button>
      <button class="btn primary" id="ndf" ${liste.length ? '' : 'disabled'}>${esc(PROFIL.ndf.nom || 'Note de frais')} (Excel)</button>
      <button class="btn primary" id="ndfPdf" ${liste.length ? '' : 'disabled'}>Note de frais en PDF</button>
      <button class="btn" id="xls" ${liste.length ? '' : 'disabled'}>Export simple (Excel)</button>
      <select id="fst" aria-label="Statut"><option value="">Tous les statuts</option>${Object.entries(STATUTS_FRAIS).map(([k, v]) => `<option value="${k}" ${f.statut === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <select id="fcat" aria-label="Catégorie"><option value="">Toutes catégories</option>${cats.map(c => `<option ${f.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
    </div>
    <table class="table frais"><thead><tr><th>Date</th><th>Catégorie</th><th>Détail</th><th>Payé par</th><th class="num">Montant</th><th>Statut</th><th></th></tr></thead>
    ${GROUPES.map(([st, titre, bouton]) => { const g = liste.filter(x => x.statut === st); if (!g.length) return '';
      const ferme = ['remboursee', 'refusee'].includes(st) && !f.ouverts.has(st);
      return `<tbody class="frais-grp${ferme ? ' ferme' : ''}" data-grp="${st}">
        <tr class="grp"><th colspan="7"><div class="grp-l"><button class="grp-tete" data-tog="${st}" aria-expanded="${!ferme}"><span class="grp-fl">▾</span> ${titre} <small class="muted">${g.length} · ${euros(somme(g))}</small></button>
          ${bouton ? `<button class="btn small" data-tout="${st}">${bouton}</button>` : ''}</div></th></tr>
        ${g.map(ligne).join('')}</tbody>`; }).join('')
      || '<tbody><tr><td colspan="7" class="muted">Aucune dépense sur cette période.</td></tr></tbody>'}</table>
    <p class="hint">« On me doit » = dépenses avancées par toi, remboursables, pas encore remboursées. Les catégories se modifient dans les Réglages.</p>`;

  $$('[data-type]', el).forEach(b => b.onclick = () => { f.type = b.dataset.type; if (f.type !== 'perso') [f.du, f.au] = periode(f.type, today() >= f.du && today() <= f.au ? today() : f.du); render(el); });
  $('#prev', el)?.addEventListener('click', () => { [f.du, f.au] = decaler(f.type, f.du, -1); render(el); });
  $('#next', el)?.addEventListener('click', () => { [f.du, f.au] = decaler(f.type, f.du, 1); render(el); });
  $('#du', el)?.addEventListener('change', e => { f.du = e.target.value; render(el); });
  $('#au', el)?.addEventListener('change', e => { f.au = e.target.value; render(el); });
  $('#fst', el).onchange = e => { f.statut = e.target.value; render(el); };
  $('#fcat', el).onchange = e => { f.cat = e.target.value; render(el); };
  $('#add', el).onclick = () => editer({}, s, base).then(ok => ok && render(el));
  $$('[data-ed]', el).forEach(b => b.onclick = () => editer(tous.find(x => x.id === b.dataset.ed), s, base).then(ok => ok && render(el)));
  $$('[data-st]', el).forEach(sel => sel.onchange = async () => {
    const x = tous.find(y => y.id === sel.dataset.st);
    await db.put('frais', { ...x, statut: sel.value, maj: new Date().toISOString(), ...(sel.value === 'remboursee' ? { rembourseLe: today() } : {}) });
    render(el);
  });
  $$('[data-tog]', el).forEach(b => b.onclick = () => { const st = b.dataset.tog; f.ouverts.has(st) ? f.ouverts.delete(st) : f.ouverts.add(st);
    const g = b.closest('tbody'); const ferme = g.classList.toggle('ferme'); b.setAttribute('aria-expanded', !ferme); });
  // tout le bloc de la période d'un coup (le mois affiché par défaut)
  $$('[data-tout]', el).forEach(b => b.onclick = async () => {
    const de = b.dataset.tout, vers = de === 'aDeclarer' ? 'declaree' : 'remboursee';
    const n = liste.filter(x => x.statut === de && (vers === 'declaree' || du(x)));   // remboursé : seulement ce qu'on me doit
    if (!n.length) return toast('Rien à marquer remboursé : ces dépenses sont non remboursables ou payées par la carte société', 'warn');
    const per = libellePeriode(f.type, f.du, f.au);
    const ok = await modal({ titre: vers === 'declaree' ? 'Tout déclarer' : 'Tout marquer remboursé', valider: 'Valider',
      corps: `<p>${n.length} dépense${n.length > 1 ? 's' : ''} (${esc(per)}) passe${n.length > 1 ? 'nt' : ''} en « ${STATUTS_FRAIS[vers]} ».</p>` });
    if (ok === null) return;
    const maj = new Date().toISOString();
    for (const x of n) await db.put('frais', { ...x, statut: vers, maj, ...(vers === 'declaree' ? { declareLe: today() } : { rembourseLe: today() }) });
    toast(`${n.length} dépense${n.length > 1 ? 's' : ''} : ${STATUTS_FRAIS[vers]}`);
    render(el);
  });
  $('#ndf', el).onclick = () => noteEntreprise(liste, s, 'xlsx').then(ok => ok && render(el));
  $('#ndfPdf', el).onclick = () => noteEntreprise(liste, s, 'pdf').then(ok => ok && render(el));
  $('#xls', el).onclick = async () => {
    const ExcelJS = await loadExcelJS();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Notes de frais');
    ws.columns = [{ header: 'Date', width: 12 }, { header: 'Catégorie', width: 16 }, { header: 'Détail', width: 36 }, { header: 'Km', width: 8 },
      { header: 'Payé par', width: 14 }, { header: 'Remboursable', width: 13 }, { header: 'Montant TTC (€)', width: 15 }, { header: 'dont TVA (€)', width: 12 }, { header: 'Statut', width: 13 }];
    ws.getRow(1).font = { bold: true, name: 'Arial' };
    liste.slice().reverse().forEach(x => ws.addRow([x.date, x.categorie, x.libelle || '', x.km || '', x.payeur === 'moi' ? 'Moi' : 'Carte société',
      x.remboursable ? 'Oui' : 'Non', Number(x.montant) || 0, Number(x.tva) || '', STATUTS_FRAIS[x.statut]]));
    const last = ws.rowCount;
    ws.addRow(['', '', 'Total', '', '', '', { formula: `SUM(G2:G${last})` }]).font = { bold: true };
    ws.getColumn(7).numFmt = '#,##0.00 €'; ws.getColumn(8).numFmt = '#,##0.00 €';
    ws.eachRow(r => r.eachCell(c => { c.font = { name: 'Arial', ...(c.font || {}) }; }));
    downloadBlob(new Blob([await wb.xlsx.writeBuffer()]), `Notes de frais ${f.du} au ${f.au}.xlsx`);
  };
}

async function editer(x, s, base) {
  const cats = (base.length ? base : DEFAULT_SETTINGS.categoriesFrais).filter(c => !/^autres?$/i.test(c));
  const autre = !!x.categorie && !cats.includes(x.categorie);   // catégorie hors liste : « Autre » + le texte saisi
  const justRec = x.justificatif ? await db.get('images', x.justificatif) : null;
  const just = justRec?.blob ? (estPdf(justRec.blob) ? { pdf: URL.createObjectURL(justRec.blob) } : await imageURL(db, x.justificatif)) : '';
  let nouveauJust = null;
  const p = modal({ titre: x.id ? 'Modifier la dépense' : 'Nouvelle dépense', corps: `
    <div class="row"><label>Date<input type="date" name="date" value="${esc(x.date || today())}" required></label>
    <label>Catégorie<select name="categorie" required>${cats.map(c => `<option ${!autre && (x.categorie || cats[0]) === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
      <option value="__autre" ${autre ? 'selected' : ''}>Autre (à préciser)…</option></select><small class="hint" id="colNdf"></small></label></div>
    <label id="autreL" ${autre ? '' : 'hidden'}>Précise la catégorie<input name="categorieAutre" value="${esc(autre ? x.categorie : '')}" placeholder="ex. Lavage voiture, Matériel PLV…"></label>
    <label>Libellé (commerce, ou destination pour les km)<input name="libelle" value="${esc(x.libelle || '')}" placeholder="ex. INDIGO, SANEF, IBIS BUDGET, Boulangerie…"></label>
    <div class="row"><label>Montant TTC (€)<input type="number" step="0.01" min="0" name="montant" value="${esc(x.montant ?? '')}"></label>
    <label>dont TVA (€, facultatif)<input type="number" step="0.01" min="0" name="tva" value="${esc(x.tva ?? '')}"></label>
    <label>Kilomètres (facultatif)<input type="number" min="0" name="km" value="${esc(x.km ?? '')}"></label></div>
    ${Number(s.tauxKm) ? `<p class="hint">Indemnités km : montant = km × ${s.tauxKm} € si tu laisses le montant vide.</p>` : ''}
    <div class="row"><label>Payé par<select name="payeur"><option value="moi" ${x.payeur !== 'societe' ? 'selected' : ''}>Moi (avance)</option><option value="societe" ${x.payeur === 'societe' ? 'selected' : ''}>Carte société</option></select></label>
    <label>Statut<select name="statut">${Object.entries(STATUTS_FRAIS).map(([k, v]) => `<option value="${k}" ${(x.statut || 'aDeclarer') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>
    <label class="check"><input type="checkbox" name="remboursable" ${x.remboursable !== false ? 'checked' : ''}> Remboursable</label>
    <fieldset><legend>Justificatif</legend>${just?.pdf ? `<p><a class="btn small" href="${just.pdf}" target="_blank" rel="noopener">📄 Ouvrir le justificatif PDF</a></p>` : just ? `<img src="${just}" class="just" alt="Justificatif">` : ''}
      <div class="choix-photo">
        <label class="btn" for="justCam">📷 Prendre une photo</label>
        <label class="btn" for="justGal">🖼️ Choisir une photo ou un PDF</label>
        <span class="muted small" id="justNom"></span>
      </div>
      <input type="file" id="justCam" accept="image/*" capture="environment" hidden>
      <input type="file" id="justGal" accept="image/*,application/pdf,.pdf" hidden></fieldset>
    ${x.id ? '<button type="button" class="btn danger small" id="delF">Supprimer cette dépense</button>' : ''}` });
  for (const id of ['#justCam', '#justGal']) $(id).onchange = e => {
    nouveauJust = e.target.files[0] || null;
    if (nouveauJust && pdfDe(nouveauJust) && nouveauJust.size > 4e6) { nouveauJust = null; e.target.value = ''; return toast('PDF trop lourd (plus de 4 Mo) : prends plutôt une photo du ticket', 'warn'); }
    $('#justNom').textContent = nouveauJust ? `✓ ${nouveauJust.name || 'photo'} (enregistré${pdfDe(nouveauJust) ? '' : 'e'} avec la dépense)` : '';
  };
  const catDe = f => f.categorie.value === '__autre' ? (f.categorieAutre.value.trim() || 'Autre') : f.categorie.value;
  const majCol = () => { const f = $('#colNdf').closest('form');
    const estAutre = f.categorie.value === '__autre';
    $('#autreL').hidden = !estAutre; f.categorieAutre.required = estAutre;
    $('#colNdf').textContent = estIkm({ categorie: catDe(f), km: f.km.value || 1 }) ? `→ onglet « ${PROFIL.ndf.ongletIk || 'Indemnités km'} » de la note de frais` : `→ colonne « ${colonneNdf(catDe(f))} » de la note de frais`; };
  const fo = $('#colNdf').closest('form');
  fo.categorie.addEventListener('change', () => { majCol(); if (fo.categorie.value === '__autre') fo.categorieAutre.focus(); }); fo.categorieAutre.addEventListener('input', majCol); majCol();
  let supprime = false;
  $('#delF')?.addEventListener('click', async () => {
    $('#delF').closest('dialog').close();
    if (await confirmer('Supprimer la dépense', 'Supprimer définitivement cette dépense ?')) { await db.del('frais', x.id); if (x.justificatif) await db.del('images', x.justificatif); supprime = true; toast('Dépense supprimée'); }
  });
  const r = await p;
  if (supprime) return true;
  if (!r) return false;
  let justificatif = x.justificatif;
  if (nouveauJust) {
    // un PDF est gardé tel quel (ses pages iront dans la note) ; une photo est allégée
    const blob = pdfDe(nouveauJust) ? new Blob([await nouveauJust.arrayBuffer()], { type: 'application/pdf' }) : await reduireImage(nouveauJust, 1800, 0.8);
    justificatif = uid('jf'); await db.put('images', { id: justificatif, blob, type: 'justificatif' });
  }
  const km = Number(r.km) || 0;
  const montant = r.montant === '' && km && Number(s.tauxKm) ? km * Number(s.tauxKm) : Number(r.montant) || 0;
  await db.put('frais', { ...x, id: x.id || uid('f'), date: r.date, categorie: (r.categorie === '__autre' ? r.categorieAutre : r.categorie).trim() || 'Autre', libelle: r.libelle, montant, tva: r.tva === '' ? '' : Number(r.tva), km: km || '',
    payeur: r.payeur, remboursable: r.remboursable === 'on', statut: r.statut, justificatif, maj: new Date().toISOString() });
  toast('Dépense enregistrée');
  return true;
}

// Note de frais au format du profil entreprise : choix des dépenses, puis Excel et/ou PDF avec justificatifs
async function noteEntreprise(liste, s, format = 'xlsx') {
  const defaut = x => x.payeur === 'moi' && x.remboursable !== false && x.statut !== 'refusee' && x.statut !== 'remboursee';
  const tri = liste.slice().sort((a, b) => a.date.localeCompare(b.date));
  const r = await modal({ titre: PROFIL.ndf.nom || 'Note de frais', valider: 'Créer la note de frais', large: true, corps: `
    <div class="seg" role="radiogroup" aria-label="Fichier à créer">${[['pdf', 'PDF'], ['xlsx', 'Excel'], ['les2', 'Les deux']].map(([k, l]) => `<label class="seg-r"><input type="radio" name="format" value="${k}" ${k === format ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
    <p class="hint">PDF : le tableau de la note (comme l'Excel) puis tous les justificatifs, un par page, dans l'ordre des dates des dépenses.
    Excel : onglets « ${esc(PROFIL.ndf.ongletReel || 'Frais')} », « ${esc(PROFIL.ndf.ongletIk || 'Indemnités km')} » et « Justificatifs ». Les numéros de justificatif sont rappelés sur chaque ligne.</p>
    ${s.commercial ? '' : '<p class="banner">Renseigne ton nom dans les Réglages : il remplit « NOM » et le nom du fichier.</p>'}
    <label>Date de la note<input type="date" name="date" value="${today()}" required></label>
    <div class="ndf-list">${tri.map(x => `<label class="pick"><input type="checkbox" name="f:${x.id}" ${defaut(x) ? 'checked' : ''}>
      <span class="pick-info"><strong>${esc(x.libelle || x.categorie)}</strong><small>${fmtDate(x.date)} · ${esc(estIkm(x) ? 'Indemnités km' : colonneNdf(x.categorie))}${x.justificatif ? ' · 📎 justificatif' : ' · <b class="late-txt">sans justificatif</b>'}${x.payeur === 'societe' ? ' · carte société' : ''}${x.payeur === 'moi' && x.remboursable === false ? ' · <b>non remboursable</b>' : ''}${x.statut === 'declaree' ? ' · déjà déclarée' : x.statut === 'remboursee' ? ' · déjà remboursée' : ''}</small></span>
      <span class="pick-det">${euros(x.montant)}</span></label>`).join('')}</div>
    <p class="hint">Cochées par défaut : les dépenses que tu as avancées, remboursables et pas encore remboursées. Dans le fichier, elles sont classées par date de la dépense (pas par date d'ajout).</p>
    <label class="check"><input type="checkbox" name="declarer" checked> Passer ces dépenses en « Déclarée »</label>` });
  if (!r) return false;
  const choisis = tri.filter(x => r['f:' + x.id] === 'on');
  if (!choisis.length) { toast('Aucune dépense cochée', 'warn'); return false; }
  const images = new Map();
  for (const x of choisis) if (x.justificatif) { const im = await db.get('images', x.justificatif); if (im?.blob) images.set(x.justificatif, im); }
  let bareme = null;
  if (r.format !== 'pdf') bareme = await baremeProfil();
  const fichier = nomFichierNdf(s, r.date);
  if (r.format !== 'pdf') downloadBlob(await genererNdf(choisis, images, s, { date: r.date, bareme }), fichier);
  if (r.format !== 'xlsx') {
    try { downloadBlob(await genererNdfPdf(choisis, images, s, { date: r.date }), fichier.replace(/\.xlsx$/, '.pdf')); }
    catch (e) { toast(e.message || 'Création du PDF impossible', 'warn'); return false; }
  }
  if (r.declarer === 'on') for (const x of choisis.filter(y => y.statut === 'aDeclarer')) await db.put('frais', { ...x, statut: 'declaree', declareLe: today(), maj: new Date().toISOString() });
  const sans = choisis.filter(x => !x.justificatif).length;
  toast(`Note de frais créée : ${choisis.length} dépense${choisis.length > 1 ? 's' : ''}${sans ? ` (${sans} sans justificatif)` : ''}`);
  return true;
}
