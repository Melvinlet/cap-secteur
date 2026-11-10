// Jours fériés en France (métropole) : dates fixes + fêtes mobiles calculées depuis Pâques.
// ferie('2026-11-11') → 'Armistice 1918' ; null si jour ordinaire.
const cache = new Map();
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Dimanche de Pâques (algorithme de Meeus / Jones / Butcher, calendrier grégorien)
function paques(an) {
  const a = an % 19, b = Math.floor(an / 100), c = an % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31), jour = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(an, mois - 1, jour, 12);
}

export function feriesDe(an) {
  if (cache.has(an)) return cache.get(an);
  const p = paques(an);
  const apres = n => iso(new Date(p.getFullYear(), p.getMonth(), p.getDate() + n, 12));
  const r = new Map([
    [`${an}-01-01`, 'Jour de l\'an'],
    [apres(1), 'Lundi de Pâques'],
    [`${an}-05-01`, 'Fête du Travail'],
    [`${an}-05-08`, 'Victoire 1945'],
    [apres(39), 'Ascension'],
    [apres(50), 'Lundi de Pentecôte'],
    [`${an}-07-14`, 'Fête nationale'],
    [`${an}-08-15`, 'Assomption'],
    [`${an}-11-01`, 'Toussaint'],
    [`${an}-11-11`, 'Armistice 1918'],
    [`${an}-12-25`, 'Noël'],
  ]);
  cache.set(an, r);
  return r;
}

export const ferie = date => (date ? feriesDe(Number(String(date).slice(0, 4))).get(String(date).slice(0, 10)) : null) || null;

// Étiquette prête à afficher (vide si jour ordinaire)
export const tagFerie = (date, esc = x => x) => { const f = ferie(date); return f ? `<span class="tag ferie" title="Jour férié">Férié · ${esc(f)}</span>` : ''; };
