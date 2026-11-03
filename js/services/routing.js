// ─────────────────────────────────────────────────────────────────────────────
// Calcul des tournées : ordre de passage + distances/temps de trajet.
// Le service d'itinéraire est interchangeable : ajoute un fournisseur dans PROVIDERS
// (même signature que tomtom) et sélectionne-le dans les Réglages.
// Si aucun service ne répond, on retombe sur l'estimation à vol d'oiseau.
// ─────────────────────────────────────────────────────────────────────────────
import { haversine } from './geo.js';

// Estimation hors ligne : vol d'oiseau × coefficient, à vitesse moyenne.
export function estimate(points, s) {
  const legs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const km = haversine(points[i], points[i + 1]) * s.coefRoute;
    legs.push({ km, min: km / s.vitesseMoyenne * 60, points: [[points[i].lat, points[i].lon], [points[i + 1].lat, points[i + 1].lon]] });
  }
  return { provider: 'estimation', legs };
}

const PROVIDERS = {
  // TomTom Routing API — https://developer.tomtom.com/routing-api/documentation
  async tomtom(points, s, { optimiser }) {
    if (!s.cleTomTom) throw new Error('Clé TomTom manquante');
    const loc = points.map(p => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join(':');
    const u = new URL(`https://api.tomtom.com/routing/1/calculateRoute/${loc}/json`);
    u.searchParams.set('key', s.cleTomTom);
    u.searchParams.set('travelMode', 'car');
    u.searchParams.set('routeType', 'fastest');
    u.searchParams.set('traffic', 'false');
    u.searchParams.set('routeRepresentation', 'polyline');
    if (optimiser && points.length > 3) u.searchParams.set('computeBestOrder', 'true');
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`TomTom : erreur ${r.status}`);
    const j = await r.json();
    const route = j.routes?.[0];
    if (!route) throw new Error('TomTom : aucun itinéraire');
    const legs = route.legs.map(l => ({
      km: l.summary.lengthInMeters / 1000,
      min: l.summary.travelTimeInSeconds / 60,
      points: l.points.map(p => [p.latitude, p.longitude]),
    }));
    // optimizedWaypoints : ordre optimal des étapes intermédiaires (hors départ / arrivée)
    let ordre = null;
    if (j.optimizedWaypoints?.length) {
      ordre = new Array(j.optimizedWaypoints.length);
      j.optimizedWaypoints.forEach(w => { ordre[w.optimizedIndex] = w.providedIndex; });
    }
    return { provider: 'tomtom', legs, ordre };
  },
};

// Ordre de visite optimisé localement (plus proche voisin + amélioration 2-opt).
// stops : [{lat, lon}], depart : {lat, lon}, retour : revenir au départ ?
// arrivee : point d'arrivée si différent du départ (ex. départ d'un hôtel, retour au domicile)
export function optimiserOrdre(depart, stops, retour = true, arrivee = depart) {
  const n = stops.length;
  if (n < 2) return stops.map((_, i) => i);
  const P = [depart, ...stops];
  const d = (i, j) => haversine(P[i], P[j]);
  const cost = route => {
    let c = d(0, route[0] + 1);
    for (let k = 0; k < route.length - 1; k++) c += d(route[k] + 1, route[k + 1] + 1);
    if (retour) c += haversine(P[route[route.length - 1] + 1], arrivee);
    return c;
  };
  // plus proche voisin
  const left = new Set(stops.map((_, i) => i));
  let cur = 0; const route = [];
  while (left.size) {
    let best = null, bd = Infinity;
    for (const j of left) { const x = d(cur, j + 1); if (x < bd) { bd = x; best = j; } }
    route.push(best); left.delete(best); cur = best + 1;
  }
  // 2-opt
  let improved = true, best = cost(route);
  while (improved) {
    improved = false;
    for (let i = 0; i < n - 1; i++) for (let k = i + 1; k < n; k++) {
      const r2 = [...route.slice(0, i), ...route.slice(i, k + 1).reverse(), ...route.slice(k + 1)];
      const c = cost(r2);
      if (c < best - 1e-9) { route.splice(0, n, ...r2); best = c; improved = true; }
    }
  }
  return route;
}

// Calcule les trajets d'une tournée. points = [départ, étape1, …, (retour)]
// Renvoie { provider, legs:[{km,min,points}], ordre?, erreur? }
export async function calculerTrajets(points, s, opts = {}) {
  if (points.length < 2) return { provider: 'aucun', legs: [] };
  const p = PROVIDERS[s.itineraire];
  if (s.itineraire === 'tomtom' && !s.cleTomTom) return { ...estimate(points, s), sansCle: true };
  if (p && navigator.onLine !== false) {
    try { return await p(points, s, opts); }
    catch (e) { return { ...estimate(points, s), erreur: e.message }; }
  }
  return estimate(points, s);
}

// Liens de navigation GPS
export function lienGps(app, dest, etapes = []) {
  if (app === 'google') {
    const u = new URL('https://www.google.com/maps/dir/');
    u.searchParams.set('api', '1');
    u.searchParams.set('destination', `${dest.lat},${dest.lon}`);
    u.searchParams.set('travelmode', 'driving');
    if (etapes.length) u.searchParams.set('waypoints', etapes.slice(0, 9).map(e => `${e.lat},${e.lon}`).join('|'));
    return u.toString();
  }
  return `https://waze.com/ul?ll=${dest.lat},${dest.lon}&navigate=yes`;
}
