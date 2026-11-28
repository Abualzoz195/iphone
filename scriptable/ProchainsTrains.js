// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: train;

// Widget « Prochains trains » pour l'app Scriptable (iPhone).
// Il affiche tes gares favorites, lues dans le fichier exporté par l'app :
//   1. Dans l'app : ⚙ → Exporter → « Enregistrer dans Fichiers » → iCloud Drive › Scriptable.
//   2. Le widget prend automatiquement le fichier « mes-gares-….json » le plus récent.
// Réexporte quand tu changes tes favoris.
//
// Emploi du temps : réglé dans l'app (Réglages → Emploi du temps du widget), transmis par
// le fichier d'export. Ex. 8:30–9:30 en semaine → une gare, 17:40–19:00 → une autre.
// Le widget se rafraîchit au début et à la fin de chaque créneau.
//
// Paramètre du widget (appui long → Modifier le widget → Parameter), prioritaire sur l'emploi du temps :
//   vide       → emploi du temps, sinon 1re gare (petit et moyen widget), 3 premières (grand widget)
//   2          → la 2e gare de ta liste (un numéro)
//   chatelet   → la première gare dont le nom contient ce texte
//
// Chaque affichage du widget = 1 requête par gare montrée (iOS rafraîchit toutes les 5 à 15 min).

const KEYCHAIN_KEY = "prim_apikey";
const REFRESH_MINUTES = 10;
// Mise à jour automatique : le script se remplace par la dernière version publiée
const SCRIPT_URL = "https://abualzoz195.github.io/iphone/scriptable/ProchainsTrains.js";
const UPDATE_EVERY_HOURS = 6;
// Couleurs des écrans de quai de l'app (css/style.css)
const COLORS = {
  head: new Color("#ffffff"), // bandeau du haut
  row: new Color("#e2e6f3"), // lignes de trains RER (gris bleuté)
  rowAlt: new Color("#d7dcee"),
  ink: new Color("#1b2a87"), // texte bleu foncé
  mission: new Color("#2635aa"),
  waitBg: new Color("#0d0d10"), // carré noir
  wait: new Color("#e7e47a"), // heure en jaune
  metroBody: new Color("#000000"),
  metroText: new Color("#e6e8ef"),
  muted: new Color("#6c7293"),
  late: new Color("#c2410c"),
  red: new Color("#ff4d5e"),
};
// Version sombre (paramètre « sombre ») : pour l'écran d'accueil en mode « Teinté » ou « Clair ».
// iOS y retire les couleurs et teinte tout le contenu : un fond coloré derrière un texte le
// rendrait invisible. Cette version n'a donc aucun fond derrière le texte.
let DARK = false;
const DARK_COLORS = {
  ink: new Color("#ffffff"),
  muted: new Color("#9aa3c7"),
  metroText: new Color("#ffffff"),
  late: new Color("#ff9f1c"),
  wait: new Color("#ffd23f"),
};
const DARK_BACKGROUND = new Color("#0b0d14");

// Fond d'un bloc : jamais en version sombre
function fill(stack, color) {
  if (!DARK) stack.backgroundColor = color;
}

const ALIASES = {
  "Aéroport Charles de Gaulle 2 (Terminal 2)": "Aéroport CDG 2",
  "Aéroport Charles de Gaulle 1": "Aéroport CDG 1",
  "Saint-Rémy-lès-Chevreuse": "St-Rémy",
  "La Défense (Grande Arche)": "La Défense",
};

// ---------- Outils ----------
const text = (f) => (Array.isArray(f) ? (f[0] || {}).value : (f || {}).value) || "";
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const compact = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// ---------- Fichier des favoris (iCloud Drive › Scriptable) ----------
// Copie des gares gardée sur le téléphone (hors iCloud) : iOS peut retirer le fichier iCloud de
// l'iPhone après quelques jours, et un widget n'a pas le temps d'attendre son téléchargement.
const LOCAL_COPY = "prochains-trains-gares.json";

function parseFavorites(text) {
  const data = JSON.parse(text);
  const list = (Array.isArray(data) ? data : data.favorites || []).filter((f) => f.widget && f.widget.lineRef);
  const schedule = (!Array.isArray(data) && data.widgetSchedule) || { slots: [], outside: "first" };
  return list.length ? { list, schedule } : null;
}

