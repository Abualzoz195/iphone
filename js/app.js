// Navigation de l'app : accueil (favoris) → ligne → gare → écran de quai.
// Les pages sont repérées par l'adresse après « # » (ex. #/board/RER_B/474151).
import { NETWORK } from "./network.js";
import { DEFAULT_FAVORITES, DEFAULT_MESSAGE, SETTINGS } from "./config.js";
import { fetchDepartures, fetchMessages, PrimError, usageStats, DAILY_QUOTA } from "./prim.js";
import { rerScreen, metroScreen, lineBadge, escapeHtml, destinationHtml } from "./screens.js";
import { mountLinePlan } from "./lineplan.js";
import { openTripDialog, tripCardHtml, loadTrip, endTrip } from "./trip.js";
import { BUS_LINES, ensureBusStops, hasBusStops, nearbyBusStops, rememberStop } from "./bus.js";

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

const ALL_LINES = new Map([...NETWORK, ...BUS_LINES].map((l) => [l.id, l]));
const lineById = (id) => ALL_LINES.get(id);
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

// Barre du haut façon iOS : bouton retour à gauche, titre au centre, actions à droite.
// Icônes (traits SVG, couleur du texte)
const svg = (body, fill = "none") =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  back: svg(`<path d="M15 18l-6-6 6-6"/>`),
  plus: svg(`<path d="M12 5v14M5 12h14"/>`),
  locate: svg(`<path d="M3 11l18-8-8 18-2-8-8-2z"/>`, "currentColor"),
  star: (on) => svg(`<path d="M12 2.8l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.6l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z"/>`, on ? "currentColor" : "none"),
  gear: svg(`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>`),
};

// Barre du haut façon Liquid Glass : boutons en verre flottant, titre au centre.
function navbar(title, { back, backLabel = "Retour", left = "", right = "", border = true } = {}) {
  const backHtml = back ? `<a class="glass-btn round" href="${back}" aria-label="${escapeHtml(backLabel)}">${ICONS.back}</a>` : "";
  return `<header class="navbar ${border ? "has-border" : ""}">
    <div class="nav-left">${backHtml}${left}</div>
    <h1 class="nav-title">${title}</h1>
    <div class="nav-right">${right}</div>
  </header>`;
}

const stationLink = (line, station, extra = "", showBadge = true) => `<a class="list-item" href="#/board/${line.id}/${station.id}">
    ${showBadge ? lineBadge(line) : ""}<span class="list-item-name">${escapeHtml(station.name)}</span>${extra}<span class="chevron">›</span></a>`;

// ---------- Pages ----------
let editing = false; // mode « Modifier » de l'accueil

function favoriteCard(fav, line, station) {
  const key = `${line.id}/${station.id}`;
  if (editing) {
    return `<li class="fav-card glass is-editing" data-key="${key}">
      <button class="fav-delete" data-delete="${key}" aria-label="Retirer ${escapeHtml(station.name)}">−</button>
      ${lineBadge(line)}<span class="fav-name">${escapeHtml(station.name)}</span>
      <span class="drag-handle" aria-label="Déplacer">≡</span>
    </li>`;
  }
  const open = isExpanded(key);
  // Aperçu repliable : replié = aucune requête à l'API pour cette gare
  return `<li class="fav-card glass ${open ? "is-open" : ""}" data-key="${key}">
    <div class="fav-head">
      <a class="fav-link" href="#/board/${key}">${lineBadge(line)}<span class="fav-name">${escapeHtml(station.name)}</span></a>
      <button type="button" class="fav-toggle" data-toggle="${key}" aria-expanded="${open}" aria-label="${open ? "Masquer" : "Afficher"} les prochains trains">${CHEVRON}</button>
    </div>
    <a class="fav-preview-link" href="#/board/${key}" ${open ? "" : "hidden"}><div class="preview" data-preview="${key}"></div></a>
  </li>`;
}

// ---------- Aperçus dépliés / repliés ----------
const CHEVRON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;
const favKey = (f) => `${f.lineId}/${f.stationId}`;
// Par défaut : seul le premier favori est déplié
const expandedKeys = () => store.get("expandedPreviews", null) ?? favorites().slice(0, 1).map(favKey);
const isExpanded = (key) => expandedKeys().includes(key);
function setExpanded(key, open) {
  const keys = expandedKeys().filter((k) => k !== key);
  if (open) keys.push(key);
  store.set("expandedPreviews", keys);
}

