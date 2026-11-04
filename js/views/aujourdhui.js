// Accueil : la journée en un coup d'œil.
import { db, getSettings } from '../db.js';
import { magasinsEnrichis } from '../data.js';
import { esc, borne, fmtDateLong, fmtDate, today, fmtHeure } from '../ui.js';
import { getTournee, planning } from './tournee.js';
import { aRelancer, dateEnLettres } from '../services/rdv.js';
import { lienGps } from '../services/routing.js';

export async function render(el) {
  const s = await getSettings();
  const mags = await magasinsEnrichis(s);
  if (!mags.length) {
    el.innerHTML = `<div class="page welcome">
      <img src="icons/icon.svg" alt="" width="72" height="72">
      <h1>Bienvenue dans Cap Secteur</h1>
      <p>Tes tournées, tes fiches magasins, ton catalogue et tes commandes, au même endroit, même sans réseau.</p>
      <p>Pas encore de magasins : rejoins ton équipe avec le lien et le code entreprise de ton responsable, ou connecte-toi à ton compte.</p>
      <a class="btn primary" href="#/bienvenue">Commencer</a></div>`;
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
  // magasins en retard déjà placés dans une tournée des 14 prochains jours
  const fin = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const prevus = new Map();
  for (const x of await db.all('tournees')) if (x.id >= today() && x.id <= fin) for (const e of x.etapes || []) if (!prevus.has(e.magasinId)) prevus.set(e.magasinId, x.id);
  const aPlacer = retard.filter(m => !prevus.has(m.id));
  const prochain = p.etapes.find(e => !e.fait && byId.get(e.magasinId)?.lat != null);
  const mProchain = prochain && byId.get(prochain.magasinId);
  const rdvs = await db.all('rdv');
  const relances = rdvs.filter(r => aRelancer(r, s.relanceApres));
  const prochainsRdv = rdvs.filter(r => ['acceptee', 'autreDate'].includes(r.statut)).map(r => ({ ...r, j: r.statut === 'autreDate' ? r.dateRetenue : r.date, h: r.statut === 'autreDate' ? r.heureRetenue : r.heure }))
    .filter(r => r.j && r.j >= today()).sort((a, b) => (a.j + a.h).localeCompare(b.j + b.h)).slice(0, 6);

  el.innerHTML = `<div class="page">
    <header class="hello"><a class="btn-icon settings-link" href="#/reglages" aria-label="Réglages" style="float:right">⚙</a><p class="muted">${fmtDateLong(today())}</p><h1>${prenom ? `Bonjour ${esc(prenom)}` : 'Bonjour'}</h1></header>
    ${aPlacer.length ? `<section class="alerte-retard" role="status">
      <h2 class="h2">${aPlacer.length} magasin${aPlacer.length > 1 ? 's' : ''} en retard de visite, pas encore planifié${aPlacer.length > 1 ? 's' : ''}</h2>
      <ul class="plain">${aPlacer.slice(0, 3).map(m => `<li><a href="#/magasin/${encodeURIComponent(m.id)}">${esc(m.nom)}</a> <span class="muted">dernière visite il y a ${m.joursDepuisVisite} j (tous les ${m.frequenceEff} j prévu)</span></li>`).join('')}</ul>
      <a class="btn" href="#/semaine">Préparer ma semaine</a></section>` : ''}
    ${mProchain ? `<a class="btn primary gps-prochain" href="${lienGps(s.gps, mProchain)}" target="_blank" rel="noopener">
      <span>Aller au prochain magasin</span><strong>${esc(mProchain.nom)}</strong><small>avec ${s.gps === 'google' ? 'Google Maps' : 'Waze'}</small></a>` : ''}
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
      ${retard.length ? '' : ''}<ul class="store-list compact" ${retard.length ? '' : 'hidden'}>${retard.slice(0, 6).map(m => `<li><a class="store" href="#/magasin/${encodeURIComponent(m.id)}">${borne(m.departement)}<span class="store-main"><span class="store-name">${esc(m.nom)}</span><span class="store-sub">Dernière visite il y a ${m.joursDepuisVisite} jours${prevus.has(m.id) ? ` · prévu le ${fmtDate(prevus.get(m.id))}` : ''}</span></span></a></li>`).join('')}</ul>
      ${jamais ? `<a class="btn ghost" href="#/magasins">Voir les magasins jamais visités</a>` : ''}
    </section></div>`;
}
