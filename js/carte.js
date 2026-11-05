// Carte (Leaflet). Fond OpenStreetMap par défaut, ou TomTom si choisi dans les réglages.
import { getSettings } from './db.js';
import { enseigneColor, esc } from './ui.js';

let leafletLoading;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  leafletLoading ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/leaflet/leaflet.js', import.meta.url).href;
    s.onload = res; s.onerror = () => rej(new Error('Carte indisponible'));
    document.head.append(s);
  });
  return leafletLoading;
}

export async function carte(el) {
  await loadLeaflet();
  const s = await getSettings();
  const map = L.map(el, { zoomControl: true }).setView([47.6, -2.3], 7);
  map.invalidateSize();
  if (s.fondCarte === 'tomtom' && s.cleTomTom) {
    L.tileLayer(`https://api.tomtom.com/map/1/tile/basic/main/{z}/{x}/{y}.png?key=${encodeURIComponent(s.cleTomTom)}`,
      { maxZoom: 19, attribution: '© TomTom, © OpenStreetMap' }).addTo(map);
  } else {
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  }
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  setTimeout(() => { if (map._container?.isConnected) map.invalidateSize(); }, 50);
  return map;
}

// Repère coloré selon l'enseigne ; numéro optionnel (ordre de tournée).
export function repere(m, numero, couleur) {
  const c = couleur || enseigneColor(m.enseigne);
  const html = numero != null
    ? `<span class="pin num" style="--c:${c}">${numero}</span>`
    : `<span class="pin" style="--c:${c}"></span>`;
  return L.marker([m.lat, m.lon], {
    title: m.nom,
    icon: L.divIcon({ className: 'pin-wrap', html, iconSize: numero != null ? [28, 28] : [16, 16], iconAnchor: numero != null ? [14, 14] : [8, 8] }),
  });
}

export function repereDepart(p, hotel = false) {
  return L.marker([p.lat, p.lon], { title: 'Départ', icon: L.divIcon({ className: 'pin-wrap', html: `<span class="pin home">${hotel ? '☾' : '⌂'}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }) })
    .bindPopup(esc(p.adresse || 'Départ'));
}

// Le trajet se dessine (lignes pleines), puis les repères apparaissent ; les lignes pointillées (estimation) apparaissent en fondu
export function animerTrace(couches) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let n = 0;
  for (const c of couches) {
    const el = c.getElement?.();
    if (!el) continue;
    if (c instanceof L.Polyline) {
      const pointille = !!c.options.dashArray;
      if (!pointille) { el.setAttribute('pathLength', '1'); el.style.strokeDasharray = '1'; }
      el.classList.add(pointille ? 'trace-fondu' : 'trace-anim');
      el.style.animationDelay = `${n++ * 0.18}s`;
      el.addEventListener('animationend', () => { if (!pointille) { el.style.strokeDasharray = ''; el.removeAttribute('pathLength'); } }, { once: true });
    } else if (el.classList.contains('leaflet-marker-icon')) {
      const pin = el.querySelector('.pin');
      if (pin) { pin.classList.add('pin-tombe'); pin.style.animationDelay = `${0.15 + Math.min(n, 14) * 0.08}s`; }
    }
  }
}
