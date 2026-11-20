// « Je monte dans ce train » (RER uniquement).
// Algorithme : on cherche CE train précis (même identifiant, ou même nom comme « ERIO55 »)
// dans les prochains passages de la gare d'arrivée. Trajet = arrivée là-bas − départ ici.
// S'il n'y figure pas, c'est qu'il ne s'y arrête pas (mission directe, autre branche)
// ou que son passage n'est pas encore annoncé (l'API voit environ 3 h à l'avance).
import { NETWORK } from "./network.js?v=20261120-1309";
import { fetchDepartures } from "./prim.js?v=20261120-1309";
import { lineBadge, escapeHtml, hhmm } from "./screens.js?v=20261120-1309";
import { DESTINATION_ALIASES } from "./config.js?v=20261120-1309";

const shortName = (name) => DESTINATION_ALIASES[name] ?? name;

const STORAGE_KEY = "trip";
const END_AFTER_ARRIVAL_MS = 15 * 60000; // la carte disparaît 15 min après l'arrivée

const lineById = (id) => NETWORK.find((l) => l.id === id);
const stationName = (line, id) => line?.stations.find((s) => s.id === id)?.name ?? "";
const monitoringRef = (stationId) => `STIF:StopArea:SP:${stationId}:`;
const normalize = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ---------- Trajet enregistré sur l'appareil ----------
export function getTrip() {
  try {
    const trip = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!trip) return null;
    return { ...trip, departure: new Date(trip.departure), arrival: new Date(trip.arrival) };
  } catch {
    return null;
  }
}
function saveTrip(trip) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(trip)); } catch { /* navigation privée */ }
}
export function endTrip() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* */ }
}

// Le même train dans une autre liste de passages
function findSameTrain(departures, train) {
  return (
    departures.find((d) => d.id === train.id) ??
    departures.find((d) => train.trainName && d.trainName === train.trainName)
  );
}

// ---------- Fenêtre « Je monte dans ce train » ----------
let dialog = null;
function getDialog() {
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.className = "trip-dialog";
    document.body.appendChild(dialog);
  }
  return dialog;
}

export function openTripDialog({ line, station, train, apiKey, onStart }) {
  const dlg = getDialog();
  const others = line.stations.filter((s) => s.id !== station.id).sort((a, b) => a.name.localeCompare(b.name, "fr"));

  const trainLine = `<p class="trip-train-info">
      ${train.mission ? `<span class="pv-mission">${escapeHtml(train.mission)}</span>` : ""}
      <span>vers <b>${escapeHtml(shortName(train.destination))}</b> · départ ${hhmm(train.expected)}${train.platform ? ` · voie ${escapeHtml(train.platform)}` : ""}</span>
    </p>`;

  const showPicker = () => {
    dlg.innerHTML = `
      <h2>Je monte dans ce train</h2>
      ${trainLine}
      <input class="search" type="search" placeholder="Ma gare d'arrivée" autocomplete="off">
      <div class="trip-stations"></div>
      <div class="dialog-actions"><button type="button" class="secondary" data-close>Annuler</button></div>`;
    const input = dlg.querySelector("input");
    const list = dlg.querySelector(".trip-stations");
    const draw = () => {
      const q = normalize(input.value);
      list.innerHTML = others
        .filter((s) => normalize(s.name).includes(q))
        .map((s) => `<button type="button" class="trip-station" data-to="${s.id}">${escapeHtml(s.name)}</button>`)
        .join("");
    };
    input.addEventListener("input", draw);
    draw();
  };

  const showResult = async (toId) => {
    const toName = stationName(line, toId);
    dlg.innerHTML = `<h2>Je monte dans ce train</h2>${trainLine}<p class="trip-result">Recherche du train à ${escapeHtml(toName)}…</p>`;
    let html;
    try {
      const atDestination = await fetchDepartures(monitoringRef(toId), line.ref, apiKey);
      const same = findSameTrain(atDestination, train);
      if (same && same.arrival > train.expected) {
        const minutes = Math.round((same.arrival - train.expected) / 60000);
        const trip = {
          lineId: line.id,
          fromId: station.id,
          toId,
          id: train.id,
          trainName: train.trainName,
          mission: train.mission,
          terminus: train.destination,
          platform: train.platform,
          departure: train.expected.toISOString(),
          arrival: same.arrival.toISOString(),
        };
        html = `<p class="trip-result">Arrivée à <b>${escapeHtml(toName)}</b> à <b>${hhmm(same.arrival)}</b></p>
          <p class="trip-duration"><span>${minutes}</span> min de trajet</p>
          <div class="dialog-actions">
            <button type="button" class="secondary" data-back>Autre gare</button>
            <button type="button" data-start>C'est parti</button>
          </div>`;
        dlg.innerHTML = `<h2>Je monte dans ce train</h2>${trainLine}${html}`;
        dlg.querySelector("[data-start]").addEventListener("click", () => {
          saveTrip(trip);
          dlg.close();
          onStart?.();
        });
        return;
      }
      html = `<p class="trip-result">Ce train ne s'arrête pas à <b>${escapeHtml(toName)}</b>, ou son passage n'y est pas encore annoncé.</p>`;
    } catch (err) {
      html = `<p class="trip-result">Impossible de vérifier : ${escapeHtml(err.message)}</p>`;
    }
    dlg.innerHTML = `<h2>Je monte dans ce train</h2>${trainLine}${html}
      <div class="dialog-actions">
        <button type="button" class="secondary" data-close>Annuler</button>
        <button type="button" data-back>Autre gare</button>
      </div>`;
  };

  dlg.onclick = (e) => {
    if (e.target.closest("[data-close]")) dlg.close();
    else if (e.target.closest("[data-back]")) showPicker();
    else {
      const to = e.target.closest("[data-to]")?.dataset.to;
      if (to) showResult(to);
    }
  };

  showPicker();
  dlg.showModal();
}

