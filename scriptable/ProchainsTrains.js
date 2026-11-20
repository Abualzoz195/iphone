// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: train;

// Widget « Prochains trains » pour l'app Scriptable (iPhone).
// Installation : voir README.md, section « Widget Scriptable ».
//
// Paramètre du widget (appui long sur le widget → Modifier le widget → Parameter) :
//   vide     → les deux sens (widget moyen ou grand)
//   Retour   → seulement vers Paris / CDG (pratique pour le petit widget)
//   Aller    → seulement vers Massy / Robinson / Saint-Rémy

// ---------- Configuration ----------
const STATION = {
  name: "Châtelet - Les Halles",
  monitoringRef: "STIF:StopArea:SP:474151:",
};
const LINE = {
  ref: "STIF:Line::C01743:",
  name: "B",
  color: "#5291CE",
  directions: {
    Retour: "Paris · CDG",
    Aller: "Massy · Robinson",
  },
};
const DESTINATION_ALIASES = {
  "Aéroport Charles de Gaulle 2 (Terminal 2)": "Aéroport CDG 2",
  "Aéroport Charles de Gaulle 1": "Aéroport CDG 1",
  "Saint-Rémy-lès-Chevreuse": "St-Rémy",
};
const KEYCHAIN_KEY = "prim_apikey";
const REFRESH_MINUTES = 5; // iOS décide en dernier : souvent entre 5 et 15 min

const COLORS = {
  bg: new Color("#08123d"),
  text: Color.white(),
  muted: new Color("#a9b5e3"),
  yellow: new Color("#ffd23f"),
  orange: new Color("#ff9f1c"),
  red: new Color("#ff4d5e"),
  line: new Color(LINE.color),
};

// ---------- Données ----------
const text = (field) => (Array.isArray(field) ? (field[0] || {}).value : (field || {}).value) || "";
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

async function fetchDepartures(apiKey) {
  const url =
    "https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring" +
    `?MonitoringRef=${encodeURIComponent(STATION.monitoringRef)}&LineRef=${encodeURIComponent(LINE.ref)}`;
  const req = new Request(url);
  req.headers = { apikey: apiKey, Accept: "application/json" };
  const data = await req.loadJSON();
  const status = req.response && req.response.statusCode;
  if (status === 401 || status === 403) throw new Error("Clé API refusée");
  if (status && status >= 400) throw new Error(`Erreur API (${status})`);

  const delivery = (((data || {}).Siri || {}).ServiceDelivery || {}).StopMonitoringDelivery || [];
  const visits = (delivery[0] || {}).MonitoredStopVisit || [];
  const seen = new Set();
  const now = new Date();
  const departures = [];

  for (const visit of visits) {
    const journey = visit.MonitoredVehicleJourney || {};
    const call = journey.MonitoredCall || {};
    const id = (journey.FramedVehicleJourneyRef || {}).DatedVehicleJourneyRef || visit.ItemIdentifier;
    if (seen.has(id)) continue;
    seen.add(id);

    const expectedRaw = call.ExpectedDepartureTime || call.ExpectedArrivalTime || call.AimedDepartureTime || call.AimedArrivalTime;
    if (!expectedRaw) continue;
    const expected = new Date(expectedRaw);
    const aimed = new Date(call.AimedDepartureTime || call.AimedArrivalTime || expectedRaw);
    if (expected - now < -60000) continue; // déjà parti

    const destination = text(journey.DestinationName) || text(call.DestinationDisplay);
    departures.push({
      mission: text(journey.JourneyNote),
      destination: DESTINATION_ALIASES[destination] || destination,
      direction: (journey.DirectionRef || {}).value || "",
      platform: (call.DeparturePlatformName || call.ArrivalPlatformName || {}).value || "",
      expected,
      delayMinutes: Math.round((expected - aimed) / 60000),
      cancelled: [call.DepartureStatus, call.ArrivalStatus].includes("cancelled"),
    });
  }
  return departures.sort((a, b) => a.expected - b.expected);
}

// ---------- Clé API (stockée dans le trousseau de l'iPhone) ----------
async function askForKey() {
  const alert = new Alert();
  alert.title = "Clé API PRIM";
  alert.message = "Colle ta clé (prim.iledefrance-mobilites.fr → Mes jetons). Elle reste dans le trousseau de ton iPhone.";
  alert.addSecureTextField("Clé API", "");
  alert.addAction("Enregistrer");
  alert.addCancelAction("Annuler");
  if ((await alert.presentAlert()) === -1) return null;
  const key = alert.textFieldValue(0).trim();
  if (key) Keychain.set(KEYCHAIN_KEY, key);
  return key || null;
}

function storedKey() {
  return Keychain.contains(KEYCHAIN_KEY) ? Keychain.get(KEYCHAIN_KEY) : null;
}

