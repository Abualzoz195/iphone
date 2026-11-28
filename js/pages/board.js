// Écran de quai : un écran par voie (RER) ou par sens (métro, bus), plan de ligne,
// « Je monte dans ce train » sur le RER.
import { DEFAULT_MESSAGE, SETTINGS } from "../config.js";
import { fetchDepartures, fetchMessages, fetchTrainStops } from "../prim.js";
import { rerScreen, metroScreen, lineBadge, escapeHtml } from "../screens.js";
import { mountLinePlan } from "../lineplan.js";
import { openTripDialog } from "../trip.js";
import { ensureBusStops, hasBusStops } from "../bus.js";
import {
  app, apiKey, lineById, stationOf, isFavorite, toggleFavorite, ICONS, navbar, errorText,
  updateInPlace, platformGroups, stopTimers, addTimers, compact,
} from "../common.js";

// ---------- Écran de quai ----------
const board = {
  line: null,
  station: null,
  departures: [],
  messages: [],
  loaded: false,
  error: null,
  served: new Map(), // train → desserte après cette gare (RER), calculée une fois par train
};

// ---------- Desserte des trains (RER) ----------
// La liste des arrêts d'un train (Navitia, 1 requête par train, gardée en mémoire) dit quelles
// gares il traverse sans s'arrêter. On en tire une phrase courte pour la ligne de l'écran.
const shortStop = (name) => name.replace(/\s*\(.*\)$/, "");

export function servedSummary(stops, stationId) {
  const index = stops.findIndex((s) => s.id === String(stationId));
  if (index < 0) return null;
  const after = stops.slice(index + 1);
  const here = stops[index];
  if (!after.length) return { terminus: true };
  if (here.skipped) return { text: "Sans arrêt dans cette gare", skipsHere: true, direct: true };
  const skipped = after.filter((s) => s.skipped);
  if (!skipped.length) return { text: "Dessert toutes les gares", direct: false };

  const lead = after.findIndex((s) => !s.skipped); // gares sautées juste après celle-ci
  const parts = [];
  if (lead > 0) parts.push(`Direct jusqu'à ${shortStop(after[lead].name)}`);
  const later = after.slice(Math.max(lead, 0)).filter((s) => s.skipped).map((s) => shortStop(s.name));
  if (later.length) parts.push(`${lead > 0 ? "puis sans arrêt à" : "Sans arrêt à"} ${later.join(", ")}`);
  return { text: parts.join(" · "), direct: true };
}

// Va chercher la desserte des trains affichés qui ne l'ont pas encore (4 au plus à la fois)
let servedLoading = false;
async function loadServed(trains) {
  if (servedLoading || !apiKey()) return;
  const { station } = board;
  const missing = trains.filter((t) => !t.terminusHere && !board.served.has(t.id) && /VehicleJourney::/.test(t.id));
  if (!missing.length) return;
  servedLoading = true;
  try {
    for (let i = 0; i < missing.length; i += 4) {
      await Promise.all(missing.slice(i, i + 4).map(async (train) => {
        try {
          const stops = await fetchTrainStops(train.id, apiKey());
          board.served.set(train.id, stops ? servedSummary(stops, station.id) : null);
        } catch {
          // réseau ou quota : la ligne reste sans desserte, on réessaiera au prochain chargement
        }
      }));
      if (board.station !== station) return;
      drawBoard();
    }
  } finally {
    servedLoading = false;
  }
}

async function loadDepartures() {
  const { line, station } = board;
  if (!apiKey()) {
    board.error = "Ajoute ta clé API PRIM dans Réglages (page d'accueil).";
    return drawBoard();
  }
  try {
    const deps = await fetchDepartures(`STIF:StopArea:SP:${station.id}:`, line.ref, apiKey());
    if (board.station !== station) return; // on a changé de gare entre-temps
    board.departures = deps;
    board.loaded = true;
    board.error = null;
  } catch (err) {
    board.error = errorText(err);
  }
  drawBoard();
}

async function loadMessages() {
  if (!apiKey()) return;
  try {
    board.messages = await fetchMessages(board.line.ref, apiKey());
  } catch {
    // info trafic secondaire : on garde les anciens messages
  }
}

function currentMessage(now) {
  const texts = board.messages.map((m) => m.text);
  if (!texts.length) return DEFAULT_MESSAGE;
  return texts[Math.floor(now / 1000 / SETTINGS.messageRotateSeconds) % texts.length];
}

