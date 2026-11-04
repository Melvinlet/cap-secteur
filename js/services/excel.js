// ─────────────────────────────────────────────────────────────────────────────
// Échanges Excel : import de la base magasins, export des commandes.
// Utilise ExcelJS (vendor/exceljs.min.js, chargé à la demande).
// ─────────────────────────────────────────────────────────────────────────────
import { db, uid } from '../db.js';
import { REGIONS, PROFIL, SAISON } from '../config.js';

let loading;
export function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  loading ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('../../vendor/exceljs.min.js', import.meta.url).href;
    s.onload = () => res(window.ExcelJS);
    s.onerror = () => rej(new Error('Impossible de charger le module Excel'));
    document.head.append(s);
  });
  return loading;
}

const cellText = v => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map(t => t.text).join('');
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v).trim();
};

// Lit un onglet en tableau d'objets, clés = en-têtes de la 1re ligne.
function lireOnglet(ws) {
  if (!ws) return [];
  const head = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { head[i] = cellText(c.value); });
  const out = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o = {}; let vide = true;
    head.forEach((h, i) => { if (!h || INTERDIT.test(h)) return; const t = cellText(row.getCell(i).value); o[h] = t; if (t) vide = false; });
    if (!vide) out.push(o);
  });
  return out;
}

// Colonnes reconnues dans l'onglet Magasins (plusieurs intitulés possibles → même champ)
const COLS = {
  id: ['ID'], enseigne: ['Enseigne'], nom: ['Nom magasin', 'Nom'], adresse: ['Adresse'], cp: ['Code postal', 'CP'],
  ville: ['Ville'], departement: ['Département'], region: ['Région'], societe: ['Société'],
  info: ['Info réseau'], commentaire: ['Commentaire'], livraisons: ['Livraisons'],
  code: ['Code magasin'], libellePlanning: ['Libellé planning'], telMagasin: ['Téléphone magasin'],
  statut: ['Statut réseau'], prioriteImport: ['Priorité'], prioriteRaison: ['Raison de la priorité'],
  classement: ['Classement'], meuble: ['Meuble / PLV'], remarqueReseau: ['Remarque visite'],
  notesReseau: ['Notes réseau'],
  latImport: ['Latitude'], lonImport: ['Longitude'], precisionImport: ['Précision position'],
};
// Colonnes jamais importées, même si elles sont présentes dans un fichier (aucun tarif dans l'appli)
const INTERDIT = /prix|tarif|rrp|pa magasin|pa plateforme|\bca\b|chiffre d'affaires|marge|deee/i;
const pick = (row, names) => { for (const n of names) if (row[n] != null && row[n] !== '') return row[n]; return ''; };

// Importe « Magasins secteur.xlsx ». Les infos saisies dans l'appli (notes, SAV, commandes,
// contacts ajoutés à la main, position corrigée…) sont conservées.
export async function importerBaseMagasins(file) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(await file.arrayBuffer()); }
  catch (e) {
    console.error(e);
    throw new Error("Ce fichier Excel n'a pas pu être lu. S'il contient des « tableaux » Excel, convertis-les en plage normale (Création de tableau > Convertir en plage).");
  }
  const feuilles = {
    Magasins: lireOnglet(wb.getWorksheet('Magasins') || wb.worksheets.find(w => /magasin/i.test(w.name))),
    Contacts: lireOnglet(wb.getWorksheet('Contacts')), Implantations: lireOnglet(wb.getWorksheet('Implantations')),
    'Saison précédente': lireOnglet(wb.getWorksheet('Saison précédente')),
  };
  return appliquerBase(feuilles);
}