// Promesse limitée dans le temps (un widget est coupé par iOS s'il est trop long)
function withTimeout(promise, seconds) {
  let timer = null;
  const limit = new Promise((_, reject) => {
    timer = Timer.schedule(seconds * 1000, false, () => reject(new Error("délai dépassé")));
  });
  return Promise.race([promise, limit]).finally(() => timer && timer.invalidate());
}

async function readFavorites() {
  const local = FileManager.local();
  const copyPath = local.joinPath(local.documentsDirectory(), LOCAL_COPY);
  let icloud = null;
  let downloading = false; // fichier présent dans iCloud mais pas encore sur le téléphone
  try { icloud = FileManager.iCloud(); } catch { /* iCloud désactivé pour Scriptable */ }

  if (icloud) {
    const dir = icloud.documentsDirectory();
    const files = icloud.listContents(dir).filter((n) => /^mes-gares.*\.json$/i.test(n));
    // Le plus récemment modifié (deux exports le même jour : « mes-gares-…-20 2.json »)
    const paths = files.map((n) => icloud.joinPath(dir, n));
    paths.sort((a, b) => icloud.modificationDate(b) - icloud.modificationDate(a));
    for (const path of paths) {
      try {
        if (icloud.isFileStoredIniCloud(path) && !icloud.isFileDownloaded(path)) {
          if (config.runsInWidget) {
            icloud.downloadFileFromiCloud(path); // sans attendre : prêt pour la prochaine fois
            downloading = true;
            break; // on prend la copie locale
          }
          await withTimeout(icloud.downloadFileFromiCloud(path), 15);
        }
        const text = icloud.readString(path);
        const saved = parseFavorites(text);
        if (saved) {
          local.writeString(copyPath, text); // met à jour la copie locale
          return saved;
        }
      } catch { /* fichier illisible ou pas encore téléchargé : on essaie le suivant */ }
    }
  }
  try {
    if (local.fileExists(copyPath)) return parseFavorites(local.readString(copyPath));
  } catch { /* copie abîmée */ }
  return downloading ? { downloading: true } : null;
}

// ---------- Emploi du temps ----------
const toMinutes = (hhmm) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
const favKey = (f) => `${f.lineId}/${f.stationId}`;

// Créneau en cours (gère les créneaux qui passent minuit, ex. 23:00 → 01:00)
function activeSlot(schedule, now) {
  const day = now.getDay();
  const previousDay = (day + 6) % 7;
  const m = now.getHours() * 60 + now.getMinutes();
  return (schedule.slots || []).find((slot) => {
    const start = toMinutes(slot.start);
    const end = toMinutes(slot.end);
    if (start < end) return slot.days.includes(day) && m >= start && m < end;
    return (slot.days.includes(day) && m >= start) || (slot.days.includes(previousDay) && m < end);
  });
}

// Prochain début ou fin de créneau (pour que le widget change de gare à l'heure)
function nextBoundary(schedule, now) {
  let best = null;
  for (let shift = 0; shift <= 7; shift++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + shift);
    for (const slot of schedule.slots || []) {
      if (!slot.days.includes(date.getDay())) continue;
      const start = toMinutes(slot.start);
      const end = toMinutes(slot.end);
      const candidates = [start, end < start ? end + 1440 : end];
      for (const m of candidates) {
        const t = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, m);
        if (t > now && (!best || t < best)) best = t;
      }
    }
  }
  return best;
}

const DAY_NAMES = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
function nextSlotText(schedule, list, now) {
  for (let shift = 0; shift <= 7; shift++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + shift);
    const upcoming = (schedule.slots || [])
      .filter((s) => s.days.includes(date.getDay()))
      .map((s) => ({ s, t: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, toMinutes(s.start)) }))
      .filter((x) => x.t > now)
      .sort((a, b) => a.t - b.t)[0];
    if (upcoming) {
      const fav = list.find((f) => favKey(f) === upcoming.s.fav);
      const when = shift === 0 ? "" : shift === 1 ? "demain " : `${DAY_NAMES[date.getDay()]} `;
      return `Prochain créneau : ${when}${upcoming.s.start}${fav ? ` · ${fav.widget.stationName}` : ""}`;
    }
  }
  return "Aucun créneau prévu";
}