function withServed(dep) {
  const served = board.served.get(dep.id);
  if (!served) return dep;
  if (served.terminus) return { ...dep, terminusHere: true };
  return { ...dep, servedText: served.text, skippedSomewhere: served.direct, skipsHere: served.skipsHere };
}

function drawBoard() {
  const container = document.getElementById("screens");
  if (!container) return;
  const now = new Date();
  const { line } = board;
  const isRer = line.mode === "RER";
  // RER : on garde les trains qui terminent ici (« ne prend pas de voyageurs »), comme en gare
  const groups = platformGroups(line, board.station, board.departures, now, { keepTerminus: isRer })
    .map((deps) => (isRer ? deps.map(withServed) : deps));
  if (!groups.length) groups.push([]); // avant le premier chargement : un écran « Chargement… »
  if (isRer) loadServed(groups.flatMap((deps) => deps.slice(0, SETTINGS.rerRows)));

  const render = line.mode === "RER" ? rerScreen : metroScreen; // le bus reprend l'écran métro
  const message = currentMessage(now);
  const html = groups.map((departures) => render({ line, departures, message, now, loading: !board.loaded })).join("");
  updateInPlace(container, html);

  const notice = document.getElementById("board-error");
  notice.hidden = !board.error;
  notice.textContent = board.error ?? "";
}

export function boardPage(lineId, stationId) {
  const line = lineById(lineId);
  if (line?.mode === "BUS" && !stationOf(line, stationId) && !hasBusStops(line) && apiKey()) {
    app.innerHTML = `<div class="board-page">${navbar(lineBadge(line), { back: "#/", backLabel: "Mes gares" })}<p class="empty" style="margin-top:34px">Chargement de l'arrêt…</p></div>`;
    ensureBusStops(line, apiKey())
      .then(() => location.hash === `#/board/${lineId}/${stationId}` && boardPage(lineId, stationId))
      .catch((err) => { app.querySelector(".empty").textContent = errorText(err); });
    return;
  }
  const station = stationOf(line, stationId);
  if (!station) return (location.hash = "#/");

  Object.assign(board, { line, station, departures: [], messages: [], loaded: false, error: null, served: new Map() });

  const star = () => ICONS.star(isFavorite(line.id, station.id));
  app.innerHTML = `<div class="board-page">
    ${navbar(escapeHtml(station.name), {
      back: "#/",
      backLabel: "Mes gares",
      right: `<button class="glass-btn round nav-star" id="star" aria-label="Favori">${star()}</button>`,
    })}
    <p class="notice" id="board-error" hidden></p>
    <div class="screens" id="screens"></div>
    <section class="line-plan" id="line-plan" hidden></section>
  </div>`;
  document.title = `${station.name} — ${line.mode === "RER" ? "RER" : "Métro"} ${line.code}`;

  document.getElementById("star").addEventListener("click", (e) => {
    toggleFavorite(line.id, station.id);
    e.currentTarget.innerHTML = star();
  });

  mountLinePlan(document.getElementById("line-plan"), line, station.id);

  // RER : toucher un train → « Je monte dans ce train »
  if (line.mode === "RER") {
    document.getElementById("screens").addEventListener("click", (e) => {
      const id = e.target.closest("[data-train]")?.dataset.train;
      const train = board.departures.find((d) => d.id === id);
      if (!train || train.cancelled) return;
      // Un train qui termine ici (ou qui ne s'arrête pas) ne se prend pas
      const served = board.served.get(id);
      if (served?.terminus || served?.skipsHere || compact(train.destination) === compact(station.name)) return;
      openTripDialog({ line, station, train, apiKey: apiKey(), onStart: () => (location.hash = "#/") });
    });
  }
  startBoard();
}

export function startBoard() {
  stopTimers();
  drawBoard();
  loadDepartures();
  loadMessages();
  addTimers(
    setInterval(drawBoard, 5000), // horloge et compte à rebours (les « : » clignotent en CSS)
    setInterval(loadDepartures, SETTINGS.departuresRefreshSeconds * 1000),
    setInterval(loadMessages, SETTINGS.messagesRefreshSeconds * 1000),
  );
}

// Vrai si l'écran de quai est affiché (pour relancer les mises à jour au retour dans l'app)
export const isBoardShown = () => Boolean(board.station) && location.hash.startsWith("#/board");