function toggleFavoritePreview(key) {
  const open = !isExpanded(key);
  setExpanded(key, open);
  const card = document.querySelector(`.fav-card[data-key="${key}"]`);
  if (!card) return;
  card.classList.toggle("is-open", open);
  const button = card.querySelector(".fav-toggle");
  button.setAttribute("aria-expanded", String(open));
  button.setAttribute("aria-label", `${open ? "Masquer" : "Afficher"} les prochains trains`);
  card.querySelector(".fav-preview-link").hidden = !open;
  if (open) {
    drawPreviews();
    loadPreview(key); // tout de suite, sans attendre le prochain rafraîchissement
  }
}

function homePage() {
  const missingBus = favorites()
    .map((f) => lineById(f.lineId))
    .filter((line) => line?.mode === "BUS" && !hasBusStops(line));
  if (missingBus.length && apiKey()) {
    Promise.all(missingBus.map((line) => ensureBusStops(line, apiKey()).catch(() => {}))).then(() => {
      if (!location.hash || location.hash === "#/" || location.hash === "#") homePage();
    });
  }
  const cards = favorites()
    .map((f) => {
      const line = lineById(f.lineId);
      const station = stationOf(line, f.stationId);
      return line && station ? favoriteCard(f, line, station) : "";
    })
    .join("");

  app.innerHTML = `<div class="page">
    ${navbar("", {
      border: false,
      left: `<button class="glass-btn round" data-action="settings" aria-label="Réglages">${ICONS.gear}</button>`,
      right: cards ? `<button class="glass-btn ${editing ? "is-tinted" : ""}" data-action="edit">${editing ? "OK" : "Modifier"}</button>` : "",
    })}
    <h1 class="large-title">Mes gares</h1>
    <div id="trip-slot"></div>
    ${!apiKey() ? `<p class="notice">Ajoute ta clé API PRIM dans <b>Réglages</b> pour voir les trains.</p>` : ""}
    <ul class="fav-list" id="fav-list">${cards || `<li class="glass empty">Aucune gare. Ajoutes-en une puis touche ☆ sur son écran.</li>`}</ul>
    ${editing ? `<p class="group-footer">Fais glisser ≡ pour changer l'ordre.</p>` : ""}
    ${editing ? "" : `<nav class="toolbar" aria-label="Actions">
      <a class="glass-btn round" href="#/nearby" aria-label="Gares autour de moi">${ICONS.locate}</a>
      <a class="glass-btn is-tinted" href="#/lines">Ajouter une gare</a>
    </nav>`}
  </div>`;

  const list = document.getElementById("fav-list");
  if (editing) enableReorder(list);
  else startHomePreviews();
}

// Déplacer les favoris au doigt (ou à la souris) par leur poignée ≡
function enableReorder(list) {
  list.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".drag-handle");
    if (!handle) return;
    e.preventDefault();
    const item = handle.closest(".fav-card");
    item.classList.add("dragging");

    const onMove = (ev) => {
      const others = [...list.querySelectorAll(".fav-card:not(.dragging)")];
      const before = others.find((el) => {
        const box = el.getBoundingClientRect();
        return ev.clientY < box.top + box.height / 2;
      });
      if (before && before !== item.nextElementSibling) list.insertBefore(item, before);
      else if (!before && list.lastElementChild !== item) list.appendChild(item);
    };
    const onEnd = () => {
      item.classList.remove("dragging");
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onEnd);
      document.removeEventListener("pointercancel", onEnd);
      const order = [...list.querySelectorAll(".fav-card")].map((el) => {
        const [lineId, stationId] = el.dataset.key.split("/");
        return { lineId, stationId };
      });
      store.set("favorites", order);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onEnd);
    document.addEventListener("pointercancel", onEnd);
  });

  list.addEventListener("click", (e) => {
    const key = e.target.closest("[data-delete]")?.dataset.delete;
    if (!key) return;
    const [lineId, stationId] = key.split("/");
    toggleFavorite(lineId, stationId);
    if (!favorites().length) editing = false;
    homePage();
  });
}

// ---------- Aperçu des prochains trains sur l'accueil ----------
const previews = new Map(); // "ligne/gare" → { departures, error }

function previewRow(line, deps, now) {
  const next = deps.filter((d) => !d.cancelled);
  const first = deps[0];
  if (line.mode !== "RER") { // métro et bus : « 1er | 2e »
    const minutes = (d) => (d ? (d.atStop ? 0 : Math.max(0, Math.floor((d.expected - now) / 60000))) : "--");
    return `<div class="pv-row pv-metro">
      <span class="pv-dest">${destinationHtml(next[0]?.destination ?? first.destination)}</span>
      <span class="pv-wait">${minutes(next[0])}<span class="pv-sep"></span>${minutes(next[1])}</span>
    </div>`;
  }
  const min = Math.floor((first.expected - now) / 60000);
  let wait;
  if (first.cancelled) wait = `<span class="pv-wait is-text is-alert">Supp.</span>`;
  else if (first.atStop) wait = `<span class="pv-wait is-text">à quai</span>`;
  else if (min <= 0) wait = `<span class="pv-wait is-text">à l'appr.</span>`;
  else if (min >= 60) wait = `<span class="pv-wait is-text">${hhmmLocal(first.expected)}</span>`;
  else wait = `<span class="pv-wait">${min}<small>min</small></span>`;
  return `<div class="pv-row pv-rer">
    <span class="pv-dest">${first.mission ? `<span class="pv-mission">${escapeHtml(first.mission)}</span>` : ""}${destinationHtml(first.destination)}</span>
    ${wait}
  </div>`;
}
const hhmmLocal = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

