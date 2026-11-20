// Navigation de l'app : accueil (favoris) → ligne → gare → écran de quai.
// Les pages sont repérées par l'adresse après « # » (ex. #/board/RER_B/474151).
import { NETWORK } from "./network.js";
import { DEFAULT_FAVORITES, DEFAULT_MESSAGE, SETTINGS } from "./config.js";
import { fetchDepartures, fetchMessages, PrimError } from "./prim.js";
import { rerScreen, metroScreen, lineBadge, escapeHtml } from "./screens.js";
import { mountLinePlan } from "./lineplan.js";

const app = document.getElementById("app");

// ---------- Stockage sur l'appareil ----------
const store = {
  get(key, fallback = null) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* navigation privée */ }
  },
};

// La 1re version stockait la clé en texte brut : on la relit telle quelle si besoin.
function apiKey() {
  try {
    const raw = localStorage.getItem("prim_apikey") ?? "";
    return raw.startsWith('"') ? JSON.parse(raw) : raw;
  } catch {
    return "";
  }
}

const lineById = (id) => NETWORK.find((l) => l.id === id);
const stationOf = (line, stationId) => line?.stations.find((s) => s.id === stationId);

// ---------- Favoris ----------
const favorites = () => store.get("favorites", DEFAULT_FAVORITES);
const isFavorite = (lineId, stationId) => favorites().some((f) => f.lineId === lineId && f.stationId === stationId);
function toggleFavorite(lineId, stationId) {
  const list = favorites();
  const next = isFavorite(lineId, stationId)
    ? list.filter((f) => !(f.lineId === lineId && f.stationId === stationId))
    : [...list, { lineId, stationId }];
  store.set("favorites", next);
}

// ---------- Outils ----------
const normalize = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const compact = (s) => normalize(s).replace(/[^a-z0-9]/g, ""); // « Massy - Palaiseau » = « Massy-Palaiseau »

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
const formatDistance = (km) => (km < 1 ? `${Math.round(km * 1000 / 10) * 10} m` : `${km.toFixed(1).replace(".", ",")} km`);

function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Localisation non disponible"));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => reject(new Error("Localisation refusée. Autorise-la dans Réglages → Safari → Position.")),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

function topbar(title, { back, right = "" } = {}) {
  return `<header class="topbar">
    ${back ? `<a class="topbar-back" href="${back}" aria-label="Retour">‹</a>` : ""}
    <h1 class="topbar-title">${title}</h1>
    ${right}
  </header>`;
}

const stationLink = (line, station, extra = "", showBadge = true) => `<a class="list-item" href="#/board/${line.id}/${station.id}">
    ${showBadge ? lineBadge(line) : ""}<span class="list-item-name">${escapeHtml(station.name)}</span>${extra}<span class="chevron">›</span></a>`;

// ---------- Pages ----------
function homePage() {
  const items = favorites()
    .map((f) => {
      const line = lineById(f.lineId);
      const station = stationOf(line, f.stationId);
      return line && station ? stationLink(line, station) : "";
    })
    .join("");

  app.innerHTML = `<div class="page">
    ${topbar("Mes gares", { right: `<button class="topbar-action" data-action="settings">Réglages</button>` })}
    ${!apiKey() ? `<p class="notice">Ajoute ta clé API PRIM dans <b>Réglages</b> pour voir les trains.</p>` : ""}
    <h2 class="section-title">Favoris</h2>
    <div class="list">${items || `<p class="empty">Aucun favori. Ajoute une gare puis touche ★ sur son écran.</p>`}</div>
    <div class="actions">
      <a class="button" href="#/lines">Choisir une ligne</a>
      <a class="button secondary" href="#/nearby">📍 Gares autour de moi</a>
    </div>
  </div>`;
}

function linesPage() {
  const grid = (mode) =>
    NETWORK.filter((l) => l.mode === mode)
      .map((l) => `<a class="line-tile" href="#/line/${l.id}" aria-label="${mode === "RER" ? "RER" : "Métro"} ${escapeHtml(l.code)}">${lineBadge(l)}</a>`)
      .join("");

  app.innerHTML = `<div class="page">
    ${topbar("Choisir une ligne", { back: "#/" })}
    <h2 class="section-title">RER</h2>
    <div class="line-grid">${grid("RER")}</div>
    <h2 class="section-title">Métro</h2>
    <div class="line-grid">${grid("METRO")}</div>
  </div>`;
}

