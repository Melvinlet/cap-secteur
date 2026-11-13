// Note de frais : tableau des dépenses (une colonne par type), onglet des indemnités kilométriques,
// et justificatifs photo numérotés. Colonnes, titres, nom de fichier et barème viennent du profil
// entreprise importé sur l'appareil (PROFIL.ndf) : le code ne contient aucun modèle d'entreprise.
import { loadExcelJS } from './excel.js';
import { norm } from '../ui.js';
import { PROFIL } from '../config.js';

const cols = () => PROFIL.ndf.colonnes;
// Rangement d'une catégorie de dépense dans une colonne du tableau (règles du profil)
export function colonneNdf(cat) {
  const c = norm(cat || '');
  for (const [col, re] of Object.entries(PROFIL.ndf.regles || {})) if (new RegExp(re).test(c) && cols().includes(col)) return col;
  return cols().includes(PROFIL.ndf.defaut) ? PROFIL.ndf.defaut : cols()[cols().length - 1];
}
export const estIkm = x => Number(x.km) > 0 && /km|kilom|ikm/.test(norm(x.categorie || ''));

const F = { name: 'Calibri', size: 11 };
const GRIS = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
const FIN = { style: 'thin' };
const CADRE = { top: FIN, left: FIN, bottom: FIN, right: FIN };
const EUR = '#,##0.00" €"';
const jour = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const centre = { horizontal: 'center', vertical: 'middle', wrapText: true };

function entete(ws, nom, date) {
  ws.getCell('B1').value = 'NOM :'; ws.getCell('B2').value = 'DATE :';
  ['B1', 'B2'].forEach(a => { ws.getCell(a).font = { ...F, bold: true }; ws.getCell(a).alignment = { horizontal: 'center' }; });
  ws.getCell('C1').value = nom; ws.getCell('C1').font = { ...F, bold: true };
  ws.getCell('C2').value = jour(date); ws.getCell('C2').numFmt = 'dd/mm/yy'; ws.getCell('C2').font = F;
  ws.getCell('C2').alignment = { horizontal: 'left' };
}

// Numéros des justificatifs : dans l'ordre chronologique des dépenses (frais et indemnités km)
export function numeroterJustificatifs(frais) {
  const m = new Map(); let n = 0;
  frais.filter(x => x.justificatif).sort((a, b) => a.date.localeCompare(b.date) || (a.maj || '').localeCompare(b.maj || '')).forEach(x => m.set(x.id, ++n));
  return m;
}

