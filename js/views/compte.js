// Écran « Compte et synchronisation » : connexion, création de compte, mot de passe oublié,
// clé de secours, état de la synchronisation entre appareils.
import { $, esc, toast, modal, fmtDate, pickFile } from '../ui.js';
import * as kitS from '../services/kit.js';
import * as nuage from '../services/nuage.js';
import * as synchro from '../services/synchro.js';

const mdpOk = m => m.length >= 8 && /\d/.test(m) && /[a-z]/i.test(m);
const REGLE = '8 caractères minimum, avec des lettres et des chiffres';

export async function render(el, params = {}) {
  await nuage.lireConfig();
  // lien d'invitation : l'adresse du service et sa clé publique arrivent dans le lien (rien de secret)
  let invite = false;
  if (params.projet && params.cle) {
    if (!nuage.configure()) await nuage.ecrireConfig(params.projet, params.cle);
    history.replaceState(null, '', location.pathname + '#/compte');
    invite = !(await kitS.adhesion());
  }
  const session = await nuage.session();
  const ouvert = session && await synchro.coffreOuvert();
  const retour = window.__retourMail;
  el.innerHTML = `<div class="page compte"><a class="back" href="#/reglages">Réglages</a><h1>Compte et synchronisation</h1><div id="zone"></div></div>`;
  const z = $('#zone');
  if (retour?.erreur) { toast(`Lien expiré ou déjà utilisé : ${retour.erreur}`, 'warn'); window.__retourMail = null; }

  if (!nuage.configure()) return ecranConfig(z, el);
  if (invite) setTimeout(() => rejoindre(el), 300);   // lien d'invitation : on enchaîne directement sur le code entreprise
  if (!session) { ecranConnexion(z, el); return equipeSansCompte(el); }
  if (!ouvert) return retour?.type === 'recovery' ? ecranNouveauMdp(z, el) : ecranDeverrouiller(z, el, session);
  return ecranEtat(z, el, session);
}

