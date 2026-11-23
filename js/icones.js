// Icônes au trait, toutes du même dessin (24 × 24, trait de 1,9) : remplacent les émojis,
// qui changent d'aspect d'un téléphone à l'autre. Usage : ic('crayon') dans un gabarit HTML.
const P = {
  crayon: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="m14 7 3 3"/>',
  croix: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  lune: '<path d="M19.5 14.5A7.8 7.8 0 1 1 9.5 4.5a6.2 6.2 0 0 0 10 10z"/>',
  maison: '<path d="M4.5 11.5 12 5.2l7.5 6.3V19.5h-5v-5h-5v5h-5z"/>',
  lieu: '<path d="M12 20.5s-6.3-5.4-6.3-10.6a6.3 6.3 0 0 1 12.6 0c0 5.2-6.3 10.6-6.3 10.6z"/><circle cx="12" cy="9.8" r="2.3"/>',
  epingle: '<path d="M9.2 4h5.6l-.9 4.8 2.8 3H7.3l2.8-3z"/><path d="M12 11.8V20"/>',
  reglages: '<path d="M4 7.5h9.5M17.5 7.5H20M4 16.5h2.5M10.5 16.5H20"/><circle cx="15.5" cy="7.5" r="2"/><circle cx="8.5" cy="16.5" r="2"/>',
  photo: '<path d="M4 8.5h3.2l1.6-2.3h6.4l1.6 2.3H20v10.3H4z"/><circle cx="12" cy="13.3" r="3.3"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2.5"/><circle cx="9.2" cy="10" r="1.6"/><path d="m20 16-4.8-4.8L7.5 19"/>',
  trombone: '<path d="m19.5 11.5-7.3 7.3a4.8 4.8 0 0 1-6.8-6.8l7.6-7.6a3.2 3.2 0 0 1 4.6 4.6l-7.4 7.4a1.6 1.6 0 0 1-2.3-2.3l6.8-6.8"/>',
  horloge: '<circle cx="12" cy="12" r="8"/><path d="M12 7.8V12l2.8 1.8"/>',
  alerte: '<path d="M12 4.2 20.5 19h-17z"/><path d="M12 10v4.2M12 16.9v.1"/>',
  document: '<path d="M7 3.5h7l4.5 4.5v12.5H7z"/><path d="M14 3.5V8h4.5M10 13h5.5M10 16.5h5.5"/>',
  micro: '<rect x="9" y="3.5" width="6" height="10.5" rx="3"/><path d="M5.8 11.2a6.2 6.2 0 0 0 12.4 0M12 17.5v3"/>',
  lecture: '<path d="M8.5 5.8v12.4l9.6-6.2z" class="plein"/>',
  etoile: '<path d="m12 3.8 2.5 5.1 5.6.8-4.1 4 1 5.6-5-2.6-5 2.6 1-5.6-4.1-4 5.6-.8z" class="plein"/>',
  coche: '<path d="m5.5 12.5 4 4 9-9.5"/>',
  chevron: '<path d="m9.5 6 6 6-6 6"/>',
};
export const ic = (nom, titre = '') => `<svg class="ic ic-${nom}" viewBox="0 0 24 24" ${titre ? `role="img" aria-label="${titre}"` : 'aria-hidden="true"'} focusable="false">${P[nom] || ''}</svg>`;
