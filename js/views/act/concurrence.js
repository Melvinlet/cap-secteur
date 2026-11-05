// Concurrence : marques, produits, offres et mises en avant relevés en magasin.
import { db, uid } from '../../db.js';
import { $, $$, esc, fmtDate, modal, toast, confirmer, norm, downloadBlob } from '../../ui.js';
import { MARQUES_CONCURRENTES, TYPES_CONCURRENCE } from '../../config.js';
import { loadExcelJS } from '../../services/excel.js';

const today = () => new Date().toISOString().slice(0, 10);
let f = { q: '', marque: '', type: '', ens: '' };

export async function render(el) {
  const [items, mags] = await Promise.all([db.all('concurrence'), db.all('magasins')]);
  const byId = new Map(mags.map(m => [m.id, m]));
  const q = norm(f.q);
  const liste = items.filter(c => (!f.marque || c.marque === f.marque) && (!f.type || c.type === f.type)
    && (!f.ens || byId.get(c.magasinId)?.enseigne === f.ens) && (!q || norm(`${c.marque} ${c.produit} ${c.observation} ${byId.get(c.magasinId)?.nom || ''}`).includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const parMarque = {}; items.forEach(c => { parMarque[c.marque || '?'] = (parMarque[c.marque || '?'] || 0) + 1; });
  const marques = Object.entries(parMarque).sort((a, b) => b[1] - a[1]);
  const ens = [...new Set(items.map(c => byId.get(c.magasinId)?.enseigne).filter(Boolean))].sort();

  el.innerHTML = `
    <div class="actions"><button class="btn primary" id="add">Ajouter un relevé</button><button class="btn" id="xls" ${liste.length ? '' : 'disabled'}>Exporter (Excel)</button></div>
    ${marques.length ? `<div class="chips"><button class="chip" data-mq="" aria-pressed="${!f.marque}">Toutes (${items.length})</button>${marques.map(([m, n]) => `<button class="chip" data-mq="${esc(m)}" aria-pressed="${f.marque === m}">${esc(m)} (${n})</button>`).join('')}</div>` : ''}
    <div class="rdv-f">
      <input type="search" id="q" placeholder="Produit, offre, magasin…" value="${esc(f.q)}" aria-label="Rechercher">
      <select id="type"><option value="">Tous les types</option>${TYPES_CONCURRENCE.map(t => `<option ${t === f.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <select id="ens"><option value="">Toutes les enseignes</option>${ens.map(e => `<option ${e === f.ens ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>
    </div>
    ${liste.length ? '' : '<p class="muted vide">Aucun relevé. Ajoute-les ici ou directement dans tes comptes rendus de visite.</p>'}
    <table class="table conc" ${liste.length ? '' : 'hidden'}><thead><tr><th>Date</th><th>Marque</th><th>Produit</th><th>Type</th><th>Observation / offre</th><th>Magasin</th><th></th></tr></thead><tbody>
    ${liste.map(c => { const m = byId.get(c.magasinId); return `<tr><td>${fmtDate(c.date)}</td><td><strong>${esc(c.marque)}</strong></td><td>${esc(c.produit || '')}</td><td>${esc(c.type || '')}</td>
      <td>${esc(c.observation || '')}</td><td>${m ? `<a href="#/magasin/${encodeURIComponent(m.id)}">${esc(m.nom)}</a>` : ''}${c.noteId ? ` <a class="muted" href="#/cr/${encodeURIComponent(c.magasinId)}/${c.noteId}">(visite)</a>` : ''}</td>
      <td><button class="btn-icon" data-ed="${c.id}" aria-label="Modifier">✎</button></td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">Aucun relevé. Ajoute-les ici ou directement dans tes comptes rendus de visite.</td></tr>'}</tbody></table>`;

  $('#q', el).oninput = e => { f.q = e.target.value; clearTimeout(f.t); f.t = setTimeout(() => render(el).then(() => { const i = $('#q', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 300); };
  $('#type', el).onchange = e => { f.type = e.target.value; render(el); };
  $('#ens', el).onchange = e => { f.ens = e.target.value; render(el); };
  $$('[data-mq]', el).forEach(b => b.onclick = () => { f.marque = b.dataset.mq; render(el); });
  $('#add', el).onclick = () => editer({}, mags).then(ok => ok && render(el));
  $$('[data-ed]', el).forEach(b => b.onclick = () => editer(items.find(c => c.id === b.dataset.ed), mags).then(ok => ok && render(el)));
  $('#xls', el).onclick = async () => {
    const ExcelJS = await loadExcelJS();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Concurrence');
    ws.columns = [{ header: 'Date', width: 12 }, { header: 'Marque', width: 18 }, { header: 'Produit', width: 26 }, { header: 'Type', width: 18 }, { header: 'Observation / offre', width: 50 }, { header: 'Magasin', width: 34 }, { header: 'Enseigne', width: 14 }];
    ws.getRow(1).font = { bold: true, name: 'Arial' };
    liste.forEach(c => { const m = byId.get(c.magasinId); ws.addRow([c.date, c.marque, c.produit || '', c.type || '', c.observation || '', m?.nom || '', m?.enseigne || '']); });
    downloadBlob(new Blob([await wb.xlsx.writeBuffer()]), 'Relevés concurrence.xlsx');
  };
}

async function editer(c, mags) {
  const noms = mags.map(m => m.nom).sort();
  const p = modal({ titre: c.id ? 'Relevé concurrence' : 'Nouveau relevé concurrence', corps: `
    <div class="row"><label>Date<input type="date" name="date" value="${esc(c.date || today())}" required></label>
    <label class="grow">Magasin<input name="magasin" list="magsC" value="${esc(mags.find(m => m.id === c.magasinId)?.nom || '')}" placeholder="facultatif"></label></div>
    <datalist id="magsC">${noms.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <div class="row"><label>Marque<input name="marque" list="marquesC" value="${esc(c.marque || '')}" required></label>
    <label class="grow">Produit / gamme<input name="produit" value="${esc(c.produit || '')}"></label></div>
    <datalist id="marquesC">${MARQUES_CONCURRENTES.map(x => `<option value="${esc(x)}">`).join('')}</datalist>
    <label>Type<select name="type">${TYPES_CONCURRENCE.map(t => `<option ${t === c.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label>Observation / offre constatée<textarea name="observation" rows="3" placeholder="ex. promo -20 % sur la gamme, 2 têtes de gondole, meuble dédié, formation des vendeurs…">${esc(c.observation || '')}</textarea></label>
    ${c.id ? '<button type="button" class="btn danger small" id="delC2">Supprimer ce relevé</button>' : ''}` });
  let supprime = false;
  $('#delC2')?.addEventListener('click', async () => { $('#delC2').closest('dialog').close(); if (await confirmer('Supprimer le relevé', 'Supprimer ce relevé concurrence ?')) { await db.del('concurrence', c.id); supprime = true; } });
  const r = await p;
  if (supprime) return true;
  if (!r) return false;
  const m = mags.find(x => x.nom === r.magasin);
  await db.put('concurrence', { ...c, id: c.id || uid('cc'), date: r.date, magasinId: m?.id || c.magasinId || '', marque: r.marque.trim(), produit: r.produit.trim(), type: r.type, observation: r.observation.trim(), maj: new Date().toISOString() });
  toast('Relevé enregistré');
  return true;
}
