// Historique des visites : tous les comptes rendus, filtrables, exportables.
import { getSettings } from '../../db.js';
import { $, $$, esc, borne, fmtDate, norm, downloadBlob, prioTag } from '../../ui.js';
import { ACTIONS_VISITE } from '../../config.js';
import { prioriteDe } from '../../data.js';
import { chargerTout, periode, libellePeriode, decaler } from '../../services/activite.js';
import { imageURL } from '../../services/images.js';
import { db } from '../../db.js';
import { loadExcelJS } from '../../services/excel.js';

const today = () => new Date().toISOString().slice(0, 10);
let f = { type: 'mois', du: null, au: null, q: '', ens: '', action: '' };

export async function render(el) {
  const s = await getSettings();
  if (!f.du) [f.du, f.au] = periode(f.type, today());
  const d = await chargerTout();
  const ens = [...new Set(d.magasins.map(m => m.enseigne))].sort();
  const q = norm(f.q);
  const liste = d.notes.filter(n => n.type === 'Visite' && n.date >= f.du && n.date <= f.au).map(n => ({ n, m: d.magById.get(n.magasinId) }))
    .filter(({ n, m }) => m && (!q || norm(`${m.nom} ${m.ville} ${n.texte || ''} ${n.contact || ''}`).includes(q)) && (!f.ens || m.enseigne === f.ens)
      && (!f.action || (n.actions || []).includes(f.action)))
    .sort((a, b) => (b.n.date + (b.n.arrivee || '')).localeCompare(a.n.date + (a.n.arrivee || '')));
  const concBy = new Map(); d.concurrence.forEach(c => { if (c.noteId) concBy.set(c.noteId, (concBy.get(c.noteId) || 0) + 1); });

  el.innerHTML = `
    <div class="periode">
      <div class="seg">${[['semaine', 'Semaine'], ['mois', 'Mois'], ['annee', 'Année'], ['perso', 'Dates']].map(([k, l]) => `<button data-type="${k}" aria-selected="${f.type === k}">${l}</button>`).join('')}</div>
      ${f.type === 'perso' ? `<label>Du<input type="date" id="du" value="${f.du}"></label><label>Au<input type="date" id="au" value="${f.au}"></label>`
        : `<button class="btn-icon" id="prev" aria-label="Précédent">‹</button><strong class="per-lab">${esc(libellePeriode(f.type, f.du, f.au))}</strong><button class="btn-icon" id="next" aria-label="Suivant">›</button>`}
    </div>
    <div class="rdv-f">
      <input type="search" id="q" placeholder="Magasin, ville, mot du compte rendu…" value="${esc(f.q)}" aria-label="Rechercher">
      <select id="ens"><option value="">Toutes les enseignes</option>${ens.map(e => `<option ${e === f.ens ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select>
      <select id="action"><option value="">Toutes les actions</option>${ACTIONS_VISITE.map(a => `<option ${a === f.action ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
      <button class="btn" id="xls" ${liste.length ? '' : 'disabled'}>Exporter (Excel)</button>
    </div>
    <p class="count">${liste.length} visite${liste.length > 1 ? 's' : ''}</p>
    <ul class="hist">${liste.map(({ n, m }) => `<li><a href="#/cr/${encodeURIComponent(m.id)}/${n.id}">
      ${borne(m.departement)}
      <div class="hist-main"><div class="hist-top"><strong>${esc(m.nom)}</strong> ${prioTag(prioriteDe(m))}<span class="muted">${fmtDate(n.date)}${n.arrivee ? ` · ${esc(n.arrivee)}${n.depart ? '–' + esc(n.depart) : ''}` : ''}${n.numero ? ` · ${esc(n.numero)}` : ''}</span>
        ${n.statut && n.statut !== 'Réalisée' ? `<span class="tag">${esc(n.statut)}</span>` : ''}</div>
        <small>${esc(n.objet || '')}${n.contact ? ` · avec ${esc(n.contact)}` : ''}</small>
        ${n.actions?.length ? `<p class="acts">${n.actions.map(a => `<span class="tag">${esc(a)}</span>`).join(' ')}</p>` : ''}
        ${n.texte ? `<p class="hist-txt">${esc(n.texte.slice(0, 220))}${n.texte.length > 220 ? '…' : ''}</p>` : ''}
        <small class="muted">${[n.photos?.length && `${n.photos.length} photo${n.photos.length > 1 ? 's' : ''}`, n.stock && Object.keys(n.stock).length && 'relevé de stock', concBy.get(n.id) && `${concBy.get(n.id)} relevé${concBy.get(n.id) > 1 ? 's' : ''} concurrence`, n.aFaire && `à faire : ${n.aFaire}`].filter(Boolean).map(esc).join(' · ')}</small>
      </div>
      ${n.photos?.length ? `<img class="hist-ph" data-ph="${esc(n.photos[0].id)}" alt="">` : ''}</a></li>`).join('') || '<li class="empty">Aucune visite sur cette période. Les comptes rendus apparaissent ici dès que tu les enregistres (fiche magasin → Compte rendu de visite).</li>'}</ul>`;

  $$('[data-ph]', el).forEach(async i => { i.src = await imageURL(db, i.dataset.ph); });
  $$('[data-type]', el).forEach(b => b.onclick = () => { f.type = b.dataset.type; if (f.type !== 'perso') [f.du, f.au] = periode(f.type, today() >= f.du && today() <= f.au ? today() : f.du); render(el); });
  $('#prev', el)?.addEventListener('click', () => { [f.du, f.au] = decaler(f.type, f.du, -1); render(el); });
  $('#next', el)?.addEventListener('click', () => { [f.du, f.au] = decaler(f.type, f.du, 1); render(el); });
  $('#du', el)?.addEventListener('change', e => { f.du = e.target.value; render(el); });
  $('#au', el)?.addEventListener('change', e => { f.au = e.target.value; render(el); });
  $('#q', el).oninput = e => { f.q = e.target.value; clearTimeout(f.t); f.t = setTimeout(() => render(el).then(() => { const i = $('#q', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 300); };
  $('#ens', el).onchange = e => { f.ens = e.target.value; render(el); };
  $('#action', el).onchange = e => { f.action = e.target.value; render(el); };
  $('#xls', el).onclick = async () => {
    const ExcelJS = await loadExcelJS();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Visites');
    ws.columns = [{ header: 'Date', width: 12 }, { header: 'Arrivée', width: 8 }, { header: 'Départ', width: 8 }, { header: 'Magasin', width: 36 },
      { header: 'Enseigne', width: 14 }, { header: 'Ville', width: 18 }, { header: 'N° visite', width: 9 }, { header: 'Objet', width: 22 },
      { header: 'Statut', width: 11 }, { header: 'Interlocuteur', width: 22 }, { header: 'Actions réalisées', width: 40 }, { header: 'Compte rendu', width: 60 },
      { header: 'À faire', width: 30 }, { header: 'Photos', width: 8 }];
    ws.getRow(1).font = { bold: true, name: 'Arial' };
    liste.slice().reverse().forEach(({ n, m }) => ws.addRow([n.date, n.arrivee || '', n.depart || '', m.nom, m.enseigne, m.ville, n.numero || '', n.objet || '', n.statut || '',
      n.contact || '', (n.actions || []).join(', '), n.texte || '', n.aFaire || '', n.photos?.length || 0]));
    ws.eachRow(r => r.eachCell(c => { c.font = { name: 'Arial', ...(c.font || {}) }; c.alignment = { vertical: 'top', wrapText: true }; }));
    downloadBlob(new Blob([await wb.xlsx.writeBuffer()]), `Visites ${f.du} au ${f.au}.xlsx`);
  };
}
