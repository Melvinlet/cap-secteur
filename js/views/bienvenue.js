// Premier démarrage : pose les questions dans l'ordre pour qu'un collègue soit prêt en 2 minutes.
//  Rejoindre mon équipe : lien d'invitation → code entreprise → secteur → toi (nom, point de départ) → compte (facultatif)
//  J'ai déjà un compte : lien d'invitation si besoin → connexion (tout revient par la synchronisation)
import { esc, toast } from '../ui.js';
import { db, getSettings, saveSettings } from '../db.js';
import * as nuage from '../services/nuage.js';
import * as kitS from '../services/kit.js';

export const marquerVu = () => db.put('reglages', { cle: 'bienvenue', valeur: true }, { sync: false });

// À l'ouverture : faut-il montrer cet écran ? (appareil vierge, ni équipe, ni compte, ni magasins)
export async function aMontrer() {
  if ((await db.get('reglages', 'bienvenue'))?.valeur) return false;
  await nuage.lireConfig();
  if (await kitS.adhesion() || await nuage.session()) return false;
  return (await db.all('magasins')).length === 0;
}

const lireLien = lien => {
  const qs = new URLSearchParams((String(lien).split('#')[1] || '').split('?')[1] || '');
  return qs.get('projet') && qs.get('cle') ? { projet: qs.get('projet'), cle: qs.get('cle') } : null;
};