// Gares à afficher. Ordre de priorité : paramètre du widget, emploi du temps, réglage par défaut.
// Renvoie [] quand l'emploi du temps dit « ne rien afficher » (aucune requête).
function pickFavorites(list, family, parameter, schedule, now) {
  const p = (parameter || "").trim();
  if (/^\d+$/.test(p)) return [list[Math.min(list.length, Math.max(1, +p)) - 1]];
  if (p) {
    const found = list.find((f) => compact(f.widget.stationName).includes(compact(p)));
    if (found) return [found];
  }
  const count = family === "large" ? 3 : 1;
  if (schedule.slots && schedule.slots.length) {
    const slot = activeSlot(schedule, now);
    const fav = slot && list.find((f) => favKey(f) === slot.fav);
    if (fav) return [fav, ...list.filter((f) => f !== fav)].slice(0, count);
    if (schedule.outside === "none") return [];
  }
  return list.slice(0, count);
}

// ---------- API PRIM ----------
async function fetchGroups(fav, apiKey) {
  const w = fav.widget;
  const url =
    "https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring" +
    `?MonitoringRef=${encodeURIComponent(w.monitoringRef)}&LineRef=${encodeURIComponent(w.lineRef)}`;
  const req = new Request(url);
  req.timeoutInterval = 8; // secondes : au-delà, message d'erreur plutôt que widget vide
  req.headers = { apikey: apiKey, Accept: "application/json" };
  const data = await req.loadJSON();
  const status = req.response && req.response.statusCode;
  if (status === 429) throw new Error("Quota du jour épuisé");
  if (status === 401 || status === 403) throw new Error("Clé API refusée");
  if (status && status >= 400) throw new Error(`Erreur API (${status})`);

  const delivery = (((data || {}).Siri || {}).ServiceDelivery || {}).StopMonitoringDelivery || [];
  const visits = (delivery[0] || {}).MonitoredStopVisit || [];
  const now = new Date();
  const here = compact(w.stationName || "");
  const seen = new Set();
  const groups = new Map();
  for (const visit of visits) {
    const j = visit.MonitoredVehicleJourney || {};
    const c = j.MonitoredCall || {};
    const id = (j.FramedVehicleJourneyRef || {}).DatedVehicleJourneyRef || visit.ItemIdentifier;
    const raw = c.ExpectedDepartureTime || c.ExpectedArrivalTime || c.AimedDepartureTime || c.AimedArrivalTime;
    if (!raw || seen.has(id)) continue;
    seen.add(id);
    const expected = new Date(raw);
    const destination = text(j.DestinationName) || text(c.DestinationDisplay);
    if (expected - now < -30000 || (here && compact(destination) === here)) continue; // parti, ou terminus ici
    const aimed = new Date(c.AimedDepartureTime || c.AimedArrivalTime || raw);
    let platform = (c.DeparturePlatformName || c.ArrivalPlatformName || {}).value || "";
    if (/^unknown$/i.test(platform)) platform = ""; // voie pas encore attribuée
    // Comme l'app : par voie pour le RER, par sens pour le métro et le bus
    const key = w.mode === "RER" && platform ? `voie ${platform}` : (j.DirectionRef || {}).value || "";
    if (!groups.has(key)) groups.set(key, []);
    // Nom de mission comme sur les écrans : « ERIC53 » si dispo, sinon le code « ROPE »
    const name = text(j.VehicleJourneyName).replace(/^RATP/, "");
    groups.get(key).push({
      mission: /^[A-Z]{4}\d{2}$/.test(name) ? name : text(j.JourneyNote),
      direction: (j.DirectionRef || {}).value || "",
      expected,
      destination: ALIASES[destination] || destination,
      delay: Math.round((expected - aimed) / 60000),
      cancelled: [c.DepartureStatus, c.ArrivalStatus].includes("cancelled"),
    });
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "fr", { numeric: true }))
    .map(([, deps]) => deps.sort((a, b) => a.expected - b.expected));
}

// ---------- Clé API (trousseau de l'iPhone) ----------
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
const storedKey = () => (Keychain.contains(KEYCHAIN_KEY) ? Keychain.get(KEYCHAIN_KEY) : null);

// ---------- Dessin : même style que les écrans de quai de l'app ----------
// On affiche l'heure de passage (18:37) plutôt qu'un compte à rebours : l'heure reste juste
// entre deux rafraîchissements, et iOS écrirait le compte à rebours dans la langue du téléphone.