function drawPreviews() {
  const now = new Date();
  const tripSlot = document.getElementById("trip-slot");
  if (tripSlot) updateInPlace(tripSlot, tripCardHtml(now));
  for (const el of document.querySelectorAll("[data-preview]")) {
    if (!isExpanded(el.dataset.preview)) continue;
    const [lineId, stationId] = el.dataset.preview.split("/");
    const line = lineById(lineId);
    const station = stationOf(line, stationId);
    const data = previews.get(el.dataset.preview);
    let html;
    if (!apiKey()) html = "";
    else if (!data) html = `<div class="pv-status">Chargement…</div>`;
    else if (data.error) html = `<div class="pv-status">${escapeHtml(data.error)}</div>`;
    else {
      const groups = platformGroups(line, station, data.departures, now);
      html = groups.length ? groups.map((g) => previewRow(line, g, now)).join("") : `<div class="pv-status">Aucun train annoncé</div>`;
    }
    updateInPlace(el, html);
  }
}

async function loadPreview(key) {
  const [lineId, stationId] = key.split("/");
  const line = lineById(lineId);
  if (!stationOf(line, stationId) || !apiKey()) return;
  try {
    const departures = await fetchDepartures(`STIF:StopArea:SP:${stationId}:`, line.ref, apiKey());
    previews.set(key, { departures });
  } catch (err) {
    if (!previews.get(key)?.departures) previews.set(key, { error: errorText(err) });
  }
  drawPreviews();
}

// Seuls les aperçus dépliés interrogent l'API
async function loadPreviews() {
  if (!apiKey()) return;
  loadTrip(apiKey()).then(drawPreviews);
  await Promise.all(favorites().map(favKey).filter(isExpanded).map(loadPreview));
}

function startHomePreviews() {
  stopBoard();
  drawPreviews();
  loadPreviews();
  board.timers.push(
    setInterval(drawPreviews, 5000), // compte à rebours
    setInterval(loadPreviews, SETTINGS.departuresRefreshSeconds * 1000),
  );
}

