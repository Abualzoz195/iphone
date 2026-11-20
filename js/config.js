// Configuration des gares et des lignes affichées.
// Pour ajouter une gare : copie un bloc de STATIONS et change les identifiants.
// Les identifiants se trouvent avec l'API PRIM (voir README.md, « Ajouter une gare »).

export const LINES = {
  RER_B: {
    ref: "STIF:Line::C01743:", // identifiant IDFM de la ligne
    mode: "RER",
    name: "B",
    color: "#5291CE",
    textColor: "#FFFFFF",
    // L'API renvoie « Aller » (vers le sud) ou « Retour » (vers le nord).
    directions: {
      Retour: "Paris · Aéroport CDG · Mitry-Claye",
      Aller: "Massy-Palaiseau · Robinson · Saint-Rémy",
    },
  },
};

export const STATIONS = [
  {
    id: "chatelet",
    name: "Châtelet - Les Halles",
    monitoringRef: "STIF:StopArea:SP:474151:", // zone d'arrêt de la gare
    lines: ["RER_B"],
  },
];

// Noms de destination trop longs pour l'écran → version courte.
export const DESTINATION_ALIASES = {
  "Aéroport Charles de Gaulle 2 (Terminal 2)": "Aéroport CDG 2",
  "Aéroport Charles de Gaulle 1": "Aéroport CDG 1",
  "Saint-Rémy-lès-Chevreuse": "St-Rémy-lès-Chevreuse",
};

export const SETTINGS = {
  departuresRefreshSeconds: 30, // fréquence de mise à jour des horaires
  messagesRefreshSeconds: 300, // fréquence de mise à jour de l'info trafic
  trainsPerDirection: 4, // nombre de trains affichés par sens
};
