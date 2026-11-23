// « Clasper Terrain » : l'outil HTML d'un collègue, importé tel quel et rangé UNIQUEMENT sur cet appareil.
// Base IndexedDB à part (« cap-terrain ») : jamais synchronisée, jamais dans les sauvegardes, jamais sur GitHub.
// Réimporter un fichier remplace l'ancien (quand le collègue sort une nouvelle version).
const BASE = 'cap-terrain', STORE = 'fichier', CLE = 'courant';

function ouvrir() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(BASE, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const d = await ouvrir();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode); const st = t.objectStore(STORE);
    const out = fn(st);
    t.oncomplete = () => { d.close(); res(out?.result); };
    t.onerror = () => { d.close(); rej(t.error); };
  });
}

// infos sans le contenu (pour l'affichage) : { nom, taille, importe } ou null
export async function infosTerrain() {
  const r = await tx('readonly', st => st.get(CLE)).catch(() => null);
  return r ? { nom: r.nom, taille: r.taille, importe: r.importe } : null;
}
export async function htmlTerrain() { return (await tx('readonly', st => st.get(CLE)).catch(() => null))?.html || null; }

// Vérifie que c'est bien une page HTML, puis remplace l'ancienne version
export async function importerTerrain(file) {
  if (!file) return null;
  if (file.size > 60e6) throw new Error('Fichier trop gros (plus de 60 Mo).');
  const html = await file.text();
  if (!/<(!doctype html|html|head|body|meta|title|script)[\s>]/i.test(html.slice(0, 5000))) throw new Error('Ce fichier n\'est pas une page HTML.');
  const rec = { html, nom: file.name, taille: file.size, importe: new Date().toISOString() };
  await tx('readwrite', st => st.put(rec, CLE));
  return { nom: rec.nom, taille: rec.taille, importe: rec.importe };
}
export async function retirerTerrain() { await tx('readwrite', st => st.delete(CLE)).catch(() => {}); }
