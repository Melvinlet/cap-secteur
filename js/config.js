// ─────────────────────────────────────────────────────────────────────────────
// Cap Secteur — configuration par défaut
// Tout ce qui est réglable par l'utilisateur part d'ici. Chaque valeur peut être
// modifiée dans l'écran Réglages : elle est alors enregistrée sur l'appareil.
// Aucune donnée d'entreprise ici : voir « Profil entreprise » en bas de fichier.
// ─────────────────────────────────────────────────────────────────────────────

export const APP_VERSION = '1.7.2';

export const DEFAULT_SETTINGS = {
  commercial: '',                 // ton nom, utilisé dans les exports
  departements: [],               // ton secteur (rempli par le profil entreprise ou dans Réglages)

  // Tournées
  depart: { adresse: '', lat: null, lon: null },
  heureDebut: '08:30',
  heureFin: '18:00',
  pauseMidi: 60,                  // minutes
  dureeVisite: 45,                // minutes par magasin (modifiable magasin par magasin)
  frequenceDefaut: 30,            // ancien réglage (remplacé par les fréquences par priorité)
  frequencesPriorite: {},         // surcharges de PRIORITES[n].freq
  calibration: { temps: 1, km: 1, n: 0 }, // écart mesuré entre l'estimation et TomTom (mis à jour tout seul)
  dureesEnseigne: {},             // surcharges de DUREES_ENSEIGNE
  joursTerrain: 5,                // jours de terrain par semaine (lundi → …)
  decoucher: true,                // nuits à l'hôtel autorisées dans le plan de secteur
  seuilDecoucher: 75,             // au-delà de ce temps de retour (min), on dort sur place
  detourRetard: 40,               // détour accepté (min) pour un magasin en retard de visite
  // ciblage du remplissage automatique de la semaine (modifiable dans la fenêtre « Remplir automatiquement »)
  ciblage: { enseignes: [], autres: 'detour', detourPetit: 20, completer: true, priorites: [1, 2, 3], departements: [], modeMax: 'libre', maxParJour: 4, maxJours: [], finDernierJour: '' },
  coefRoute: 1.3,                 // distance à vol d'oiseau × coef ≈ distance par la route
  vitesseMoyenne: 70,             // km/h, utilisée quand aucun service d'itinéraire n'est disponible

  // Services en ligne
  itineraire: 'tomtom',           // 'tomtom' | 'aucun'
  cleTomTom: '',                  // jamais exportée dans les sauvegardes partagées
  gps: 'waze',                    // 'waze' | 'google'
  objetDefaut: '',                // objet de visite proposé par défaut (sinon le premier de la liste)
  telPro: '', emailPro: '',       // ta signature dans les demandes de rendez-vous
  modelesRdv: {},                 // tes versions personnalisées des messages (sinon MODELES_RDV)
  relanceApres: 3,                // jours sans réponse avant de proposer une relance
  categoriesFrais: ['Repas', 'Hébergement', 'Carburant', 'Péages', 'Parking', 'Transport', 'Fournitures', 'Téléphone', 'Indemnités km', 'Divers'],
  tauxKm: 0,                      // indemnité kilométrique (€/km) si tu utilises ton véhicule perso ; 0 = non utilisé
  fondCarte: 'osm',               // 'osm' | 'tomtom'
};

// Enseignes : couleur du repère sur la carte et durée de visite par défaut (minutes).
// Vides dans le code : remplies par le profil entreprise importé sur l'appareil.
export const ENSEIGNES = {};
export const ENSEIGNE_AUTRE = '#5B6573';
export const DUREES_ENSEIGNE = {};

// Priorités de visite. « freq » = nombre de jours entre deux visites (modifiable dans Réglages).
export const PRIORITES = {
  1: { label: 'Prioritaire', court: 'P1', freq: 42, aide: 'gros potentiel, à voir souvent' },
  2: { label: 'Standard', court: 'P2', freq: 84, aide: 'visite régulière' },
  3: { label: 'Occasionnel', court: 'P3', freq: 180, aide: 'petit potentiel, de temps en temps' },
  0: { label: 'En pause', court: 'Pause', freq: null, aide: 'pas de visite pour l\'instant (travaux, changement de direction…)' },
  5: { label: 'Refus', court: 'Refus', freq: null, aide: 'ne souhaite pas travailler avec nous' },
  4: { label: 'Fermé', court: 'Fermé', freq: null, aide: 'le magasin n\'existe plus' },
};
export const ORDRE_PRIORITES = [1, 2, 3, 0, 5, 4];
export const HORS_TOURNEE = [0, 4, 5];

// Rôle des interlocuteurs en magasin (du terrain au décisionnaire)
export const ROLES_CONTACT = ['Vendeur', 'Responsable de rayon', 'Chef de secteur magasin', 'Chef des ventes', 'Directeur', 'Adhérent / gérant', 'Acheteur / centrale', 'Autre'];
// Priorité par défaut selon l'enseigne (profil entreprise). Modifiable magasin par magasin.
export const PRIORITE_ENSEIGNE = {};
export const PRIORITE_DEFAUT = 2;

