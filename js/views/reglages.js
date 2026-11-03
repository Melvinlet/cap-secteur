// Réglages : profil, tournées, services en ligne, import / export des données.
import { db, getSettings, saveSettings, STORES } from '../db.js';
import { APP_VERSION, DUREES_ENSEIGNE, PRIORITES, OBJETS_VISITE, MODELES_RDV, PROFIL } from '../config.js';
import { $, $$, esc, toast, pickFile, downloadBlob, confirmer, modal, today } from '../ui.js';
import { importerBaseMagasins } from '../services/excel.js';
import { geocodeAdresse, geocodeMagasin } from '../services/geo.js';
import { exporter, importer } from '../services/backup.js';

export async function render(el) {
  const s = await getSettings();
  const nbMag = await db.count('magasins');
  const nonLoc = (await db.all('magasins')).filter(m => m.lat == null).length;
  let usage = '';
  try { const e = await navigator.storage.estimate(); usage = `${(e.usage / 1048576).toFixed(1)} Mo utilisés sur cet appareil`; } catch { /* non dispo */ }

  el.innerHTML = `<div class="page">
    <h1>Réglages</h1>
    <form id="f" class="settings">
      <section><h2 class="h2">Toi</h2>
        <label>Ton nom (bons de commande et colonne « Chef de secteur » du planning)<input name="commercial" value="${esc(s.commercial)}" autocomplete="name"></label></section>

      <section><h2 class="h2">Rendez-vous</h2>
        <div class="row"><label>Ton téléphone pro (signature)<input name="telPro" type="tel" value="${esc(s.telPro)}"></label>
          <label>Ton e-mail pro (signature)<input name="emailPro" type="email" value="${esc(s.emailPro)}"></label>
          <label>Proposer une relance après (jours)<input name="relanceApres" type="number" min="1" value="${s.relanceApres}"></label></div>
        <details><summary>Messages de rendez-vous (modifiables)</summary>
          <p class="hint">Variables : {bonjour} {contact} {magasin} {enseigne} {ville} {quand} {date} {heure} {objet} {chef} {telephone} {email}.
          « {quand} » donne par exemple « le mardi 10 novembre vers 10 h 30 », « {objet} » la phrase liée à l'objet de la visite.</p>
          ${Object.entries(MODELES_RDV).map(([k, m]) => { const v = { ...m, ...((s.modelesRdv || {})[k] || {}) }; return `<fieldset><legend>${esc(m.label)}</legend>
            ${k === 'sms' ? '' : `<label>Objet du mail<input name="mod:${k}:sujet" value="${esc(v.sujet)}"></label>`}
            <label>Texte<textarea name="mod:${k}:corps" rows="${k === 'sms' ? 3 : 10}">${esc(v.corps)}</textarea></label>
            <button type="button" class="btn small ghost" data-reset="${k}">Revenir au texte d'origine</button></fieldset>`; }).join('')}
        </details></section>

      <section><h2 class="h2">Notes de frais</h2>
        <label>Catégories (une par ligne)<textarea name="categoriesFrais" rows="5">${esc((s.categoriesFrais || []).join('\n'))}</textarea></label>
        <label>Indemnité kilométrique (€/km, 0 = pas d'indemnité)<input name="tauxKm" type="number" min="0" step="0.001" value="${s.tauxKm ?? 0}"></label>
        <p class="hint">Si tu indiques un taux, une dépense saisie avec des kilomètres et sans montant est calculée automatiquement (km × taux).</p></section>

      <section><h2 class="h2">Tournées</h2>
        <label>Point de départ (domicile)
          <span class="row"><input name="departAdresse" value="${esc(s.depart.adresse)}" placeholder="Adresse complète" class="grow"><button type="button" class="btn" id="locDepart">Localiser</button></span>
          <small id="departInfo" class="hint">${s.depart.lat != null ? `Position enregistrée (${s.depart.lat.toFixed(4)}, ${s.depart.lon.toFixed(4)})` : 'Pas encore localisé'}</small></label>
        <div class="row"><label>Début de journée<input type="time" name="heureDebut" value="${s.heureDebut}"></label>
          <label>Fin de journée<input type="time" name="heureFin" value="${s.heureFin}"></label>
          <label>Pause déjeuner (min)<input type="number" name="pauseMidi" min="0" step="15" value="${s.pauseMidi}"></label></div>
        <label>Durée d'une visite, autres enseignes (min)<input type="number" name="dureeVisite" min="5" step="5" value="${s.dureeVisite}"></label>
        <fieldset><legend>Fréquence de visite par priorité (jours)</legend><div class="row">
          ${[1, 2, 3].map(p => `<label>${PRIORITES[p].label}<input type="number" min="1" name="freq:${p}" value="${(s.frequencesPriorite || {})[p] ?? PRIORITES[p].freq}"></label>`).join('')}
        </div><p class="hint">La priorité par défaut de chaque enseigne vient du profil entreprise. Change la priorité d'un magasin sur sa fiche, ou de plusieurs d'un coup depuis la liste Magasins.</p></fieldset>
        <fieldset><legend>Durée de visite par enseigne (min)</legend><div class="row">
          ${Object.keys(DUREES_ENSEIGNE).map(e => `<label>${esc(e)}<input type="number" min="5" step="5" name="duree:${esc(e)}" value="${(s.dureesEnseigne || {})[e] ?? DUREES_ENSEIGNE[e]}"></label>`).join('')}
        </div><p class="hint">Les autres enseignes utilisent la durée d'une visite ci-dessus. Une durée peut aussi être fixée magasin par magasin.</p></fieldset>
        <fieldset><legend>Plan de secteur</legend>
          <div class="row"><label>Jours de terrain par semaine<select name="joursTerrain">${[3, 4, 5, 6].map(n => `<option ${+s.joursTerrain === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <label>Nuit sur place si le retour dépasse (min)<input type="number" name="seuilDecoucher" min="15" step="5" value="${s.seuilDecoucher}"></label></div>
          <label class="check"><input type="checkbox" name="decoucher" ${s.decoucher ? 'checked' : ''}> Nuits à l'hôtel autorisées</label></fieldset>
        <label>Objet de visite par défaut (export du planning)<select name="objetDefaut">${OBJETS_VISITE.map(o => `<option ${o === s.objetDefaut ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
        <label>Application GPS<select name="gps"><option value="waze" ${s.gps === 'waze' ? 'selected' : ''}>Waze</option><option value="google" ${s.gps === 'google' ? 'selected' : ''}>Google Maps</option></select></label>
      </section>

      <section><h2 class="h2">Calcul des trajets</h2>
        <label>Service d'itinéraire<select name="itineraire">
          <option value="tomtom" ${s.itineraire === 'tomtom' ? 'selected' : ''}>TomTom (temps de trajet réels)</option>
          <option value="aucun" ${s.itineraire === 'aucun' ? 'selected' : ''}>Aucun (estimation à vol d'oiseau)</option></select></label>
        <label>Clé TomTom
          <span class="row"><input name="cleTomTom" type="password" value="${esc(s.cleTomTom)}" autocomplete="off" spellcheck="false" class="grow" placeholder="Colle ta clé ici">
          <button type="button" class="btn" id="showKey">Afficher</button><button type="button" class="btn" id="testKey">Tester</button></span>
          <small class="hint">Gratuite sur developer.tomtom.com. Elle reste sur cet appareil et n'est jamais incluse dans les sauvegardes.</small></label>
        <label>Fond de carte<select name="fondCarte"><option value="osm" ${s.fondCarte === 'osm' ? 'selected' : ''}>OpenStreetMap</option><option value="tomtom" ${s.fondCarte === 'tomtom' ? 'selected' : ''}>TomTom (utilise ta clé)</option></select></label>
        <p class="hint">${s.calibration?.n ? `Calibrage automatique : d'après tes ${s.calibration.n} dernière(s) tournée(s) TomTom, les trajets réels prennent ×${s.calibration.temps.toFixed(2)} le temps estimé. Le plan de secteur en tient compte.` : 'Le plan de secteur se calibrera tout seul sur tes tournées calculées par TomTom.'}</p>
        <details><summary>Estimation sans service</summary><div class="row">
          <label>Coefficient route / vol d'oiseau<input type="number" name="coefRoute" min="1" max="2" step="0.05" value="${s.coefRoute}"></label>
          <label>Vitesse moyenne (km/h)<input type="number" name="vitesseMoyenne" min="20" max="130" value="${s.vitesseMoyenne}"></label></div></details>
      </section>

      <section><h2 class="h2">Secteur</h2>
        <label>Départements (séparés par des virgules)<input name="departements" value="${esc(s.departements.join(', '))}"></label></section>

      <div class="sticky-save"><button class="btn primary" type="submit">Enregistrer les réglages</button></div>
    </form>

    <section class="settings"><h2 class="h2">Base magasins</h2>
      <p>${nbMag} magasin${nbMag > 1 ? 's' : ''} enregistré${nbMag > 1 ? 's' : ''}${nbMag ? ` · ${nonLoc} non localisé${nonLoc > 1 ? 's' : ''}` : ''}.</p>
      <div class="actions">
        <button class="btn primary" id="impBase">Importer la base magasins (Excel)</button>
        ${nonLoc ? `<button class="btn" id="geoAll">Localiser les ${nonLoc} magasins</button>` : ''}
      </div>
      <p class="hint">Réimporter le fichier met à jour les adresses et contacts sans effacer tes notes, commandes ni SAV.</p>
      <div id="geoProg" hidden><progress max="1" value="0"></progress> <span></span></div>
    </section>

    <section class="settings"><h2 class="h2">Profil entreprise</h2>
      <p>${PROFIL.nom ? `Profil chargé : <strong>${esc(PROFIL.nom)}</strong>.` : '<strong>Aucun profil chargé.</strong> L\'appli fonctionne, mais sans tes enseignes, ta campagne de commande, tes messages ni ton modèle de note de frais.'}</p>
      <p class="hint">Le profil (enseignes, campagne, messages, modèle de note de frais…) reste sur cet appareil. Il n'est jamais dans le code de l'appli : importe le fichier « Profil entreprise.json » de ton dossier de données. Il est aussi inclus dans tes sauvegardes.</p>
      <div class="actions"><button class="btn${PROFIL.nom ? '' : ' primary'}" id="impProfil">Importer le profil entreprise</button></div>
    </section>

    <section class="settings"><h2 class="h2">Compte et synchronisation</h2>
      <p id="etatCompte" class="muted">…</p>
      <div class="actions"><a class="btn primary" href="#/compte">Compte et synchronisation</a></div>
    </section>

    <section class="settings"><h2 class="h2">Sauvegarde manuelle</h2>
      <p>Copie de secours, ou transfert vers un autre appareil sans compte : exporte ici, puis importe le fichier sur l'autre appareil.</p>
      <div class="actions"><button class="btn" id="expAll">Exporter mes données</button><button class="btn" id="impAll">Importer une sauvegarde</button></div>
    </section>

    <section class="settings"><h2 class="h2">Partager le catalogue</h2>
      <p>Le pack catalogue contient uniquement les produits, leurs photos et leur référencement par enseigne — sans aucun prix, sans tes magasins ni tes notes. Il peut être envoyé aux collègues.</p>
      <p class="hint">Pour démarrer : importe le pack catalogue fourni avec tes données.</p>
      <div class="actions"><button class="btn" id="expCat">Exporter le pack catalogue</button><button class="btn" id="impCat">Importer un pack catalogue</button></div>
    </section>

    <section class="settings danger-zone"><h2 class="h2">Zone sensible</h2>
      <button class="btn danger" id="wipe">Effacer toutes les données de cet appareil</button></section>

    <p class="muted about">Cap Secteur ${APP_VERSION}${usage ? ` · ${usage}` : ''}</p>
  </div>`;

  const f = $('#f');
  f.onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const num = k => Number(d[k]);
    const depart = d.departAdresse === s.depart.adresse ? s.depart : { adresse: d.departAdresse, lat: null, lon: null };
    await saveSettings({
      commercial: d.commercial.trim(), depart, heureDebut: d.heureDebut, heureFin: d.heureFin, pauseMidi: num('pauseMidi'),
      dureeVisite: num('dureeVisite'), objetDefaut: d.objetDefaut,
      telPro: d.telPro.trim(), emailPro: d.emailPro.trim(), relanceApres: num('relanceApres') || 3,
      modelesRdv: Object.fromEntries(Object.keys(MODELES_RDV).map(k => [k, {
        ...(d[`mod:${k}:sujet`] !== undefined && d[`mod:${k}:sujet`] !== MODELES_RDV[k].sujet ? { sujet: d[`mod:${k}:sujet`] } : {}),
        ...(d[`mod:${k}:corps`] !== MODELES_RDV[k].corps ? { corps: d[`mod:${k}:corps`] } : {}) }]).filter(([, v]) => Object.keys(v).length)),
      frequencesPriorite: Object.fromEntries([1, 2, 3].map(p => [p, num('freq:' + p)])), gps: d.gps, itineraire: d.itineraire,
      cleTomTom: d.cleTomTom.trim(), fondCarte: d.fondCarte, coefRoute: num('coefRoute'), vitesseMoyenne: num('vitesseMoyenne'),
      departements: d.departements.split(/[,;\s]+/).filter(Boolean),
      dureesEnseigne: Object.fromEntries(Object.entries(d).filter(([k]) => k.startsWith('duree:')).map(([k, v]) => [k.slice(6), Number(v)])),
      categoriesFrais: d.categoriesFrais.split('\n').map(x => x.trim()).filter(Boolean), tauxKm: num('tauxKm') || 0,
      joursTerrain: num('joursTerrain'), seuilDecoucher: num('seuilDecoucher'), decoucher: d.decoucher === 'on',
    });
    toast('Réglages enregistrés');
    if (depart.lat == null && depart.adresse) $('#locDepart').click();
  };

  $('#locDepart').onclick = async () => {
    const q = f.departAdresse.value.trim();
    if (!q) return toast('Saisis d\'abord une adresse', 'warn');
    try {
      const r = await geocodeAdresse(q, f.cleTomTom.value.trim());
      if (!r) return toast('Adresse introuvable', 'warn');
      await saveSettings({ depart: { adresse: q, lat: r.lat, lon: r.lon } });
      $('#departInfo').textContent = `Trouvé : ${r.label || q}`;
      toast('Point de départ enregistré');
    } catch { toast('Pas de connexion : réessaie plus tard', 'warn'); }
  };
  $$('[data-reset]').forEach(b => b.onclick = () => {
    const k = b.dataset.reset;
    if (f[`mod:${k}:sujet`]) f[`mod:${k}:sujet`].value = MODELES_RDV[k].sujet;
    f[`mod:${k}:corps`].value = MODELES_RDV[k].corps;
    toast('Texte d\'origine remis : pense à enregistrer');
  });
  $('#showKey').onclick = e => { const i = f.cleTomTom; i.type = i.type === 'password' ? 'text' : 'password'; e.target.textContent = i.type === 'password' ? 'Afficher' : 'Masquer'; };
  $('#testKey').onclick = async () => {
    const k = f.cleTomTom.value.trim();
    if (!k) return toast('Colle d\'abord ta clé', 'warn');
    try {
      const r = await fetch(`https://api.tomtom.com/routing/1/calculateRoute/47.4784,-0.5632:47.2184,-1.5536/json?key=${encodeURIComponent(k)}`);
      toast(r.ok ? 'Clé valide : TomTom répond' : `Clé refusée (erreur ${r.status})`, r.ok ? '' : 'warn');
    } catch { toast('Pas de connexion', 'warn'); }
  };

  $('#impBase').onclick = async () => {
    const file = await pickFile('.xlsx');
    if (!file) return;
    try {
      const r = await importerBaseMagasins(file);
      toast(`${r.magasins} magasins importés (${r.nouveaux} nouveaux)`);
      render(el);
    } catch (e) { toast(e.message, 'warn'); }
  };
  $('#geoAll')?.addEventListener('click', async () => {
    const todo = (await db.all('magasins')).filter(m => m.lat == null);
    const box = $('#geoProg'), bar = box.querySelector('progress'), txt = box.querySelector('span');
    box.hidden = false; bar.max = todo.length; $('#geoAll').disabled = true;
    let ok = 0, approx = 0, ko = 0;
    for (const [i, m] of todo.entries()) {
      try {
        const g = await geocodeMagasin(m, s.cleTomTom);
        if (g) { await db.put('magasins', { ...m, lat: g.lat, lon: g.lon, precision: g.precision }); g.precision === 'adresse' ? ok++ : approx++; } else ko++;
      } catch { ko++; if (!navigator.onLine) break; }
      bar.value = i + 1; txt.textContent = `${i + 1} / ${todo.length}`;
      await new Promise(r => setTimeout(r, 120)); // reste poli avec le service public
    }
    toast(`${ok} trouvés à l'adresse, ${approx} au centre de la ville, ${ko} introuvables`);
    render(el);
  });

  import('../services/nuage.js').then(async n => {
    await n.lireConfig(); const s = await n.session(); const x = $('#etatCompte'); if (!x) return;
    x.textContent = !n.configure() ? 'Pas encore configuré : tes données ne sont que sur cet appareil.' : s ? `Connecté (${s.email || 'compte'}) : synchronisation automatique et chiffrée entre tes appareils.` : 'Configuré, mais pas connecté sur cet appareil.';
  });
  $('#expAll').onclick = async () => downloadBlob(await exporter('complet'), `Cap Secteur sauvegarde ${today()}.json`);
  $('#expCat').onclick = async () => downloadBlob(await exporter('catalogue'), `Cap Secteur catalogue ${today()}.json`);
  const imp = async () => {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    const choix = await modal({ titre: 'Importer', valider: 'Importer', corps: `
      <label class="check"><input type="radio" name="mode" value="fusion" checked> Fusionner avec les données de cet appareil (recommandé)</label>
      <label class="check"><input type="radio" name="mode" value="remplacer"> Remplacer les données de cet appareil</label>` });
    if (!choix) return;
    try {
      const r = await importer(file, choix.mode);
      const n = Object.values(r.bilan).reduce((a, b) => a + b, 0);
      toast(r.type === 'profil' ? `Profil « ${r.nom || 'entreprise'} » chargé` : `${r.type === 'catalogue' ? 'Catalogue' : 'Sauvegarde'} importé : ${n} éléments`);
      render(el);
    } catch (e) { toast(e.message, 'warn'); }
  };
  $('#impAll').onclick = imp; $('#impCat').onclick = imp;
  $('#impProfil').onclick = async () => {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    try { const r = await importer(file, 'fusion'); toast(r.type === 'profil' ? `Profil « ${r.nom || 'entreprise'} » chargé` : 'Fichier importé'); render(el); }
    catch (e) { toast(e.message, 'warn'); }
  };
  $('#wipe').onclick = async () => {
    if (!(await confirmer('Tout effacer', 'Toutes les données de cet appareil (magasins, notes, commandes, SAV, catalogue, réglages) seront supprimées. Exporte une sauvegarde avant si tu en as besoin.', 'Tout effacer'))) return;
    for (const st of Object.keys(STORES)) await db.clear(st);
    location.hash = '#/'; location.reload();
  };
}
