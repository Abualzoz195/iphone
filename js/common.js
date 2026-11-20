// Outils partagés par les pages : stockage, lignes et gares, favoris, barre du haut,
// mise à jour de l'affichage sur place, regroupement des trains par quai, minuteries.
import { NETWORK } from "./network.js";
import { DEFAULT_FAVORITES } from "./config.js";
import { PrimError } from "./prim.js";
import { lineBadge, escapeHtml } from "./screens.js";
import { BUS_LINES } from "./bus.js";

export const app = document.getElementById("app");

// ---------- Stockage sur l'appareil ----------
export const store = {
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
export function apiKey() {
  try {
    const raw = localStorage.getItem("prim_apikey") ?? "";
    return raw.startsWith('"') ? JSON.parse(raw) : raw;
  } catch {
    return "";
  }
}

const ALL_LINES = new Map([...NETWORK, ...BUS_LINES].map((l) => [l.id, l]));
export const lineById = (id) => ALL_LINES.get(id);
export const stationOf = (line, stationId) => line?.stations.find((s) => s.id === stationId);

// ---------- Favoris ----------
export const favorites = () => store.get("favorites", DEFAULT_FAVORITES);
export const isFavorite = (lineId, stationId) => favorites().some((f) => f.lineId === lineId && f.stationId === stationId);
export function toggleFavorite(lineId, stationId) {
  const list = favorites();
  const next = isFavorite(lineId, stationId)
    ? list.filter((f) => !(f.lineId === lineId && f.stationId === stationId))
    : [...list, { lineId, stationId }];
  store.set("favorites", next);
}

// ---------- Outils ----------
export const normalize = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const compact = (s) => normalize(s).replace(/[^a-z0-9]/g, ""); // « Massy - Palaiseau » = « Massy-Palaiseau »

export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
export const formatDistance = (km) => (km < 1 ? `${Math.round(km * 1000 / 10) * 10} m` : `${km.toFixed(1).replace(".", ",")} km`);

export function locate() {
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
export const ICONS = {
  back: svg(`<path d="M15 18l-6-6 6-6"/>`),
  plus: svg(`<path d="M12 5v14M5 12h14"/>`),
  locate: svg(`<path d="M3 11l18-8-8 18-2-8-8-2z"/>`, "currentColor"),
  star: (on) => svg(`<path d="M12 2.8l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.6l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z"/>`, on ? "currentColor" : "none"),
  gear: svg(`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>`),
};

// Barre du haut façon Liquid Glass : boutons en verre flottant, titre au centre.
export function navbar(title, { back, backLabel = "Retour", left = "", right = "", border = true } = {}) {
  const backHtml = back ? `<a class="glass-btn round" href="${back}" aria-label="${escapeHtml(backLabel)}">${ICONS.back}</a>` : "";
  return `<header class="navbar ${border ? "has-border" : ""}">
    <div class="nav-left">${backHtml}${left}</div>
    <h1 class="nav-title">${title}</h1>
    <div class="nav-right">${right}</div>
  </header>`;
}

export const stationLink = (line, station, extra = "", showBadge = true) => `<a class="list-item" href="#/board/${line.id}/${station.id}">
    ${showBadge ? lineBadge(line) : ""}<span class="list-item-name">${escapeHtml(station.name)}</span>${extra}<span class="chevron">›</span></a>`;

export function errorText(err) {
  if (err instanceof PrimError && err.kind === "auth") return "Clé API refusée. Vérifie-la dans Réglages (page d'accueil).";
  if (err instanceof PrimError && err.kind === "network") return "Pas de réseau — nouvel essai dans quelques secondes.";
  return err.message || "Erreur inconnue";
}

// Met à jour l'affichage sans remplacer les éléments existants : on ne change que les textes
// et attributs différents. Sur iPhone, remplacer l'élément sous le doigt annule le défilement.
export function updateInPlace(container, html) {
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
export function platformGroups(line, station, departures, now) {
  const here = compact(station.name);
  const upcoming = departures.filter((d) => d.expected - now > -30000 && compact(d.destination) !== here);
  const groupOf = (d) => (line.mode === "RER" && d.platform ? `voie ${d.platform}` : d.direction);
  const keys = [...new Set(upcoming.map(groupOf))].sort((x, y) => x.localeCompare(y, "fr", { numeric: true }));
  return keys.map((key) => upcoming.filter((d) => groupOf(d) === key));
}

// ---------- Minuteries de la page affichée (arrêtées en changeant de page) ----------
let timers = [];
export function stopTimers() {
  timers.forEach(clearInterval);
  timers = [];
}
export function addTimers(...ids) {
  timers.push(...ids);
}