export const REGIONS = {};   // département → région (profil entreprise)

export const STATUTS_SAV = ['Ouvert', 'En cours', 'En attente pièce', 'Résolu'];
export const TYPES_NOTE = ['Visite', 'Appel', 'Note'];

// Statuts et objets de visite (les objets peuvent être remplacés par le profil entreprise)
export const STATUTS_VISITE = ['Planifiée', 'Confirmée', 'Réalisée', 'Reportée', 'Annulée'];
export const OBJETS_VISITE = ['Prise de commande', 'Présentation gamme', 'Relevé stock', 'Implantation / PLV',
  'Formation vendeurs', 'Animation', 'Salon', 'SAV', 'Autre'];

// Campagne de commande en cours. Désactivée tant qu'aucun profil entreprise ne la définit.
export const SAISON = {
  nom: 'Campagne en cours', debut: null, commandeDebut: null, commandeFin: null, livraisonDebut: null, livraisonFin: null,
  maxLivraisons: 6,
  offertPour: 0,                  // 1 produit offert toutes les N unités (0 = aucun)
  libelleOffert: 'produit offert', libelleOfferts: 'produits offerts', libelleOffertLong: 'Produits offerts',
  independants: [],               // enseignes qui demandent maintien des reliquats + engagement signé
  modesLivraison: ['Direct magasin', 'Plateforme'],
};
// Enseignes de référence (catalogue, objectifs, export planning)
export const ENSEIGNES_LISTE = [];

// ── Rendez-vous ──────────────────────────────────────────────────────────────
export const STATUTS_RDV = {
  aFaire: { label: 'Demande non faite', court: 'À faire' },
  envoyee: { label: 'Demande envoyée', court: 'Envoyée' },
  relancee: { label: 'Relancée', court: 'Relancée' },
  acceptee: { label: 'Acceptée', court: 'Acceptée' },
  autreDate: { label: 'Acceptée à une autre date', court: 'Autre date' },
  refusee: { label: 'Refusée', court: 'Refusée' },
};

// Ce que dit le message selon l'objet de la visite
export const OBJET_PHRASE = {
  'Prise de commande': 'faire le point sur vos besoins et préparer votre commande',
  'Présentation gamme': 'vous présenter notre gamme',
  'Relevé stock': 'faire un point sur votre stock et vos ventes',
  'Implantation / PLV': 'voir ensemble l\'implantation et la PLV en rayon',
  'Formation vendeurs': 'former vos équipes de vente à nos produits',
  'Animation': 'préparer une animation dans votre magasin',
  'Salon': 'faire suite à notre échange lors du salon',
  'SAV': 'faire le point sur vos dossiers SAV',
  'Autre': 'échanger avec vous',
};

// Modèles de messages. Variables : {bonjour} {contact} {magasin} {quand} {date} {heure} {objet}
// {chef} {poste} {societe} {marques} {telephone} {email} {enseigne} {ville}. Modifiables dans Réglages.
export const MODELES_RDV = {
  demande: {
    label: 'Demande de rendez-vous',
    sujet: 'Demande de rendez-vous – {magasin}',
    corps: `{bonjour},

Je suis {chef}, {poste} sur votre région.

Je serai de passage {quand} et je souhaiterais vous rencontrer pour {objet}. Ce créneau vous conviendrait-il ? Si ce n'est pas le cas, je m'adapte volontiers à vos disponibilités.

Bien cordialement,

{chef}
{poste}
{telephone}
{email}`,
  },
  relance: {
    label: 'Relance',
    sujet: 'Relance : rendez-vous – {magasin}',
    corps: `{bonjour},

Je me permets de revenir vers vous concernant ma demande de rendez-vous : je serai dans votre secteur {quand} pour {objet}.

Pouvez-vous me dire si ce créneau vous convient, ou m'indiquer un moment plus pratique pour vous ?

Bien cordialement,

{chef}
{poste}
{telephone}`,
  },
  confirmation: {
    label: 'Confirmation',
    sujet: 'Confirmation de notre rendez-vous – {magasin}',
    corps: `{bonjour},

Je vous confirme notre rendez-vous {quand} dans votre magasin, pour {objet}.

À très bientôt,

{chef}
{poste}
{telephone}`,
  },
  sms: {
    label: 'SMS court',
    sujet: '',
    corps: `{bonjour}, {chef} ({poste}). Je passe {quand} : auriez-vous 30 minutes pour {objet} ? Merci de me dire si ça vous convient.`,
  },
};

// ── Compte rendu de visite ───────────────────────────────────────────────────
export const ACTIONS_VISITE = ['Présentation gamme', 'Prise de commande', 'Relevé de stock', 'Implantation / mise en rayon',
  'PLV posée', 'Formation vendeurs', 'Animation', 'Traitement SAV', 'Merchandising / facing', 'Point litiges / livraison', 'Autre'];
export const ETIQUETTES_PHOTO = ['Rayon', 'Avant', 'Après', 'PLV', 'Meuble', 'Concurrence', 'Autre'];

