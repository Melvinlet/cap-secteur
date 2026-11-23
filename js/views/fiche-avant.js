// Fiche « avant d'entrer » : tout ce qu'il faut savoir sur un magasin en 10 secondes, devant la porte.
// Contact (avec la bonne civilité), RDV, à faire en cours, dernier compte rendu, ventes, saison précédente, SAV.
// Aucun prix : uniquement des unités.
import { db, getSettings } from '../db.js';
import { magasinComplet, prioriteDe } from '../data.js';
import { esc, modal, fmtDate, joursDepuis, prioTag, toast, today } from '../ui.js';
import { PROFIL } from '../config.js';
import { getRdv, labelStatut, dateEnLettres, dateEffRdv, heureEffRdv } from '../services/rdv.js';
import { bonjourDe } from '../services/civilite.js';
import { estOuvert, listeAFaire, brancherCoches } from '../services/afaire.js';
import { lienGps } from '../services/routing.js';
import { marquerVisite, lienDetails } from '../services/visite.js';

const bloc = (titre, corps, cls = '') => corps ? `<section class="fa-bloc ${cls}"><h3>${titre}</h3>${corps}</section>` : '';

export async function ouvrirFicheAvant(magasinId, date) {
  const [d, s, rdv] = await Promise.all([magasinComplet(magasinId), getSettings(), getRdv(magasinId)]);
  if (!d) return;
  const { m, contacts, notes, sav } = d;

  // contact : celui du RDV, sinon le premier qui a un nom
  const ct = contacts.find(c => c.id === rdv.contactId) || contacts.find(c => c.nom) || null;
  const contact = ct ? `<p class="fa-bonjour">« ${esc(bonjourDe(ct))}${ct.nom ? ` <span class="muted">(${esc(ct.nom)})</span>` : ''} »</p>
    <p class="small">${[ct.fonction && esc(ct.fonction), ct.tel && `<a href="tel:${esc(ct.tel.replace(/\s/g, ''))}">${esc(ct.tel)}</a>`, ct.email && `<a href="mailto:${esc(ct.email)}">${esc(ct.email)}</a>`].filter(Boolean).join(' · ')}</p>
    ${contacts.filter(c => c !== ct && c.nom).length ? `<p class="small muted">Aussi : ${contacts.filter(c => c !== ct && c.nom).slice(0, 3).map(c => esc(c.nom + (c.fonction ? ` (${c.fonction})` : ''))).join(', ')}</p>` : ''}` : '<p class="muted small">Aucun contact enregistré : pense à demander le nom du chef de rayon.</p>';

  // RDV
  const rDate = dateEffRdv(rdv), rHeure = heureEffRdv(rdv);
  const rdvTxt = rdv.statut === 'aFaire' ? '' : `<p><span class="tag ${['acceptee', 'autreDate'].includes(rdv.statut) ? 'ok' : ''}">${esc(labelStatut(rdv.statut))}</span>${rDate ? ` ${esc(dateEnLettres(rDate))}` : ''}${rHeure ? ` à ${esc(rHeure)}` : ''}${rdv.objet ? ` <span class="muted">· ${esc(rdv.objet)}</span>` : ''}</p>`;

  // à faire encore ouverts
  const af = notes.filter(estOuvert).sort((a, b) => a.date.localeCompare(b.date));

  // dernier compte rendu (visite faite)
  const der = notes.find(n => n.type === 'Visite' && n.statut === 'Réalisée' && (n.date || '') <= (date || '9999') && (n.texte || n.actions?.length || n.contact || n.aFaire));
  const derniere = notes.find(n => n.type === 'Visite' && n.statut === 'Réalisée');
  const j = derniere ? joursDepuis(derniere.date) : null;
  const visite = der ? `<p class="small">${fmtDate(der.date)}${der.objet ? ` · ${esc(der.objet)}` : ''}${der.contact ? ` · vu avec ${esc(der.contact)}` : ''}</p>
      ${der.actions?.length ? `<p class="acts">${der.actions.map(a => `<span class="tag">${esc(a)}</span>`).join(' ')}</p>` : ''}
      ${der.texte ? `<p class="fa-texte">${esc(der.texte.length > 320 ? der.texte.slice(0, 320) + '…' : der.texte)}</p>` : ''}
      <a class="small" href="${lienDetails(der)}">Ouvrir ce compte rendu</a>`
    : derniere ? `<p class="small">Visité le ${fmtDate(derniere.date)}, sans compte rendu détaillé.</p>` : '<p class="muted small">Jamais visité.</p>';

  // chiffres : ventes (unités, rang) + saison précédente (unités par produit) + implantation
  let chiffres = '';
  if (m.ventes2026 > 0) {
    const v = (await db.all('magasins')).map(x => Number(x.ventes2026) || 0).filter(n => n > 0);
    const rang = 1 + v.filter(n => n > m.ventes2026).length;
    chiffres += `<p><strong>${m.ventes2026}</strong> robot${m.ventes2026 > 1 ? 's' : ''} vendu${m.ventes2026 > 1 ? 's' : ''} en 2026 <span class="muted">· ${rang}${rang === 1 ? 'er' : 'e'} sur ${v.length}</span></p>`;
  } else if (m.ventes2026 === 0) chiffres += '<p class="muted">Aucune vente enregistrée en 2026.</p>';
  const sp = m.saisonPrecedente;
  if (sp?.commandes?.length) {
    const tot = new Map(); sp.commandes.forEach(c => tot.set(c.produit, (tot.get(c.produit) || 0) + c.qte));
    const total = [...tot.values()].reduce((a, b) => a + b, 0);
    chiffres += `<p>${esc(PROFIL.saisonPrecedente || 'Saison précédente')} : <strong>${total}</strong> unités <span class="muted">· ${[...tot].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p, q]) => `${esc(p)} × ${q}`).join(', ')}</span></p>`;
  }
  if (m.meuble) chiffres += `<p class="small">Meuble / PLV : ${esc(m.meuble)}</p>`;
  const savOuverts = sav.filter(x => x.statut !== 'Résolu');
  if (savOuverts.length) chiffres += `<p class="small"><span class="tag late">${savOuverts.length} SAV en cours</span> ${savOuverts.slice(0, 2).map(x => esc(x.produit || 'SAV')).join(', ')}</p>`;

  const futurJ = (date || today()) > today();   // jour à venir : on prépare, on ne marque pas « visité »
  const corps = `<div class="fiche-avant">
    <p class="fa-tete">${prioTag(prioriteDe(m))} <strong>${esc(m.nom)}</strong><br><span class="muted small">${esc(m.adresse && m.cp && m.adresse.includes(m.cp) ? m.adresse : [m.adresse, `${m.cp || ''} ${m.ville || ''}`.trim()].filter(Boolean).join(', '))}${j != null ? ` · dernière visite il y a ${j} jour${j > 1 ? 's' : ''}` : ''}</span></p>
    <p class="fa-liens">${m.lat != null ? `<a class="btn small" href="${lienGps(s.gps, m)}" target="_blank" rel="noopener">GPS</a>` : ''}${m.telMagasin ? `<a class="btn small" href="tel:${esc(m.telMagasin.replace(/\s/g, ''))}">Appeler le magasin</a>` : ''}<a class="btn small ghost" href="#/magasin/${encodeURIComponent(m.id)}">Fiche complète</a>${!m.positionManuelle && !futurJ ? '<button type="button" class="btn small ghost" id="faIci" title="La position du téléphone devient celle du magasin : le GPS t\'y emmènera directement">📍 Je suis devant</button>' : ''}</p>
    ${bloc('À faire', af.length ? listeAFaire(af) : '', 'fa-afaire')}
    ${bloc('Ton contact', contact)}
    ${bloc('Rendez-vous', rdvTxt)}
    ${bloc('Dernier compte rendu', visite)}
    ${bloc('Chiffres', chiffres)}
  </div>`;
  const futur = futurJ;
  const p = modal({ titre: 'Avant d\'entrer', valider: futur ? 'Fermer' : 'Visité', large: true, corps });
  const dlg = document.querySelector('dialog[open]');
  brancherCoches(dlg);
  dlg.querySelector('#faIci')?.addEventListener('click', async e => { const { jeSuisDevant } = await import('../services/emplacements.js'); if (await jeSuisDevant(magasinId)) e.target.remove(); });
  const r = await p;
  if (r === null || futur) return false;
  const v = await marquerVisite(magasinId, date);
  toast(`${m.nom} : visité`, '', { label: 'Ajouter des détails', href: lienDetails(v) });
  return true;
}
