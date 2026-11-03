// ─────────────────────────────────────────────────────────────────────────────
// Accès au service en ligne (Supabase) : compte (e-mail + mot de passe, mot de passe
// oublié par e-mail) et stockage des données CHIFFRÉES. L'adresse du projet et sa clé
// publique sont saisies dans l'appli (Réglages), jamais écrites dans le code.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from '../db.js';

const SESSION = 'session';
let config = null;

export async function lireConfig() {
  const row = await db.get('sync', 'config');
  config = row?.valeur || null;
  return config;
}
export async function ecrireConfig(url, cle) {
  url = (url || '').trim().replace(/\/+$/, '');
  config = url && cle ? { url, cle: cle.trim() } : null;
  if (config) await db.put('sync', { k: 'config', valeur: config }, { sync: false });
  else await db.del('sync', 'config', { sync: false });
  return config;
}
export const configure = () => !!config;

async function appel(chemin, { methode = 'GET', corps, jeton, entetes = {} } = {}) {
  if (!config) throw new Error('Service en ligne non configuré');
  let r;
  try {
    r = await fetch(config.url + chemin, {
      method: methode,
      headers: { apikey: config.cle, 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}), ...entetes },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      signal: AbortSignal.timeout(20000),
    });
  } catch { const e = new Error('Pas de connexion au service en ligne'); e.horsLigne = true; throw e; }
  const texte = await r.text();
  let json = null; try { json = texte ? JSON.parse(texte) : null; } catch { /* réponse vide */ }
  if (!r.ok) {
    const msg = json?.msg || json?.message || json?.error_description || json?.error || `Erreur ${r.status}`;
    const e = new Error(traduire(msg)); e.status = r.status; e.code = json?.code || json?.error_code; throw e;
  }
  return json;
}
function traduire(m) {
  const t = String(m);
  if (/invalid login credentials/i.test(t)) return 'E-mail ou mot de passe incorrect';
  if (/email not confirmed/i.test(t)) return 'E-mail pas encore confirmé : clique sur le lien reçu par mail';
  if (/already registered|already been registered|user already exists/i.test(t)) return 'Un compte existe déjà avec cet e-mail';
  if (/password should be at least|weak password/i.test(t)) return 'Mot de passe trop faible (8 caractères minimum, avec des chiffres et des lettres)';
  if (/rate limit|too many/i.test(t)) return 'Trop de demandes : réessaie dans quelques minutes';
  if (/jwt expired|invalid jwt/i.test(t)) return 'Session expirée : reconnecte-toi';
  return t;
}

// ── Session ──────────────────────────────────────────────────────────────────
export async function session() { return (await db.get('sync', SESSION))?.valeur || null; }
async function garderSession(s) {
  const v = { access: s.access_token, refresh: s.refresh_token, expire: Date.now() + (Number(s.expires_in) || 3600) * 1000, email: s.user?.email, uid: s.user?.id };
  await db.put('sync', { k: SESSION, valeur: v }, { sync: false });
  return v;
}
export async function jeton() {
  const s = await session();
  if (!s) return null;
  if (Date.now() < s.expire - 60000) return s.access;
  try {
    const r = await appel('/auth/v1/token?grant_type=refresh_token', { methode: 'POST', corps: { refresh_token: s.refresh } });
    return (await garderSession(r)).access;
  } catch (e) {
    if (e.horsLigne) throw e;
    await db.del('sync', SESSION, { sync: false });   // session révoquée : il faudra se reconnecter
    return null;
  }
}

// ── Compte ───────────────────────────────────────────────────────────────────
const retour = () => location.origin + location.pathname;
export async function creerCompte(email, motDePasse) {
  const r = await appel(`/auth/v1/signup?redirect_to=${encodeURIComponent(retour())}`, { methode: 'POST', corps: { email, password: motDePasse } });
  if (r?.access_token) { await garderSession(r); return { connecte: true }; }
  return { connecte: false };            // e-mail de confirmation envoyé
}
export async function connexion(email, motDePasse) {
  const r = await appel('/auth/v1/token?grant_type=password', { methode: 'POST', corps: { email, password: motDePasse } });
  return garderSession(r);
}
export async function motDePasseOublie(email) {
  await appel(`/auth/v1/recover?redirect_to=${encodeURIComponent(retour())}`, { methode: 'POST', corps: { email } });
}
export async function changerMotDePasse(nouveau) {
  await appel('/auth/v1/user', { methode: 'PUT', corps: { password: nouveau }, jeton: await jeton() });
}
export async function deconnexion() {
  try { const j = await jeton(); if (j) await appel('/auth/v1/logout', { methode: 'POST', jeton: j }); } catch { /* hors ligne */ }
  await db.del('sync', SESSION, { sync: false });
}
// Retour depuis un lien reçu par mail (confirmation ou mot de passe oublié) : jetons dans l'adresse
export async function lireRetourMail() {
  const h = location.hash.replace(/^#/, '');
  if (!/(^|&)access_token=/.test(h) && !/(^|&)error_description=/.test(h)) return null;
  const p = Object.fromEntries(new URLSearchParams(h));
  history.replaceState(null, '', location.pathname + '#/compte');
  if (p.error_description) return { erreur: p.error_description.replace(/\+/g, ' ') };
  let email;
  try { await lireConfig(); email = (await appel('/auth/v1/user', { jeton: p.access_token }))?.email; } catch { /* sans réseau */ }
  await garderSession({ access_token: p.access_token, refresh_token: p.refresh_token, expires_in: p.expires_in, user: { email } });
  return { type: p.type };   // 'recovery' | 'signup' | 'magiclink'…
}

// ── Données (table cap_donnees) et clés emballées (table cap_cles) ───────────
export async function lireCles() {
  const r = await appel('/rest/v1/cap_cles?select=*', { jeton: await jeton() });
  return r?.[0] || null;
}
export async function ecrireCles(c) {
  await appel('/rest/v1/cap_cles', { methode: 'POST', corps: c, jeton: await jeton(), entetes: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
}
export async function envoyer(lignes) {
  if (!lignes.length) return;
  await appel('/rest/v1/cap_donnees', { methode: 'POST', corps: lignes, jeton: await jeton(), entetes: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
}
export async function recevoir(depuis, limite = 300) {
  const filtre = depuis ? `&modifie=gt.${encodeURIComponent(depuis)}` : '';
  return appel(`/rest/v1/cap_donnees?select=k,t,supprime,iv,data,modifie&order=modifie.asc${filtre}&limit=${limite}`, { jeton: await jeton() });
}
