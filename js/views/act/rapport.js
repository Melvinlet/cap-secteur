// Rapport d'activité de date à date + comparateur (S-1 / M-1 / année-1, et N-1).
import { getSettings } from '../../db.js';
import { $, $$, esc, fmtKm, fmtDuree, downloadBlob, toast } from '../../ui.js';
import { chargerTout, indicateurs, periode, precedente, anPasse, decaler, libellePeriode } from '../../services/activite.js';
import { loadExcelJS } from '../../services/excel.js';
import { SAISON } from '../../config.js';

const today = () => new Date().toISOString().slice(0, 10);
let f = { type: 'semaine', du: null, au: null };

const euros = v => `${(Math.round(v * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
// [clé, libellé, format, inclure dans le résumé]
const LIGNES = [
  ['visites', 'Visites réalisées'], ['magasins', 'Magasins différents visités'], ['p1', 'Magasins P1 visités', (v, i) => `${v} / ${i.p1Total}`],
  ['tempsMagasin', 'Temps passé en magasin', v => v ? fmtDuree(v) : '–'], ['joursTerrain', 'Jours de terrain'], ['km', 'Kilomètres (estimés)', v => v ? fmtKm(v) : '–'],
  ['nuits', 'Nuits sur place'], ['rdvDemandes', 'Demandes de RDV envoyées'], ['rdvRelances', 'Relances'], ['rdv', 'RDV obtenus'], ['rdvRefus', 'RDV refusés'],
  ['commandes', 'Commandes préparées'], ['unites', 'Unités commandées'], ['dummies', SAISON.libelleOffertLong || 'Produits offerts'],
  ['releves', 'Relevés de stock'], ['ruptures', 'Ruptures constatées'], ['photos', 'Photos de rayon'], ['concurrence', 'Relevés concurrence'],
  ['savOuverts', 'Dossiers SAV ouverts'], ['fraisTotal', 'Notes de frais', v => euros(v)], ['fraisDu', 'Frais restant à me rembourser', v => euros(v)],
];

export async function render(el) {
  const s = await getSettings();
  if (!f.du) [f.du, f.au] = periode(f.type, today());
  const d = await chargerTout();
  const [pdu, pau] = precedente(f.type, f.du, f.au);
  const [ndu, nau] = anPasse(f.du, f.au);
  const cur = indicateurs(d, f.du, f.au, s), prev = indicateurs(d, pdu, pau, s), n1 = indicateurs(d, ndu, nau, s);
  const labP = { semaine: 'S-1', mois: 'M-1', annee: 'Année -1', perso: 'Période -1' }[f.type];
  const delta = (a, b) => { if (!b && !a) return ''; if (!b) return '<span class="up">nouveau</span>'; const p = Math.round((a - b) / b * 100); return p === 0 ? '<span class="eq">=</span>' : `<span class="${p > 0 ? 'up' : 'down'}">${p > 0 ? '+' : ''}${p} %</span>`; };
  const fmt = (k, v, i, fn) => fn ? fn(v, i) : (Number.isInteger(v) ? v : Math.round(v));
  const actions = Object.entries(cur.actions).sort((a, b) => b[1] - a[1]);
  const enseignes = [...new Set([...Object.keys(cur.parEnseigne), ...Object.keys(prev.parEnseigne)])].sort();

  el.innerHTML = `
    <div class="periode">
      <div class="seg">${[['semaine', 'Semaine'], ['mois', 'Mois'], ['annee', 'Année'], ['perso', 'Dates']].map(([k, l]) => `<button data-type="${k}" aria-selected="${f.type === k}">${l}</button>`).join('')}</div>
      ${f.type === 'perso' ? `<label>Du<input type="date" id="du" value="${f.du}"></label><label>Au<input type="date" id="au" value="${f.au}"></label>`
        : `<button class="btn-icon" id="prev" aria-label="Précédent">‹</button><strong class="per-lab">${esc(libellePeriode(f.type, f.du, f.au))}</strong><button class="btn-icon" id="next" aria-label="Suivant">›</button>`}
    </div>
    <div class="tour-sum rep-sum">
      <div><span class="big">${cur.visites}</span> visites ${delta(cur.visites, prev.visites)}</div>
      <div><span class="big">${cur.magasins}</span> magasins vus</div>
      <div><span class="big">${cur.rdv}</span> RDV obtenus</div>
      <div><span class="big">${cur.unites}</span> unités commandées</div>
    </div>
    <div class="actions"><button class="btn" id="copy">Copier le résumé (mail au manager)</button><button class="btn" id="xls">Exporter (Excel)</button><button class="btn ghost" id="print">Imprimer / PDF</button></div>
    <table class="table rep">
      <thead><tr><th>Indicateur</th><th class="num">${esc(libellePeriode(f.type, f.du, f.au))}</th><th class="num">${labP}<small>${esc(libellePeriode(f.type, pdu, pau))}</small></th><th class="num">N-1<small>${esc(libellePeriode(['mois', 'annee'].includes(f.type) ? f.type : 'perso', ndu, nau))}</small></th></tr></thead>
      <tbody>${LIGNES.map(([k, l, fn]) => `<tr><td>${esc(l)}</td><td class="num"><strong>${fmt(k, cur[k], cur, fn)}</strong></td>
        <td class="num">${fmt(k, prev[k], prev, fn)} ${delta(cur[k], prev[k])}</td><td class="num">${fmt(k, n1[k], n1, fn)} ${delta(cur[k], n1[k])}</td></tr>`).join('')}</tbody></table>
    <div class="grid2">
      <section><h2 class="h2">Visites par enseigne</h2>
        <table class="table"><thead><tr><th>Enseigne</th><th class="num">Période</th><th class="num">${labP}</th></tr></thead><tbody>
        ${enseignes.map(e => `<tr><td>${esc(e)}</td><td class="num">${cur.parEnseigne[e] || 0}</td><td class="num">${prev.parEnseigne[e] || 0}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Aucune visite.</td></tr>'}</tbody></table></section>
      <section><h2 class="h2">Actions réalisées</h2>
        <table class="table"><tbody>${actions.map(([a, v]) => `<tr><td>${esc(a)}</td><td class="num">${v}</td></tr>`).join('') || '<tr><td class="muted">Aucune action notée dans les comptes rendus.</td></tr>'}</tbody></table></section>
    </div>`;

  $$('[data-type]', el).forEach(b => b.onclick = () => { f.type = b.dataset.type; if (f.type !== 'perso') [f.du, f.au] = periode(f.type, today() >= f.du && today() <= f.au ? today() : f.du); render(el); });
  $('#prev', el)?.addEventListener('click', () => { [f.du, f.au] = decaler(f.type, f.du, -1); render(el); });
  $('#next', el)?.addEventListener('click', () => { [f.du, f.au] = decaler(f.type, f.du, 1); render(el); });
  $('#du', el)?.addEventListener('change', e => { f.du = e.target.value; render(el); });
  $('#au', el)?.addEventListener('change', e => { f.au = e.target.value; render(el); });
  $('#print', el).onclick = () => window.print();
  $('#copy', el).onclick = async () => {
    const t = [`Rapport d'activité — ${libellePeriode(f.type, f.du, f.au)}${s.commercial ? ` — ${s.commercial}` : ''}`, '',
      ...LIGNES.filter(([k]) => !k.startsWith('frais')).map(([k, l, fn]) => `• ${l} : ${fmt(k, cur[k], cur, fn)} (${labP} : ${fmt(k, prev[k], prev, fn)})`),
      '', actions.length ? `Actions : ${actions.map(([a, v]) => `${a} (${v})`).join(', ')}` : ''].join('\n');
    try { await navigator.clipboard.writeText(t); toast('Résumé copié : colle-le dans ton mail'); } catch { toast('Copie impossible sur cet appareil', 'warn'); }
  };
  $('#xls', el).onclick = async () => {
    const ExcelJS = await loadExcelJS();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Rapport');
    ws.columns = [{ width: 36 }, { width: 18 }, { width: 18 }, { width: 18 }];
    ws.addRow([`Rapport d'activité — ${libellePeriode(f.type, f.du, f.au)}`]).font = { bold: true, size: 13 };
    ws.addRow([s.commercial || '']);
    ws.addRow([]);
    ws.addRow(['Indicateur', libellePeriode(f.type, f.du, f.au), `${labP} (${libellePeriode(f.type, pdu, pau)})`, `N-1 (${libellePeriode('perso', ndu, nau)})`]).font = { bold: true };
    LIGNES.forEach(([k, l, fn]) => ws.addRow([l, fmt(k, cur[k], cur, fn), fmt(k, prev[k], prev, fn), fmt(k, n1[k], n1, fn)]));
    const v = wb.addWorksheet('Visites');
    v.columns = [{ header: 'Date', width: 12 }, { header: 'Magasin', width: 36 }, { header: 'Objet', width: 22 }, { header: 'Actions', width: 40 }, { header: 'Compte rendu', width: 60 }];
    cur.listeVisites.sort((a, b) => a.date.localeCompare(b.date)).forEach(n => v.addRow([n.date, d.magById.get(n.magasinId)?.nom || '', n.objet || '', (n.actions || []).join(', '), n.texte || '']));
    [ws, v].forEach(x => x.eachRow(r => r.eachCell(c => { c.font = { name: 'Arial', ...(c.font || {}) }; })));
    downloadBlob(new Blob([await wb.xlsx.writeBuffer()]), `Rapport ${f.du} au ${f.au}.xlsx`);
  };
}