function linesPage() {
  const grid = (mode) =>
    NETWORK.filter((l) => l.mode === mode)
      .map((l) => `<a class="line-tile" href="#/line/${l.id}" aria-label="${mode === "RER" ? "RER" : "Métro"} ${escapeHtml(l.code)}">${lineBadge(l)}</a>`)
      .join("");

  app.innerHTML = `<div class="page">
    ${navbar("Lignes", { back: "#/", backLabel: "Mes gares" })}
    <h2 class="group-label">RER</h2>
    <div class="line-grid">${grid("RER")}</div>
    <h2 class="group-label">Métro</h2>
    <div class="line-grid">${grid("METRO")}</div>
    <h2 class="group-label">Bus</h2>
    <div class="search-row bus-search">
      <input class="search" id="bus-search" type="search" inputmode="search" placeholder="Numéro de ligne (ex. 197)" autocomplete="off">
    </div>
    <div class="group" id="bus-list"><p class="empty">Tape le numéro d'une ligne parmi les ${BUS_LINES.length} lignes de bus.</p></div>
  </div>`;

  const input = document.getElementById("bus-search");
  const list = document.getElementById("bus-list");
  input.addEventListener("input", () => {
    const q = normalize(input.value.trim());
    if (!q) {
      list.innerHTML = `<p class="empty">Tape le numéro d'une ligne parmi les ${BUS_LINES.length} lignes de bus.</p>`;
      return;
    }
    // Numéro exact d'abord, puis numéros qui commencent par la saisie, puis réseaux
    const score = (l) => (normalize(l.code) === q ? 0 : normalize(l.code).startsWith(q) ? 1 : 2);
    const found = BUS_LINES.filter((l) => normalize(l.code).startsWith(q) || normalize(l.network).includes(q))
      .sort((a, b) => score(a) - score(b))
      .slice(0, 40);
    list.innerHTML =
      found
        .map((l) => `<a class="list-item" href="#/line/${l.id}">${lineBadge(l)}<span class="list-item-name"><span class="bus-network">${escapeHtml(l.network)}</span></span><span class="chevron">›</span></a>`)
        .join("") || `<p class="empty">Aucune ligne trouvée.</p>`;
  });
}

function linePage(lineId) {
  const line = lineById(lineId);
  if (!line) return (location.hash = "#/lines");
  if (line.mode === "BUS" && !hasBusStops(line)) {
    app.innerHTML = `<div class="page">
      ${navbar(lineBadge(line), { back: "#/lines", backLabel: "Lignes" })}
      <p class="empty" style="margin-top:34px">${apiKey() ? "Chargement des arrêts…" : "Ajoute ta clé API PRIM dans Réglages."}</p>
    </div>`;
    if (apiKey()) {
      ensureBusStops(line, apiKey())
        .then(() => location.hash === `#/line/${lineId}` && linePage(lineId))
        .catch((err) => { app.querySelector(".empty").textContent = errorText(err); });
    }
    return;
  }

  app.innerHTML = `<div class="page">
    ${navbar(lineBadge(line), { back: "#/lines", backLabel: "Lignes", right: `<button class="glass-btn round" id="near" aria-label="Trier par distance">${ICONS.locate}</button>` })}
    <div class="search-row" style="margin-top:12px">
      <input class="search" id="search" type="search" placeholder="${line.mode === "BUS" ? "Rechercher un arrêt" : "Rechercher une gare"}" autocomplete="off">
    </div>
    <p class="notice" id="geo-error" hidden></p>
    <div class="group" id="station-list"></div>
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
    ${navbar("Autour de moi", { back: "#/", backLabel: "Mes gares" })}
    <div class="group" id="near-list" style="margin-top:16px"><p class="empty">Localisation en cours…</p></div>
  </div>`;
  const list = document.getElementById("near-list");
  try {
    const position = await locate();
    const all = NETWORK.flatMap((line) => line.stations.map((station) => ({ line, station, km: distanceKm(position, station) })));
    all.sort((a, b) => a.km - b.km);
    let nearby = all.slice(0, 15);
    // Bus : 1 requête Navitia (arrêts à moins de 600 m)
    if (apiKey()) {
      try {
        const buses = await nearbyBusStops(position, apiKey());
        nearby = [...nearby, ...buses].sort((a, b) => a.km - b.km).slice(0, 40);
      } catch { /* sans réseau : RER et métro seulement */ }
    }
    list.innerHTML = nearby
      .map(({ line, station, km }) => stationLink(line, station, `<span class="distance">${formatDistance(km)}</span>`))
      .join("");
  } catch (err) {
    list.innerHTML = `<p class="empty">${escapeHtml(err.message)}</p>`;
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
function updateInPlace(container, html) {
  if (container.lastHtml === html) return;
  container.lastHtml = html;
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

// Trains à venir regroupés par quai, comme les écrans en gare : un groupe par voie pour le RER
// (le sens « Aller/Retour » de l'API n'est pas fiable sur le RER A), par sens pour le métro.
// On retire les trains partis, et au terminus ceux qui finissent leur trajet ici.
function platformGroups(line, station, departures, now) {
  const here = compact(station.name);
  const upcoming = departures.filter((d) => d.expected - now > -30000 && compact(d.destination) !== here);
  const groupOf = (d) => (line.mode === "RER" && d.platform ? `voie ${d.platform}` : d.direction);
  const keys = [...new Set(upcoming.map(groupOf))].sort((x, y) => x.localeCompare(y, "fr", { numeric: true }));
  return keys.map((key) => upcoming.filter((d) => groupOf(d) === key));
}

function drawBoard() {
  const container = document.getElementById("screens");
  if (!container) return;
  const now = new Date();
  const { line } = board;
  const groups = platformGroups(line, board.station, board.departures, now);
  if (!groups.length) groups.push([]); // avant le premier chargement : un écran « Chargement… »

  const render = line.mode === "RER" ? rerScreen : metroScreen; // le bus reprend l'écran métro
  const message = currentMessage(now);
  const html = groups.map((departures) => render({ line, departures, message, now, loading: !board.loaded })).join("");
  updateInPlace(container, html);

  const notice = document.getElementById("board-error");
  notice.hidden = !board.error;
  notice.textContent = board.error ?? "";
}

function boardPage(lineId, stationId) {
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

  Object.assign(board, { line, station, departures: [], messages: [], loaded: false, error: null });

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
      openTripDialog({ line, station, train, apiKey: apiKey(), onStart: () => (location.hash = "#/") });
    });
  }
  startBoard();
}