// ---------- Widget ----------
function addHeader(widget, compact) {
  const header = widget.addStack();
  header.centerAlignContent();

  const badge = header.addStack();
  badge.backgroundColor = COLORS.line;
  badge.cornerRadius = 4;
  badge.setPadding(1, 5, 1, 5);
  const b = badge.addText(LINE.name);
  b.font = Font.heavySystemFont(13);
  b.textColor = Color.white();

  header.addSpacer(6);
  const name = header.addText(STATION.name);
  name.font = Font.boldSystemFont(compact ? 13 : 15);
  name.textColor = COLORS.text;
  name.lineLimit = 1;
  name.minimumScaleFactor = 0.7;

  header.addSpacer();
  const updated = header.addText(hhmm(new Date()));
  updated.font = Font.mediumSystemFont(11);
  updated.textColor = COLORS.muted;
}

function addDeparture(container, dep, showMission) {
  const row = container.addStack();
  row.layoutVertically();

  const top = row.addStack();
  top.centerAlignContent();
  const time = top.addText(dep.cancelled ? "Supprimé" : hhmm(dep.expected));
  time.font = Font.boldMonospacedSystemFont(dep.cancelled ? 13 : 16);
  time.textColor = dep.cancelled ? COLORS.red : COLORS.yellow;

  if (!dep.cancelled && dep.delayMinutes >= 2) {
    top.addSpacer(4);
    const delay = top.addText(`+${dep.delayMinutes}`);
    delay.font = Font.boldSystemFont(12);
    delay.textColor = COLORS.orange;
  }
  if (!dep.cancelled) {
    top.addSpacer(4);
    // Se met à jour tout seul sur l'écran d'accueil, même entre deux rafraîchissements
    const relative = top.addDate(dep.expected);
    relative.applyRelativeStyle();
    relative.font = Font.mediumSystemFont(11);
    relative.textColor = COLORS.muted;
    relative.lineLimit = 1;
  }

  const bottom = row.addText(`${showMission && dep.mission ? dep.mission + " · " : ""}${dep.destination}`);
  bottom.font = Font.mediumSystemFont(11);
  bottom.textColor = COLORS.text;
  bottom.lineLimit = 1;
}

function addDirection(container, directionRef, departures, count, showMission) {
  const column = container.addStack();
  column.layoutVertically();

  const label = column.addText(`→ ${LINE.directions[directionRef] || directionRef}`);
  label.font = Font.semiboldSystemFont(11);
  label.textColor = COLORS.muted;
  label.lineLimit = 1;
  column.addSpacer(3);

  const list = departures.filter((d) => d.direction === directionRef).slice(0, count);
  if (!list.length) {
    const none = column.addText("Aucun train annoncé");
    none.font = Font.mediumSystemFont(12);
    none.textColor = COLORS.muted;
  }
  list.forEach((dep, i) => {
    if (i) column.addSpacer(4);
    addDeparture(column, dep, showMission);
  });
}

function messageWidget(message) {
  const widget = new ListWidget();
  widget.backgroundColor = COLORS.bg;
  addHeader(widget, true);
  widget.addSpacer();
  const t = widget.addText(message);
  t.font = Font.mediumSystemFont(13);
  t.textColor = COLORS.text;
  widget.addSpacer();
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60000);
  return widget;
}

function buildWidget(departures, family, parameter) {
  const widget = new ListWidget();
  widget.backgroundColor = COLORS.bg;
  widget.setPadding(12, 14, 12, 14);
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60000);
  widget.url = "scriptable:///run/" + encodeURIComponent(Script.name());

  addHeader(widget, family === "small");
  widget.addSpacer(8);

  const only = (parameter || "").trim();
  const directions = only && LINE.directions[only] ? [only] : Object.keys(LINE.directions); // dans l'ordre de la config : Paris d'abord
  // Petit widget sans paramètre : un seul sens, vers Paris
  if (family === "small" && !only) directions.splice(1);

  if (family === "large") {
    for (const dir of directions) {
      addDirection(widget, dir, departures, directions.length === 1 ? 8 : 4, true);
      widget.addSpacer(10);
    }
  } else if (directions.length === 1) {
    addDirection(widget, directions[0], departures, 3, family !== "small");
  } else {
    const columns = widget.addStack();
    columns.topAlignContent();
    addDirection(columns, directions[0], departures, 3, false);
    columns.addSpacer(10);
    addDirection(columns, directions[1], departures, 3, false);
  }
  widget.addSpacer();
  return widget;
}

// ---------- Lancement ----------
async function main() {
  let apiKey = storedKey();

  if (!config.runsInWidget) {
    // Lancé depuis l'app : proposer de changer la clé
    if (apiKey) {
      const menu = new Alert();
      menu.title = STATION.name;
      menu.addAction("Voir le widget");
      menu.addAction("Changer la clé API");
      menu.addCancelAction("Fermer");
      const choice = await menu.presentSheet();
      if (choice === -1) return;
      if (choice === 1) apiKey = await askForKey();
    } else {
      apiKey = await askForKey();
    }
  }

  const family = config.widgetFamily || "medium";
  let widget;
  if (!apiKey) {
    widget = messageWidget("Ouvre le script dans Scriptable pour entrer ta clé API PRIM.");
  } else {
    try {
      widget = buildWidget(await fetchDepartures(apiKey), family, args.widgetParameter);
    } catch (err) {
      widget = messageWidget(err.message || "Pas de connexion");
    }
  }

  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
}

await main();
Script.complete();
