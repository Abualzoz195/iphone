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
const COLORS = {
  bg: new Color("#08123d"),
  text: Color.white(),
  muted: new Color("#a9b5e3"),
  yellow: new Color("#ffd23f"),
  orange: new Color("#ff9f1c"),
  red: new Color("#ff4d5e"),
};
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
async function readFavorites() {
  for (const fm of [FileManager.iCloud(), FileManager.local()]) {
    let dir;
    try { dir = fm.documentsDirectory(); } catch { continue; }
    const files = fm.listContents(dir).filter((n) => /^mes-gares.*\.json$/i.test(n)).sort();
    if (!files.length) continue;
    const path = fm.joinPath(dir, files[files.length - 1]); // le plus récent (date dans le nom)
    if (fm.isFileStoredIniCloud && fm.isFileStoredIniCloud(path) && !fm.isFileDownloaded(path)) {
      await fm.downloadFileFromiCloud(path);
    }
    const data = JSON.parse(fm.readString(path));
    const list = (Array.isArray(data) ? data : data.favorites || []).filter((f) => f.widget && f.widget.lineRef);
    const schedule = (!Array.isArray(data) && data.widgetSchedule) || { slots: [], outside: "first" };
    if (list.length) return { list, schedule };
  }
  return null;
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
    const platform = (c.DeparturePlatformName || c.ArrivalPlatformName || {}).value || "";
    // Comme l'app : par voie pour le RER, par sens pour le métro et le bus
    const key = w.mode === "RER" && platform ? `voie ${platform}` : (j.DirectionRef || {}).value || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
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

// ---------- Dessin ----------
function badge(stack, w) {
  const b = stack.addStack();
  b.backgroundColor = new Color(w.color);
  b.cornerRadius = w.mode === "METRO" ? 9 : 4;
  b.setPadding(1, 5, 1, 5);
  const t = b.addText((w.mode === "BUS" ? "" : w.mode === "METRO" ? "M" : "") + w.code);
  t.font = Font.heavySystemFont(12);
  t.textColor = new Color(w.textColor);
}

function addHeader(container, w, compactHeader) {
  const row = container.addStack();
  row.centerAlignContent();
  badge(row, w);
  row.addSpacer(6);
  const name = row.addText(w.stationName || "Gare");
  name.font = Font.boldSystemFont(compactHeader ? 12 : 14);
  name.textColor = COLORS.text;
  name.lineLimit = 1;
  name.minimumScaleFactor = 0.7;
  row.addSpacer();
}

function addGroup(container, w, deps, maxRows) {
  const col = container.addStack();
  col.layoutVertically();
  const first = deps.find((d) => !d.cancelled) || deps[0];
  const dest = col.addText(`→ ${first.destination}`);
  dest.font = Font.semiboldSystemFont(11);
  dest.textColor = COLORS.muted;
  dest.lineLimit = 1;
  col.addSpacer(2);

  if (w.mode !== "RER") {
    // Métro / bus : « 1er | 2e » en minutes, mis à jour par iOS entre deux rafraîchissements
    const row = col.addStack();
    row.centerAlignContent();
    deps.filter((d) => !d.cancelled).slice(0, 2).forEach((d, i) => {
      if (i) row.addSpacer(8);
      const t = row.addDate(d.expected);
      t.applyRelativeStyle();
      t.font = Font.boldMonospacedSystemFont(14);
      t.textColor = COLORS.yellow;
      t.lineLimit = 1;
    });
    return;
  }
  deps.slice(0, maxRows).forEach((d, i) => {
    if (i) col.addSpacer(2);
    const row = col.addStack();
    row.centerAlignContent();
    const time = row.addText(d.cancelled ? "Supprimé" : hhmm(d.expected));
    time.font = Font.boldMonospacedSystemFont(d.cancelled ? 12 : 14);
    time.textColor = d.cancelled ? COLORS.red : COLORS.yellow;
    if (!d.cancelled && d.delay >= 2) {
      row.addSpacer(3);
      const late = row.addText(`+${d.delay}`);
      late.font = Font.boldSystemFont(11);
      late.textColor = COLORS.orange;
    }
    if (!d.cancelled) {
      row.addSpacer(4);
      const rel = row.addDate(d.expected);
      rel.applyRelativeStyle();
      rel.font = Font.mediumSystemFont(10);
      rel.textColor = COLORS.muted;
      rel.lineLimit = 1;
    }
  });
}

function addStation(widget, fav, groups, family, single) {
  const w = fav.widget;
  addHeader(widget, w, family === "small");
  widget.addSpacer(5);
  if (!groups.length) {
    const none = widget.addText("Aucun passage annoncé");
    none.font = Font.mediumSystemFont(12);
    none.textColor = COLORS.muted;
    return;
  }
  const shown = family === "small" ? groups.slice(0, 1) : groups.slice(0, 2);
  const rows = family === "large" && single ? 4 : family === "large" ? 2 : 3;
  const line = widget.addStack();
  line.topAlignContent();
  shown.forEach((deps, i) => {
    if (i) line.addSpacer(10);
    addGroup(line, w, deps, rows);
  });
}

function messageWidget(message) {
  const widget = new ListWidget();
  widget.backgroundColor = COLORS.bg;
  const t = widget.addText(message);
  t.font = Font.mediumSystemFont(13);
  t.textColor = COLORS.text;
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60000);
  return widget;
}

async function buildWidget(family, parameter, apiKey) {
  const saved = await readFavorites();
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
  widget.backgroundColor = COLORS.bg;
  widget.setPadding(12, 14, 12, 14);
  widget.refreshAfterDate = nextRefresh;
  for (const [i, fav] of favs.entries()) {
    if (i) widget.addSpacer(10);
    try {
      addStation(widget, fav, await fetchGroups(fav, apiKey), family, favs.length === 1);
    } catch (err) {
      addHeader(widget, fav.widget, family === "small");
      const e = widget.addText(err.message || "Pas de connexion");
      e.font = Font.mediumSystemFont(11);
      e.textColor = COLORS.orange;
    }
  }
  widget.addSpacer();
  const updated = widget.addText(`maj ${hhmm(new Date())}`);
  updated.font = Font.mediumSystemFont(9);
  updated.textColor = COLORS.muted;
  updated.rightAlignText();
  return widget;
}

// ---------- Lancement ----------
async function main() {
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
  const widget = apiKey
    ? await buildWidget(family, args.widgetParameter, apiKey)
    : messageWidget("Ouvre le script dans Scriptable pour entrer ta clé API PRIM.");
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
}

await main();
Script.complete();