function startBoard() {
  stopBoard();
  drawBoard();
  loadDepartures();
  loadMessages();
  board.timers.push(
    setInterval(drawBoard, 5000), // horloge et compte à rebours (les « : » clignotent en CSS)
    setInterval(loadDepartures, SETTINGS.departuresRefreshSeconds * 1000),
    setInterval(loadMessages, SETTINGS.messagesRefreshSeconds * 1000),
  );
}

// ---------- Routeur ----------
function route() {
  stopBoard();
  document.title = "Prochains trains";
  const [, page, a, b] = location.hash.split("/");
  if (page) editing = false; // on quitte le mode Modifier en changeant de page
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
  const onBoard = board.station && location.hash.startsWith("#/board");
  const onHome = !location.hash || location.hash === "#/" || location.hash === "#";
  if (document.hidden) stopBoard();
  else if (onBoard) startBoard();
  else if (onHome && !editing) startHomePreviews();
});

// ---------- Réglages ----------
const dialog = document.getElementById("settings-dialog");
app.addEventListener("click", (e) => {
  const toggle = e.target.closest("[data-toggle]");
  if (toggle) toggleFavoritePreview(toggle.dataset.toggle);
  if (e.target.closest("[data-action=end-trip]")) {
    endTrip();
    drawPreviews();
  }
  if (e.target.closest("[data-action=edit]")) {
    editing = !editing;
    homePage();
  }
  if (e.target.closest("[data-action=settings]")) {
    document.getElementById("api-key").value = apiKey();
    showVersion();
    dialog.showModal();
  }
});
dialog.addEventListener("close", () => {
  if (dialog.returnValue !== "save") return;
  try { localStorage.setItem("prim_apikey", document.getElementById("api-key").value.trim()); } catch { /* */ }
  route();
});

route();

// ---------- Export / import des favoris ----------
const favsStatus = (text) => (document.getElementById("favs-status").textContent = text);