// ---------- Mise à jour en temps réel du trajet ----------
export async function loadTrip(apiKey) {
  const trip = getTrip();
  if (!trip || !apiKey) return;
  const line = lineById(trip.lineId);
  if (!line) return;
  const now = new Date();
  try {
    // Avant le départ : l'heure de départ peut bouger (retard)
    if (now - trip.departure < 2 * 60000) {
      const here = findSameTrain(await fetchDepartures(monitoringRef(trip.fromId), line.ref, apiKey), trip);
      if (here) {
        trip.departure = here.expected;
        trip.platform = here.platform || trip.platform;
      }
    }
    // L'heure d'arrivée suit le train en temps réel
    const there = findSameTrain(await fetchDepartures(monitoringRef(trip.toId), line.ref, apiKey), trip);
    if (there) trip.arrival = there.arrival;
    if (getTrip()?.id === trip.id) saveTrip({ ...trip, departure: trip.departure.toISOString(), arrival: trip.arrival.toISOString() });
  } catch {
    // pas de réseau : on garde les dernières heures connues
  }
}

// ---------- Carte « Mon trajet » sur l'accueil ----------
export function tripCardHtml(now) {
  const trip = getTrip();
  if (!trip) return "";
  if (now - trip.arrival > END_AFTER_ARRIVAL_MS) {
    endTrip();
    return "";
  }
  const line = lineById(trip.lineId);
  if (!line) return "";
  const from = stationName(line, trip.fromId);
  const to = stationName(line, trip.toId);
  const total = trip.arrival - trip.departure;
  const minutes = (date) => Math.max(0, Math.ceil((date - now) / 60000));

  let big, caption, progress;
  if (now < trip.departure) {
    big = minutes(trip.departure);
    caption = `avant le départ${trip.platform ? ` · voie ${escapeHtml(trip.platform)}` : ""}`;
    progress = 0;
  } else if (now < trip.arrival) {
    big = minutes(trip.arrival);
    caption = "avant l'arrivée";
    progress = Math.min(100, ((now - trip.departure) / total) * 100);
  } else {
    big = null;
    caption = `Arrivé à ${escapeHtml(to)}`;
    progress = 100;
  }

  return `<section class="trip-card">
    <div class="trip-top">
      <span class="trip-label">Mon trajet</span>
      <button type="button" class="trip-end" data-action="end-trip">Terminer</button>
    </div>
    <div class="trip-route">${lineBadge(line)}<span>${escapeHtml(from)} <span class="trip-arrow">→</span> ${escapeHtml(to)}</span></div>
    <div class="trip-main">
      ${big === null ? "" : `<span class="trip-wait"><b>${big}</b><small>min</small></span>`}
      <span class="trip-caption">${caption}</span>
    </div>
    <div class="trip-bar" aria-hidden="true"><i style="width:${progress.toFixed(1)}%"></i></div>
    <div class="trip-times"><span>${hhmm(trip.departure)}</span><span>${hhmm(trip.arrival)}</span></div>
    <p class="trip-meta">${trip.mission ? `${escapeHtml(trip.mission)} · ` : ""}vers ${escapeHtml(shortName(trip.terminus))} · ${Math.round(total / 60000)} min de trajet</p>
  </section>`;
}
