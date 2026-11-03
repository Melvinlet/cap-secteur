// Objectifs : en nombres ou en unités (jamais en euros), suivis automatiquement.
import { db, uid, getSettings } from '../../db.js';
import { $, $$, esc, fmtDate, modal, toast, confirmer } from '../../ui.js';
import { INDICATEURS, ENSEIGNES_LISTE, PRIORITES, SAISON } from '../../config.js';
import { chargerTout, indicateurs, periode } from '../../services/activite.js';

const today = () => new Date().toISOString().slice(0, 10);

export async function render(el) {
  const s = await getSettings();
  const d = await chargerTout();
  const objs = d.objectifs.sort((a, b) => (a.fin || '').localeCompare(b.fin || ''));
  const valeur = o => o.indicateur === 'manuel' ? Number(o.valeur) || 0
    : indicateurs(d, o.debut, o.fin, s, { enseigne: o.enseigne, priorite: o.priorite, produitId: o.produitId })[o.indicateur] || 0;
  const avance = o => { // où on devrait en être aujourd'hui, au prorata du temps écoulé
    const t0 = new Date(o.debut + 'T12:00'), t1 = new Date(o.fin + 'T12:00'), t = new Date();
    return Math.max(0, Math.min(1, (t - t0) / (t1 - t0 || 1)));
  };
  el.innerHTML = `
    <div class="actions"><button class="btn primary" id="add">Nouvel objectif</button></div>
    <div class="objs">${objs.map(o => {
      const v = valeur(o), pct = o.cible ? Math.min(100, Math.round(v / o.cible * 100)) : 0, att = Math.round(avance(o) * 100);
      const etat = v >= o.cible ? 'ok' : pct + 5 < att && o.fin >= today() ? 'retard' : o.fin < today() ? 'fini' : '';
      return `<article class="obj ${etat}">
        <header><strong>${esc(o.titre || INDICATEURS[o.indicateur])}</strong><button class="btn-icon" data-ed="${o.id}" aria-label="Modifier">✎</button></header>
        <p class="muted small">${esc(INDICATEURS[o.indicateur])}${o.enseigne ? ` · ${esc(o.enseigne)}` : ''}${o.priorite !== '' && o.priorite != null ? ` · ${esc(PRIORITES[o.priorite]?.label || '')}` : ''}${o.produitId ? ` · ${esc(d.produits.find(p => p.id === o.produitId)?.nom || '')}` : ''} · du ${fmtDate(o.debut)} au ${fmtDate(o.fin)}</p>
        <div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span><i style="left:${att}%" title="Où tu devrais en être aujourd'hui"></i></div>
        <p class="obj-val"><span class="big">${v}</span> / ${o.cible} <span class="muted">(${pct} %)</span>
          ${etat === 'ok' ? '<b class="ok-txt">Atteint</b>' : etat === 'retard' ? `<b class="late-txt">En retard sur le rythme (${att} % du temps écoulé)</b>` : etat === 'fini' ? '<span class="muted">Terminé</span>' : ''}</p>
        ${o.indicateur === 'manuel' ? `<div class="row tight"><button class="btn small" data-m="${o.id}:-1">−1</button><button class="btn small" data-m="${o.id}:1">+1</button></div>` : ''}
      </article>`;
    }).join('') || '<p class="empty">Aucun objectif. Exemples : « 40 visites ce mois-ci », « tous les P1 vus avant fin janvier », « 150 unités commandées sur la campagne ». La progression se calcule toute seule à partir de tes comptes rendus, RDV et commandes.</p>'}</div>`;

  $('#add', el).onclick = () => editer({}, d).then(ok => ok && render(el));
  $$('[data-ed]', el).forEach(b => b.onclick = () => editer(objs.find(o => o.id === b.dataset.ed), d).then(ok => ok && render(el)));
  $$('[data-m]', el).forEach(b => b.onclick = async () => {
    const [id, k] = b.dataset.m.split(':'); const o = objs.find(x => x.id === id);
    await db.put('objectifs', { ...o, valeur: Math.max(0, (Number(o.valeur) || 0) + Number(k)), maj: new Date().toISOString() }); render(el);
  });
}

async function editer(o, d) {
  const [md, mf] = periode('mois', today());
  const p = modal({ titre: o.id ? 'Modifier l\'objectif' : 'Nouvel objectif', corps: `
    <label>Intitulé (facultatif)<input name="titre" value="${esc(o.titre || '')}" placeholder="ex. Tous les P1 vus avant Noël"></label>
    <div class="row"><label>Indicateur<select name="indicateur">${Object.entries(INDICATEURS).map(([k, v]) => `<option value="${k}" ${o.indicateur === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="qty">Cible<input type="number" min="1" name="cible" value="${esc(o.cible ?? '')}" required></label></div>
    <div class="row"><label>Enseigne<select name="enseigne"><option value="">Toutes</option>${ENSEIGNES_LISTE.map(e => `<option ${o.enseigne === e ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
    <label>Priorité<select name="priorite"><option value="">Toutes</option>${[1, 2, 3].map(p => `<option value="${p}" ${String(o.priorite) === String(p) ? 'selected' : ''}>${PRIORITES[p].label}</option>`).join('')}</select></label></div>
    <label>Produit (pour les unités commandées)<select name="produitId"><option value="">Tous les produits</option>${d.produits.sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0)).map(p => `<option value="${p.id}" ${o.produitId === p.id ? 'selected' : ''}>${esc(p.nom)}</option>`).join('')}</select></label>
    <div class="row"><label>Du<input type="date" name="debut" value="${esc(o.debut || md)}" required></label><label>Au<input type="date" name="fin" value="${esc(o.fin || mf)}" required></label></div>
    <p class="hint">Raccourcis : <button type="button" class="btn small" data-p="mois">Ce mois</button> <button type="button" class="btn small" data-p="trim">Ce trimestre</button> ${SAISON.commandeDebut ? `<button type="button" class="btn small" data-p="saison">${esc(SAISON.nom)}</button>` : ''}</p>
    ${o.id ? '<button type="button" class="btn danger small" id="delO">Supprimer l\'objectif</button>' : ''}` });
  $$('[data-p]').forEach(b => b.onclick = () => {
    const f = b.closest('form');
    if (b.dataset.p === 'mois') [f.debut.value, f.fin.value] = periode('mois', today());
    if (b.dataset.p === 'saison' && SAISON.commandeDebut) { f.debut.value = SAISON.commandeDebut; f.fin.value = SAISON.commandeFin; }
    if (b.dataset.p === 'trim') { const t = new Date(); const q = Math.floor(t.getMonth() / 3) * 3; f.debut.value = `${t.getFullYear()}-${String(q + 1).padStart(2, '0')}-01`; f.fin.value = periode('mois', `${t.getFullYear()}-${String(q + 3).padStart(2, '0')}-01`)[1]; }
  });
  let supprime = false;
  $('#delO')?.addEventListener('click', async () => { $('#delO').closest('dialog').close(); if (await confirmer('Supprimer l\'objectif', 'Supprimer cet objectif ?')) { await db.del('objectifs', o.id); supprime = true; } });
  const r = await p;
  if (supprime) return true;
  if (!r) return false;
  await db.put('objectifs', { ...o, ...r, id: o.id || uid('o'), cible: Number(r.cible), priorite: r.priorite === '' ? '' : Number(r.priorite), maj: new Date().toISOString() });
  toast('Objectif enregistré');
  return true;
}
