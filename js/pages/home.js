// Accueil : carte « Mon trajet », gares favorites avec aperçu repliable, mode Modifier.
import { SETTINGS } from "../config.js";
import { fetchDepartures } from "../prim.js";
import { lineBadge, escapeHtml, destinationHtml } from "../screens.js";
import { tripCardHtml, loadTrip } from "../trip.js";
import { ensureBusStops, hasBusStops } from "../bus.js";
import {
  app, store, apiKey, lineById, stationOf, favorites, toggleFavorite, ICONS, navbar,
  errorText, updateInPlace, platformGroups, stopTimers, addTimers,
} from "../common.js";

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
export const expandedKeys = () => store.get("expandedPreviews", null) ?? favorites().slice(0, 1).map(favKey);
const isExpanded = (key) => expandedKeys().includes(key);
function setExpanded(key, open) {
  const keys = expandedKeys().filter((k) => k !== key);
  if (open) keys.push(key);
  store.set("expandedPreviews", keys);
}

export function toggleFavoritePreview(key) {
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

export function homePage() {
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

export function drawPreviews() {
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

export function startHomePreviews() {
  stopTimers();
  drawPreviews();
  loadPreviews();
  addTimers(
    setInterval(drawPreviews, 5000), // compte à rebours
    setInterval(loadPreviews, SETTINGS.departuresRefreshSeconds * 1000),
  );
}

export const isEditing = () => editing;
export function setEditing(value) {
  editing = value;
}