// Applique une base magasins (onglets lus depuis Excel, ou venant du kit entreprise : mêmes colonnes)
export async function appliquerBase(feuilles) {
  const propre = rows => (rows || []).map(r => Object.fromEntries(Object.entries(r).filter(([h]) => !INTERDIT.test(h)).map(([h, v]) => [h, v == null ? '' : String(v)])));
  const mags = propre(feuilles.Magasins);
  if (!mags.length) throw new Error('Onglet « Magasins » introuvable ou vide');
  const existants = new Map((await db.all('magasins')).map(m => [m.id, m]));
  const now = new Date().toISOString();
  const magasins = mags.map(r => {
    const cp = String(pick(r, COLS.cp)).padStart(5, '0');
    const f = Object.fromEntries(Object.entries(COLS).map(([k, n]) => [k, pick(r, n)]));
    const id = f.id || `M-${cp}-${(f.ville || '').toUpperCase().replace(/[^A-Z0-9]/g, '')}-${(f.enseigne || '').slice(0, 4).toUpperCase()}`;
    const { ca2025, ...old } = existants.get(id) || {};
    const changeAdresse = old.adresse !== f.adresse || old.cp !== cp;
    const p = f.prioriteImport === '' ? null : Number(f.prioriteImport);
    const posFichier = f.latImport !== '' && f.lonImport !== '' ? { lat: Number(f.latImport), lon: Number(f.lonImport), precision: f.precisionImport || 'commune' } : null;
    delete f.prioriteImport; delete f.latImport; delete f.lonImport; delete f.precisionImport;
    // position : on garde celle trouvée par l'appli (adresse) ou corrigée à la main ; sinon celle du fichier (centre de la commune)
    const garderPos = old.positionManuelle || (old.lat != null && old.precision && old.precision !== 'commune' && !changeAdresse);
    const position = garderPos ? {} : posFichier ? posFichier : (changeAdresse ? { lat: null, lon: null, precision: null } : {});
    return {
      ...old, ...f, id, cp,
      // la priorité du fichier s'applique, sauf si tu l'as changée toi-même dans l'appli
      priorite: old.prioriteManuelle ? old.priorite : ([0, 1, 2, 3, 4, 5].includes(p) ? p : (old.priorite ?? null)),
      departement: f.departement || cp.slice(0, 2),
      region: f.region || REGIONS[cp.slice(0, 2)] || '',
      nom: f.nom || `${f.enseigne} ${f.ville}`,
      ...position,
      majImport: now,
    };
  });
  // Saison précédente (commandes passées + plan d'implantation, quantités seulement)
  const s26 = propre(feuilles['Saison précédente']);
  const parMag = new Map();
  for (const r of s26) {
    const id = r['ID magasin']; if (!id) continue;
    if (!parMag.has(id)) parMag.set(id, { commandes: [], implantation: [] });
    const x = { date: r['Date'] || '', commande: String(r['N° commande'] || ''), mode: r['Mode'] || '', type: r['Type'] || '', produit: r['Produit'] || '',
      ean: String(r['EAN'] || ''), qte: Number(r['Quantité']) || 0, livraison: r['Livraison'] || '', statut: r['Statut'] || '' };
    parMag.get(id)[r['Nature'] === 'Implantation' ? 'implantation' : 'commandes'].push(x);
  }
  for (const m of magasins) { delete m.saison2026; if (parMag.has(m.id)) m.saisonPrecedente = parMag.get(m.id); else delete m.saisonPrecedente; }
  await db.putMany('magasins', magasins);

  // Contacts / implantations : on remplace ceux qui venaient de l'import, on garde ceux saisis dans l'appli.
  const ids = new Set(magasins.map(m => m.id));
  for (const [store, onglet, map] of [
    ['contacts', 'Contacts', r => ({ nom: r['Nom'], fonction: r['Fonction'], email: r['E-mail'], tel: r['Téléphone'], tel2: r['Téléphone 2'], note: r['Note'], origine: r['Source'] })],
    ['implantations', 'Implantations', r => ({ produit: r['Produit'], qte: Number(r['Quantité']) || r['Quantité'], engagement: r['Engagement fichier fournisseur'], code: r['Code magasin'], divers: r['Divers'] })],
  ]) {
    const rows = propre(feuilles[onglet]);
    const anciens = (await db.all(store)).filter(c => c.source === 'import' && ids.has(c.magasinId));
    for (const c of anciens) await db.del(store, c.id);
    await db.putMany(store, rows.filter(r => ids.has(r['ID magasin'])).map(r => ({
      id: uid(store[0]), magasinId: r['ID magasin'], source: 'import', ...map(r),
    })));
  }
  return { magasins: magasins.length, nouveaux: magasins.filter(m => !existants.has(m.id)).length };
}

const FONT = { name: 'Arial' };
// Date Excel sans heure (évite le décalage de fuseau horaire)
const jour = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const BLEU = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E4FA0' } };
const xlsxBlob = async wb => new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
const enTete = row => { row.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } }; row.eachCell(c => { c.fill = BLEU; }); };

