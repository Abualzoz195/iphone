// Affichage façon écran de gare : horloge, prochains trains par sens, info trafic.
import { LINES, STATIONS, DESTINATION_ALIASES, SETTINGS } from "./config.js";
import { fetchDepartures, fetchMessages, PrimError } from "./prim.js";

const $ = (id) => document.getElementById(id);

// --- Stockage local (la clé et la gare choisie restent sur l'appareil) ---
const store = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* navigation privée */ }
  },
};

const state = {
  station: STATIONS.find((s) => s.id === store.get("station")) ?? STATIONS[0],
  departures: [], // [{ lineKey, ...depart }]
  messages: [],
  lastUpdate: null,
  error: null,
};

let departuresTimer = null;
let messagesTimer = null;

// --- Outils d'affichage ---
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const pad = (n) => String(n).padStart(2, "0");
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function lineBadge(line) {
  return `<span class="line-badge" style="--line:${line.color};--line-text:${line.textColor}" aria-label="${line.mode} ${line.name}">
    <span class="line-mode">${escapeHtml(line.mode)}</span><span class="line-name">${escapeHtml(line.name)}</span></span>`;
}

// Ce qu'on affiche à droite : minutes restantes, ou l'heure si c'est loin.
function waitDisplay(dep, now) {
  if (dep.cancelled) return { big: "Supprimé", unit: "", cls: "cancelled" };
  const minutes = Math.floor((dep.expected - now) / 60000);
  if (dep.atStop) return { big: "À quai", unit: "", cls: "now" };
  if (minutes <= 0) return { big: "À l'approche", unit: "", cls: "now" };
  if (minutes >= 60) return { big: hhmm(dep.expected), unit: "", cls: "" };
  return { big: String(minutes), unit: "min", cls: "" };
}

function renderRow(dep, line, now) {
  const wait = waitDisplay(dep, now);
  const destination = DESTINATION_ALIASES[dep.destination] ?? dep.destination;
  const tags = [];
  if (dep.cancelled) tags.push(`<span class="tag tag-red">Supprimé</span>`);
  else if (dep.delayMinutes >= 2) tags.push(`<span class="tag tag-orange">Retard +${dep.delayMinutes} min</span>`);
  else tags.push(`<span class="tag tag-plain">À l'heure</span>`);
  if (dep.longTrain === false) tags.push(`<span class="tag tag-plain">Train court</span>`);

  return `<li class="row ${dep.cancelled ? "is-cancelled" : ""}">
    <div class="row-mission">${escapeHtml(dep.mission || "—")}</div>
    <div class="row-main">
      <div class="row-destination">${escapeHtml(destination)}</div>
      <div class="row-meta">
        <span class="row-time">${hhmm(dep.expected)}</span>
        ${tags.join("")}
      </div>
    </div>
    <div class="row-wait ${wait.cls}">
      <span class="wait-big">${escapeHtml(wait.big)}</span>${wait.unit ? `<span class="wait-unit">${wait.unit}</span>` : ""}
    </div>
    <div class="row-platform" aria-label="Voie ${escapeHtml(dep.platform)}">${escapeHtml(dep.platform || "")}</div>
  </li>`;
}

function render() {
  const now = new Date();
  $("clock").innerHTML = `${hhmm(now)}<span class="clock-seconds">${pad(now.getSeconds())}</span>`;

  const sections = [];
  for (const lineKey of state.station.lines) {
    const line = LINES[lineKey];
    for (const [directionRef, label] of Object.entries(line.directions)) {
      const deps = state.departures
        .filter((d) => d.lineKey === lineKey && d.direction === directionRef)
        .filter((d) => d.expected - now > -60000) // on retire les trains partis
        .slice(0, SETTINGS.trainsPerDirection);

      const rows = deps.length
        ? deps.map((d) => renderRow(d, line, now)).join("")
        : `<li class="row row-empty">${state.lastUpdate ? "Aucun train annoncé" : "Chargement…"}</li>`;

      sections.push(`<section class="direction">
        <h2 class="direction-header">${lineBadge(line)}<span class="direction-label">${escapeHtml(label)}</span><span class="direction-voie">Voie</span></h2>
        <ul class="rows">${rows}</ul>
      </section>`);
    }
  }
  $("directions").innerHTML = sections.join("");

  if (state.lastUpdate) {
    const ago = Math.round((now - state.lastUpdate) / 1000);
    $("updated").textContent = ago < 5 ? "Mis à jour à l'instant" : `Mis à jour il y a ${ago < 60 ? ago + " s" : Math.floor(ago / 60) + " min"}`;
  }

  const notice = $("notice");
  notice.hidden = !state.error;
  notice.textContent = state.error ?? "";
}