// ── 1. adresse du service ─────────────────────────────────────────────────────
function ecranConfig(z, el) {
  const q = s => z.querySelector(s);
  z.innerHTML = `<form id="fi" class="settings"><h2 class="h2">Tu as reçu un lien d'invitation ?</h2>
      <label>Colle-le ici<input name="lien" type="url" placeholder="https://…#/compte?projet=…" required></label>
      <button class="btn primary">Rejoindre mon équipe</button></form>
    <details><summary>Configurer un service à toi (responsable)</summary>
    <p>Pour retrouver tes données sur le téléphone et le PC automatiquement, l'appli utilise ton propre espace en ligne (Supabase).
    Tout y est <strong>chiffré sur l'appareil</strong> avant d'être envoyé : l'hébergeur ne peut rien lire.</p>
    <form id="f" class="settings">
      <label>Adresse du projet<input name="url" type="url" placeholder="https://xxxx.supabase.co" required></label>
      <label>Clé publique (« anon » ou « publishable »)<input name="cle" required autocomplete="off"></label>
      <p class="hint">Jamais la clé « service_role » / « secret ».</p>
      <button class="btn primary">Enregistrer</button></form></details>`;
  q('#fi').onsubmit = async e => {
    e.preventDefault();
    const lien = new FormData(e.target).get('lien');
    const qs = new URLSearchParams((lien.split('#')[1] || '').split('?')[1] || '');
    if (!qs.get('projet') || !qs.get('cle')) return toast('Ce n\'est pas un lien d\'invitation Cap Secteur', 'warn');
    render(el, { projet: qs.get('projet'), cle: qs.get('cle') });
  };
  q('#f').onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    if (/service_role|sb_secret_/i.test(d.cle) || /"role"\s*:\s*"service_role"/.test(atobSafe(d.cle))) return toast('C\'est la clé secrète : prends la clé publique', 'warn');
    await nuage.ecrireConfig(d.url, d.cle);
    render(el);
  };
}
const atobSafe = k => { try { return atob((k.split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/')); } catch { return ''; } };

// ── 2. connexion / création de compte / mot de passe oublié ─────────────────────
function ecranConnexion(z, el, onglet = 'connexion') {
  const q = s => z.querySelector(s);
  const creer = onglet === 'creer';
  z.innerHTML = `<div class="seg" role="tablist"><button data-o="connexion" aria-selected="${!creer}">Se connecter</button><button data-o="creer" aria-selected="${creer}">Créer un compte</button></div>
    <form id="f" class="settings auth">
      <label>E-mail<input name="email" type="email" autocomplete="email" required></label>
      <label>Mot de passe<input name="mdp" type="password" autocomplete="${creer ? 'new-password' : 'current-password'}" required></label>
      ${creer ? `<label>Confirmer le mot de passe<input name="mdp2" type="password" autocomplete="new-password" required></label><p class="hint">${REGLE}.</p>` : ''}
      <button class="btn primary">${creer ? 'Créer mon compte' : 'Se connecter'}</button>
      ${creer ? '' : '<button type="button" class="btn ghost" id="oubli">Mot de passe oublié ?</button>'}
    </form>
    <p class="hint"><button type="button" class="btn small ghost" id="cfg">Changer l'adresse du service</button></p>`;
  z.querySelectorAll('[data-o]').forEach(b => b.onclick = () => ecranConnexion(z, el, b.dataset.o));
  q('#cfg').onclick = async () => { await nuage.ecrireConfig('', ''); render(el); };
  q('#oubli')?.addEventListener('click', async () => {
    const r = await modal({ titre: 'Mot de passe oublié', valider: 'Envoyer le lien', corps: `<label>E-mail du compte<input name="email" type="email" value="${esc(q('#f').email.value)}" required></label>
      <p class="hint">Tu vas recevoir un mail avec un lien : ouvre-le sur cet appareil. Tu choisiras un nouveau mot de passe, puis tu taperas ta clé de secours pour retrouver tes données.</p>` });
    if (!r) return;
    try { await nuage.motDePasseOublie(r.email.trim()); toast('Mail envoyé : regarde ta boîte de réception (et les indésirables)'); }
    catch (e) { toast(e.message, 'warn'); }
  });
  q('#f').onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target)), email = d.email.trim();
    const btn = e.target.querySelector('.btn.primary'); btn.disabled = true;
    try {
      if (creer) {
        if (d.mdp !== d.mdp2) throw new Error('Les deux mots de passe ne sont pas identiques');
        if (!mdpOk(d.mdp)) throw new Error(`Mot de passe trop faible : ${REGLE}`);
        const r = await nuage.creerCompte(email, d.mdp);
        if (!r.connecte) { z.innerHTML = `<div class="banner">Compte créé. Ouvre le mail de confirmation envoyé à <strong>${esc(email)}</strong>, puis reviens ici pour te connecter.</div><button class="btn" id="ok">Se connecter</button>`; q('#ok').onclick = () => ecranConnexion(z, el); return; }
      } else await nuage.connexion(email, d.mdp);
      await apresConnexion(d.mdp);
      render(el);
    } catch (err) { toast(err.message, 'warn'); btn.disabled = false; }
  };
}

async function apresConnexion(mdp) {
  const premierBranchement = !(await synchro.derniereSynchro());
  const r = await synchro.ouvrirCoffre(mdp);
  if (r.nouvelleCleSecours) await montrerCleSecours(r.nouvelleCleSecours);
  if (premierBranchement) await synchro.toutMarquer();      // ce que l'appareil contient part en ligne
  const e = await synchro.synchroniser();
  toast(e.erreur ? `Connecté, mais synchronisation impossible : ${e.erreur}` : 'Connecté : tes données sont synchronisées');
}

async function montrerCleSecours(cle) {
  for (;;) {
    const p = modal({ titre: 'Ta clé de secours', valider: 'Je l\'ai notée', corps: `
      <p>Note-la sur papier ou dans un endroit sûr (pas dans un mail). Elle sert <strong>uniquement</strong> si tu oublies ton mot de passe :
      sans elle, les données en ligne ne pourraient plus être déchiffrées. Elle ne sera plus jamais affichée.</p>
      <p class="cle-secours">${esc(cle)}</p>
      <button type="button" class="btn small" id="copier">Copier</button>
      <label class="check"><input type="checkbox" name="ok" required> J'ai noté ma clé de secours</label>` });
    $('#copier').onclick = async () => { try { await navigator.clipboard.writeText(cle); toast('Clé copiée'); } catch { toast('Copie impossible : recopie-la à la main', 'warn'); } };
    const r = await p;
    if (r?.ok === 'on') return;
  }
}

// ── 3. retour du lien « mot de passe oublié » ─────────────────────────────────
function ecranNouveauMdp(z, el) {
  const q = s => z.querySelector(s);
  z.innerHTML = `<div class="banner">Choisis un nouveau mot de passe, puis tape ta clé de secours pour retrouver tes données.</div>
    <form id="f" class="settings">
      <label>Nouveau mot de passe<input name="mdp" type="password" autocomplete="new-password" required></label>
      <label>Confirmer<input name="mdp2" type="password" autocomplete="new-password" required></label><p class="hint">${REGLE}.</p>
      <label>Clé de secours<input name="secours" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" autocomplete="off" required></label>
      <button class="btn primary">Valider</button></form>`;
  q('#f').onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    try {
      if (d.mdp !== d.mdp2) throw new Error('Les deux mots de passe ne sont pas identiques');
      if (!mdpOk(d.mdp)) throw new Error(`Mot de passe trop faible : ${REGLE}`);
      await synchro.reouvrirAvecSecours(d.secours, d.mdp);
      window.__retourMail = null;
      await synchro.synchroniser();
      toast('Mot de passe changé, données retrouvées');
      render(el);
    } catch (err) { toast(err.message, 'warn'); }
  };
}