// Préparation de commande — SANS AUCUN PRIX. À reporter dans le bon de commande officiel.
export async function exporterCommande(cmd, magasin, contacts, produits, reglages, saison) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = reglages.commercial || 'Cap Secteur';
  const ws = wb.addWorksheet('Commande');
  ws.columns = [{ width: 12 }, { width: 14 }, { width: 16 }, { width: 40 }, { width: 11 }, { width: 14 }];
  const bold = { ...FONT, bold: true };
  ws.addRow([`Préparation de commande — ${saison.nom}`]).font = { ...bold, size: 14 };
  ws.addRow([`À reporter dans le ${PROFIL.commande.bon || 'bon de commande officiel'}, onglet « ${magasin.enseigne} ». Document sans prix.`]).font = { ...FONT, italic: true, color: { argb: 'FF5E6876' } };
  ws.addRow([]);
  const c0 = contacts[0] || {};
  const bloc = [
    ['Enseigne', magasin.enseigne], ['Magasin', magasin.libellePlanning || magasin.nom], ['Code client', magasin.code || ''],
    ['Adresse', magasin.adresse || ''], ['CP / Ville', `${magasin.cp} ${magasin.ville}`], ['Contact', cmd.contact || c0.nom || ''],
    ['Téléphone', magasin.telMagasin || c0.tel || ''], ['E-mail magasin', cmd.email || c0.email || ''],
    ['Date commande', jour(cmd.date)], ['Mode de livraison', cmd.modeLivraison || ''],
    ['Livraison souhaitée', cmd.livraison ? jour(cmd.livraison) : ''],
    ...(saison.independants.includes(magasin.enseigne) ? [['Maintien reliquats', cmd.reliquats || 'À renseigner'], ['Engagement signé', cmd.engagement ? 'Oui' : 'Non']] : []),
    ['Commercial', reglages.commercial || ''], ['Référence', cmd.reference || ''],
  ];
  for (const [k, v] of bloc) {
    const r = ws.addRow([k, '', v]);
    r.getCell(1).font = bold;
    if (v instanceof Date) r.getCell(3).numFmt = 'dd/mm/yyyy';
    ws.mergeCells(r.number, 1, r.number, 2);
  }
  ws.addRow([]);
  const dates = (cmd.cadencier || []).filter(Boolean);
  const h = ws.addRow(['Réf.', 'Code enseigne', 'EAN', 'Produit', 'Quantité', SAISON.libelleOffertLong || 'Produits offerts']);
  enTete(h);
  const first = ws.rowCount + 1;
  for (const l of cmd.lignes) {
    const p = produits.find(x => x.id === l.produitId) || {};
    const r = ws.addRow([p.ref || '', (p.codesEnseigne || {})[magasin.enseigne] || '', p.ean || '', p.nom || '', Number(l.qte) || 0, Number(l.dummy) || 0]);
    r.getCell(3).numFmt = '@';
  }
  const last = ws.rowCount;
  const tot = ws.addRow(['', '', '', 'Total unités', { formula: `SUM(E${first}:E${last})` }, { formula: `SUM(F${first}:F${last})` }]);
  tot.font = bold;
  if (dates.length) { ws.addRow([]); ws.addRow(['Cadencier de livraison']).font = bold; dates.forEach((d, i) => { const r = ws.addRow([`Livraison ${i + 1}`, '', jour(d)]); r.getCell(3).numFmt = 'dd/mm/yyyy'; }); }
  if (cmd.note) { ws.addRow([]); const r = ws.addRow(['Note', '', cmd.note]); r.getCell(1).font = bold; }
  ws.eachRow(r => r.eachCell(c => { c.font = { ...FONT, ...(c.font || {}) }; }));
  return xlsxBlob(wb);
}

// Export des visites au format du planning de l'entreprise (colonnes du profil, copier-coller direct).
export async function exporterPlanning(lignes, titre, colMotif = false) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Planning');
  ws.columns = [{ width: 12 }, { width: 8 }, { width: 22 }, { width: 16 }, { width: 52 }, { width: 13 }, { width: 24 }, { width: 10 }, { width: 24 }, { width: 3 }, { width: 45 }];
  ws.addRow([titre]).font = { ...FONT, bold: true, size: 13 };
  ws.addRow([PROFIL.planning.consigne || '']).font = { ...FONT, italic: true };
  const head = ws.addRow([...PROFIL.planning.colonnes, ...(colMotif ? ['', 'Pourquoi j\'y vais (pour moi, ne pas coller)'] : [])]);
  enTete(head);
  if (colMotif) {
    head.getCell(10).value = null; head.getCell(10).fill = { type: 'pattern', pattern: 'none' };
    head.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7EEF9' } };
    head.getCell(11).font = { ...FONT, bold: true, italic: true, color: { argb: 'FF163B78' } };
  }
  for (const l of lignes) {
    const r = ws.addRow([jour(l.jour), l.heure || '', l.chef, l.enseigne, l.magasin, l.statut, l.objet, l.numero, l.interlocuteur || '', ...(colMotif ? ['', l.motif || ''] : [])]);
    r.getCell(1).numFmt = 'dd/mm/yyyy';
  }
  ws.eachRow(r => r.eachCell(c => { c.font = { ...FONT, ...(c.font || {}) }; }));
  return xlsxBlob(wb);
}
