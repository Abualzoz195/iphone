// Réglages de l'affichage. La liste des lignes et des gares est dans network.js (fichier généré).

// Noms de destination raccourcis comme sur les écrans en gare.
export const DESTINATION_ALIASES = {
  "Aéroport Charles de Gaulle 2 (Terminal 2)": "Aéroport Ch. de Gaulle",
  "Aéroport Charles de Gaulle 1": "Aéroport Ch. de Gaulle 1",
  "Aéroport d'Orly": "Aéroport d'Orly",
  "La Défense (Grande Arche)": "La Défense",
};

// Pastille aéroport affichée à côté de la destination.
export const AIRPORTS = [
  { match: /Charles de Gaulle|Ch\. de Gaulle/i, code: "CDG" },
  { match: /Orly/i, code: "ORY" },
];

// Message affiché quand il n'y a aucune info trafic.
export const DEFAULT_MESSAGE =
  "Attentifs, ensemble • Ne pas se séparer de ses effets personnels • Signaler à nos agents tout objet abandonné, comportement ou situation inhabituels";

// Favori ajouté au tout premier lancement.
export const DEFAULT_FAVORITES = [{ lineId: "RER_B", stationId: "474151" }];

export const SETTINGS = {
  departuresRefreshSeconds: 30, // fréquence de mise à jour des horaires
  messagesRefreshSeconds: 300, // fréquence de mise à jour de l'info trafic
  messageRotateSeconds: 10, // durée d'affichage de chaque message
  rerRows: 4, // nombre de trains par écran RER
};