function label(stack, value, size, color, weight = "bold") {
  const t = stack.addText(value);
  t.font = weight === "mono" ? Font.boldMonospacedSystemFont(size) : weight === "semibold" ? Font.semiboldSystemFont(size) : Font.boldSystemFont(size);
  t.textColor = color;
  t.lineLimit = 1;
  return t;
}

// Pastilles : « RER » en contour + lettre, ou « M » + numéro, ou « BUS » + numéro
function badges(stack, w, size) {
  const mode = stack.addStack();
  mode.borderWidth = 1.5;
  mode.borderColor = COLORS.ink;
  mode.cornerRadius = w.mode === "METRO" ? size : 4;
  mode.setPadding(1, 4, 1, 4);
  label(mode, w.mode === "METRO" ? "M" : w.mode === "BUS" ? "BUS" : "RER", size * 0.75, COLORS.ink);
  stack.addSpacer(3);
  const line = stack.addStack();
  fill(line, new Color(w.color));
  if (DARK) {
    line.borderWidth = 1.5;
    line.borderColor = new Color(w.color);
  }
  line.cornerRadius = w.mode === "METRO" ? size : 4;
  line.setPadding(1, 5, 1, 5);
  label(line, w.code, size, DARK ? new Color(w.color) : new Color(w.textColor));
}

// Bandeau blanc : pastilles, nom de la gare, heure de mise à jour
function header(container, w, compact) {
  const head = container.addStack();
  fill(head, COLORS.head);
  head.setPadding(compact ? 5 : 7, 10, compact ? 4 : 7, 10);
  head.centerAlignContent();
  badges(head, w, compact ? 11 : 13);
  head.addSpacer(7);
  const name = label(head, w.stationName || "Gare", compact ? 12 : 14, COLORS.ink);
  name.minimumScaleFactor = 0.7;
  head.addSpacer();
  if (!compact) label(head, hhmm(new Date()), 10, COLORS.muted, "semibold");
}

// Carré noir avec l'heure en jaune (ou « Supp. » en rouge)
function waitBox(stack, d, size = 13, width = 0) {
  const box = stack.addStack();
  if (width) {
    box.size = new Size(width, 0); // largeur réservée : l'heure n'est jamais coupée
    box.centerAlignContent();
  }
  fill(box, COLORS.waitBg);
  box.cornerRadius = size > 16 ? 5 : 3;
  box.setPadding(size > 16 ? 3 : 2, size > 16 ? 7 : 5, size > 16 ? 3 : 2, size > 16 ? 7 : 5);
  if (width) box.addSpacer();
  const t = label(box, d.cancelled ? "Supp." : hhmm(d.expected), size, d.cancelled ? COLORS.red : COLORS.wait, "mono");
  t.minimumScaleFactor = 0.7;
  if (width) box.addSpacer();
}

// ---------- RER : une direction par bloc ----------
// Titre d'une direction : ses terminus (« Mitry - Claye · Aéroport CDG 2 »)
const directionTitle = (deps) => [...new Set(deps.map((d) => d.destination))].slice(0, 2).join(" · ");

// Deux directions au plus. Les trains sont groupés par voie ; si la gare a plus de deux voies,
// on regroupe par sens (aller / retour).
function twoDirections(groups) {
  if (groups.length <= 2) return groups;
  const bySense = new Map();
  for (const d of groups.flat()) {
    if (!bySense.has(d.direction)) bySense.set(d.direction, []);
    bySense.get(d.direction).push(d);
  }
  return [...bySense.values()].map((deps) => deps.sort((a, b) => a.expected - b.expected)).slice(0, 2);
}

function directionTitleRow(container, deps, compact) {
  const title = container.addStack();
  fill(title, COLORS.head);
  title.setPadding(compact ? 1 : 3, compact ? 8 : 10, compact ? 1 : 3, 6);
  const t = label(title, `→ ${directionTitle(deps)}`, compact ? 9 : 10, COLORS.muted, "semibold");
  t.minimumScaleFactor = 0.7;
  title.addSpacer();
}

// Lignes d'une direction, en version étroite (colonne, petit widget) : destination et heure.
// Pas de retard ici, faute de place (il est dans le grand widget).
function narrowRows(container, deps, maxRows, compact) {
  deps.slice(0, maxRows).forEach((d, i) => {
    const row = container.addStack();
    fill(row, i % 2 ? COLORS.rowAlt : COLORS.row);
    row.setPadding(compact ? 2 : 3, compact ? 8 : 10, compact ? 2 : 3, 6);
    row.centerAlignContent();
    const dest = label(row, d.destination, compact ? 11 : 12, COLORS.ink, "semibold");
    dest.minimumScaleFactor = 0.7;
    row.addSpacer(4);
    row.addSpacer();
    waitBox(row, d, compact ? 11 : 12);
  });
}