// ── 4. connecté mais clé pas encore sur l'appareil (après confirmation par mail) ───
function ecranDeverrouiller(z, el, session) {
  const q = s => z.querySelector(s);
  z.innerHTML = `<p>Connecté${session.email ? ` en tant que <strong>${esc(session.email)}</strong>` : ''}. Tape ton mot de passe pour déverrouiller tes données sur cet appareil.</p>
    <form id="f" class="settings"><label>Mot de passe<input name="mdp" type="password" autocomplete="current-password" required></label>
    <button class="btn primary">Déverrouiller</button> <button type="button" class="btn ghost" id="sortir">Se déconnecter</button></form>`;
  q('#sortir').onclick = async () => { await nuage.deconnexion(); render(el); };
  q('#f').onsubmit = async e => {
    e.preventDefault();
    try { window.__retourMail = null; await apresConnexion(new FormData(e.target).get('mdp')); render(el); }
    catch (err) { toast(err.message, 'warn'); }
  };
}

// ── 5. état de la synchronisation ───────────────────────────────────────────────
async function ecranEtat(z, el, session) {
  const q = s => z.querySelector(s);
  const [derniere, attente] = [await synchro.derniereSynchro(), await synchro.enAttente()];
  const e = synchro.etatSynchro();
  if (!z.isConnected) return;
  z.innerHTML = `<div class="tour-sum sync-sum">
      <div><span class="big">${derniere ? new Date(derniere).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '–'}</span>dernière synchro${derniere ? ` (${fmtDate(derniere.slice(0, 10))})` : ''}</div>
      <div class="${attente ? 'over' : ''}"><span class="big">${attente}</span>modification${attente > 1 ? 's' : ''} en attente</div></div>
    ${e.erreur ? `<div class="banner warn">${esc(e.erreur)}</div>` : ''}
    <p>Connecté en tant que <strong>${esc(session.email || '')}</strong>. La synchronisation est automatique : à l'ouverture, quelques secondes après chaque modification, puis toutes les 2 minutes. Hors connexion, les modifications attendent et partent au retour du réseau.</p>
    <p class="hint">Chiffré sur l'appareil avant envoi : l'hébergeur ne voit ni tes magasins, ni tes notes, ni tes frais. La clé TomTom ne quitte jamais l'appareil.</p>
    <div class="actions"><button class="btn primary" id="sync">Synchroniser maintenant</button>
      <button class="btn" id="mdp">Changer le mot de passe</button><button class="btn ghost" id="sortir">Se déconnecter</button></div>
    <p><button class="btn small" id="invit">Copier le lien d'invitation pour un collègue</button></p>
    <section class="settings" id="kitZone"><h2 class="h2">Kit entreprise</h2><p class="muted">Vérification…</p></section>`;
  sectionKit(q('#kitZone'), el);
  q('#invit').onclick = async () => {
    const c = await nuage.lireConfig();
    const lien = `${location.origin}${location.pathname}#/compte?projet=${encodeURIComponent(c.url)}&cle=${encodeURIComponent(c.cle)}`;
    try { await navigator.clipboard.writeText(lien); toast('Lien copié : envoie-le à ton collègue (le code entreprise, lui, se donne à part)'); }
    catch { await modal({ titre: 'Lien d\'invitation', valider: 'Fermer', corps: `<p>Copie ce lien :</p><p class="cle-secours" style="font-size:.85rem">${esc(lien)}</p>` }); }
  };
  q('#sync').onclick = async () => {
    q('#sync').disabled = true;
    const r = await synchro.synchroniser();
    toast(r.erreur ? r.erreur : `Synchronisé : ${r.envoyes} envoyé${r.envoyes > 1 ? 's' : ''}, ${r.recus} reçu${r.recus > 1 ? 's' : ''}`, r.erreur ? 'warn' : undefined);
    render(el);
  };
  q('#mdp').onclick = async () => {
    const r = await modal({ titre: 'Changer le mot de passe', valider: 'Changer', corps: `
      <label>Nouveau mot de passe<input name="mdp" type="password" autocomplete="new-password" required></label>
      <label>Confirmer<input name="mdp2" type="password" autocomplete="new-password" required></label><p class="hint">${REGLE}. Ta clé de secours reste la même.</p>` });
    if (!r) return;
    try {
      if (r.mdp !== r.mdp2) throw new Error('Les deux mots de passe ne sont pas identiques');
      if (!mdpOk(r.mdp)) throw new Error(`Mot de passe trop faible : ${REGLE}`);
      await synchro.changerMotDePasse(r.mdp); toast('Mot de passe changé');
    } catch (err) { toast(err.message, 'warn'); }
  };
  q('#sortir').onclick = async () => {
    const r = await modal({ titre: 'Se déconnecter', valider: 'Se déconnecter', corps: `<p>La synchronisation s'arrête sur cet appareil. Tes données restent sur l'appareil et en ligne.</p>
      ${attente ? `<p class="banner warn">${attente} modification(s) pas encore envoyée(s) : elles partiront à ta prochaine connexion.</p>` : ''}` });
    if (!r) return;
    await nuage.deconnexion(); await synchro.oublierCoffre(); render(el);
  };
}

