// ─────────────────────────────────────────────────────────────────────────────
// Localisation des adresses (géocodage).
// 1) Géoplateforme IGN (service public, gratuit, sans clé)  2) ancienne API Adresse
// 3) TomTom si une clé est renseignée. Ajoute un service = ajoute une fonction à PROVIDERS.
// ─────────────────────────────────────────────────────────────────────────────

const geojsonProvider = base => async (q, opts = {}) => {
  const u = new URL(base);
  u.searchParams.set('q', q.slice(0, 200));
  u.searchParams.set('limit', '1');
  if (opts.type) u.searchParams.set('type', opts.type);
  const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const f = (await r.json()).features?.[0];
  if (!f) return null;
  const [lon, lat] = f.geometry.coordinates;
  return { lat, lon, score: f.properties.score ?? 0, cp: f.properties.postcode, ville: f.properties.city, label: f.properties.label };
};

const PROVIDERS = {
  ign: geojsonProvider('https://data.geopf.fr/geocodage/search'),
  ban: geojsonProvider('https://api-adresse.data.gouv.fr/search/'),
  async tomtom(q, opts = {}) {
    if (!opts.cle) return null;
    const u = new URL(`https://api.tomtom.com/search/2/geocode/${encodeURIComponent(q.slice(0, 200))}.json`);
    u.searchParams.set('key', opts.cle);
    u.searchParams.set('countrySet', 'FR');
    u.searchParams.set('limit', '1');
    const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const x = (await r.json()).results?.[0];
    if (!x) return null;
    return { lat: x.position.lat, lon: x.position.lon, score: Math.min(1, (x.score || 0) / 10), cp: x.address?.postalCode, ville: x.address?.municipality, label: x.address?.freeformAddress };
  },
};

async function chain(q, opts) {
  let lastErr;
  for (const name of ['ign', 'ban', 'tomtom']) {
    try {
      const r = await PROVIDERS[name](q, opts);
      if (r) return { ...r, source: name };
    } catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return null;
}

// Localise un magasin. Renvoie { lat, lon, precision: 'adresse' | 'ville', ... } ou null.
export async function geocodeMagasin(m, cle) {
  const adr = (m.adresse || '').trim();
  const q = adr && !adr.includes(m.cp) ? `${adr} ${m.cp} ${m.ville}` : (adr || `${m.cp} ${m.ville}`);
  const res = await chain(q, { cle });
  const sameDep = r => r && (!r.cp || r.cp.slice(0, 2) === String(m.cp).slice(0, 2));
  if (res && res.score >= 0.45 && sameDep(res)) return { ...res, precision: 'adresse' };
  const ville = await chain(`${m.cp} ${m.ville}`, { cle, type: 'municipality' });
  if (ville) return { ...ville, precision: 'ville' };
  return res && sameDep(res) ? { ...res, precision: 'approx' } : null;
}

export const geocodeAdresse = (q, cle) => chain(q, { cle });

// Distance à vol d'oiseau en km.
export function haversine(a, b) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
