// Onglet « Clasper Terrain » : l'outil HTML du collègue, ouvert en plein écran dans Cap Secteur.
// Le fichier est importé une fois par appareil et reste uniquement sur cet appareil
// (ni synchronisé, ni sauvegardé, ni sur GitHub). Nouvelle version = on réimporte, elle remplace l'ancienne.
import { $, esc, fmtDate, toast, pickFile } from '../ui.js';
import { infosTerrain, htmlTerrain, importerTerrain, retirerTerrain } from '../services/terrain.js';
import { ic } from '../icones.js';

let url = null;

export async function importer() {
  const f = await pickFile('.html,.htm,text/html');
  if (!f) return null;
  try { const r = await importerTerrain(f); toast(`« ${r.nom} » importé`); return r; }
  catch (e) { toast(e.message, 'warn'); return null; }
}

export async function render(el) {
  destroy();
  const info = await infosTerrain();
  if (!info) {
    el.innerHTML = `<div class="page terrain-vide">
      <header class="page-head"><h1>Clasper Terrain</h1></header>
      <div class="terrain-accueil">
        <span class="terrain-ic grand" aria-hidden="true"></span>
        <h2>Ouvre l'outil de ton collègue ici</h2>
        <p>Bon de commande pour l'ADV, gamme, data magasins… tout son outil, directement dans Cap Secteur, même sans réseau.</p>
        <ol class="terrain-etapes">
          <li><b>Récupère le fichier</b><span>Le fichier HTML envoyé par ton collègue (par exemple « Clasper_Terrain_Equipe_1.html »), sur cet appareil.</span></li>
          <li><b>Importe-le</b><span>Un seul import par appareil : une fois sur le PC, une fois sur le téléphone.</span></li>
          <li><b>Nouvelle version ?</b><span>Bouton « Mettre à jour » en haut de l'outil : la nouvelle remplace l'ancienne.</span></li>
        </ol>
        <button class="btn primary" id="tImp">Importer le fichier</button>
        <p class="hint">Le fichier reste uniquement sur cet appareil : il n'est ni synchronisé, ni envoyé sur GitHub.</p>
      </div></div>`;
    $('#tImp').onclick = async () => { if (await importer()) render(el); };
    return;
  }
  const html = await htmlTerrain();
  document.body.classList.add('terrain-plein');   // plein écran : la barre d'onglets de Cap Secteur s'efface (l'outil a la sienne)
  url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  el.innerHTML = `<div class="terrain">
    <header class="terrain-barre">
      <button type="button" class="terrain-retour" id="tRet" aria-label="Revenir à Cap Secteur">${ic('chevron')}<span>Cap Secteur</span></button>
      <div class="terrain-titre"><strong>Clasper Terrain</strong><small>version du ${fmtDate(info.importe)}</small></div>
      <button type="button" class="btn small" id="tMaj" title="Importer la nouvelle version du fichier">Mettre à jour</button>
    </header>
    <div class="terrain-cadre-boite"><div class="terrain-charge" aria-hidden="true"><span class="terrain-ic"></span></div>
      <iframe class="terrain-cadre" src="${url}" title="Clasper Terrain" allow="clipboard-write; fullscreen"></iframe></div>
  </div>`;
  const cadre = $('.terrain-cadre');
  cadre.addEventListener('load', () => el.querySelector('.terrain-charge')?.remove(), { once: true });
  $('#tRet').onclick = () => { if (history.length > 1) history.back(); else location.hash = '#/'; };
  $('#tMaj').onclick = async () => { if (await importer()) render(el); };
}

export function destroy() { document.body.classList.remove('terrain-plein'); if (url) { URL.revokeObjectURL(url); url = null; } }
export { retirerTerrain };