// ── 6. kit entreprise (base France + catalogue + profil, chiffré avec le code entreprise) ──
// Sans compte : on peut quand même rejoindre l'équipe ; le compte ne sert qu'à synchroniser ses appareils
function equipeSansCompte(el) {
  const s = document.createElement('section');
  s.className = 'settings'; s.id = 'kitZone';
  el.querySelector('.page').append(s);
  const p = document.createElement('p');
  p.className = 'hint'; p.textContent = 'Le compte est facultatif : il sert seulement à retrouver tes visites, notes et frais sur ton autre appareil (téléphone ↔ PC).';
  el.querySelector('#zone').prepend(p);
  return sectionKit(s, el);
}

async function sectionKit(zone, el) {
  if (!zone) return;
  let info = null, a = null;
  try { [info, a] = [await kitS.infoKit(), await kitS.adhesion()]; }
  catch (e) { zone.innerHTML = `<h2 class="h2">Kit entreprise</h2><p class="muted">${esc(e.message)}</p>`; return; }
  const date = v => v ? `${v.slice(6, 8)}/${v.slice(4, 6)}/${v.slice(0, 4)} ${v.slice(8, 10)}:${v.slice(10, 12)}` : '';
  zone.innerHTML = `<h2 class="h2">Kit entreprise</h2>
    ${a ? `<p>Tu utilises le kit de ton équipe : <strong>${esc(a.secteurs.join(', '))}</strong>${a.departements?.length ? ` (dép. ${esc(a.departements.join(', '))})` : ''}, version du ${date(a.version)}.
      Il se met à jour tout seul quand il est republié.</p>
      <div class="actions"><button class="btn" id="kMaj">Vérifier les mises à jour</button><button class="btn" id="kSecteur">Changer de secteur</button></div>`
    : info ? `<p>Un kit entreprise est disponible (publié le ${date(info.version)}). Avec le code entreprise donné par ton responsable,
      tu récupères d'un coup ta base magasins, le catalogue et les réglages de l'entreprise.</p>
      <div class="actions"><button class="btn primary" id="kJoindre">Rejoindre l'équipe</button></div>`
    : '<p class="muted">Aucun kit publié pour l\'instant.</p>'}
    <details><summary>Publier ou mettre à jour le kit (responsable)</summary>
      <p class="hint">Choisis le fichier « Kit entreprise.json » de ton dossier de données et le code entreprise. Le kit part chiffré : sans le code, personne ne peut le lire, pas même l'hébergeur.
      Donne le code aux collègues de vive voix ou par SMS, jamais par mail avec le lien.</p>
      <button class="btn" id="kPublier">Publier le kit…</button></details>`;
  const q = s => zone.querySelector(s);
  q('#kJoindre')?.addEventListener('click', () => rejoindre(el));
  q('#kSecteur')?.addEventListener('click', () => rejoindre(el, a));
  q('#kMaj')?.addEventListener('click', async () => {
    try { const r = await kitS.mettreAJour(); toast(r?.erreur || (r?.version ? 'Kit mis à jour' : 'Tu as déjà la dernière version'), r?.erreur ? 'warn' : undefined); }
    catch (e) { toast(e.message, 'warn'); }
  });
  q('#kPublier').onclick = () => publier(el, info);
}

async function rejoindre(el, actuel = null) {
  const r = await modal({ titre: 'Rejoindre l\'équipe', valider: 'Ouvrir le kit', corps: `
    <label>Code entreprise<input name="code" type="password" autocomplete="off" required></label>
    <p class="hint">Le code t'a été donné par ton responsable.</p>` });
  if (!r) return;
  let ouvert;
  try { ouvert = await kitS.ouvrirKit(r.code, { codeOk: () => toast('Code bon : téléchargement du kit…') }); }
  catch (e) { return toast(e.message, 'warn'); }
  const secteurs = kitS.secteursDuKit(ouvert.kit);
  const choisi = actuel?.secteurs?.[0] || secteurs[0]?.nom;
  const p = modal({ titre: 'Ton secteur', valider: 'Charger mes magasins', large: true, corps: `
    <div class="radio-col">${secteurs.map(s => `<label class="check"><input type="radio" name="secteur" value="${esc(s.nom)}" ${s.nom === choisi ? 'checked' : ''}> ${esc(s.nom)} <small class="muted">${s.magasins} magasins</small></label>`).join('')}</div>
    <p class="small">Départements <span class="muted">(décoche ceux qui ne sont pas à toi)</span></p>
    <div class="chips" id="kDeps"></div>
    <p class="hint">Tes notes, commandes et frais déjà saisis sont conservés.</p>` });
  const deps = () => {
    const s = secteurs.find(x => x.nom === document.querySelector('input[name=secteur]:checked')?.value);
    const garde = new Set(actuel?.departements || []);
    document.getElementById('kDeps').innerHTML = (s?.departements || []).map(d => `<label class="chip-check"><input type="checkbox" name="dep:${d}" ${!garde.size || garde.has(d) ? 'checked' : ''}><span>${d}</span></label>`).join('');
  };
  document.querySelectorAll('input[name=secteur]').forEach(i => i.onchange = deps); deps();
  const c = await p;
  if (!c) return;
  const choix = { secteurs: [c.secteur], departements: Object.keys(c).filter(k => k.startsWith('dep:')).map(k => k.slice(4)) };
  if (!choix.departements.length) return toast('Coche au moins un département', 'warn');
  try {
    const res = await kitS.appliquerKit(ouvert.kit, choix);
    await kitS.memoriser(ouvert.brute, ouvert.version, choix);
    toast(`Bienvenue : ${res.magasins} magasins chargés, avec le catalogue et les réglages de l'entreprise`);
    location.hash = '#/magasins';
  } catch (e) { toast(e.message, 'warn'); }
}