// frais : dépenses à mettre dans la note ; images : Map(id → { blob, type }) ; s : réglages
const L = n => { let s = ''; n++; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };   // 0 → A
export async function genererNdf(frais, images, s, { date, bareme = null }) {
  const N = cols().length, cTva = 4 + N, cTot = 5 + N;          // colonnes (1 = A) : B date, C libellé, D… types, TVA, TOTAL
  const lTva = L(cTva - 1), lTot = L(cTot - 1), lDer = L(cTva - 2);
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = s.commercial || 'Cap Secteur';
  const nom = (s.commercial || '').trim();
  const reels = frais.filter(x => !estIkm(x)).sort((a, b) => a.date.localeCompare(b.date));
  const ikm = frais.filter(estIkm).sort((a, b) => a.date.localeCompare(b.date));

  // ── Réel ────────────────────────────────────────────────────────────────────
  const ws = wb.addWorksheet(PROFIL.ndf.ongletReel || 'Frais', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: reels.length > 60 ? 0 : 1,
    margins: { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } }, views: [{ showGridLines: true }] });
  ws.columns = [2, 8.5, 31.9, ...cols().map(() => 10.5), 8.4, 10.9].map(width => ({ width }));
  entete(ws, nom, date);
  ws.getRow(3).height = 30.75;
  if (PROFIL.ndf.mention) { const c3 = ws.getCell('C3'); c3.value = PROFIL.ndf.mention; c3.font = { ...F, size: 8, bold: true }; c3.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true }; }
  ws.mergeCells(`D3:${L(Math.min(cTva - 2, 6))}3`);
  const d3 = ws.getCell('D3'); d3.value = PROFIL.ndf.titre || 'NOTE DE FRAIS'; d3.font = { ...F, size: 14, bold: true }; d3.alignment = centre;
  const titres = ['DATE', 'LIBELLE', ...cols(), 'TVA', 'TOTAL'];
  ws.getRow(4).height = 30;
  titres.forEach((t, i) => {
    const c = ws.getCell(4, i + 2); c.value = t; c.fill = GRIS; c.border = CADRE; c.alignment = centre;
    c.font = { ...F, bold: true, size: t === 'TOTAL' ? 14 : t === 'LIBELLE' ? 10 : 11 };
  });
  const nbLignes = Math.max(Number(PROFIL.ndf.lignesReel) || 30, reels.length);
  const fin = 4 + nbLignes;
  const numero = numeroterJustificatifs(frais);           // id dépense → n° de justificatif
  for (let i = 0; i < nbLignes; i++) {
    const r = 5 + i, x = reels[i], row = ws.getRow(r);
    row.height = 21;
    for (let col = 2; col <= cTot; col++) {
      const c = ws.getCell(r, col);
      c.border = CADRE; c.font = { ...F, size: col === 3 ? 10 : 11 };
      c.alignment = col === 3 ? { vertical: 'middle', wrapText: true } : centre;
      if (col >= 4) c.numFmt = EUR;
    }
    ws.getCell(r, 2).numFmt = 'dd/mm/yy';
    ws.getCell(r, cTot).value = { formula: `SUM(D${r}:${lTva}${r})` };
    if (!x) continue;
    const ttc = Number(x.montant) || 0, tva = Number(x.tva) || 0;
    ws.getCell(r, 2).value = jour(x.date);
    ws.getCell(r, 3).value = [x.libelle || x.categorie, x.justificatif ? `(justif. ${numero.get(x.id)})` : ''].filter(Boolean).join(' ').toUpperCase();
    ws.getCell(r, 4 + cols().indexOf(colonneNdf(x.categorie))).value = Math.round((ttc - tva) * 100) / 100;   // HT si la TVA est détaillée
    if (tva) ws.getCell(r, cTva).value = tva;
  }
  const t = fin + 2;
  ws.mergeCells(`B${t}:C${t}`);
  const tot = ws.getCell(`B${t}`); tot.value = 'TOTAL'; tot.font = { ...F, size: 14, bold: true }; tot.fill = GRIS; tot.alignment = centre; tot.border = CADRE;
  ws.getRow(t).height = 24;
  for (let k = 4; k <= cTot; k++) {
    const col = L(k - 1), c = ws.getCell(`${col}${t}`); c.value = { formula: `SUM(${col}5:${col}${fin})` }; c.numFmt = EUR; c.border = CADRE; c.alignment = centre;
    c.font = { ...F, bold: k === cTot };
  }
  ws.pageSetup.printArea = `B1:${lTot}${t}`;

  // ── IKM ─────────────────────────────────────────────────────────────────────
  const wk = wb.addWorksheet(PROFIL.ndf.ongletIk || 'Indemnités km', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1 } });
  wk.columns = [2, 8.5, 45.6, 12.9, 10.6, 12].map(width => ({ width }));
  entete(wk, nom, date);
  wk.getRow(3).height = 40.5;
  wk.mergeCells('B3:F3');
  const k3 = wk.getCell('B3'); k3.value = PROFIL.ndf.titre || 'NOTE DE FRAIS'; k3.font = { ...F, size: 14, bold: true }; k3.alignment = centre;
  wk.getRow(4).height = 30;
  (PROFIL.ndf.titresIk || ['DATE', 'DESTINATION', 'KILOMETRES', 'BAREME', 'MONTANT']).forEach((v, i) => {
    const c = wk.getCell(4, i + 2); c.value = v; c.fill = GRIS; c.border = CADRE; c.alignment = centre; c.font = { ...F, bold: true };
  });
  const nbK = Math.max(Number(PROFIL.ndf.lignesIk) || 15, ikm.length), finK = 4 + nbK;
  for (let i = 0; i < nbK; i++) {
    const r = 5 + i, x = ikm[i];
    wk.getRow(r).height = 19.5;
    for (let col = 2; col <= 6; col++) { const c = wk.getCell(r, col); c.border = CADRE; c.font = F; c.alignment = col === 3 ? { vertical: 'middle', wrapText: true } : centre; }
    wk.getCell(r, 2).numFmt = 'dd/mm/yy'; wk.getCell(r, 4).numFmt = '#,##0'; wk.getCell(r, 5).numFmt = '0.000'; wk.getCell(r, 6).numFmt = '#,##0.00';
    wk.getCell(r, 6).value = { formula: `D${r}*E${r}` };
    if (!x) continue;
    wk.getCell(r, 2).value = jour(x.date);
    wk.getCell(r, 3).value = [x.libelle || '', x.justificatif ? `(justif. ${numero.get(x.id)})` : ''].filter(Boolean).join(' ');
    wk.getCell(r, 4).value = Number(x.km) || 0;
    wk.getCell(r, 5).value = Number(x.km) ? Math.round((Number(x.montant) || 0) / Number(x.km) * 1000) / 1000 || Number(s.tauxKm) || 0 : Number(s.tauxKm) || 0;
  }
  const tk = finK + 1;
  wk.mergeCells(`B${tk}:C${tk}`);
  const tkc = wk.getCell(`B${tk}`); tkc.value = 'TOTAL'; tkc.font = { ...F, size: 14, bold: true }; tkc.fill = GRIS; tkc.alignment = centre; tkc.border = CADRE;
  ['D', 'E', 'F'].forEach(col => { const c = wk.getCell(`${col}${tk}`); c.value = col === 'E' ? null : { formula: `SUM(${col}5:${col}${finK})` }; c.numFmt = col === 'D' ? '#,##0' : EUR; c.border = CADRE; c.alignment = centre; c.font = { ...F, bold: true }; });
  if (bareme) {
    const id = wb.addImage({ buffer: bareme, extension: 'png' });
    wk.addImage(id, { tl: { col: 1, row: tk + 1 }, ext: { width: 640, height: 409 } });
  }

  // ── Justificatifs ───────────────────────────────────────────────────────────
  const avec = frais.filter(x => x.justificatif && images.get(x.justificatif)).sort((a, b) => numero.get(a.id) - numero.get(b.id));
  if (avec.length) {
    const wj = wb.addWorksheet('Justificatifs', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    wj.columns = [{ width: 2 }, { width: 70 }];
    wj.getCell('B1').value = `Justificatifs — ${nom}`; wj.getCell('B1').font = { ...F, size: 14, bold: true };
    let row = 3;
    for (const x of avec) {
      const img = images.get(x.justificatif);
      const num = numero.get(x.id);
      const c = wj.getCell(`B${row}`);
      c.value = `Justificatif ${num} — ${x.date.split('-').reverse().join('/')} — ${x.libelle || x.categorie} — ${colonneNdf(x.categorie)} — ${(Number(x.montant) || 0).toFixed(2).replace('.', ',')} €`;
      c.font = { ...F, bold: true }; c.fill = GRIS; c.border = CADRE;
      if (estPdf(img.blob)) {   // un PDF ne s'insère pas dans Excel : il est dans la note en PDF
        const d = wj.getCell(`B${row + 1}`); d.value = 'Justificatif au format PDF : voir la note de frais en PDF (pages jointes).'; d.font = { ...F, italic: true };
        row += 3; continue;
      }
      const { buffer, w, h } = await prepImage(img.blob);
      const largeur = 480, hauteur = Math.round(h / w * largeur);
      const id = wb.addImage({ buffer, extension: 'jpeg' });
      wj.addImage(id, { tl: { col: 1, row }, ext: { width: largeur, height: hauteur } });
      row += 1 + Math.ceil(hauteur / 20) + 1;            // ≈ 20 px par ligne
      wj.getRow(row - 1).addPageBreak();                  // un justificatif par page à l'impression
    }
  }
  return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// Image → JPEG (ExcelJS ne prend que png/jpeg/gif) + dimensions
export async function prepImage(blob) {
  const bmp = await createImageBitmap(blob);
  const max = 1400, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(bmp, 0, 0, w, h);
  const out = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.82));
  return { buffer: await out.arrayBuffer(), w, h };
}

