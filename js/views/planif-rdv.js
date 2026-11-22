// « Planifier un RDV » : un rendez-vous pris sur place (ou au téléphone) est saisi à la main.
// Magasin, jour, heure → le RDV passe en « Acceptée », le magasin entre dans la tournée de ce jour à la bonne place,
// et l'appli prévient avant d'enregistrer si ça empiète sur un autre magasin ou un autre RDV.
import { db, getSettings } from '../db.js';
import { magasinsEnrichis, dureeVisite, trierContacts } from '../data.js';
import { OBJETS_VISITE } from '../config.js';
import { esc, fmtHeure, parseHeure, modal, norm, toast, today, fmtDate } from '../ui.js';
import { getRdv, tousLesRdv, changerStatut, dateEnLettres } from '../services/rdv.js';
import { evenementRdv, proposerAgenda } from '../services/agenda.js';
import { ferie } from '../services/feries.js';
import { getTournee, estimerJour, placerRendezVous, departPourRdv, chainer, recalerLendemain } from './tournee.js';

const decale = (date, n) => { const d = new Date(date + 'T12:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const hh = min => fmtHeure(min).replace(':', 'h');

// Simule la journée avec ce RDV, sans rien enregistrer
async function simuler({ m, date, heure, objet }, mags, s) {
  const rdvs = new Map(await tousLesRdv());
  rdvs.set(m.id, { ...(rdvs.get(m.id) || {}), magasinId: m.id, statut: 'acceptee', date, heure });
  const t0 = await getTournee(date);
  const t = structuredClone(t0); t.calcul = null;
  const veille = await db.get('tournees', decale(date, -1));
  chainer(veille ? structuredClone(veille) : null, t, mags);
  const avant = t.etapes.length ? estimerJour({ ...structuredClone(t0), calcul: null }, mags, s, rdvs) : null;
  let e = t.etapes.find(x => x.magasinId === m.id);
  const dejaLa = !!e;
  if (!e) { e = { magasinId: m.id, fait: false }; t.etapes.push(e); }
  e.rdv = { heure, statut: 'Confirmée' };
  delete e.heureImposee;
  if (objet) e.objet = objet;
  placerRendezVous(t, mags, s, rdvs);
  let p = estimerJour(t, mags, s, rdvs);
  // partir plus tôt si c'est ce qui permet d'être à l'heure
  let departPropose = null;
  if (p.rdvRates) {
    const h = departPourRdv(t, mags, s, rdvs);
    if (h && parseHeure(h) < parseHeure(t.heureDebut || s.heureDebut)) departPropose = h;
  }
  const pe = p.etapes.find(x => x.magasinId === m.id);
  const alertes = [], infos = [];
  if (pe?.retardRdv) alertes.push(`Avec le reste de la journée, tu arriverais vers ${hh(pe.arrivee)} : ${pe.retardRdv} min après l'heure du RDV.`);
  for (const x of p.etapes) if (x !== pe && x.retardRdv) alertes.push(`Le RDV de ${esc(mags.get(x.magasinId)?.nom || '?')} (${esc(x.rdvHeure)}) serait raté de ${x.retardRdv} min.`);
  // chevauchement direct avec un autre RDV (indépendamment de la route)
  const debut = parseHeure(heure), fin = debut + Number(e.duree || dureeVisite(m, s));
  for (const x of p.etapes) {
    if (x === pe || !x.rdvConfirme || !x.rdvHeure) continue;
    const d2 = parseHeure(x.rdvHeure), f2 = d2 + x.duree;
    if (debut < f2 && d2 < fin) alertes.push(`Chevauche le RDV de ${esc(mags.get(x.magasinId)?.nom || '?')} à ${esc(x.rdvHeure)}.`);
  }
  // magasins décalés par le RDV
  if (avant) {
    const hAvant = new Map(avant.etapes.map(x => [x.magasinId, x.arrivee]));
    const decales = p.etapes.filter(x => x !== pe && hAvant.has(x.magasinId) && Math.abs(x.arrivee - hAvant.get(x.magasinId)) >= 20);
    if (decales.length) infos.push(`Décalé${decales.length > 1 ? 's' : ''} : ${decales.map(x => `${esc(mags.get(x.magasinId)?.nom || '?')} ${hh(hAvant.get(x.magasinId))} → ${hh(x.arrivee)}`).join(' · ')}.`);
  }
  const hors = p.etapes.filter(x => x.hors && !x.rdvConfirme && !x.fait && x.magasinId !== m.id);
  if (p.depasse) alertes.push(`La journée finirait vers ${hh(p.fin)} au lieu de ${s.heureFin.replace(':', 'h')}${hors.length ? ` : ${hors.length} magasin${hors.length > 1 ? 's' : ''} ne rentre${hors.length > 1 ? 'nt' : ''} plus` : ''}.`);
  // ailleurs dans le planning (jours à venir) : on le retire de là-bas
  const ailleurs = [];
  for (const t2 of await db.all('tournees')) {
    if (t2.id === date || t2.id < today()) continue;
    const x = t2.etapes?.find(y => y.magasinId === m.id && !y.fait);
    if (x) ailleurs.push({ date: t2.id, rdv: x.rdv?.heure || (x.rdv ? 'confirmé' : '') });
  }
  ailleurs.sort((a, b) => a.date.localeCompare(b.date));
  const fer = ferie(date);
  const js = new Date(date + 'T12:00').getDay();
  if (fer) alertes.push(`Le ${dateEnLettres(date)} est férié (${esc(fer)}).`);
  else if (js === 0 || js === 6) infos.push(`C'est un ${js === 6 ? 'samedi' : 'dimanche'}.`);
  if (date < today()) alertes.push('Ce jour est déjà passé : choisis aujourd\'hui ou un jour à venir.');
  return { t, p, pe, dejaLa, alertes, infos, hors, ailleurs, departPropose };
}

export async function planifierRdv(pre = {}) {
  const s = await getSettings();
  const all = await magasinsEnrichis(s);
  const mags = new Map(all.map(m => [m.id, m]));
  const etiq = m => `${m.nom} — ${m.cp || ''} ${m.ville || ''}`.trim();
  const parEtiq = new Map(all.map(m => [norm(etiq(m)), m]));
  const trouver = txt => { const q = norm(txt || ''); if (!q) return null; const m = parEtiq.get(q); if (m) return m; const l = all.filter(x => norm(etiq(x)).includes(q)); return l.length === 1 ? l[0] : null; };
  const m0 = pre.magasinId ? mags.get(pre.magasinId) : null;
  const p = modal({ titre: 'Planifier un RDV', valider: 'Enregistrer le RDV', large: true, corps: `
    <p class="hint">Un rendez-vous pris sur place ou au téléphone : il passe en « Acceptée » et entre dans ta tournée de ce jour, à son heure.</p>
    <label>Magasin<input name="mag" list="dlPlanRdv" value="${m0 ? esc(etiq(m0)) : ''}" placeholder="Tape le nom ou la ville du magasin" autocomplete="off" required></label>
    <datalist id="dlPlanRdv">${all.map(m => `<option value="${esc(etiq(m))}">`).join('')}</datalist>
    <div class="row"><label>Jour<input type="date" name="date" value="${esc(pre.date && pre.date >= today() ? pre.date : today())}" min="${today()}" required></label>
      <label>Heure<input type="time" name="heure" value="${esc(pre.heure || '')}" step="300" required></label></div>
    <div class="row"><label>Objet de la visite<select name="objet"><option value="">—</option>${OBJETS_VISITE.map(o => `<option value="${esc(o.id || o)}">${esc(o.label || o)}</option>`).join('')}</select></label>
      <label>Avec <small class="muted">(facultatif)</small><select name="contact" id="prCt"><option value="">—</option></select></label></div>
    <div id="prApercu" class="pr-apercu" aria-live="polite"><p class="muted small">Choisis le magasin, le jour et l'heure : l'appli te montre la journée avant d'enregistrer.</p></div>
    <label class="check"><input type="checkbox" name="agenda" checked> Me proposer de l'ajouter à mon agenda</label>` });
  const dlg = document.querySelector('dialog[open]');
  const fo = dlg.querySelector('form') || dlg;
  const v = n => fo.querySelector(`[name="${n}"]`).value;
  let dernier = null, jeton = 0, magCts = null;
  const majContacts = async m => {
    if (magCts === m?.id) return;
    magCts = m?.id || null;
    const sel = dlg.querySelector('#prCt');
    if (!m) { sel.innerHTML = '<option value="">—</option>'; return; }
    const [cts, r] = await Promise.all([db.byMagasin('contacts', m.id), getRdv(m.id)]);
    sel.innerHTML = '<option value="">—</option>' + trierContacts(cts).filter(c => c.nom).map(c => `<option value="${esc(c.id)}" ${c.id === r.contactId ? 'selected' : ''}>${esc(c.nom)}${c.fonction ? ` (${esc(c.fonction)})` : ''}</option>`).join('');
    if (r.objet && !v('objet')) fo.querySelector('[name="objet"]').value = r.objet;
  };
  const apercu = async () => {
    const box = dlg.querySelector('#prApercu');
    const m = trouver(v('mag')), date = v('date'), heure = v('heure');
    majContacts(m);
    if (!m) { dernier = null; box.innerHTML = `<p class="muted small">${v('mag') ? 'Choisis le magasin dans la liste proposée.' : 'Choisis le magasin, le jour et l\'heure : l\'appli te montre la journée avant d\'enregistrer.'}</p>`; return; }
    if (!date || !heure) { dernier = null; box.innerHTML = '<p class="muted small">Indique le jour et l\'heure du rendez-vous.</p>'; return; }
    const n = ++jeton;
    const res = await simuler({ m, date, heure, objet: v('objet') }, mags, s);
    if (n !== jeton) return;   // une saisie plus récente est en cours
    dernier = { m, date, heure, res };
    const { p, pe, alertes, infos, hors, ailleurs, departPropose } = res;
    box.innerHTML = `
      <p class="pr-titre"><strong>${esc(dateEnLettres(date))}</strong> · ${p.etapes.length} magasin${p.etapes.length > 1 ? 's' : ''} · fin vers ${hh(p.fin)}${p.estime ? ' <small class="muted">(estimation)</small>' : ''}</p>
      ${alertes.length ? `<div class="banner warn pr-alertes">${alertes.map(a => `<p>⚠ ${a}</p>`).join('')}</div>` : '<p class="pr-ok">✓ Ça rentre dans ta journée sans empiéter sur un autre rendez-vous.</p>'}
      ${infos.map(i => `<p class="small">${i}</p>`).join('')}
      <ol class="pr-jour">${p.etapes.map(x => { const mm = mags.get(x.magasinId) || {}; const moi = x === pe;
        return `<li class="${moi ? 'moi' : ''} ${x.retardRdv ? 'late' : ''} ${x.hors ? 'hors' : ''}"><span class="pr-h">${hh(x.arrivee)}</span> ${esc(mm.nom || '?')}${moi ? ' <span class="tag ok">nouveau RDV</span>' : x.rdvConfirme && x.rdvHeure ? ` <span class="tag ok">RDV ${esc(x.rdvHeure)}</span>` : ''}${x.retardRdv ? ` <span class="tag late">+${x.retardRdv} min</span>` : ''}${x.hors ? ' <span class="tag late">après l\'heure de fin</span>' : ''}</li>`; }).join('')}</ol>
      ${departPropose ? `<label class="check"><input type="checkbox" name="avancer" checked> Partir à ${departPropose.replace(':', 'h')} au lieu de ${(res.t.heureDebut || s.heureDebut).replace(':', 'h')} pour être à l'heure</label>` : ''}
      ${hors.length ? `<label class="check"><input type="checkbox" name="retirerHors"> Retirer de la journée ce qui ne rentre plus : ${hors.map(x => esc(mags.get(x.magasinId)?.nom || '?')).join(', ')}</label>` : ''}
      ${ailleurs.length ? `<label class="check"><input type="checkbox" name="retirerAilleurs" checked> Le retirer ${ailleurs.length > 1 ? 'des autres jours où il était prévu' : 'du jour où il était prévu'} : ${ailleurs.map(a => `${esc(dateEnLettres(a.date))}${a.rdv ? ` <b class="late-txt">(il y avait un RDV à ${esc(a.rdv)} : remplacé)</b>` : ''}`).join(', ')}</label>` : ''}`;
  };
  let tempo = null;
  const plusTard = () => { clearTimeout(tempo); tempo = setTimeout(apercu, 250); };
  fo.querySelector('[name="mag"]').addEventListener('input', plusTard);
  ['date', 'heure', 'objet'].forEach(n => fo.querySelector(`[name="${n}"]`).addEventListener('change', apercu));
  fo.querySelector('[name="heure"]').addEventListener('input', plusTard);
  apercu();
  const r = await p;
  if (!r) return false;
  const m = trouver(r.mag);
  if (!m) { toast(`Magasin introuvable : « ${r.mag} ». Choisis-le dans la liste proposée.`, 'warn'); return false; }
  if (!r.date || !r.heure) { toast('Indique le jour et l\'heure du rendez-vous', 'warn'); return false; }
  if (r.date < today()) { toast('Pas de rendez-vous dans le passé : choisis aujourd\'hui ou un jour à venir', 'warn'); return false; }

  // on refait la simulation avec les valeurs validées, puis on applique
  const res = dernier && dernier.m.id === m.id && dernier.date === r.date && dernier.heure === r.heure ? dernier.res : await simuler({ m, date: r.date, heure: r.heure, objet: r.objet }, mags, s);
  const t = res.t;
  if (r.avancer === 'on' && res.departPropose) t.heureDebut = res.departPropose;
  const retires = [];
  if (r.retirerHors === 'on' && res.hors.length) {
    const ids = new Set(res.hors.map(x => x.magasinId));
    t.etapes = t.etapes.filter(e => !ids.has(e.magasinId) || e.rdv || e.fait);
    retires.push(...res.hors.map(x => mags.get(x.magasinId)?.nom).filter(Boolean));
  }
  t.calcul = null;
  await db.put('tournees', t);
  const deplace = [];
  if (r.retirerAilleurs === 'on') for (const a of res.ailleurs) {
    const t2 = await db.get('tournees', a.date);
    if (!t2) continue;
    t2.etapes = t2.etapes.filter(e => e.magasinId !== m.id || e.fait);
    t2.calcul = null;
    await db.put('tournees', t2);
    deplace.push(a.date);
  }
  const rdv0 = await getRdv(m.id);
  const { rdv } = await changerStatut(rdv0, 'acceptee', { date: r.date, heure: r.heure, ...(r.objet ? { objet: r.objet } : {}), ...(r.contact ? { contactId: r.contact } : {}), priseSurPlace: today() });
  // la nuit éventuelle et le lendemain suivent
  await recalerLendemain(await getTournee(r.date), mags);
  for (const d of deplace) await recalerLendemain(await getTournee(d), mags);

  toast(`RDV planifié : ${m.nom}, ${dateEnLettres(r.date)} à ${r.heure.replace(':', 'h')}${deplace.length ? ` · retiré du ${deplace.map(fmtDate).join(', ')}` : ''}${retires.length ? ` · ${retires.length} magasin${retires.length > 1 ? 's' : ''} retiré${retires.length > 1 ? 's' : ''} de la journée` : ''}${res.alertes.length ? ' · attention, voir la journée' : ''}`,
    res.alertes.length ? 'warn' : '', { label: 'Voir la journée', href: `#/tournee/${r.date}` });
  if (r.agenda === 'on') {
    const c = r.contact ? await db.get('contacts', r.contact) : null;
    const o = OBJETS_VISITE.find(x => (x.id || x) === rdv.objet);
    await proposerAgenda(evenementRdv(m, rdv, s, c, o?.label || o || rdv.objet || ''), { titre: 'RDV enregistré : l\'ajouter à ton agenda ?' });
  }
  return true;
}
