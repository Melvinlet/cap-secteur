// Ajout d'un rendez-vous à l'agenda : lien « Google Agenda » (aucun compte à relier dans l'appli)
// et fichier .ics pour les autres agendas (Outlook, Apple…).
import { esc, modal } from '../ui.js';
import { dureeVisite } from '../data.js';

const pad = n => String(n).padStart(2, '0');
const compact = (date, h) => date.replace(/-/g, '') + (h ? 'T' + h.replace(':', '') + '00' : '');
const plusMinutes = (date, h, min) => { const d = new Date(`${date}T${h}:00`); d.setMinutes(d.getMinutes() + min); return [`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, `${pad(d.getHours())}:${pad(d.getMinutes())}`]; };
const lendemain = date => { const d = new Date(date + 'T12:00'); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };

// { titre, date 'AAAA-MM-JJ', heure 'HH:MM' | '', duree (min), lieu, details }
export function lienGoogleAgenda(ev) {
  const fin = ev.heure ? plusMinutes(ev.date, ev.heure, ev.duree || 60) : [lendemain(ev.date), ''];
  const u = new URL('https://calendar.google.com/calendar/render');
  u.searchParams.set('action', 'TEMPLATE');
  u.searchParams.set('text', ev.titre);
  u.searchParams.set('dates', `${compact(ev.date, ev.heure)}/${compact(...fin)}`);
  if (ev.heure) u.searchParams.set('ctz', Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris');
  if (ev.lieu) u.searchParams.set('location', ev.lieu);
  if (ev.details) u.searchParams.set('details', ev.details);
  return u.toString();
}

export function fichierIcs(ev) {
  const echap = s => String(s || '').replace(/\\/g, '\\\\').replace(/[,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const fin = ev.heure ? plusMinutes(ev.date, ev.heure, ev.duree || 60) : [lendemain(ev.date), ''];
  const quand = (d, h) => h ? `:${compact(d, h)}` : `;VALUE=DATE:${compact(d)}`;
  const txt = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cap Secteur//FR', 'BEGIN:VEVENT',
    `UID:${ev.uid || Date.now()}@cap-secteur`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART${quand(ev.date, ev.heure)}`, `DTEND${quand(...fin)}`, `SUMMARY:${echap(ev.titre)}`,
    ev.lieu ? `LOCATION:${echap(ev.lieu)}` : '', ev.details ? `DESCRIPTION:${echap(ev.details)}` : '',
    'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', `DESCRIPTION:${echap(ev.titre)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
  return new Blob([txt], { type: 'text/calendar;charset=utf-8' });
}

// Événement d'un rendez-vous magasin
export function evenementRdv(m, r, s, contact, objetTxt) {
  const autre = r.statut === 'autreDate';
  return {
    uid: `${r.id}-${autre ? r.dateRetenue : r.date}`,
    titre: `RDV ${m.nom}`,
    date: autre ? r.dateRetenue : r.date, heure: (autre ? r.heureRetenue : r.heure) || '',
    duree: dureeVisite(m, s),
    lieu: [m.adresse, `${m.cp || ''} ${m.ville || ''}`.trim()].filter(Boolean).join(', '),
    details: [objetTxt && `Objet : ${objetTxt}`, contact && `Contact : ${[contact.nom, contact.tel, contact.email].filter(Boolean).join(' · ')}`, m.telMagasin && `Magasin : ${m.telMagasin}`].filter(Boolean).join('\n'),
  };
}

// Fenêtre « Ajouter à mon agenda »
export function proposerAgenda(ev, { titre = 'Ajouter à ton agenda' } = {}) {
  if (!ev.date) return;
  const p = modal({ titre, valider: 'Fermer', corps: `
    <p><strong>${esc(ev.titre)}</strong><br><span class="muted">${esc(new Date(ev.date + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))}${ev.heure ? ` à ${esc(ev.heure.replace(':', 'h'))}` : ''}</span></p>
    <div class="actions agenda-btns">
      <a class="btn primary" href="${esc(lienGoogleAgenda(ev))}" target="_blank" rel="noopener">Google Agenda</a>
      <button type="button" class="btn" id="agIcs">Autre agenda (fichier .ics)</button></div>
    <p class="hint">Google Agenda s'ouvre avec le rendez-vous prérempli (lieu, contact, objet) : il ne reste qu'à appuyer sur Enregistrer.</p>` });
  const b = document.getElementById('agIcs');
  b.onclick = () => {   // lien créé dans la fenêtre (une fenêtre ouverte rend le reste de la page inactif)
    const a = document.createElement('a');
    a.href = URL.createObjectURL(fichierIcs(ev));
    a.download = `${ev.titre} ${ev.date}.ics`.replace(/[\\/:*?"<>|]/g, '-');
    b.after(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  return p;
}
