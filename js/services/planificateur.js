// ─────────────────────────────────────────────────────────────────────────────
// Plan de secteur : programme les visites sur plusieurs semaines en respectant
// la priorité (fréquence de visite) de chaque magasin et tes horaires.
//
// Principe (heuristique, calcul hors ligne) :
//  • chaque magasin a une date « due » = dernière visite + fréquence de sa priorité
//    (jamais visité = dû dès le début) ; les « Hors tournées » sont ignorés ;
//  • semaine après semaine, on ne retient que les magasins dus (ou presque) ;
//  • une journée qui part du domicile commence par le magasin dû le plus éloigné,
//    une journée qui part de l'hôtel par le plus proche ; on enchaîne ensuite le
//    plus proche tant que la journée tient dans les horaires (trajets + visites + retour) ;
//  • on profite d'un passage dans une zone pour voir un magasin proche bientôt dû ;
//  • si le dernier magasin est loin du domicile (> seuil) on dort sur place,
//    sauf le dernier jour de la semaine où l'on rentre forcément ;
//  • les temps de trajet estimés sont corrigés avec l'écart mesuré sur tes
//    tournées calculées par TomTom (calibrage automatique).
// ─────────────────────────────────────────────────────────────────────────────
import { haversine } from './geo.js';
import { optimiserOrdre } from './routing.js';
import { dureeVisite, frequenceDe, prioriteDe } from '../data.js';
import { parseHeure } from '../ui.js';

const JOUR = 86400000;