// ── Concurrence ──────────────────────────────────────────────────────────────
export const MARQUES_CONCURRENTES = [];   // proposées à la saisie (profil entreprise)
export const TYPES_CONCURRENCE = ['Produit', 'Offre / promo', 'PLV / mise en avant', 'Implantation', 'Info magasin'];

// ── Notes de frais ───────────────────────────────────────────────────────────
export const STATUTS_FRAIS = { aDeclarer: 'À déclarer', declaree: 'Déclarée', remboursee: 'Remboursée', refusee: 'Refusée' };

// ── Objectifs (toujours en nombres / unités, jamais en euros) ────────────────
export const INDICATEURS = {
  visites: 'Visites réalisées', magasins: 'Magasins différents visités', p1: 'Magasins P1 visités',
  unites: 'Unités commandées', commandes: 'Commandes', rdv: 'RDV obtenus', releves: 'Relevés de stock',
  concurrence: 'Relevés concurrence', photos: 'Photos de rayon', manuel: 'Suivi manuel',
};

// ── Profil entreprise ────────────────────────────────────────────────────────
// Le code de l'appli ne contient aucune donnée d'entreprise. Tout ce qui est propre à
// l'employeur (enseignes, campagne, messages, modèle de note de frais…) arrive par un
// fichier « profil » importé sur l'appareil et rangé dans sa mémoire locale.
export const PROFIL = {
  nom: '', societe: '', marques: [], poste: 'Commercial',
  saisonPrecedente: 'Saison précédente', reseau: '',
  ciblage: { enseignes: [] },
  planning: { nom: 'planning', consigne: 'Une ligne par visite.', colonnes: ['Jour', 'Heure', 'Commercial', 'Enseigne', 'Magasin', 'Statut visite', 'Objet de la visite', 'N° visite', 'Interlocuteur'] },
  commande: { bon: 'bon de commande officiel' },
  ndf: { nom: 'Note de frais', titre: 'NOTE DE FRAIS', mention: '', fichier: 'Note de frais {AAAA}-{MM}-{JJ} {PRENOM} {NOM}',
    ongletReel: 'Frais', ongletIk: 'Indemnités km', lignesReel: 30, lignesIk: 15,
    colonnes: ['Repas', 'Hébergement', 'Carburant', 'Péages', 'Parking', 'Divers'],
    regles: { Repas: 'repas|restau|dejeuner|diner|midi', 'Hébergement': 'hotel|hebergement|nuit', Carburant: 'carbur|essence|gasoil|gazole|plein|recharge', 'Péages': 'peage', Parking: 'parking|stationnement' },
    defaut: 'Divers', bareme: null },
};
const vider = o => { if (Array.isArray(o)) o.length = 0; else for (const k of Object.keys(o)) delete o[k]; return o; };
const remplir = (cible, src) => { if (src == null) return; if (Array.isArray(cible)) { vider(cible); cible.push(...src); } else Object.assign(vider(cible), src); };
const PROFIL_VIDE = JSON.parse(JSON.stringify(PROFIL));
const BASE = { OBJETS_VISITE: [...OBJETS_VISITE], OBJET_PHRASE: { ...OBJET_PHRASE }, SAISON: { ...SAISON }, MODELES_RDV: JSON.parse(JSON.stringify(MODELES_RDV)) };

export function appliquerProfil(p) {
  p = p || {};
  remplir(PROFIL, { ...JSON.parse(JSON.stringify(PROFIL_VIDE)), ...p,
    ndf: { ...PROFIL_VIDE.ndf, ...(p.ndf || {}) }, planning: { ...PROFIL_VIDE.planning, ...(p.planning || {}) },
    commande: { ...PROFIL_VIDE.commande, ...(p.commande || {}) }, ciblage: { ...PROFIL_VIDE.ciblage, ...(p.ciblage || {}) } });
  remplir(ENSEIGNES, p.couleurs || {});
  remplir(DUREES_ENSEIGNE, p.durees || {});
  remplir(PRIORITE_ENSEIGNE, p.prioritesEnseigne || {});
  remplir(REGIONS, p.regions || {});
  remplir(ENSEIGNES_LISTE, p.enseignes || []);
  remplir(MARQUES_CONCURRENTES, p.marquesConcurrentes || []);
  remplir(OBJETS_VISITE, p.objetsVisite || BASE.OBJETS_VISITE);
  remplir(OBJET_PHRASE, { ...BASE.OBJET_PHRASE, ...(p.objetPhrase || {}) });
  remplir(SAISON, { ...BASE.SAISON, ...(p.saison || {}) });
  remplir(MODELES_RDV, JSON.parse(JSON.stringify(p.modelesRdv || BASE.MODELES_RDV)));
  DEFAULT_SETTINGS.departements = p.departements || [];
  DEFAULT_SETTINGS.objetDefaut = p.objetDefaut || OBJETS_VISITE[0];
  if (p.categoriesFrais) DEFAULT_SETTINGS.categoriesFrais = p.categoriesFrais;
  DEFAULT_SETTINGS.ciblage = { ...DEFAULT_SETTINGS.ciblage, enseignes: PROFIL.ciblage.enseignes || [] };
}
