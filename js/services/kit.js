// ─────────────────────────────────────────────────────────────────────────────
// Kit entreprise : base magasins de tous les secteurs + catalogue + profil, publié une fois
// en ligne, CHIFFRÉ avec un code entreprise. Un collègue se connecte, tape le code, choisit
// son secteur : l'appli télécharge, déchiffre et ne garde que ses magasins.
// Le code ne quitte jamais les appareils ; le serveur ne stocke que du contenu illisible.
// ─────────────────────────────────────────────────────────────────────────────
import { db, enregistrerProfil, getSettings, saveSettings } from '../db.js';
import * as nuage from './nuage.js';
import * as C from './chiffrement.js';
import { appliquerBase } from './excel.js';
import { importer } from './backup.js';

const ID = 'equipe';
const TAILLE = 800000;          // caractères par morceau envoyé
const enc = new TextEncoder(), dec = new TextDecoder();

async function aesDe(brute) { return crypto.subtle.importKey('raw', brute, 'AES-GCM', false, ['encrypt', 'decrypt']); }

// ── Lecture ──────────────────────────────────────────────────────────────────
export async function infoKit() {
  const r = await nuage.appelRest(`/rest/v1/cap_kit?id=eq.${ID}&select=version,sel,iv_cle,cle,iv,nb,modifie,auteur`);
  return r?.[0] || null;
}
async function ouvrirCle(info, code) {
  return C.deballer({ sel: info.sel, iv: info.iv_cle, cle: info.cle }, code.trim());
}
async function telecharger(info, brute) {
  const parts = await nuage.appelRest(`/rest/v1/cap_kit_morceaux?kit=eq.${ID}&version=eq.${encodeURIComponent(info.version)}&select=n,data&order=n.asc`);
  if (!parts || parts.length !== info.nb) throw new Error('Kit incomplet en ligne : réessaie dans un instant');
  const data = parts.map(p => p.data).join('');
  const clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: C.deB64(info.iv) }, await aesDe(brute), C.deB64(data));
  return JSON.parse(dec.decode(clair));
}

// Rejoindre l'équipe avec le code entreprise : renvoie le kit (pour choisir son secteur)
export async function ouvrirKit(code, { codeOk } = {}) {
  const info = await infoKit();
  if (!info) throw new Error('Aucun kit entreprise publié pour l\'instant');
  const brute = await ouvrirCle(info, code);
  if (!brute) throw new Error('Code entreprise incorrect');
  codeOk?.();
  const kit = await telecharger(info, brute);
  return { kit, brute, version: info.version };
}

// Applique le kit : profil, catalogue, et les magasins des secteurs / départements choisis
export async function appliquerKit(kit, choix) {
  const deps = new Set(choix.departements);
  const f = { Magasins: [], Contacts: [], Implantations: [], 'Saison précédente': [] };
  for (const s of choix.secteurs) {
    const sec = kit.secteurs[s]; if (!sec) continue;
    const mags = sec.feuilles.Magasins.filter(m => !deps.size || deps.has(m['Département']));
    const ids = new Set(mags.map(m => m.ID));
    f.Magasins.push(...mags);
    for (const k of ['Contacts', 'Implantations', 'Saison précédente']) f[k].push(...(sec.feuilles[k] || []).filter(r => ids.has(r['ID magasin'])));
  }
  await enregistrerProfil({ ...kit.profil, departements: [...deps].sort() });
  if (kit.catalogue) {
    const json = JSON.stringify({ format: 'cap-secteur', type: 'catalogue', version: kit.version, date: kit.date, data: kit.catalogue });
    await importer({ text: async () => json }, 'fusion');
  }
  const s = await getSettings();
  if (!s.departements?.length) await saveSettings({ departements: [...deps].sort() });
  const r = await appliquerBase(f);
  return { magasins: r.magasins };
}

// Mémorise l'adhésion (synchronisée, chiffrée, entre les appareils de l'utilisateur)
export async function memoriser(brute, version, choix) {
  await db.put('reglages', { cle: 'kit', valeur: { cle: Array.from(brute), version, ...choix, maj: new Date().toISOString() } });
}
export const adhesion = async () => (await db.get('reglages', 'kit'))?.valeur || null;
export async function quitter() { await db.del('reglages', 'kit'); }

// Vérifie s'il existe une version plus récente et l'applique (appelé après chaque synchronisation)
export async function mettreAJour({ forcer = false } = {}) {
  const a = await adhesion();
  if (!a) return null;
  const info = await infoKit();
  if (!info || (!forcer && info.version === a.version)) return null;
  const brute = new Uint8Array(a.cle);
  let kit;
  try { kit = await telecharger(info, brute); }
  catch { return { erreur: 'Le code entreprise a changé : demande le nouveau code et rejoins à nouveau l\'équipe (Compte et synchronisation).' }; }
  await appliquerKit(kit, a);
  await memoriser(brute, info.version, { secteurs: a.secteurs, departements: a.departements });
  return { version: info.version, nom: kit.nom };
}

// ── Publication (administrateur) ─────────────────────────────────────────────
// Reprend la clé du kit actuel si le code est le même ; sinon (nouveau code) crée une nouvelle clé :
// les anciens codes ne marchent plus, chacun devra saisir le nouveau.
export async function publierKit(kit, code, { nouveauCode = false } = {}) {
  code = code.trim();
  if (code.length < 8) throw new Error('Code entreprise trop court (8 caractères minimum)');
  const info = await infoKit();
  let brute = info && !nouveauCode ? await ouvrirCle(info, code) : null;
  if (info && !brute && !nouveauCode) { const e = new Error('Ce code ne correspond pas au code actuel du kit'); e.codeDifferent = true; throw e; }
  if (!brute) brute = C.nouvelleCleDonnees();
  const version = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const chiffre = C.b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesDe(brute), enc.encode(JSON.stringify({ ...kit, version }))));
  const morceaux = [];
  for (let i = 0; i < chiffre.length; i += TAILLE) morceaux.push(chiffre.slice(i, i + TAILLE));
  // 1. les morceaux de la nouvelle version, 2. la fiche du kit qui pointe dessus, 3. ménage de l'ancienne version
  for (const [n, data] of morceaux.entries()) {
    await nuage.appelRest('/rest/v1/cap_kit_morceaux', { methode: 'POST', corps: { kit: ID, version, n, data }, entetes: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
  }
  const emb = info && !nouveauCode ? { sel: info.sel, iv: info.iv_cle, cle: info.cle } : await C.emballer(brute, code);
  await nuage.appelRest('/rest/v1/cap_kit', { methode: 'POST', entetes: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    corps: { id: ID, version, sel: emb.sel, iv_cle: emb.iv, cle: emb.cle, iv: C.b64(iv), nb: morceaux.length } });
  if (info) await nuage.appelRest(`/rest/v1/cap_kit_morceaux?kit=eq.${ID}&version=neq.${version}`, { methode: 'DELETE' }).catch(() => {});
  return { version, brute, taille: chiffre.length, morceaux: morceaux.length };
}

// Liste des secteurs d'un kit (pour l'écran de choix)
export const secteursDuKit = kit => Object.entries(kit.secteurs).map(([nom, s]) => ({ nom, departements: s.departements, magasins: s.feuilles.Magasins.length }));