function linePage(lineId) {
  const line = lineById(lineId);
  if (!line) return (location.hash = "#/lines");

  app.innerHTML = `<div class="page">
    ${topbar(`${lineBadge(line)} <span>Choisir une gare</span>`, { back: "#/lines" })}
    <div class="search-row">
      <input class="search" id="search" type="search" placeholder="Rechercher une gare" autocomplete="off">
      <button class="button secondary small" id="near">📍 Proche</button>
    </div>
    <p class="notice" id="geo-error" hidden></p>
    <div class="list" id="station-list"></div>
  </div>`;

  let position = null;
  const list = document.getElementById("station-list");
  const draw = () => {
    const query = normalize(document.getElementById("search").value);
    let stations = line.stations
      .filter((s) => normalize(s.name).includes(query))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
    if (position) stations = [...stations].sort((a, b) => distanceKm(position, a) - distanceKm(position, b));
    list.innerHTML =
      stations
        .map((s) => stationLink(line, s, position ? `<span class="distance">${formatDistance(distanceKm(position, s))}</span>` : "", false))
        .join("") || `<p class="empty">Aucune gare trouvée.</p>`;
  };
  document.getElementById("search").addEventListener("input", draw);
  document.getElementById("near").addEventListener("click", async () => {
    const error = document.getElementById("geo-error");
    try {
      position = await locate();
      error.hidden = true;
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
    draw();
  });
  draw();
}

async function nearbyPage() {
  app.innerHTML = `<div class="page">
    ${topbar("Autour de moi", { back: "#/" })}
    <div class="list" id="near-list"><p class="empty">Localisation en cours…</p></div>
  </div>`;
  const list = document.getElementById("near-list");
  try {
    const position = await locate();
    const all = NETWORK.flatMap((line) => line.stations.map((station) => ({ line, station, km: distanceKm(position, station) })));
    all.sort((a, b) => a.km - b.km);
    list.innerHTML = all
      .slice(0, 15)
      .map(({ line, station, km }) => stationLink(line, station, `<span class="distance">${formatDistance(km)}</span>`))
      .join("");
  } catch (err) {
    list.innerHTML = `<p class="notice">${escapeHtml(err.message)}</p>`;
  }
}

// ---------- Écran de quai ----------
const board = {
  line: null,
  station: null,
  departures: [],
  messages: [],
  loaded: false,
  error: null,
  timers: [],
};

function stopBoard() {
  board.timers.forEach(clearInterval);
  board.timers = [];
}

function errorText(err) {
  if (err instanceof PrimError && err.kind === "auth") return "Clé API refusée. Vérifie-la dans Réglages (page d'accueil).";
  if (err instanceof PrimError && err.kind === "network") return "Pas de réseau — nouvel essai dans quelques secondes.";
  return err.message || "Erreur inconnue";
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

// Met à jour l'affichage sans remplacer les éléments existants : on ne change que les textes
// et attributs différents. Sur iPhone, remplacer l'élément sous le doigt annule le défilement.
let lastBoardHtml = "";
function updateInPlace(container, html) {
  if (html === lastBoardHtml && container.childNodes.length) return;
  lastBoardHtml = html;
  const next = document.createElement("div");
  next.innerHTML = html;
  morphChildren(container, next);
}

function morphChildren(current, next) {
  const oldNodes = [...current.childNodes];
  const newNodes = [...next.childNodes];
  newNodes.forEach((newNode, i) => {
    const oldNode = oldNodes[i];
    if (!oldNode) current.appendChild(newNode);
    else if (oldNode.nodeType !== newNode.nodeType || oldNode.nodeName !== newNode.nodeName) current.replaceChild(newNode, oldNode);
    else if (newNode.nodeType === Node.TEXT_NODE) {
      if (oldNode.nodeValue !== newNode.nodeValue) oldNode.nodeValue = newNode.nodeValue;
    } else if (newNode.nodeType === Node.ELEMENT_NODE) {
      for (const { name } of [...oldNode.attributes]) if (!newNode.hasAttribute(name)) oldNode.removeAttribute(name);
      for (const { name, value } of [...newNode.attributes]) if (oldNode.getAttribute(name) !== value) oldNode.setAttribute(name, value);
      morphChildren(oldNode, newNode);
    }
  });
  for (let i = oldNodes.length - 1; i >= newNodes.length; i--) oldNodes[i].remove();
}

function drawBoard() {
  const container = document.getElementById("screens");
  if (!container) return;
  const now = new Date();
  const { line } = board;
  // On retire les trains partis, et au terminus ceux qui finissent leur trajet ici.
  const here = compact(board.station.name);
  const upcoming = board.departures.filter((d) => d.expected - now > -30000 && compact(d.destination) !== here);

  // Un écran par quai, comme en gare. Le RER est regroupé par voie (le sens « Aller/Retour »
  // de l'API n'est pas toujours fiable sur le RER A) ; le métro par sens.
  const groupOf = (d) => (line.mode === "RER" && d.platform ? `voie ${d.platform}` : d.direction);
  const groups = [...new Set(upcoming.map(groupOf))].sort((x, y) => x.localeCompare(y, "fr", { numeric: true }));
  if (!groups.length) groups.push(null); // avant le premier chargement : un écran « Chargement… »

  const render = line.mode === "METRO" ? metroScreen : rerScreen;
  const message = currentMessage(now);
  const html = groups
    .map((group) => render({ line, departures: upcoming.filter((d) => group === null || groupOf(d) === group), message, now, loading: !board.loaded }))
    .join("");
  updateInPlace(container, html);

  const notice = document.getElementById("board-error");
  notice.hidden = !board.error;
  notice.textContent = board.error ?? "";
}

function boardPage(lineId, stationId) {
  const line = lineById(lineId);
  const station = stationOf(line, stationId);
  if (!station) return (location.hash = "#/");

  Object.assign(board, { line, station, departures: [], messages: [], loaded: false, error: null });

  const star = () => (isFavorite(line.id, station.id) ? "★" : "☆");
  app.innerHTML = `<div class="board-page">
    ${topbar(escapeHtml(station.name), {
      back: "#/",
      right: `<button class="topbar-star" id="star" aria-label="Favori">${star()}</button>`,
    })}
    <p class="notice" id="board-error" hidden></p>
    <div class="screens" id="screens"></div>
    <section class="line-plan" id="line-plan" hidden></section>
  </div>`;
  document.title = `${station.name} — ${line.mode === "RER" ? "RER" : "Métro"} ${line.code}`;

  document.getElementById("star").addEventListener("click", (e) => {
    toggleFavorite(line.id, station.id);
    e.currentTarget.textContent = star();
  });

  mountLinePlan(document.getElementById("line-plan"), line);
  startBoard();
}

function startBoard() {
  stopBoard();
  drawBoard();
  loadDepartures();
  loadMessages();
  board.timers.push(
    setInterval(drawBoard, 1000), // horloge et compte à rebours
    setInterval(loadDepartures, SETTINGS.departuresRefreshSeconds * 1000),
    setInterval(loadMessages, SETTINGS.messagesRefreshSeconds * 1000),
  );
}

// ---------- Routeur ----------
function route() {
  stopBoard();
  document.title = "Prochains trains";
  const [, page, a, b] = location.hash.split("/");
  if (page === "lines") linesPage();
  else if (page === "line") linePage(a);
  else if (page === "nearby") nearbyPage();
  else if (page === "board") boardPage(a, b);
  else homePage();
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);

// Pas de requêtes quand l'app est en arrière-plan (batterie et quota)
document.addEventListener("visibilitychange", () => {
  if (!board.station || !location.hash.startsWith("#/board")) return;
  if (document.hidden) stopBoard();
  else startBoard();
});

// ---------- Réglages ----------
const dialog = document.getElementById("settings-dialog");
app.addEventListener("click", (e) => {
  if (e.target.closest("[data-action=settings]")) {
    document.getElementById("api-key").value = apiKey();
    dialog.showModal();
  }
});
dialog.addEventListener("close", () => {
  if (dialog.returnValue !== "save") return;
  try { localStorage.setItem("prim_apikey", document.getElementById("api-key").value.trim()); } catch { /* */ }
  route();
});

route();
