// Affinage automatique des positions : les magasins placés au centre de leur commune (ou pas encore
// localisés) sont cherchés à leur adresse exacte, en arrière-plan, dès que l'appareil a du réseau.
// Une seule passe à la fois (verrou), polie avec le service public (pause entre deux recherches).
import { db, getSettings } from '../db.js';
import { geocodeMagasin, haversine } from './geo.js';
import { toast } from '../ui.js';

const VERROU = 'cap-affinage';
let enCours = false;

export async function affinerPositions({ silencieux = false } = {}) {
  if (enCours || !navigator.onLine) return;
  try { const v = Number(localStorage.getItem(VERROU)); if (v && Date.now() - v < 10 * 60e3) return; localStorage.setItem(VERROU, String(Date.now())); } catch { /* stockage indisponible */ }
  enCours = true;
  const s = await getSettings();
  const aFaire = (await db.all('magasins')).filter(m => !m.positionManuelle && (m.lat == null || m.precision === 'commune') && !m.affinageEchec);
  let ok = 0, ko = 0;
  try {
    for (const m of aFaire) {
      if (!navigator.onLine) break;
      try {
        const g = await geocodeMagasin(m, s.cleTomTom);
        const actuel = await db.get('magasins', m.id);
        if (!actuel || actuel.positionManuelle) continue;
        // garde-fou : un résultat à plus de 25 km du centre de la commune est sûrement une erreur
        const loin = g && actuel.lat != null && haversine(actuel, g) > 25;
        if (g && g.precision === 'adresse' && !loin) { await db.put('magasins', { ...actuel, lat: g.lat, lon: g.lon, precision: 'adresse' }); ok++; }
        else if (g && actuel.lat == null) { await db.put('magasins', { ...actuel, lat: g.lat, lon: g.lon, precision: g.precision }); ok++; }
        else { await db.put('magasins', { ...actuel, affinageEchec: new Date().toISOString().slice(0, 10) }); ko++; }
      } catch { ko++; if (!navigator.onLine) break; }
      await new Promise(r => setTimeout(r, 150));
      try { localStorage.setItem(VERROU, String(Date.now())); } catch { /* */ }
    }
  } finally {
    enCours = false;
    try { localStorage.removeItem(VERROU); } catch { /* */ }
  }
  if (ok && !silencieux) toast(`${ok} magasin${ok > 1 ? 's' : ''} localisé${ok > 1 ? 's' : ''} à l'adresse exacte`);
  return { ok, ko, total: aFaire.length };
}