// Deux colonnes côte à côte (widget moyen, grand avec plusieurs gares)
function directionColumns(container, groups, rowsPerDirection) {
  const width = Math.floor((Device.screenSize().width - 52) / 2) - 1; // largeur d'un widget moyen
  const columns = container.addStack();
  columns.topAlignContent();
  groups.forEach((deps, i) => {
    if (i) {
      const line = columns.addStack(); // trait vertical entre les deux directions
      line.backgroundColor = DARK ? new Color("#2a2e40") : COLORS.rowAlt;
      line.size = new Size(1, 0);
    }
    const col = columns.addStack();
    col.layoutVertically();
    col.size = new Size(width, 0);
    directionTitleRow(col, deps, false);
    narrowRows(col, deps, rowsPerDirection, false);
  });
}

// Directions l'une sous l'autre (petit widget, grand widget avec une gare)
// Petit widget : le prochain train de la direction (un train supprimé ne prend pas la place),
// avec l'heure en grand
function bigRow(container, deps) {
  const d = deps.find((x) => !x.cancelled) || deps[0];
  // La destination sur sa ligne, l'heure en grand dessous : les deux restent entières
  const block = container.addStack();
  block.layoutVertically();
  fill(block, COLORS.row);
  block.setPadding(3, 8, 4, 6);
  const dest = label(block, d.destination, 11, COLORS.ink, "semibold");
  dest.minimumScaleFactor = 0.75;
  const row = block.addStack();
  row.addSpacer();
  waitBox(row, d, 20); // seule sur sa ligne : le carré prend la largeur du texte, sans coupure
}

function directionStack(container, groups, rowsPerDirection, compact) {
  groups.forEach((deps) => {
    directionTitleRow(container, deps, compact);
    if (compact) bigRow(container, deps);
    else rerRows(container, deps, rowsPerDirection, false);
  });
}

// Écran RER : une ligne par train (mission, destination, retard, heure)
function rerRows(container, deps, maxRows, compact) {
  deps.slice(0, maxRows).forEach((d, i) => {
    const row = container.addStack();
    fill(row, i % 2 ? COLORS.rowAlt : COLORS.row);
    row.setPadding(4, compact ? 8 : 10, 4, 8);
    row.centerAlignContent();
    if (!compact && d.mission) {
      const chip = row.addStack();
      fill(chip, COLORS.mission);
      chip.setPadding(1, 4, 1, 4);
      label(chip, d.mission, 9, DARK ? new Color("#8fb4ff") : Color.white(), "mono");
      row.addSpacer(6);
    }
    const dest = label(row, d.destination, compact ? 11 : 13, COLORS.ink, "semibold");
    dest.minimumScaleFactor = 0.75;
    row.addSpacer();
    if (!compact && !d.cancelled && d.delay >= 2) { // pas la place dans le petit widget
      label(row, `+${d.delay}′`, 10, COLORS.late);
      row.addSpacer(4);
    }
    waitBox(row, d);
  });
}

// Écran métro / bus : une ligne par sens, « → destination » puis les deux prochains passages
function metroRows(container, groups, maxGroups, compact) {
  const body = container.addStack();
  body.layoutVertically();
  fill(body, COLORS.metroBody);
  body.setPadding(compact ? 6 : 10, 10, 6, 10);
  groups.slice(0, maxGroups).forEach((deps, i) => {
    if (i) body.addSpacer(compact ? 6 : 12);
    const next = deps.filter((d) => !d.cancelled);
    if (compact) {
      // Petit widget : la destination sur une ligne, le prochain passage en grand dessous
      const dest = label(body, `→ ${next[0] ? next[0].destination : deps[0].destination}`, 10, COLORS.metroText, "semibold");
      dest.minimumScaleFactor = 0.7;
      const row = body.addStack();
      row.addSpacer();
      label(row, next[0] ? hhmm(next[0].expected) : "--:--", 22, COLORS.wait, "mono");
      return;
    }
    const row = body.addStack();
    row.centerAlignContent();
    const dest = label(row, `→ ${next[0] ? next[0].destination : deps[0].destination}`, 14, COLORS.metroText, "semibold");
    dest.minimumScaleFactor = 0.75;
    row.addSpacer();
    next.slice(0, compact ? 1 : 2).forEach((d, j) => {
      if (j) row.addSpacer(10);
      label(row, hhmm(d.expected), compact ? 13 : 20, COLORS.wait, "mono");
    });
  });
  body.addSpacer();
}

