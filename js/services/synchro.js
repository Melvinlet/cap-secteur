// ─────────────────────────────────────────────────────────────────────────────
// Synchronisation automatique entre appareils, chiffrée de bout en bout.
//  1. on récupère ce qui a changé en ligne depuis la dernière fois, on le déchiffre et on
//     l'applique (sauf si l'appareil a une modification plus récente du même élément) ;
//  2. on envoie, chiffrées, les modifications faites sur l'appareil.
// Le plus récent gagne (horodatage de la modification). Hors ligne : tout attend, rien ne se perd.
// ─────────────────────────────────────────────────────────────────────────────
import { db, STORES, SYNCHRO, surModification, oublierReglages } from '../db.js';
import { appliquerProfil } from '../config.js';
import * as nuage from './nuage.js';
import * as C from './chiffrement.js';
import { blobToDataURL, dataURLToBlob } from './images.js';

let cles = null;                 // clés de travail (en mémoire)
let enCours = null, minuteur = null, relance = null;
const etat = { derniere: null, erreur: null, envoyes: 0, recus: 0 };
export const etatSynchro = () => ({ ...etat });

const lire = async k => (await db.get('sync', k))?.valeur;
const ecrire = (k, valeur) => db.put('sync', { k, valeur }, { sync: false });

// ── Clés ─────────────────────────────────────────────────────────────────────
async function chargerCles() {
  if (cles) return cles;
  const brute = await lire('cle');
  if (!brute) return null;
  cles = await C.clesDeTravail(new Uint8Array(brute));
  return cles;
}
async function garderCle(brute) { await ecrire('cle', Array.from(brute)); cles = await C.clesDeTravail(brute); }

// Après connexion : récupère la clé de données (avec le mot de passe), ou la crée au premier usage.
// Renvoie { nouvelleCleSecours } la première fois : à montrer une seule fois à l'utilisateur.
export async function ouvrirCoffre(motDePasse) {
  const enLigne = await nuage.lireCles();
  if (enLigne) {
    const brute = await C.deballer(enLigne.mdp, motDePasse);
    if (!brute) throw new Error('Ce mot de passe ne déverrouille pas tes données. S\'il a été changé par « mot de passe oublié », utilise ta clé de secours.');
    await garderCle(brute);
    return {};
  }
  const brute = C.nouvelleCleDonnees();
  const secours = C.nouvelleCleSecours();
  await nuage.ecrireCles({ mdp: await C.emballer(brute, motDePasse), secours: await C.emballer(brute, C.normaliserCleSecours(secours)) });
  await garderCle(brute);
  return { nouvelleCleSecours: secours };
}
// Mot de passe oublié : nouveau mot de passe + clé de secours
export async function reouvrirAvecSecours(cleSecours, nouveauMdp) {
  const enLigne = await nuage.lireCles();
  if (!enLigne) throw new Error('Aucune donnée en ligne pour ce compte');
  const brute = await C.deballer(enLigne.secours, C.normaliserCleSecours(cleSecours));
  if (!brute) throw new Error('Clé de secours incorrecte');
  await nuage.changerMotDePasse(nouveauMdp);
  await nuage.ecrireCles({ mdp: await C.emballer(brute, nouveauMdp), secours: enLigne.secours });
  await garderCle(brute);
}
// Changement de mot de passe en étant connecté (la clé est déjà sur l'appareil)
export async function changerMotDePasse(nouveau) {
  const brute = new Uint8Array(await lire('cle'));
  const enLigne = await nuage.lireCles();
  await nuage.changerMotDePasse(nouveau);
  await nuage.ecrireCles({ mdp: await C.emballer(brute, nouveau), secours: enLigne.secours });
}
export async function oublierCoffre() {
  cles = null;
  for (const k of ['cle', 'depuis']) await db.del('sync', k, { sync: false });
}
export const coffreOuvert = async () => !!(await chargerCles());

// Premier branchement d'un appareil : tout ce qu'il contient part en ligne (le plus récent gagnera)
export async function toutMarquer() {
  for (const store of SYNCHRO) {
    const rows = await db.all(store);
    const kp = STORES[store].keyPath;
    const lignes = rows.filter(r => store !== 'reglages' || ['settings', 'profil', 'kit'].includes(r[kp]))
      .map(r => ({ k: `d:${store}:${r[kp]}`, store, id: r[kp], t: Date.parse(r.maj || r.majImport || '') || 1, supprime: false }));
    for (let i = 0; i < lignes.length; i += 500) await Promise.all(lignes.slice(i, i + 500).map(l => db.put('sync', l, { sync: false })));
  }
}

// ── Mise en forme des enregistrements ───────────────────────────────────────────
async function emballerEnregistrement(store, id) {
  let rec = await db.get(store, id);
  if (!rec) return null;
  if (store === 'reglages' && id === 'settings') { const { cleTomTom, ...v } = rec.valeur || {}; rec = { ...rec, valeur: v }; }   // la clé TomTom reste sur l'appareil
  if (store === 'images' && rec.blob) rec = { ...rec, blob: undefined, data: await blobToDataURL(rec.blob), mime: rec.blob.type };
  return rec;
}
async function appliquer(store, id, rec, supprime) {
  if (!STORES[store]) return false;
  if (supprime) { await db.del(store, id, { sync: false }); return true; }
  if (store === 'images' && rec.data) { const { data, mime, ...r } = rec; rec = { ...r, blob: await dataURLToBlob(data) }; }
  if (store === 'reglages' && id === 'settings') {
    const local = (await db.get('reglages', 'settings'))?.valeur || {};
    rec = { ...rec, valeur: { ...rec.valeur, cleTomTom: local.cleTomTom || '' } };
    await db.put(store, rec, { sync: false }); oublierReglages(); return true;
  }
  await db.put(store, rec, { sync: false });
  if (store === 'reglages' && id === 'profil') { appliquerProfil(rec.valeur); oublierReglages(); }
  return true;
}

