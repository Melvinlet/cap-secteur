// Écran « Clasper Terrain » : l'outil du collègue en plein écran, dans Cap Secteur.
import { $, esc, fmtDate, toast, pickFile } from '../ui.js';
import { infosTerrain, htmlTerrain, importerTerrain } from '../services/terrain.js';

let url = null;

export async function importer() {
  const f = await pickFile('.html,.htm,text/html');
  if (!f) return null;
  try { const r = await importerTerrain(f); toast(`« ${r.nom} » importé`); document.querySelector('.nav-terrain')?.removeAttribute('hidden'); return r; }
  catch (e) { toast(e.message, 'warn'); return null; }
}

export async function render(el) {
  destroy();
  const info = await infosTerrain();
  if (!info) {
    el.innerHTML = `<div class="page"><header class="page-head"><h1>Clasper Terrain</h1></header>
      <div class="empty"><p>Importe le fichier HTML de ton collègue (par exemple « Clasper_Terrain_Equipe_1.html ») pour l'ouvrir ici, même sans réseau.</p>
      <p class="muted">Il reste uniquement sur cet appareil : il n'est ni synchronisé, ni envoyé sur GitHub. Quand ton collègue sort une nouvelle version, réimporte-la : elle remplace l'ancienne.</p>
      <p><button class="btn primary" id="tImp">Importer le fichier</button></p></div></div>`;
    $('#tImp').onclick = async () => { if (await importer()) render(el); };
    return;
  }
  const html = await htmlTerrain();
  url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  el.innerHTML = `<div class="terrain">
    <header class="terrain-barre">
      <a class="btn-icon" href="#/" aria-label="Revenir à Cap Secteur">‹</a>
      <div class="terrain-titre"><strong>Clasper Terrain</strong><small>version du ${fmtDate(info.importe)}</small></div>
      <button class="btn small" id="tMaj" title="Importer la nouvelle version du fichier">Mettre à jour</button>
    </header>
    <iframe class="terrain-cadre" src="${url}" title="Clasper Terrain" allow="clipboard-write; fullscreen"></iframe>
  </div>`;
  $('#tMaj').onclick = async () => { if (await importer()) render(el); };
}

export function destroy() { if (url) { URL.revokeObjectURL(url); url = null; } }