// Nom du fichier selon le modèle du profil : {JJ} {MM} {AAAA} {PRENOM} {NOM}
export function nomFichierNdf(s, date) {
  const [y, m, d] = date.split('-');
  const parts = (s.commercial || 'PRENOM NOM').trim().split(/\s+/);
  const clean = t => norm(t).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const nom = (PROFIL.ndf.fichier || 'Note de frais {AAAA}-{MM}-{JJ}').replace('{JJ}', d).replace('{MM}', m).replace('{AAAA}', y)
    .replace('{PRENOM}', clean(parts[0])).replace('{NOM}', clean(parts.slice(1).join('-') || 'NOM'));
  return `${nom.replace(/[\\/:*?"<>|]/g, '-')}.xlsx`;
}
// barème kilométrique (image du profil) → octets PNG
export async function baremeProfil() {
  if (!PROFIL.ndf.bareme) return null;
  try { return await (await fetch(PROFIL.ndf.bareme)).arrayBuffer(); } catch { return null; }
}

// ── PDF : le tableau de la note (comme l'Excel) puis tous les justificatifs, dans l'ordre des dates ──
let chargement, chargementPdfLib;
const charger = src => new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = new URL(src, import.meta.url).href;
  s.onload = res; s.onerror = () => rej(new Error('Impossible de charger le module PDF')); document.head.append(s);
});
function loadJsPDF() {
  if (window.jspdf?.jsPDF?.API?.autoTable) return Promise.resolve(window.jspdf.jsPDF);
  chargement ||= charger('../../vendor/jspdf/jspdf.umd.min.js').then(() => charger('../../vendor/jspdf/jspdf.plugin.autotable.min.js')).then(() => window.jspdf.jsPDF);
  return chargement;
}
// pdf-lib : seulement quand un justificatif est lui-même un PDF (ses pages sont insérées dans la note)
function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  chargementPdfLib ||= charger('../../vendor/pdf-lib/pdf-lib.min.js').then(() => window.PDFLib);
  return chargementPdfLib;
}
export const estPdf = blob => blob?.type === 'application/pdf';
// police standard du PDF : on remplace les caractères qu'elle ne sait pas écrire
const txt = v => String(v ?? '').replace(/[\u202F\u00A0]/g, ' ').replace(/[→⇒]/g, '->').replace(/[’]/g, "'").replace(/[^\x20-\x7E\u00A0-\u00FF€—–«»…œŒ]/g, '');
const eur = v => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €';
const dfr = iso => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; };