// magasins : magasins localisés, avec derniereVisite (AAAA-MM-JJ ou null)
// opts : { debut: 'AAAA-MM-JJ' (un lundi), semaines: n,
//          fixes: Map(jour du plan → [ids]) magasins imposés ce jour-là (RDV, ajouts à la main),
//          exclus: Set(ids) à ne pas ajouter automatiquement,
//          cible: { enseignes: [..], autres: 'detour' | 'normal' | 'aucun', detourPetit: min,
//                   completer: bool, priorites: [1,2,3], departements: [..] } }
//  Ciblage : les journées sont construites autour des enseignes ciblées (les grandes surfaces
//  prioritaires) ; les autres magasins ne sont ajoutés que s'ils coûtent peu de détour
//  sur le trajet déjà prévu (insertion la moins chère), dans la limite des horaires.
export function planifier(magasins, s, { debut, semaines = 8, fixes = new Map(), exclus = new Set(), cible = null, heures = new Map() }) {
  // heures : Map(id magasin → 'HH:MM') heure de rendez-vous des magasins imposés
  const H = s.depart;
  const t0 = new Date(debut + 'T12:00').getTime();
  const budgetBase = parseHeure(s.heureFin) - parseHeure(s.heureDebut) - (Number(s.pauseMidi) || 0);
  // options du remplissage : magasins max par jour, jours sans tournée, fin plus tôt le dernier jour
  const maxJour = Number(cible?.maxParJour) || Infinity;
  const joursOff = new Set((cible?.joursOff || []).map(Number));
  const finDernier = cible?.finDernierJour ? parseHeure(cible.finDernierJour) - parseHeure(s.heureDebut) - (Number(s.pauseMidi) || 0) : null;
  const cal = s.calibration || {};
  const kmF = s.coefRoute * (cal.km || 1), tF = s.coefRoute * (cal.temps || 1);
  const km = (a, b) => haversine(a, b) * kmF;
  const dt = (a, b) => haversine(a, b) * tF / s.vitesseMoyenne * 60;
  const visite = m => dureeVisite(m, s);
  const seuil = Number(s.seuilDecoucher) || 75;
  const nbJours = Math.max(1, Math.min(6, Number(s.joursTerrain) || 5));

  // échéances (en jours depuis le début du plan)
  const actifs = magasins.filter(m => frequenceDe(m, s) != null);
  const freq = new Map(actifs.map(m => [m, frequenceDe(m, s)]));
  const due = new Map(actifs.map(m => {
    if (!m.derniereVisite) return [m, -prioriteDe(m) * 0.01];           // jamais vu : dû tout de suite (P1 d'abord)
    return [m, Math.round((new Date(m.derniereVisite + 'T12:00').getTime() - t0) / JOUR) + freq.get(m)];
  }));
  const visites = new Map(actifs.map(m => [m, 0]));
  const byId = new Map(magasins.map(m => [m.id, m]));
  const detour = Number(s.detourRetard ?? 40);
  // retard en « cycles » : 0,5 = la moitié de sa fréquence dépassée → on accepte un détour pour lui
  const retard = (m, o) => freq.has(m) ? (m.derniereVisite ? (o - due.get(m)) / freq.get(m) : 0.4) : 0;
  const enCible = new Set(cible?.enseignes || []);
  const modeAutres = enCible.size ? (cible.autres || 'detour') : 'normal';
  const detourPetit = Number(cible?.detourPetit ?? 20);
  const prios = cible?.priorites?.length ? new Set(cible.priorites.map(Number)) : null;
  const deps = cible?.departements?.length ? new Set(cible.departements.map(String)) : null;
  const estCible = m => !enCible.size || enCible.has(m.enseigne);
  const candidats = actifs.filter(m => !exclus.has(m.id) && (!prios || prios.has(prioriteDe(m))) && (!deps || deps.has(String(m.departement)))
    && (modeAutres !== 'aucun' || estCible(m)));
  // journées construites d'abord avec les enseignes ciblées ; les autres seulement en détour
  const principaux = modeAutres === 'normal' ? candidats : candidats.filter(estCible);
  const petits = modeAutres === 'detour' ? candidats.filter(m => !estCible(m)) : [];

  const jours = [];
  const rentrer = j => {
    const der = byId.get(j.etapes[j.etapes.length - 1]);
    j.retour = true; j.nuit = null;
    if (der) { j.km += km(der, H); j.conduite += dt(der, H); }
  };
  for (let w = 0; w < semaines; w++) {
    let pos = H;
    for (let d = 0; d < nbJours; d++) {
      const o = w * 7 + d;                                               // jour du plan
      const off = j => joursOff.has(j) && !(fixes.get(w * 7 + j) || []).length;   // jour sans tournée (sauf RDV imposé)
      if (off(d)) { jours.push(jourVide(w, d, o, null)); pos = H; continue; }
      let dernierTravaille = true;
      for (let j = d + 1; j < nbJours; j++) if (!off(j)) dernierTravaille = false;
      const dernierJour = dernierTravaille || off(d + 1);                 // le soir, retour à la maison
      const budget = dernierTravaille && finDernier != null ? Math.min(budgetBase, finDernier) : budgetBase;
      // rendez-vous le lendemain : on ne dort sur place que si c'est plus près de ce rendez-vous que la maison
      const pinsDemain = (fixes.get(o + 1) || []).map(id => byId.get(id)).filter(m => m?.lat != null);
      const hDemain = m => heures.has(m.id) ? parseHeure(heures.get(m.id)) : Infinity;
      const pinDemain = pinsDemain.sort((a, b) => hDemain(a) - hDemain(b))[0];
      // RDV tôt le lendemain, trop loin pour y être à l'heure en partant de la maison : on finit la journée vers lui et on dort sur place
      const marge = pinDemain ? hDemain(pinDemain) - parseHeure(s.heureDebut) : Infinity;
      const versDemain = !!pinDemain && s.decoucher && !dernierJour && marge < Infinity && dt(H, pinDemain) > marge;
      // lendemain = dernier jour travaillé, peut-être raccourci : depuis l'hôtel il faut pouvoir voir des magasins ET rentrer
      let demainDernier = !dernierJour;
      for (let j = d + 2; j < nbJours; j++) if (!off(j)) demainDernier = false;
      const budgetDemain = demainDernier && finDernier != null ? Math.min(budgetBase, finDernier) : budgetBase;
      const doitRentrer = m => versDemain ? false
        : !s.decoucher || dernierJour || dt(m, H) <= seuil || (!!pinDemain && dt(m, pinDemain) > dt(H, pinDemain))
          || (demainDernier && dt(m, H) > budgetDemain * 0.5);
      // fin de journée : retour maison, ou route du soir vers l'hôtel proche du RDV du lendemain
      const fin = m => versDemain ? Math.max(0, dt(m, pinDemain) - marge) : (doitRentrer(m) ? dt(m, H) : 0);
      // dus : échéance passée ou dans la semaine ; bonus : à moins de la moitié de leur fréquence
      const estDu = m => due.get(m) <= o + 6 - d;
      const estBonus = m => due.get(m) <= o + freq.get(m) / 2;
      let dus = principaux.filter(estDu);
      if (!dus.length && modeAutres === 'detour' && cible?.completer !== false) dus = petits.filter(estDu);   // plus aucun grand magasin dû : on complète
      const depuisDomicile = pos === H;
      const pins = (fixes.get(o) || []).map(id => byId.get(id)).filter(m => m && m.lat != null);

      let seed = null;
      if (pins.length) {
        seed = pins[0];
      } else if (dus.length) {
        const c = [...dus];
        if (depuisDomicile) {
          // le plus loin d'abord, en avançant les magasins les plus en retard
          if (versDemain) c.sort((a, b) => (dt(a, pinDemain) + dt(H, a)) - (dt(b, pinDemain) + dt(H, b)) + (due.get(a) - due.get(b)) * 2);
          else c.sort((a, b) => (dt(H, b) - dt(H, a)) + (due.get(a) - due.get(b)) * 4);
          // journée avec retour le soir : on garde au moins 40 % du temps pour les visites
          if (!versDemain) seed = c.find(m => (!doitRentrer(m) || 2 * dt(H, m) <= budget * 0.6) && dt(H, m) + visite(m) + fin(m) <= budget);
          seed ||= c.find(m => dt(H, m) + visite(m) + fin(m) <= budget);
        } else {
          c.sort((a, b) => dt(pos, a) + (dernierJour ? dt(a, H) * 0.5 : 0) - dt(pos, b) - (dernierJour ? dt(b, H) * 0.5 : 0));
          seed = c.find(m => dt(pos, m) + visite(m) + fin(m) <= budget);
        }
      }
      if (!seed && !depuisDomicile) {
        // rien de dû faisable depuis l'hôtel : on rentre en voyant ce qui est sur le chemin
        const c = principaux.filter(estBonus).sort((a, b) => dt(pos, a) + dt(a, H) - dt(pos, b) - dt(b, H));
        seed = c.find(m => dt(pos, m) + visite(m) + dt(m, H) <= budget) || null;
        if (!seed) {
          // rien de faisable depuis l'hôtel : la veille on rentre plutôt, et on refait cette journée depuis la maison
          const veille = jours[jours.length - 1];
          if (veille?.etapes.length && !veille.retour) { rentrer(veille); pos = H; d--; continue; }
          jours.push(jourVide(w, d, o, pos)); pos = H; continue;
        }
      }
      if (!seed) { jours.push(jourVide(w, d, o, null)); continue; }

      let etapes = [seed], t = dt(pos, seed) + visite(seed), cur = seed;
      const pris = new Set([seed]);
      // magasins imposés : enchaînés au plus proche
      for (const p of pins.slice(1).sort((a, b) => dt(seed, a) - dt(seed, b))) { t += dt(cur, p) + visite(p); etapes.push(p); pris.add(p); cur = p; }
      let sautMax = 80;
      for (;;) {
        if (etapes.length >= maxJour) break;
        let best = null, bestScore = Infinity;
        for (const c of (estCible(seed) || modeAutres !== 'detour' ? principaux : petits)) {
          if (pris.has(c)) continue;
          const du = estDu(c);
          if (!du && !estBonus(c)) continue;
          const r = retard(c, o), enRetard = du && r >= 0.5;
          const dd = dt(cur, c);
          // un magasin « bonus » doit être sur le chemin ; un magasin en retard vaut un détour
          if (dd > (du ? sautMax + (enRetard ? detour : 0) : 30)) continue;
          if (t + dd + visite(c) + fin(c) > budget) continue;
          const score = dd + (du ? 0 : 20) - (enRetard ? Math.min(detour, 15 + 15 * Math.min(r, 2)) : 0)
            + (dernierJour ? Math.max(0, dt(c, H) - dt(cur, H)) * 0.5 : 0)
            + (versDemain ? Math.max(0, dt(c, pinDemain) - dt(cur, pinDemain)) * 0.7 : 0);
          if (score < bestScore) { bestScore = score; best = c; }
        }
        if (!best) {
          if (sautMax < 1e9 && t < budget * 0.6) { sautMax = 1e9; continue; }
          break;
        }
        t += dt(cur, best) + visite(best);
        etapes.push(best); pris.add(best); cur = best;
      }

      let retour = doitRentrer(cur);
      let liste = optimiserOrdre(pos, etapes, retour, H).map(i => etapes[i]);

      // petits magasins « sur le chemin » : insertion la moins chère tant que le détour reste court
      const ajouts = {};
      if (petits.length) {
        const duree = (l, ret) => { let c = 0, p = pos; for (const m of l) { c += dt(p, m) + visite(m); p = m; } return c + (ret ? dt(p, H) : versDemain ? fin(p) : 0); };
        for (;;) {
          if (liste.length >= maxJour) break;
          let best = null;
          for (const c of petits) {
            if (pris.has(c) || !(estDu(c) || estBonus(c))) continue;
            const r = retard(c, o), max = detourPetit + (estDu(c) && r >= 0.5 ? Math.max(0, detour - detourPetit) / 2 : 0);
            for (let k = 0; k <= liste.length; k++) {
              const a = k ? liste[k - 1] : pos, b = k < liste.length ? liste[k] : (retour ? H : null);
              const cout = dt(a, c) + (b ? dt(c, b) - dt(a, b) : 0);
              if (cout > max) continue;
              const score = cout - (estDu(c) ? 5 : 0) - (r >= 0.5 ? 10 : 0) - (c.derniereVisite ? 0 : 3);
              if (best && score >= best.score) continue;
              const essai = [...liste.slice(0, k), c, ...liste.slice(k)];
              if (duree(essai, retour) > budget) continue;
              best = { score, c, k, cout, essai };
            }
          }
          if (!best) break;
          liste = best.essai; pris.add(best.c); ajouts[best.c.id] = Math.round(best.cout);
        }
        if (Object.keys(ajouts).length) liste = optimiserOrdre(pos, liste, retour, H).map(i => liste[i]);
      }
      const dernier = liste[liste.length - 1];
      if (!retour && doitRentrer(dernier)) retour = true;

      let k = 0, c = 0, prev = pos;
      for (const m of liste) { k += km(prev, m); c += dt(prev, m); prev = m; }
      if (retour) { k += km(prev, H); c += dt(prev, H); }
      // RDV tôt le lendemain trop loin : route du soir jusqu'à un hôtel près de lui
      const nuitVers = !retour && versDemain && dt(dernier, pinDemain) > marge;
      if (nuitVers) { k += km(prev, pinDemain); c += dt(prev, pinDemain); }
      const total = c + liste.reduce((a, m) => a + visite(m), 0);
      const detours = liste.filter(m => !pins.includes(m) && retard(m, o) >= 0.5).map(m => m.id);
      for (const m of liste) if (freq.has(m)) { due.set(m, o + freq.get(m)); visites.set(m, visites.get(m) + 1); }
      jours.push({
        semaine: w + 1, jourSemaine: d, offset: o,
        depart: depuisDomicile ? null : { lat: pos.lat, lon: pos.lon, adresse: pos.adresse },
        etapes: liste.map(m => m.id), fixes: pins.map(m => m.id), detours, ajouts,
        retour, km: k, conduite: c, nuit: retour ? null : `Nuit près de ${(nuitVers ? pinDemain : dernier).ville}`,
        fin: parseHeure(s.heureDebut) + (Number(s.pauseMidi) || 0) + total, depasse: total > budget,
      });
      const lieu = nuitVers ? pinDemain : dernier;
      pos = retour ? H : { lat: lieu.lat, lon: lieu.lon, adresse: `Nuit près de ${lieu.ville}` };
    }
  }

  // une nuit sur place n'a de sens que si le lendemain est travaillé : sinon retour à la maison le soir
  jours.forEach((j, i) => {
    const n = jours[i + 1];
    if (!j.etapes.length || j.retour || (n && n.semaine === j.semaine && n.etapes.length)) return;
    rentrer(j);
    if (n) n.depart = null;
  });
  const pleins = jours.filter(j => j.etapes.length);
  const jamais = actifs.filter(m => !visites.get(m));
  const enRetardFin = actifs.filter(m => due.get(m) < semaines * 7 - 7 && visites.get(m) > 0);
  return {
    cree: new Date().toISOString(), debut, semaines,
    parametres: { decoucher: s.decoucher, seuil, nbJours, coefRoute: s.coefRoute, calibration: cal.temps || 1, vitesse: s.vitesseMoyenne },
    jours,
    nonProgrammes: jamais.map(m => m.id),
    totaux: {
      jours: pleins.length, semaines, magasins: actifs.length, horsTournees: magasins.length - actifs.length,
      visites: pleins.reduce((a, j) => a + j.etapes.length, 0), couverts: actifs.length - jamais.length,
      nuits: pleins.filter(j => !j.retour).length, enRetardFin: enRetardFin.length,
      km: pleins.reduce((a, j) => a + j.km, 0), conduite: pleins.reduce((a, j) => a + j.conduite, 0),
    },
  };
}

function jourVide(w, d, o, pos) {
  return { semaine: w + 1, jourSemaine: d, offset: o, depart: pos && pos.adresse ? { lat: pos.lat, lon: pos.lon, adresse: pos.adresse } : null, etapes: [], fixes: [], detours: [], ajouts: {}, retour: true, km: 0, conduite: 0, fin: 0, depasse: false };
}

export function dateDuJour(debut, offset) {
  const d = new Date(debut + 'T12:00');
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export function prochainLundi(from = new Date()) {
  const d = new Date(from); d.setHours(12, 0, 0, 0);
  const add = (8 - d.getDay()) % 7;
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}
