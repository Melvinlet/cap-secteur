// Emplacement exact des magasins : on cherche LE MAGASIN (son bâtiment), pas son adresse.
// Beaucoup d'adresses de zones commerciales n'ont pas de numéro (« Route de Dinard », « ZA de Kerlann ») :
// la base des adresses place alors le point au milieu de la route ou de la zone, souvent à plusieurs centaines de mètres.
// 1) OpenStreetMap (une seule requête pour tout le secteur) : magasins de bricolage / jardinage / matériaux, avec enseigne.
// 2) Pour ceux qui manquent : recherche de lieu TomTom (avec la clé de l'utilisateur, qui ne quitte pas l'appareil).
// Un magasin placé à la main n'est jamais déplacé.
import { db, getSettings } from '../db.js';
import { haversine } from './geo.js';

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const TYPES = 'doityourself|hardware|garden_centre|trade|building_materials|agrarian|houseware|paint|tool_hire';
const sansAccent = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const colle = s => sansAccent(s).replace(/[^a-z0-9]/g, '');

// clés de reconnaissance d'une enseigne dans le nom / la marque OpenStreetMap ou TomTom
function clesEnseigne(e) {
  const k = colle(e);
  if (!k || k === 'sansenseigne') return [];
  if (k.startsWith('mrbricolage') || k === 'monsieurbricolage') return ['mrbricolage', 'monsieurbricolage'];
  if (k.startsWith('briconaute')) return ['briconaute'];
  return [k];
}
const correspond = (cles, texte) => { const t = colle(texte); return cles.some(c => t.includes(c)); };

async function overpass(bbox) {
  const [s, w, n, e] = bbox.map(x => x.toFixed(3));
  const q = `[out:json][timeout:120];nwr["shop"~"^(${TYPES})$"](${s},${w},${n},${e});out center tags;`;
  let err;
  for (const u of OVERPASS) {
    try {
      const r = await fetch(u, { method: 'POST', body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(150000) });
      if (!r.ok) throw new Error(`OpenStreetMap a répondu ${r.status}`);
      return (await r.json()).elements.map(x => ({ lat: x.lat ?? x.center?.lat, lon: x.lon ?? x.center?.lon,
        texte: [x.tags?.name, x.tags?.brand, x.tags?.operator, x.tags?.['name:fr']].filter(Boolean).join(' '),
        ville: x.tags?.['addr:city'] || '', id: `${x.type}/${x.id}` })).filter(x => x.lat != null);
    } catch (e) { err = e; }
  }
  throw err || new Error('OpenStreetMap injoignable');
}

async function tomtomPoi(m, cles, cle) {
  const u = new URL(`https://api.tomtom.com/search/2/poiSearch/${encodeURIComponent(`${m.enseigne} ${m.ville}`.slice(0, 150))}.json`);
  Object.entries({ key: cle, countrySet: 'FR', language: 'fr-FR', limit: '8', lat: m.lat, lon: m.lon, radius: '15000' }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const res = (await r.json()).results || [];
  return res.map(x => ({ lat: x.position.lat, lon: x.position.lon, texte: [x.poi?.name, ...(x.poi?.brands || []).map(b => b.name)].join(' ') }))
    .filter(x => correspond(cles, x.texte)).sort((a, b) => haversine(m, a) - haversine(m, b))[0] || null;
}

// rayon de recherche autour de la position actuelle : large si on ne connaît que la commune
const rayonMax = m => (['commune', 'ville', 'approx'].includes(m.precision) || !m.precision ? 12 : 4);

export async function recalerMagasins({ forcer = false, progression = () => {} } = {}) {
  const s = await getSettings();
  const tous = await db.all('magasins');
  const aFaire = tous.filter(m => m.lat != null && !m.positionManuelle && (forcer || m.precision !== 'magasin'));
  if (!aFaire.length) return { total: 0, recales: [], nonTrouves: [] };

  // 1) OpenStreetMap : tous les magasins du secteur d'un coup
  progression('Recherche des magasins sur la carte…');
  const lat = aFaire.map(m => m.lat), lon = aFaire.map(m => m.lon), marge = 0.12;
  const pois = await overpass([Math.min(...lat) - marge, Math.min(...lon) - marge, Math.max(...lat) + marge, Math.max(...lon) + marge]);

  // couples (magasin, point OSM) possibles, puis attribution du plus proche au plus loin (un point = un magasin)
  const couples = [];
  for (const m of aFaire) {
    const cles = clesEnseigne(m.enseigne);
    if (!cles.length) continue;
    for (const p of pois) {
      if (!correspond(cles, p.texte)) continue;
      let d = haversine(m, p);
      if (d > rayonMax(m)) continue;
      // même ville (adresse OSM ou nom du magasin) : bonus ; au-delà de 3 km, la ville doit correspondre
      // (sinon on risquerait de prendre le magasin de la même enseigne dans la ville voisine)
      const v = sansAccent(m.ville).replace(/^(saint|sainte|st|ste)[ -]/, '').split(/[ -]/).filter(x => x.length > 2)[0] || sansAccent(m.ville);
      const memeVille = sansAccent(`${p.ville} ${p.texte}`).includes(v);
      if (d > 3 && !memeVille) continue;
      if (memeVille) d *= 0.5;
      couples.push({ m, p, d });
    }
  }
  couples.sort((a, b) => a.d - b.d);
  const pris = new Set(), places = new Map();
  for (const c of couples) {
    if (places.has(c.m.id) || pris.has(c.p.id)) continue;
    places.set(c.m.id, { lat: c.p.lat, lon: c.p.lon, source: 'osm' }); pris.add(c.p.id);
  }

  // 2) TomTom pour ceux qui manquent (si une clé est renseignée)
  const restants = aFaire.filter(m => !places.has(m.id) && clesEnseigne(m.enseigne).length);
  if (s.cleTomTom && restants.length) {
    let i = 0;
    for (const m of restants) {
      progression(`Recherche TomTom ${++i} / ${restants.length}…`);
      try { const p = await tomtomPoi(m, clesEnseigne(m.enseigne), s.cleTomTom); if (p && haversine(m, p) <= rayonMax(m)) places.set(m.id, { ...p, source: 'tomtom' }); } catch { /* réseau : on passe */ }
      await new Promise(r => setTimeout(r, 220));
    }
  }

  // 3) enregistrement (sans écraser une position placée à la main entre-temps)
  const recales = [];
  for (const [id, p] of places) {
    const actuel = await db.get('magasins', id);
    if (!actuel || actuel.positionManuelle) continue;
    const ecart = Math.round(haversine(actuel, p) * 1000);
    await db.put('magasins', { ...actuel, lat: p.lat, lon: p.lon, precision: 'magasin', positionSource: p.source, affinageEchec: undefined });
    recales.push({ id, nom: actuel.nom, ecart });
  }
  const nonTrouves = aFaire.filter(m => !places.has(m.id)).map(m => ({ id: m.id, nom: m.nom, ville: m.ville, precision: m.precision }));
  return { total: aFaire.length, recales, nonTrouves };
}

// Au démarrage : une seule fois par appareil (puis à la demande dans Réglages)
export async function recalerUneFois() {
  const CLE = 'cap-emplacements-v1';
  try { if (localStorage.getItem(CLE)) return null; } catch { return null; }
  if (!navigator.onLine) return null;
  const r = await recalerMagasins();
  try { localStorage.setItem(CLE, new Date().toISOString()); } catch { /* */ }
  return r;
}