// Écran métro / bus en colonnes (moyen, grand) : une colonne par sens,
// « 1er » et « 2e » côte à côte comme sur l'écran de quai
function metroColumns(container, groups) {
  const width = Math.floor((Device.screenSize().width - 52) / 2) - 1; // largeur d'un widget moyen
  const body = container.addStack();
  fill(body, COLORS.metroBody);
  body.setPadding(18, 0, 12, 0); // contenu plus centré dans la hauteur du widget
  body.topAlignContent();
  groups.slice(0, 2).forEach((deps, i) => {
    if (i) {
      const line = body.addStack(); // trait entre les deux sens
      line.backgroundColor = new Color("#3a3d4d");
      line.size = new Size(1, 0);
    }
    const next = deps.filter((d) => !d.cancelled);
    const col = body.addStack();
    col.layoutVertically();
    col.size = new Size(width, 0);
    col.setPadding(0, 10, 0, 8);
    const dest = label(col, `→ ${next[0] ? next[0].destination : deps[0].destination}`, 11, COLORS.metroText, "semibold");
    dest.minimumScaleFactor = 0.7;
    col.addSpacer(4);
    const cells = col.addStack();
    ["1er", "2e"].forEach((name, k) => {
      if (k) {
        cells.addSpacer(6);
        const sep = cells.addStack(); // trait vertical entre 1er et 2e, comme sur l'écran
        sep.backgroundColor = new Color("#93a4ff");
        sep.size = new Size(1, 34);
        cells.addSpacer(6);
      }
      const cell = cells.addStack();
      cell.layoutVertically();
      label(cell, name, 9, new Color("#93a4ff"), "semibold");
      label(cell, next[k] ? hhmm(next[k].expected) : "--:--", 20, COLORS.wait, "mono");
    });
    cells.addSpacer();
  });
}

function noTrain(container, message, metro) {
  const box = container.addStack();
  fill(box, metro ? COLORS.metroBody : COLORS.row);
  box.setPadding(8, 10, 8, 10);
  label(box, message, 11, metro ? COLORS.metroText : COLORS.ink, "semibold");
  box.addSpacer();
}

// Une gare : bandeau + trains. `rows` = nombre de trains (RER) ou de sens (métro, bus)
// Une gare : bandeau + trains, une partie par direction.
// layout : "columns" (côte à côte) ou "stack" (l'une sous l'autre) ; rows = trains par direction
function station(widget, fav, groups, layout, rows, compact) {
  const w = fav.widget;
  const block = widget.addStack();
  block.layoutVertically();
  header(block, w, compact);
  if (!groups.length) return noTrain(block, "Aucun passage annoncé", w.mode !== "RER");
  if (w.mode === "RER") {
    const directions = twoDirections(groups);
    if (layout === "columns" && directions.length === 2) directionColumns(block, directions, rows);
    else directionStack(block, directions, rows, compact);
  } else {
    if (compact) metroRows(block, groups, 2, true);
    else metroColumns(block, groups);
  }
}

function messageWidget(message) {
  const widget = new ListWidget();
  widget.backgroundColor = DARK ? DARK_BACKGROUND : COLORS.row;
  widget.setPadding(12, 14, 12, 14);
  const t = widget.addText(message);
  t.font = Font.semiboldSystemFont(13);
  t.textColor = COLORS.ink;
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60000);
  return widget;
}