// Kit entreprise : nouvelle version publiée ? (simple vérification, téléchargement seulement si besoin)
async function verifierKit() {
  try {
    const k = await (await import('./kit.js')).mettreAJour();
    if (k?.erreur) etat.erreur = k.erreur;
    else if (k?.version) { etat.kit = k.version; dispatchEvent(new CustomEvent('cap-synchro', { detail: { kit: k.version } })); (await import('../ui.js')).toast('Kit entreprise mis à jour (base magasins, catalogue, profil)'); }
  } catch { /* kit indisponible : on réessaiera */ }
}

// ── Un tour de synchronisation ──────────────────────────────────────────────────
export function synchroniser() {
  if (enCours) return enCours;
  enCours = (async () => {
    try {
      await nuage.lireConfig();
      if (!nuage.configure() || !navigator.onLine) return etat;
      if (!(await nuage.session()) || !(await chargerCles())) { await verifierKit(); return etat; }
      if (!(await nuage.jeton())) { etat.erreur = 'Session expirée : reconnecte-toi'; return etat; }
      let recus = 0, envoyes = 0;
      dispatchEvent(new CustomEvent('cap-synchro-etat', { detail: { enCours: true } }));
      // 1. réception
      let depuis = await lire('depuis');
      for (;;) {
        const lignes = await nuage.recevoir(depuis);
        if (!lignes?.length) break;
        for (const l of lignes) {
          const moi = await db.get('sync', `e:${l.k}`);                              // notre propre envoi qui revient
          if (moi && moi.t === Number(l.t)) { await db.del('sync', moi.k, { sync: false }); continue; }
          let p;
          try { p = await C.dechiffrer(cles, l.iv, l.data); } catch { continue; }   // illisible : autre clé, on ignore
          const attente = await db.get('sync', `d:${p.store}:${p.id}`);
          if (attente && attente.t > Number(l.t)) continue;                        // l'appareil a plus récent : il sera envoyé
          if (await appliquer(p.store, p.id, p.rec, l.supprime)) recus++;
          if (attente) await db.del('sync', attente.k, { sync: false });
        }
        depuis = lignes[lignes.length - 1].modifie;
        await ecrire('depuis', depuis);
        if (lignes.length < 300) break;
      }
      // 2. envoi
      const attentes = (await db.all('sync')).filter(x => x.k.startsWith('d:'));
      for (let i = 0; i < attentes.length; i += 50) {
        const lot = attentes.slice(i, i + 50);
        const lignes = [];
        for (const a of lot) {
          const rec = a.supprime ? null : await emballerEnregistrement(a.store, a.id);
          const supprime = a.supprime || !rec;
          const { iv, data } = await C.chiffrer(cles, { store: a.store, id: a.id, rec: supprime ? null : rec });
          lignes.push({ k: await C.masquer(cles, `${a.store}:${a.id}`), t: a.t, supprime, iv, data });
        }
        await nuage.envoyer(lignes);
        for (const l of lignes) await db.put('sync', { k: `e:${l.k}`, t: l.t }, { sync: false });
        for (const a of lot) {                       // retiré de la file seulement s'il n'a pas changé entre-temps
          const cur = await db.get('sync', a.k);
          if (cur && cur.t === a.t) await db.del('sync', a.k, { sync: false });
        }
        envoyes += lot.length;
      }
      Object.assign(etat, { derniere: new Date().toISOString(), erreur: null, envoyes, recus });
      dispatchEvent(new CustomEvent('cap-synchro-etat', { detail: { fini: true, echanges: envoyes + recus } }));
      await ecrire('derniere', etat.derniere);
      if (recus) dispatchEvent(new CustomEvent('cap-synchro', { detail: { recus } }));
      await verifierKit();
    } catch (e) {
      dispatchEvent(new CustomEvent('cap-synchro-etat', { detail: { fini: true, erreur: true } }));
      etat.erreur = e.message;
      if (e.status === 401) etat.erreur = 'Session expirée : reconnecte-toi';
    } finally { enCours = null; }
    return etat;
  })();
  return enCours;
}
export const enAttente = async () => (await db.all('sync')).filter(x => x.k.startsWith('d:')).length;
export const derniereSynchro = () => lire('derniere');

// ── Synchronisation automatique ──────────────────────────────────────────────────
export function demarrer() {
  surModification(() => { clearTimeout(relance); relance = setTimeout(synchroniser, 8000); });   // peu après une modification
  addEventListener('online', () => setTimeout(synchroniser, 3000));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') synchroniser(); });
  clearInterval(minuteur); minuteur = setInterval(synchroniser, 2 * 60 * 1000);
  setTimeout(synchroniser, 2000);
}