async function publier(el, info) {
  if (!(await nuage.session())) return toast('Connecte-toi à ton compte pour publier le kit', 'warn');
  const file = await pickFile('.json,application/json');
  if (!file) return;
  let kit;
  try { kit = JSON.parse(await file.text()); if (kit.type !== 'kit' || !kit.secteurs) throw new Error(); }
  catch { return toast('Ce fichier n\'est pas un kit entreprise', 'warn'); }
  const nb = Object.values(kit.secteurs).reduce((a, s) => a + s.feuilles.Magasins.length, 0);
  const r = await modal({ titre: 'Publier le kit entreprise', valider: 'Publier', corps: `
    <p>${Object.keys(kit.secteurs).length} secteurs, ${nb} magasins, catalogue et profil « ${esc(kit.nom || '')} ».</p>
    <label>Code entreprise${info ? ' (le code actuel, pour une simple mise à jour)' : ''}<input name="code" type="password" autocomplete="new-password" required minlength="8"></label>
    <label>Confirmer le code<input name="code2" type="password" autocomplete="new-password" required></label>
    ${info ? '<label class="check"><input type="checkbox" name="nouveau"> Changer de code (par exemple après le départ d\'un collègue) : chacun devra saisir le nouveau</label>' : ''}` });
  if (!r) return;
  if (r.code !== r.code2) return toast('Les deux codes ne sont pas identiques', 'warn');
  try {
    toast('Chiffrement et envoi du kit…');
    const res = await kitS.publierKit(kit, r.code, { nouveauCode: r.nouveau === 'on' });
    // si le responsable utilise déjà le kit, il passe directement à la nouvelle version
    const a = await kitS.adhesion();
    if (a) await kitS.memoriser(res.brute, res.version, { secteurs: a.secteurs, departements: a.departements });
    toast(`Kit publié et chiffré (${res.morceaux} morceau${res.morceaux > 1 ? 'x' : ''})${a ? '' : '. Pour l\'utiliser aussi toi-même : « Rejoindre l\'équipe »'}`);
    render(el);
  } catch (e) {
    toast(e.codeDifferent ? 'Ce code ne correspond pas au code actuel. Coche « Changer de code » si c\'est voulu.' : e.message, 'warn');
  }
}