function renderTicker() {
  const ticker = $("ticker");
  ticker.hidden = state.messages.length === 0;
  const textEl = $("ticker-text");
  const content = state.messages.map((m) => m.text).join("   •   ");
  if (textEl.dataset.content === content) return; // ne pas relancer l'animation
  textEl.dataset.content = content;
  textEl.textContent = content;
  // Vitesse de défilement constante quelle que soit la longueur du texte
  textEl.style.animationDuration = `${Math.max(15, content.length / 8)}s`;
}

// --- Chargement des données ---
function apiKey() {
  return store.get("prim_apikey") ?? "";
}

function handleError(err) {
  if (err instanceof PrimError && err.kind === "auth") {
    state.error = "Clé API refusée. Vérifie-la dans Réglages.";
  } else if (err instanceof PrimError && err.kind === "network") {
    state.error = "Pas de réseau — nouvel essai dans quelques secondes.";
  } else {
    state.error = err.message || "Erreur inconnue";
  }
}

async function loadDepartures() {
  if (!apiKey()) {
    state.error = "Ajoute ta clé API PRIM dans Réglages pour afficher les trains.";
    render();
    return;
  }
  const station = state.station;
  try {
    const results = await Promise.all(
      station.lines.map(async (lineKey) => {
        const deps = await fetchDepartures(station.monitoringRef, LINES[lineKey].ref, apiKey());
        return deps.map((d) => ({ ...d, lineKey }));
      }),
    );
    if (station !== state.station) return; // la gare a changé pendant le chargement
    state.departures = results.flat();
    state.lastUpdate = new Date();
    state.error = null;
  } catch (err) {
    handleError(err);
  }
  render();
}

async function loadMessages() {
  if (!apiKey()) return;
  try {
    const results = await Promise.all(state.station.lines.map((k) => fetchMessages(LINES[k].ref, apiKey())));
    const unique = new Map(results.flat().map((m) => [m.id, m]));
    state.messages = [...unique.values()];
  } catch {
    // L'info trafic est secondaire : on garde les anciens messages.
  }
  renderTicker();
}

function startPolling() {
  stopPolling();
  loadDepartures();
  loadMessages();
  departuresTimer = setInterval(loadDepartures, SETTINGS.departuresRefreshSeconds * 1000);
  messagesTimer = setInterval(loadMessages, SETTINGS.messagesRefreshSeconds * 1000);
}

function stopPolling() {
  clearInterval(departuresTimer);
  clearInterval(messagesTimer);
}

// --- Gare ---
function selectStation(station) {
  state.station = station;
  state.departures = [];
  state.messages = [];
  state.lastUpdate = null;
  store.set("station", station.id);
  $("station-name").textContent = station.name;
  document.title = `${station.name} — Prochains trains`;
  render();
  renderTicker();
  startPolling();
}

function setupStationPicker() {
  const multiple = STATIONS.length > 1;
  $("station-caret").hidden = !multiple;
  $("station-button").disabled = !multiple;
  $("station-button").addEventListener("click", () => {
    $("station-list").innerHTML = STATIONS.map(
      (s) => `<button type="button" class="station-choice ${s === state.station ? "is-current" : ""}" data-id="${escapeHtml(s.id)}">${escapeHtml(s.name)}</button>`,
    ).join("");
    $("station-dialog").showModal();
  });
  $("station-list").addEventListener("click", (e) => {
    const button = e.target.closest("[data-id]");
    if (!button) return;
    $("station-dialog").close();
    selectStation(STATIONS.find((s) => s.id === button.dataset.id));
  });
}

// --- Réglages (clé API) ---
function setupSettings() {
  const dialog = $("settings-dialog");
  $("settings-button").addEventListener("click", () => {
    $("api-key").value = apiKey();
    dialog.showModal();
  });
  dialog.addEventListener("close", () => {
    if (dialog.returnValue !== "save") return;
    store.set("prim_apikey", $("api-key").value.trim());
    state.error = null;
    startPolling();
  });
}

// --- Démarrage ---
setupStationPicker();
setupSettings();
selectStation(state.station);
setInterval(render, 1000); // horloge et compte à rebours

// Économise la batterie et le quota : pas de requêtes quand l'app est en arrière-plan.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPolling();
  else startPolling();
});

if (!apiKey()) $("settings-button").click();