document.getElementById("export-favs").addEventListener("click", async () => {
  // Pour les bus, on joint l'arrêt (nom, position) : sur un autre téléphone, un arrêt trouvé via
  // « Autour de moi » n'est pas forcément dans la liste officielle de la ligne.
  const withStops = favorites().map((f) => {
    const line = lineById(f.lineId);
    const station = line?.mode === "BUS" ? stationOf(line, f.stationId) : null;
    return station ? { ...f, station } : f;
  });
  const data = {
    app: "prochains-trains",
    format: 2,
    exportedAt: new Date().toISOString(),
    favorites: withStops,
    expandedPreviews: expandedKeys(), // aperçus dépliés
  };
  const name = `mes-gares-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(data, null, 2)], name, { type: "application/json" });
  try {
    // Sur iPhone : feuille de partage (Fichiers, AirDrop, Messages…)
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "Mes gares" });
    } else {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(file);
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
    }
    favsStatus(`${data.favorites.length} gare(s) exportée(s).`);
  } catch (err) {
    if (err.name !== "AbortError") favsStatus("Export impossible : " + err.message);
  }
});

document.getElementById("import-favs").addEventListener("click", () => document.getElementById("import-file").click());

document.getElementById("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // permet de réimporter le même fichier
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.favorites;
    if (!Array.isArray(list)) throw new Error("ce fichier ne contient pas de gares");
    // On ne garde que les gares qui existent dans l'app, sans doublon
    const seen = new Set();
    const valid = list.filter((f) => {
      const key = `${f?.lineId}/${f?.stationId}`;
      const line = lineById(f?.lineId);
      // Arrêt de bus joint au fichier : on le mémorise pour pouvoir l'afficher tout de suite
      if (line?.mode === "BUS" && f.station?.id === String(f.stationId) && f.station.name) {
        rememberStop(line.id, { id: f.station.id, name: f.station.name, lat: +f.station.lat || 0, lon: +f.station.lon || 0 });
      }
      const known = stationOf(line, f?.stationId) || (line?.mode === "BUS" && /^\d+$/.test(String(f?.stationId)));
      if (seen.has(key) || !known) return false;
      seen.add(key);
      return true;
    }).map(({ lineId, stationId }) => ({ lineId, stationId }));
    if (!valid.length) throw new Error("aucune gare reconnue dans ce fichier");
    if (!confirm(`Remplacer tes ${favorites().length} gare(s) par les ${valid.length} du fichier ?`)) return;
    store.set("favorites", valid);
    // Aperçus dépliés (fichiers récents) ; sinon, par défaut le premier seulement
    if (Array.isArray(data.expandedPreviews)) {
      const keys = new Set(valid.map((f) => `${f.lineId}/${f.stationId}`));
      store.set("expandedPreviews", data.expandedPreviews.filter((k) => keys.has(k)));
    } else {
      store.set("expandedPreviews", null);
    }
    const skipped = list.length - valid.length;
    favsStatus(`${valid.length} gare(s) importée(s)${skipped ? `, ${skipped} ignorée(s)` : ""}.`);
    route();
  } catch (err) {
    favsStatus("Import impossible : " + err.message);
  }
});

// ---------- Compteur de requêtes (discret, en haut à droite, sur toutes les pages) ----------
// Ligne 1 : requêtes de la dernière minute. Ligne 2 : « Prochains passages » restants
// aujourd'hui (compte local, ≈) et autonomie estimée au débit actuel, app ouverte.
const hud = document.createElement("div");
hud.className = "quota-hud";
hud.setAttribute("aria-hidden", "true");
document.body.appendChild(hud);

function formatDuration(minutes) {
  if (!isFinite(minutes)) return "∞";
  if (minutes < 60) return `${Math.floor(minutes)} min`;
  const h = Math.floor(minutes / 60);
  return h >= 24 ? "> 24 h" : `${h} h ${String(Math.floor(minutes % 60)).padStart(2, "0")}`;
}

function drawHud() {
  const { perMinute, remaining, minutesLeft, usage } = usageStats();
  hud.innerHTML = `<span>${perMinute} req/min</span><span>≈${remaining}/${DAILY_QUOTA} · ${formatDuration(minutesLeft)}</span>`;
  hud.title = `Aujourd'hui (UTC) : passages ${usage.passages}, info trafic ${usage.infotrafic}, Navitia ${usage.navitia}`;
  hud.classList.toggle("is-low", remaining < 150);
}
drawHud();
setInterval(drawHud, 2000);

// ---------- Version, hors connexion et mises à jour (service worker) ----------
// La version affichée est la date de publication de la page sur GitHub Pages :
// plus besoin de numéro de version à changer à la main.
async function showVersion() {
  const el = document.getElementById("app-version");
  try {
    const response = await fetch("index.html", { method: "HEAD", cache: "no-store" });
    const date = new Date(response.headers.get("last-modified"));
    el.textContent = isNaN(date)
      ? "inconnue"
      : date.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    el.textContent = "inconnue (hors connexion)";
  }
  document.getElementById("offline-status").textContent = navigator.serviceWorker?.controller
    ? "disponible hors connexion"
    : "pas encore disponible hors connexion";
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw.js")
    .then((registration) => registration.update()) // vérifie à chaque lancement si sw.js a changé
    .catch(() => { /* navigation privée ou navigateur sans service worker */ });

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "update-available" || document.querySelector(".update-toast")) return;
    const toast = document.createElement("button");
    toast.type = "button";
    toast.className = "update-toast";
    toast.innerHTML = "Nouvelle version disponible · <b>Recharger</b>";
    toast.addEventListener("click", () => location.reload());
    document.body.appendChild(toast);
  });
}
