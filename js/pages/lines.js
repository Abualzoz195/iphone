// Choix d'une ligne (RER, métro, recherche de bus), d'une gare, et « Autour de moi ».
import { NETWORK } from "../network.js";
import { lineBadge, escapeHtml } from "../screens.js";
import { BUS_LINES, ensureBusStops, hasBusStops, nearbyBusStops } from "../bus.js";
import {
  app, apiKey, lineById, normalize, distanceKm, formatDistance, locate, ICONS, navbar, stationLink, errorText,
} from "../common.js";

export function linesPage() {
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

export function linePage(lineId) {
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

export async function nearbyPage() {
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
