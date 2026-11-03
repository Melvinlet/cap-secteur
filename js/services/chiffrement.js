// ─────────────────────────────────────────────────────────────────────────────
// Chiffrement de bout en bout (WebCrypto). Les données partent chiffrées de l'appareil :
// le serveur ne stocke que du contenu illisible.
//  • une clé de données (AES-GCM 256) aléatoire, créée une fois par compte ;
//  • cette clé est rangée en ligne deux fois, « emballée » : par le mot de passe, et par
//    la clé de secours (pour un mot de passe oublié). Ni l'une ni l'autre ne quitte l'appareil ;
//  • les identifiants des enregistrements sont masqués (HMAC) : le serveur ne voit même pas
//    quels magasins ou quelles dépenses existent.
// ─────────────────────────────────────────────────────────────────────────────
const enc = new TextEncoder(), dec = new TextDecoder();
const ITERATIONS = 250000;

export const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
export const deB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const alea = n => crypto.getRandomValues(new Uint8Array(n));

async function cleDepuisSecret(secret, sel) {
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sel, iterations: ITERATIONS, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// Clé de secours lisible : 5 groupes de 4 caractères sans ambiguïté (pas de 0/O, 1/I/L)
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function nouvelleCleSecours() {
  const r = alea(20);
  return Array.from(r, x => ALPHA[x % ALPHA.length]).join('').match(/.{4}/g).join('-');
}
export const normaliserCleSecours = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Emballe / déballe la clé de données brute avec un secret (mot de passe ou clé de secours)
export async function emballer(brute, secret) {
  const sel = alea(16), iv = alea(12);
  const k = await cleDepuisSecret(secret, sel);   // secret : mot de passe, ou clé de secours normalisée
  const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, brute);
  return { sel: b64(sel), iv: b64(iv), cle: b64(c) };
}
export async function deballer(paquet, secret) {
  const k = await cleDepuisSecret(secret, deB64(paquet.sel));
  try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(paquet.iv) }, k, deB64(paquet.cle))); }
  catch { return null; }   // mauvais secret
}

export const nouvelleCleDonnees = () => alea(32);

// Prépare les clés de travail à partir de la clé brute
export async function clesDeTravail(brute) {
  const aes = await crypto.subtle.importKey('raw', brute, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const hmac = await crypto.subtle.importKey('raw', brute, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return { aes, hmac };
}

export async function chiffrer(cles, objet) {
  const iv = alea(12);
  const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cles.aes, enc.encode(JSON.stringify(objet)));
  return { iv: b64(iv), data: b64(c) };
}
export async function dechiffrer(cles, iv, data) {
  const p = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(iv) }, cles.aes, deB64(data));
  return JSON.parse(dec.decode(p));
}
export async function masquer(cles, texte) {
  const s = await crypto.subtle.sign('HMAC', cles.hmac, enc.encode(texte));
  return Array.from(new Uint8Array(s).subarray(0, 20), x => x.toString(16).padStart(2, '0')).join('');
}