export async function render(el, params = {}) {
  await nuage.lireConfig();
  if (params.projet && params.cle) {               // arrivé par le lien d'invitation
    await nuage.ecrireConfig(params.projet, params.cle);
    history.replaceState(null, '', location.pathname + '#/bienvenue');
  }
  el.innerHTML = `<div class="page bienvenue"><div id="w"></div></div>`;
  const w = el.querySelector('#w');
  const etat = { chemin: null };
  const q = s => w.querySelector(s);
  const ecran = (etape, total, titre, corps) => {
    w.innerHTML = `${etape ? `<p class="w-etape">Étape ${etape} sur ${total}</p>` : ''}<h1>${titre}</h1>${corps}`;
    w.querySelector('input:not([type=radio]):not([type=checkbox])')?.focus();
  };

  // ── 0. choix ──
  function accueil() {
    ecran(0, 0, 'Bienvenue dans Cap Secteur', `
      <p class="w-intro">Tes tournées, tes magasins, tes comptes rendus et tes frais, au même endroit, même sans réseau.</p>
      <div class="w-choix">
        <button class="w-btn" data-c="equipe"><strong>Premier démarrage</strong><span>On m'a envoyé un lien ou un code entreprise : je rejoins mon équipe.</span></button>
        <button class="w-btn" data-c="compte"><strong>J'ai déjà un compte</strong><span>J'utilise déjà l'appli sur un autre appareil : je me connecte et je retrouve tout.</span></button>
      </div>
      <p><button class="btn ghost small" id="seul">Juste découvrir l'appli</button></p>`);
    w.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { etat.chemin = b.dataset.c; nuage.configure() ? suite() : lien(); });
    q('#seul').onclick = async () => { await marquerVu(); location.hash = '#/'; };
  }
  const total = () => etat.chemin === 'equipe' ? (nuage.configure() && !etat.lienDemande ? 4 : 5) : 2;
  const n = i => etat.lienDemande ? i + 1 : i;
  const suite = () => etat.chemin === 'equipe' ? code() : connexion();

  // ── lien d'invitation (seulement si l'appli ne connaît pas encore le service) ──
  function lien() {
    etat.lienDemande = true;
    ecran(1, total(), 'Ton lien d\'invitation', `
      <form id="f" class="settings">
        <label>Colle ici le lien que ton responsable t'a envoyé<input name="lien" type="url" required placeholder="https://…"></label>
        <p class="hint">Tu l'as reçu par SMS, WhatsApp ou mail. Appui long dans le message → Copier, puis appui long ici → Coller.</p>
        <div class="actions"><button type="button" class="btn ghost" id="ret">Retour</button><button class="btn primary">Continuer</button></div></form>`);
    q('#ret').onclick = accueil;
    q('#f').onsubmit = async e => {
      e.preventDefault();
      const l = lireLien(new FormData(e.target).get('lien'));
      if (!l) return toast('Ce n\'est pas un lien d\'invitation Cap Secteur : recopie-le en entier', 'warn');
      await nuage.ecrireConfig(l.projet, l.cle);
      suite();
    };
  }

  // ── code entreprise ──
  function code() {
    ecran(n(1), total(), 'Le code entreprise', `
      <form id="f" class="settings">
        <label>Code entreprise<input name="code" type="password" autocomplete="off" required></label>
        <p class="hint">Ton responsable te le donne à part (de vive voix ou par SMS). Ce n'est pas un mot de passe de compte.</p>
        <div class="actions"><button type="button" class="btn ghost" id="ret">Retour</button><button class="btn primary" id="go">Ouvrir le kit de l'équipe</button></div></form>`);
    q('#ret').onclick = accueil;
    q('#f').onsubmit = async e => {
      e.preventDefault();
      const b = q('#go'); b.disabled = true; b.textContent = 'Vérification du code…';
      try {
        etat.ouvert = await kitS.ouvrirKit(new FormData(e.target).get('code'), { codeOk: () => { b.textContent = 'Téléchargement de la base…'; } });
        secteur();
      } catch (err) { toast(err.message, 'warn'); b.disabled = false; b.textContent = 'Ouvrir le kit de l\'équipe'; }
    };
  }

  // ── secteur et départements ──
  function secteur() {
    const secteurs = kitS.secteursDuKit(etat.ouvert.kit);
    ecran(n(2), total(), 'Ton secteur', `
      <form id="f" class="settings">
        <div class="radio-col">${secteurs.map((s, i) => `<label class="check"><input type="radio" name="secteur" value="${esc(s.nom)}" ${i ? '' : 'checked'}> ${esc(s.nom)} <small class="muted">${s.magasins} magasins</small></label>`).join('')}</div>
        <p class="small">Tes départements <span class="muted">(décoche ceux qui ne sont pas à toi)</span></p>
        <div class="chips" id="deps"></div>
        <div class="actions"><button class="btn primary" id="go">Charger mes magasins</button></div></form>`);
    const deps = () => {
      const s = secteurs.find(x => x.nom === q('input[name=secteur]:checked')?.value);
      q('#deps').innerHTML = (s?.departements || []).map(d => `<label class="chip-check"><input type="checkbox" name="dep:${d}" checked><span>${d}</span></label>`).join('');
    };
    w.querySelectorAll('input[name=secteur]').forEach(i => i.onchange = deps); deps();
    q('#f').onsubmit = async e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const choix = { secteurs: [d.secteur], departements: Object.keys(d).filter(k => k.startsWith('dep:')).map(k => k.slice(4)) };
      if (!choix.departements.length) return toast('Coche au moins un département', 'warn');
      const b = q('#go'); b.disabled = true; b.textContent = 'Chargement…';
      try {
        const r = await kitS.installer(etat.ouvert.kit, etat.ouvert.brute, etat.ouvert.version, choix);
        await saveSettings({ departements: choix.departements });
        etat.nb = r.magasins;
        toi();
      } catch (err) { toast(err.message, 'warn'); b.disabled = false; b.textContent = 'Charger mes magasins'; }
    };
  }

  // ── toi : nom et point de départ des tournées ──
  async function toi() {
    const s = await getSettings();
    ecran(n(3), total(), 'Toi', `
      <div class="banner">${etat.nb} magasins chargés, avec le catalogue et les réglages de l'entreprise.</div>
      <form id="f" class="settings">
        <label>Ton nom et prénom <small class="muted">(sur tes comptes rendus et notes de frais)</small><input name="nom" value="${esc(s.commercial || '')}" autocomplete="name"></label>
        <label>D'où pars-tu le matin ? <small class="muted">(ton adresse, pour calculer les tournées)</small><input name="adresse" value="${esc(s.depart?.adresse || '')}" placeholder="Rue, code postal, ville" autocomplete="street-address"></label>
        <p class="hint">Elle reste sur ton appareil. Tu pourras la changer dans Réglages.</p>
        <div class="actions"><button type="button" class="btn ghost" id="passer">Plus tard</button><button class="btn primary" id="go">Continuer</button></div></form>`);
    q('#passer').onclick = compte;
    q('#f').onsubmit = async e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      const b = q('#go'); b.disabled = true;
      const maj = { commercial: d.nom.trim() };
      if (d.adresse.trim() && d.adresse.trim() !== s.depart?.adresse) {
        b.textContent = 'Localisation…';
        maj.depart = { adresse: d.adresse.trim(), lat: null, lon: null };
        try {
          const { geocodeAdresse } = await import('../services/geo.js');
          const r = await geocodeAdresse(d.adresse.trim(), s.cleTomTom);
          if (r) maj.depart = { adresse: d.adresse.trim(), lat: r.lat, lon: r.lon };
          else toast('Adresse pas trouvée : tu pourras la corriger dans Réglages', 'warn');
        } catch { toast('Pas de réseau pour localiser l\'adresse : réessaie dans Réglages', 'warn'); }
      }
      await saveSettings(maj);
      compte();
    };
  }

  // ── compte (facultatif) ──
  function compte() {
    ecran(n(4), total(), 'Un compte ? (facultatif)', `
      <p>Sans compte, l'appli marche déjà : tes magasins et le catalogue sont là, et ils se mettent à jour tout seuls.</p>
      <p>Le compte sert à <strong>retrouver tes visites, notes et frais sur ton autre appareil</strong> (téléphone et PC), et à ne rien perdre si tu changes de téléphone. Tout est chiffré : personne d'autre ne peut les lire.</p>
      <div class="actions"><button class="btn ghost" id="plus">Plus tard</button><button class="btn primary" id="creer">Créer mon compte</button></div>`);
    q('#plus').onclick = fin;
    q('#creer').onclick = async () => { await marquerVu(); location.hash = '#/compte?onglet=creer'; };
  }
  async function fin() {
    await marquerVu();
    toast('C\'est prêt : bonne route !');
    location.hash = '#/';
  }

  // ── déjà un compte ──
  async function connexion() {
    await marquerVu();
    location.hash = '#/compte';
  }

  accueil();
}
