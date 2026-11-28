// Rendu HTML des deux types d'écrans de quai : RER (liste de trains) et métro (1er / 2e métro).
import { DESTINATION_ALIASES, AIRPORTS, SETTINGS } from "./config.js";

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const pad = (n) => String(n).padStart(2, "0");
export const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const minutesUntil = (date, now) => Math.floor((date - now) / 60000);

// Horloge « 9:53 » avec deux-points qui clignotent
function clock(now, extraClass = "") {
  return `<div class="screen-clock ${extraClass}">${now.getHours()}<span class="clock-colon">:</span>${pad(now.getMinutes())}</div>`;
}

export function lineBadge(line, size = "") {
  const style = `--line:${line.color};--line-text:${line.textColor}`;
  if (line.mode === "METRO") {
    return `<span class="badge badge-metro ${size}" style="${style}"><span class="badge-mode">M</span><span class="badge-line ${line.code.length > 2 ? "is-long" : ""}">${escapeHtml(line.code)}</span></span>`;
  }
  if (line.mode === "BUS") {
    return `<span class="badge badge-bus ${size}" style="${style}"><span class="badge-mode">BUS</span><span class="badge-line ${line.code.length > 3 ? "is-long" : ""}">${escapeHtml(line.code)}</span></span>`;
  }
  return `<span class="badge badge-rer ${size}" style="${style}"><span class="badge-mode">RER</span><span class="badge-line">${escapeHtml(line.code)}</span></span>`;
}

export function destinationHtml(raw) {
  const name = DESTINATION_ALIASES[raw] ?? raw;
  const airport = AIRPORTS.find((a) => a.match.test(raw));
  const chip = airport ? ` <span class="airport-chip"><span class="airport-plane">✈</span>${airport.code}</span>` : "";
  return `<span class="dest-name">${escapeHtml(name)}</span>${chip}`;
}

function infoBar(message, line, extraClass = "") {
  return `<footer class="screen-info ${extraClass}">
    <div class="info-side"><span class="info-icon">i</span>${lineBadge(line, "tiny")}</div>
    <p class="info-text">${escapeHtml(message)}</p>
  </footer>`;
}

// ---------- Écran RER ----------
function rerWait(dep, now) {
  if (dep.passing) return `<span class="wait-text is-passing">Sans<br>arrêt</span>`;
  if (dep.cancelled) return `<span class="wait-text is-alert">Supp.</span>`;
  if (dep.atStop) return `<span class="wait-text">à quai</span>`;
  const min = minutesUntil(dep.expected, now);
  if (min <= 0) return `<span class="wait-text">à l'appr.</span>`;
  if (min >= 60) return `<span class="wait-text">${hhmm(dep.expected)}</span>`;
  return `<span class="wait-num">${min}</span><span class="wait-unit">min</span>`;
}

function rerRow(dep, now) {
  const notes = [];
  if (dep.terminusHere) notes.push(`<span class="row-note">Terminus</span>`);
  else if (dep.cancelled) notes.push(`<span class="row-note is-alert">Supprimé</span>`);
  else if (dep.delayMinutes >= 2) notes.push(`<span class="row-note is-alert">Retard +${dep.delayMinutes}'</span>`);
  if (dep.platform) notes.push(`<span class="row-voie">Voie <b>${escapeHtml(dep.platform)}</b></span>`);

  // data-train : toucher la ligne ouvre « Je monte dans ce train »
  // Desserte sous la destination : « Dessert toutes les gares », « Direct jusqu'à … »,
  // ou « Terminus – ne prend pas de voyageurs » pour un train qui finit sa course ici
  const stops = dep.terminusHere ? "Terminus · ne prend pas de voyageurs" : dep.servedText || "";
  return `<li class="rer-row ${dep.cancelled ? "is-cancelled" : ""} ${dep.terminusHere ? "is-terminus" : ""} ${dep.skipsHere ? "is-skipping" : ""}" data-train="${escapeHtml(dep.id)}">
    <span class="rer-mission">${escapeHtml(dep.mission || "")}</span>
    <span class="rer-dest-cell">
      <span class="rer-dest">${destinationHtml(dep.destination)}</span>
      ${stops ? `<span class="rer-stops ${dep.skippedSomewhere ? "is-direct" : ""}">${escapeHtml(stops)}</span>` : ""}
    </span>
    <span class="rer-wait">${rerWait(dep, now)}</span>
    <span class="rer-notes">${notes.join("")}</span>
  </li>`;
}

export function rerScreen({ line, departures, message, now, loading }) {
  const rows = departures.slice(0, SETTINGS.rerRows);
  // L'en-tête liste les terminus desservis depuis ce quai, comme en gare
  const terminus = [...new Set(departures.filter((d) => !d.terminusHere).map((d) => d.destination))].slice(0, 2);
  const head = terminus.length
    ? terminus.map((t) => `<div class="head-dest-line">${destinationHtml(t)}</div>`).join("")
    : `<div class="head-dest-line">${loading ? "Chargement…" : "Aucun train annoncé"}</div>`;

  const emptyRows = Array.from({ length: SETTINGS.rerRows - rows.length }, () => `<li class="rer-row is-empty"></li>`);

  return `<section class="screen rer-screen">
    <header class="rer-head">
      ${lineBadge(line, "big")}
      <div class="head-dest">${head}</div>
      ${clock(now)}
    </header>
    <ol class="rer-rows">${rows.map((d) => rerRow(d, now)).join("")}${emptyRows.join("")}</ol>
    ${infoBar(message, line)}
  </section>`;
}

// ---------- Écran métro ----------
function metroCell(label, dep, now) {
  let value = "--";
  if (dep) value = dep.atStop ? "0" : String(Math.max(0, minutesUntil(dep.expected, now)));
  return `<div class="metro-cell">
    <span class="metro-label">${label}</span>
    <span class="metro-num ${value.length > 2 ? "is-small" : ""}">${value}</span>
  </div>`;
}

export function metroScreen({ line, departures, message, now, loading }) {
  const next = departures.filter((d) => !d.cancelled);
  const vehicle = line.mode === "BUS" ? "bus" : "métro"; // l'écran métro sert aussi pour les bus
  const destination = next[0]?.destination ?? (loading ? "Chargement…" : `Aucun ${vehicle} annoncé`);

  return `<section class="screen metro-screen">
    <header class="metro-head">
      ${lineBadge(line, "big")}
      <span class="metro-dest">${destinationHtml(destination)}</span>
      ${clock(now, "is-metro")}
    </header>
    <div class="metro-body">
      ${metroCell(`1<sup>er</sup> ${vehicle}`, next[0], now)}
      <span class="metro-sep" aria-hidden="true"></span>
      ${metroCell(`2<sup>e</sup> ${vehicle}`, next[1], now)}
    </div>
    ${infoBar(message, line, "is-metro")}
  </section>`;
}