async function buildWidget(family, parameter, apiKey) {
  const saved = await readFavorites();
  if (saved && saved.downloading) {
    const wait = messageWidget("Récupération de tes gares depuis iCloud… Le widget s'affichera au prochain rafraîchissement.");
    wait.refreshAfterDate = new Date(Date.now() + 60000);
    return wait;
  }
  if (!saved) {
    return messageWidget("Exporte tes gares dans l'app (⚙ → Exporter) et enregistre le fichier dans iCloud Drive › Scriptable.");
  }
  const { list, schedule } = saved;
  const now = new Date();
  // Rafraîchissement : toutes les 10 min, ou plus tôt si un créneau commence ou se termine
  const boundary = parameter ? null : nextBoundary(schedule, now);
  const nextRefresh = new Date(Math.min(now.getTime() + REFRESH_MINUTES * 60000, boundary ? boundary.getTime() + 5000 : Infinity));

  const favs = pickFavorites(list, family, parameter, schedule, now);
  if (!favs.length) {
    // Hors créneau avec « ne rien afficher » : aucune requête à l'API
    const idle = messageWidget(nextSlotText(schedule, list, now));
    idle.refreshAfterDate = boundary ? new Date(boundary.getTime() + 5000) : nextRefresh;
    return idle;
  }

  const widget = new ListWidget();
  const firstMode = favs[0].widget.mode;
  widget.backgroundColor = DARK ? DARK_BACKGROUND : firstMode === "RER" ? COLORS.row : COLORS.metroBody;
  widget.setPadding(0, 0, 0, 0);
  widget.refreshAfterDate = nextRefresh;
  const compact = family === "small";
  // Nombre de trains par gare selon la taille du widget et le nombre de gares
  // Disposition et nombre de trains par direction selon la taille du widget
  const layout = family === "small" || (family === "large" && favs.length === 1) ? "stack" : "columns";
  const rows = family === "small" ? 1 : family === "medium" ? 3 : [4, 3, 2][favs.length - 1];
  for (const [i, fav] of favs.entries()) {
    if (i) widget.addSpacer(6);
    try {
      station(widget, fav, await fetchGroups(fav, apiKey), layout, rows, compact);
    } catch (err) {
      const block = widget.addStack();
      block.layoutVertically();
      header(block, fav.widget, compact);
      noTrain(block, err.message || "Pas de connexion", fav.widget.mode !== "RER");
    }
  }
  widget.addSpacer();
  return widget;
}

// ---------- Mise à jour automatique ----------
// Au plus toutes les 6 h (ou à chaque lancement depuis Scriptable), on télécharge le script
// publié. S'il a changé, on remplace ce fichier : la nouvelle version sert dès l'affichage suivant.
async function selfUpdate(force) {
  const key = "prochains_trains_last_update";
  const last = Keychain.contains(key) ? +Keychain.get(key) : 0;
  if (!force && Date.now() - last < UPDATE_EVERY_HOURS * 3600000) return false;
  try {
    const req = new Request(`${SCRIPT_URL}?t=${Date.now()}`);
    req.timeoutInterval = force ? 10 : 4; // dans le widget, on ne s'attarde pas
    const code = await req.loadString();
    Keychain.set(key, String(Date.now()));
    // Garde-fou : on n'écrit que si c'est bien ce script, complet
    if (!(req.response && req.response.statusCode === 200) || !code.includes("Widget « Prochains trains »") || code.length < 5000) return false;
    const fm = FileManager.iCloud();
    const path = module.filename;
    if (fm.readString(path) === code) return false;
    fm.writeString(path, code);
    return true;
  } catch {
    return false; // pas de réseau : on réessaiera plus tard
  }
}

// ---------- Lancement ----------
async function main() {
  const updated = await selfUpdate(!config.runsInWidget);
  if (updated && !config.runsInWidget) {
    const done = new Alert();
    done.title = "Widget mis à jour";
    done.message = "La nouvelle version est installée. Relance le script pour la voir.";
    done.addAction("OK");
    await done.presentAlert();
    return;
  }
  let apiKey = storedKey();
  if (!config.runsInWidget) {
    if (apiKey) {
      const menu = new Alert();
      menu.title = "Prochains trains";
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
  const rawParameter = args.widgetParameter || "";
  DARK = /\bsombre\b/i.test(rawParameter);
  if (DARK) Object.assign(COLORS, DARK_COLORS);
  const parameter = rawParameter.replace(/\bsombre\b/gi, "").trim() || null;
  const widget = apiKey
    ? await buildWidget(family, parameter, apiKey)
    : messageWidget("Ouvre le script dans Scriptable pour entrer ta clé API PRIM.");
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
}

// Si quoi que ce soit plante ou traîne, le widget affiche la raison au lieu de rester vide
try {
  await withTimeout(main(), 25);
} catch (err) {
  const widget = messageWidget(`Widget indisponible : ${err.message || err}. Ouvre le script dans Scriptable pour le relancer.`);
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
}
Script.complete();