export async function genererNdfPdf(frais, images, s, { date }) {
  const jsPDF = await loadJsPDF();
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const W = 210, M = 10, nom = (s.commercial || '').trim();
  const numero = numeroterJustificatifs(frais);
  const reels = frais.filter(x => !estIkm(x)).sort((a, b) => a.date.localeCompare(b.date));
  const ikm = frais.filter(estIkm).sort((a, b) => a.date.localeCompare(b.date));
  const gris = [217, 217, 217];
  const style = { font: 'helvetica', fontSize: 8.5, lineColor: [0, 0, 0], lineWidth: 0.2, textColor: [0, 0, 0], valign: 'middle', cellPadding: 1.4 };
  const head = { fillColor: gris, fontStyle: 'bold', halign: 'center', textColor: [0, 0, 0] };

  // en-tête comme le modèle
  const entete = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('NOM :', M, 14); doc.text('DATE :', M, 20);
    doc.setFont('helvetica', 'normal'); doc.text(txt(nom), M + 16, 14); doc.text(dfr(date), M + 16, 20);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(txt(PROFIL.ndf.titre || 'NOTE DE FRAIS'), W / 2, 30, { align: 'center' });
    if (PROFIL.ndf.mention) { doc.setFontSize(7); doc.text(txt(PROFIL.ndf.mention), M, 30); }
  };
  entete();

  // tableau « Réel »
  const lignes = reels.map(x => {
    const ttc = Number(x.montant) || 0, tva = Number(x.tva) || 0, col = colonneNdf(x.categorie);
    return [dfr(x.date), txt([x.libelle || x.categorie, x.justificatif ? `(justif. ${numero.get(x.id)})` : ''].filter(Boolean).join(' ').toUpperCase()),
      ...cols().map(c => c === col ? eur(ttc - tva) : ''), tva ? eur(tva) : '', eur(ttc)];
  });
  const somme = k => reels.reduce((a, x) => { const ttc = Number(x.montant) || 0, tva = Number(x.tva) || 0;
    return a + (k === 'TVA' ? tva : k === 'TOTAL' ? ttc : colonneNdf(x.categorie) === k ? ttc - tva : 0); }, 0);
  const totReel = somme('TOTAL');
  doc.autoTable({
    startY: 35, margin: { left: M, right: M }, theme: 'grid', styles: style, headStyles: head,
    head: [['DATE', 'LIBELLE', ...cols(), 'TVA', 'TOTAL']],
    body: lignes.length ? lignes : [['', 'Aucune dépense', ...cols().map(() => ''), '', '']],
    foot: [[{ content: 'TOTAL', colSpan: 2, styles: { halign: 'center', fontSize: 11 } }, ...[...cols(), 'TVA', 'TOTAL'].map(k => eur(somme(k)))]],
    footStyles: { fillColor: gris, textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center' },
    columnStyles: { 0: { halign: 'center', cellWidth: 15 }, 1: { cellWidth: 50 }, ...Object.fromEntries(cols().map((_, i) => [i + 2, { halign: 'center' }])), [cols().length + 2]: { halign: 'center' }, [cols().length + 3]: { halign: 'center', fontStyle: 'bold' } },
    showFoot: 'lastPage',
  });

  // tableau « IKM »
  let y = doc.lastAutoTable.finalY + 8;
  let totIk = 0;
  if (ikm.length) {
    if (y > 250) { doc.addPage(); y = 15; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(txt(`INDEMNITES KILOMETRIQUES (${(PROFIL.ndf.ongletIk || 'IK').toUpperCase()})`), M, y);
    const rows = ikm.map(x => { const km = Number(x.km) || 0, mt = Number(x.montant) || 0; totIk += mt;
      return [dfr(x.date), txt([x.libelle || '', x.justificatif ? `(justif. ${numero.get(x.id)})` : ''].filter(Boolean).join(' ')), String(km), km ? (mt / km).toFixed(3).replace('.', ',') : '', eur(mt)]; });
    doc.autoTable({
      startY: y + 3, margin: { left: M, right: M }, theme: 'grid', styles: style, headStyles: head,
      head: [(PROFIL.ndf.titresIk || ['DATE', 'DESTINATION', 'KILOMETRES', 'BAREME', 'MONTANT'])], body: rows,
      foot: [[{ content: 'TOTAL', colSpan: 2, styles: { halign: 'center' } }, String(ikm.reduce((a, x) => a + (Number(x.km) || 0), 0)), '', eur(totIk)]],
      footStyles: { fillColor: gris, textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center' },
      columnStyles: { 0: { halign: 'center', cellWidth: 18 }, 2: { halign: 'center', cellWidth: 30 }, 3: { halign: 'center', cellWidth: 22 }, 4: { halign: 'center', cellWidth: 28 } },
    });
    y = doc.lastAutoTable.finalY + 8;
  }
  // récapitulatif
  if (y > 270) { doc.addPage(); y = 15; }
  const nbJ = frais.filter(x => x.justificatif && images.get(x.justificatif)).length;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(`TOTAL DE LA NOTE : ${eur(totReel + totIk)}`, W - M, y, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.text(txt(`${frais.length} dépense${frais.length > 1 ? 's' : ''} · ${nbJ} justificatif${nbJ > 1 ? 's' : ''} joint${nbJ > 1 ? 's' : ''} (pages suivantes, dans l'ordre des dates)`), M, y);

  // justificatifs : une page chacun, dans l'ordre chronologique
  const avec = frais.filter(x => x.justificatif && images.get(x.justificatif)).sort((a, b) => numero.get(a.id) - numero.get(b.id));
  const insertions = [];   // justificatifs PDF : leurs pages sont insérées ici après coup (avec pdf-lib)
  for (const x of avec) {
    if (estPdf(images.get(x.justificatif).blob)) {
      insertions.push({ apres: doc.getNumberOfPages(), x, titre: txt(`Justificatif ${numero.get(x.id)} — ${dfr(x.date)} — ${x.libelle || x.categorie} — ${eur(x.montant)}`) });
      continue;
    }
    doc.addPage();
    doc.setFillColor(...gris); doc.rect(M, 10, W - 2 * M, 9, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(0, 0, 0);
    doc.text(txt(`Justificatif ${numero.get(x.id)} — ${dfr(x.date)} — ${x.libelle || x.categorie}`), M + 2, 16);
    doc.text(txt(`${estIkm(x) ? 'Indemnités km' : colonneNdf(x.categorie)} — ${eur(x.montant)}`), W - M - 2, 16, { align: 'right' });
    const { buffer, w, h } = await prepImage(images.get(x.justificatif).blob);
    const maxW = W - 2 * M, maxH = 297 - 25 - 12;
    const k = Math.min(maxW / w, maxH / h);
    doc.addImage(new Uint8Array(buffer), 'JPEG', M + (maxW - w * k) / 2, 23, w * k, h * k);
  }
  const pied = (i, n) => txt(`Note de frais ${nom} du ${dfr(date)} — page ${i} / ${n}`);
  if (!insertions.length) {
    // pied de page
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(90, 90, 90);
      doc.text(pied(i, n), W / 2, 292, { align: 'center' });
    }
    return doc.output('blob');
  }
  return insererPdfs(doc.output('arraybuffer'), insertions, images, pied);
}

// Insère les pages des justificatifs PDF à leur place (ordre des dates), avec un bandeau « Justificatif n » et la numérotation des pages
async function insererPdfs(base, insertions, images, pied) {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const out = await PDFDocument.load(base);
  const police = await out.embedFont(StandardFonts.Helvetica), gras = await out.embedFont(StandardFonts.HelveticaBold);
  const ecrire = t => t.replace(/[^\x20-\x7E\u00A0-\u00FF€—–…œŒ’]/g, '');   // police standard : alphabet latin (WinAnsi)
  let decalage = 0;
  for (const ins of insertions) {
    let pages;
    try {
      const src = await PDFDocument.load(await images.get(ins.x.justificatif).blob.arrayBuffer(), { ignoreEncryption: true });
      pages = await out.copyPages(src, src.getPageIndices());
    } catch {
      // PDF illisible ou protégé : une page qui le signale, pour ne rien perdre en silence
      const pg = out.insertPage(ins.apres + decalage, [595.28, 841.89]);
      pg.drawText(ecrire(ins.titre), { x: 28, y: 800, size: 10, font: gras });
      pg.drawText(ecrire('Ce justificatif PDF n\'a pas pu être intégré (fichier protégé ou abîmé) : joins-le à part.'), { x: 28, y: 780, size: 10, font: police, color: rgb(.6, .1, .1) });
      decalage += 1; continue;
    }
    pages.forEach((pg, k) => {
      out.insertPage(ins.apres + decalage + k, pg);
      if (k) return;
      const { width, height } = pg.getSize();
      const t = ecrire(ins.titre), taille = 9, l = Math.min(width - 20, gras.widthOfTextAtSize(t, taille) + 12);
      pg.drawRectangle({ x: 10, y: height - 24, width: l, height: 16, color: rgb(.9, .9, .9), opacity: .95 });
      pg.drawText(t, { x: 16, y: height - 19, size: taille, font: gras, color: rgb(0, 0, 0), maxWidth: width - 32 });
    });
    decalage += pages.length;
  }
  const n = out.getPageCount();
  out.getPages().forEach((pg, i) => {
    const { width } = pg.getSize(), t = ecrire(pied(i + 1, n));
    pg.drawText(t, { x: (width - police.widthOfTextAtSize(t, 7.5)) / 2, y: 12, size: 7.5, font: police, color: rgb(.35, .35, .35) });
  });
  return new Blob([await out.save()], { type: 'application/pdf' });
}
