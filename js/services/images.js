// Redimensionne une photo avant de la stocker (limite la place prise sur le téléphone).
export async function reduireImage(file, max = 1600, qualite = 0.85) {
  if (file.type === 'image/svg+xml') return file;
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); // fond blanc pour les PNG transparents
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', qualite));
}

export const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
export const dataURLToBlob = async u => (await fetch(u)).blob();

const urls = new Map();
// URL d'affichage d'une image stockée (mise en cache pour la session)
export async function imageURL(db, id) {
  if (!id) return '';
  if (urls.has(id)) return urls.get(id);
  const row = await db.get('images', id);
  if (!row) return '';
  const u = URL.createObjectURL(row.blob);
  urls.set(id, u);
  return u;
}
export const oublierImage = id => { if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); } };
