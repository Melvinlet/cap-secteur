// Accueil : la journée en un coup d'œil.
import { db, getSettings } from '../db.js';
import { magasinsEnrichis } from '../data.js';
import { esc, borne, fmtDateLong, fmtDate, today, fmtHeure } from '../ui.js';
import { getTournee, planning } from './tournee.js';
import { aRelancer, dateEnLettres } from '../services/rdv.js';

export async function render(el) {
  const s = await getSettings();
  const mags = await magasinsEnrichis(s);
  if (!mags.length) {
    el.innerHTML = `<div class="page welcome">
      <img src="icons/icon.svg" alt="" width="72" height="72">
      <h1>Bienvenue dans Cap Secteur</h1>
      <p>Tes tournées, tes fiches magasins, ton catalogue et tes commandes, au même endroit, même sans réseau.</p>
      <ol class="steps">
        <li><strong>Importe ta base magasins</strong> : le fichier Excel « Magasins secteur.xlsx ».</li>
        <li><strong>Indique ton point de départ</strong> pour le calcul des trajets.</li>
        <li><strong>Colle ta clé TomTom</strong> (facultatif) pour des temps de trajet précis.</li>
      </ol>
      <a class="btn primary" href="#/reglages">Commencer</a></div>`;
    return;
  }
  const byId = new Map(mags.map(m => [m.id, m]));
  const t = await getTournee(today());
  const p = planning(t, byId, s);
  const savs = (await db.all('sav')).filter(x => x.statut !== 'Résolu').sort((a, b) => a.date.localeCompare(b.date));
  const todos = (await db.all('notes')).filter(n => n.aFaire).sort((a, b) => (a.echeance || '9999').localeCompare(b.echeance || '9999') || b.date.localeCompare(a.date)).slice(0, 8);
  const retard = mags.filter(m => m.enRetard).sort((a, b) => b.joursDepuisVisite - a.joursDepuisVisite);
  const jamais = mags.filter(m => !m.derniereVisite).length;
  const prenom = (s.commercial || '').split(' ')[0];
  const rdvs = await db.all('rdv');
  const relances = rdvs.filter(r => aRelancer(r, s.relanceApres));
  const prochainsRdv = rdvs.filter(r => ['acceptee', 'autreDate'].includes(r.statut)).map(r => ({ ...r, j: r.statut === 'autreDate' ? r.dateRetenue : r.date, h: r.statut === 'autreDate' ? r.heureRetenue : r.heure }))
    .filter(r => r.j && r.j >= today()).sort((a, b) => (a.j + a.h).localeCompare(b.j + b.h)).slice(0, 6);

  el.innerHTML = `<div class="page">
    <header class="hello"><a class="btn-icon settings-link" href="#/reglages" aria-label="Réglages" style="float:right">⚙</a><p class="muted">${fmtDateLong(today())}</p><h1>${prenom ? `Bonjour ${esc(prenom)}` : 'Bonjour'}</h1></header>
    <section class="today-tour">
      <h2 class="h2">Tournée du jour <a class="btn small" href="#/tournee">${t.etapes.length ? 'Ouvrir' : 'Préparer'}</a></h2>
      ${t.etapes.length ? `<ol class="mini-stops">${p.etapes.map((e, i) => { const m = byId.get(e.magasinId); return m ? `<li class="${e.fait ? 'done' : ''}"><span class="n">${i + 1}</span>
        <a href="#/magasin/${encodeURIComponent(m.id)}">${esc(m.nom)}</a>${t.calcul ? `<span class="muted">${fmtHeure(e.arrivee)}</span>` : ''}</li>` : ''; }).join('')}</ol>`
        : '<p class="muted">Rien de prévu aujourd\'hui.</p>'}
    </section>
    <div class="grid2">
      <section><h2 class="h2">SAV en cours <span class="badge">${savs.length}</span></h2>
        <ul class="plain">${savs.slice(0, 8).map(x => { const m = byId.get(x.magasinId); return `<li><a href="#/magasin/${encodeURIComponent(x.magasinId)}/sav">${esc(x.produit || 'SAV')}</a> <span class="muted">${esc(m?.nom || '')} · ${fmtDate(x.date)} · ${esc(x.statut)}</span></li>`; }).join('') || '<li class="muted">Aucun dossier ouvert.</li>'}</ul></section>
      <section><h2 class="h2">À faire</h2>
        <ul class="plain">${todos.map(n => { const m = byId.get(n.magasinId); return `<li><a href="#/magasin/${encodeURIComponent(n.magasinId)}/suivi">${esc(n.aFaire)}</a> <span class="muted">${esc(m?.nom || '')}</span>${n.echeance ? ` <span class="tag ${n.echeance < today() ? 'late' : ''}">pour le ${fmtDate(n.echeance)}</span>` : ''}</li>`; }).join('') || '<li class="muted">Rien en attente. Les « prochaines étapes » notées pendant tes visites apparaissent ici.</li>'}</ul></section>
    </div>
    <div class="grid2">
      <section><h2 class="h2">Rendez-vous confirmés <a class="btn small" href="#/rdv">Rendez-vous</a></h2>
        <ul class="plain">${prochainsRdv.map(r => { const m = byId.get(r.magasinId); return m ? `<li><a href="#/magasin/${encodeURIComponent(m.id)}">${esc(m.nom)}</a> <span class="muted">${esc(dateEnLettres(r.j))}${r.h ? ' à ' + esc(r.h) : ''}</span></li>` : ''; }).join('') || '<li class="muted">Aucun rendez-vous confirmé à venir.</li>'}</ul></section>
      <section><h2 class="h2">Demandes à relancer <span class="badge">${relances.length}</span></h2>
        <ul class="plain">${relances.slice(0, 6).map(r => { const m = byId.get(r.magasinId); return m ? `<li><a href="#/rdv?m=${encodeURIComponent(m.id)}">${esc(m.nom)}</a> <span class="muted">envoyée le ${fmtDate(r.dateRelance || r.dateEnvoi)}</span></li>` : ''; }).join('') || `<li class="muted">Rien à relancer : une demande sans réponse depuis ${s.relanceApres} jours apparaîtra ici.</li>`}</ul></section>
    </div>
    <section><h2 class="h2">À revoir en priorité</h2>
      <p class="muted">${retard.length} magasin${retard.length > 1 ? 's' : ''} en retard de visite · ${jamais} jamais visité${jamais > 1 ? 's' : ''}</p>
      ${retard.length ? '' : ''}<ul class="store-list compact" ${retard.length ? '' : 'hidden'}>${retard.slice(0, 6).map(m => `<li><a class="store" href="#/magasin/${encodeURIComponent(m.id)}">${borne(m.departement)}<span class="store-main"><span class="store-name">${esc(m.nom)}</span><span class="store-sub">Dernière visite il y a ${m.joursDepuisVisite} jours</span></span></a></li>`).join('')}</ul>
      ${jamais ? `<a class="btn ghost" href="#/magasins">Voir les magasins jamais visités</a>` : ''}
    </section></div>`;
}
