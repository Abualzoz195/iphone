// « Je monte dans ce train » (RER uniquement).
//
// 1. Arrêts du train : on récupère la liste ordonnée des arrêts de CE train (Navitia, horaires
//    prévus, gares sans arrêt signalées). La fenêtre ne propose que les gares où il s'arrête.
// 2. Temps réel : on cherche ce même train (identifiant, ou nom comme « ERIO55 ») dans les
//    prochains passages de deux gares seulement (ta gare avant le départ, puis la prochaine
//    gare du train ; et ta destination).
//    Ailleurs, on prend l'horaire prévu + le retard constaté.
// 3. Position : le train est « à quai à X » ou « entre X et Y » selon l'heure estimée à chaque gare.
// Sans liste d'arrêts (train inconnu de Navitia), on se contente du départ et de l'arrivée.
import { NETWORK } from "./network.js?v=20261120-1512";
import { fetchDepartures, fetchTrainStops } from "./prim.js?v=20261120-1512";
import { lineBadge, escapeHtml, hhmm } from "./screens.js?v=20261120-1512";
import { DESTINATION_ALIASES } from "./config.js?v=20261120-1512";

const shortName = (name) => DESTINATION_ALIASES[name] ?? name;

const STORAGE_KEY = "trip";
const END_AFTER_ARRIVAL_MS = 15 * 60000; // la carte disparaît 15 min après l'arrivée

const lineById = (id) => NETWORK.find((l) => l.id === id);
const stationName = (line, id) => line?.stations.find((s) => s.id === id)?.name ?? "";
const monitoringRef = (stationId) => `STIF:StopArea:SP:${stationId}:`;
const normalize = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const minutesUntil = (date, now) => Math.max(0, Math.ceil((date - now) / 60000));

// « 132130 » (heure UTC) → date, le jour le plus proche de `ref` (trains qui passent minuit)
function utcToDate(hhmmss, ref) {
  const h = +hhmmss.slice(0, 2), m = +hhmmss.slice(2, 4), s = +hhmmss.slice(4, 6);
  let best = null;
  for (const dayShift of [-1, 0, 1]) {
    const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate() + dayShift, h, m, s));
    if (!best || Math.abs(d - ref) < Math.abs(best - ref)) best = d;
  }
  return best;
}

// Arrêts desservis (sans les gares traversées), avec horaires prévus en Date
function servedStops(rawStops, ref) {
  return rawStops
    .filter((s) => !s.skipped)
    .map((s) => ({ id: s.id, name: s.name, arrival: utcToDate(s.arrivalUtc, ref), departure: utcToDate(s.departureUtc, ref) }));
}

// ---------- Trajet enregistré sur l'appareil ----------
const toDates = (stops) => stops?.map((s) => ({ ...s, arrival: new Date(s.arrival), departure: new Date(s.departure), live: s.live ? new Date(s.live) : null }));

export function getTrip() {
  try {
    const trip = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!trip) return null;
    return { ...trip, departure: new Date(trip.departure), arrival: new Date(trip.arrival), stops: toDates(trip.stops) };
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
  let stops = null; // arrêts desservis de ce train, si Navitia le connaît

  const trainLine = `<p class="trip-train-info">
      ${train.mission ? `<span class="pv-mission">${escapeHtml(train.mission)}</span>` : ""}
      <span>vers <b>${escapeHtml(shortName(train.destination))}</b> · départ ${hhmm(train.expected)}${train.platform ? ` · voie ${escapeHtml(train.platform)}` : ""}</span>
    </p>`;

  // Gares proposées : celles où ce train s'arrête après ta gare, dans l'ordre ; sinon toute la ligne
  const choices = () => {
    const here = stops?.findIndex((s) => s.id === station.id) ?? -1;
    if (stops && here >= 0) return stops.slice(here + 1).map((s) => ({ id: s.id, name: s.name, time: s.arrival }));
    return line.stations.filter((s) => s.id !== station.id).sort((a, b) => a.name.localeCompare(b.name, "fr"));
  };

  const showPicker = () => {
    dlg.innerHTML = `
      <h2>Je monte dans ce train</h2>
      ${trainLine}
      <input class="search" type="search" placeholder="Ma gare d'arrivée" autocomplete="off">
      <p class="trip-hint">${stops ? "Gares où ce train s'arrête :" : "Chargement des arrêts…"}</p>
      <div class="trip-stations"></div>
      <div class="dialog-actions"><button type="button" class="secondary" data-close>Annuler</button></div>`;
    const input = dlg.querySelector("input");
    const list = dlg.querySelector(".trip-stations");
    const draw = () => {
      const q = normalize(input.value);
      list.innerHTML = choices()
        .filter((s) => normalize(s.name).includes(q))
        .map((s) => `<button type="button" class="trip-station" data-to="${s.id}"><span>${escapeHtml(s.name)}</span>${s.time ? `<small>${hhmm(s.time)}</small>` : ""}</button>`)
        .join("");
    };
    input.addEventListener("input", draw);
    draw();
    return { draw, hint: dlg.querySelector(".trip-hint") };
  };

  const showResult = async (toId) => {
    const toName = stationName(line, toId);
    dlg.innerHTML = `<h2>Je monte dans ce train</h2>${trainLine}<p class="trip-result">Recherche du train à ${escapeHtml(toName)}…</p>`;
    let html;
    try {
      const same = findSameTrain(await fetchDepartures(monitoringRef(toId), line.ref, apiKey), train);
      // Pas encore annoncé là-bas mais on connaît ses arrêts : horaire prévu + retard actuel
      const planned = stops?.find((s) => s.id === toId);
      const here = stops?.find((s) => s.id === station.id);
      const delay = here ? train.expected - here.departure : 0;
      const arrival = same?.arrival ?? (planned ? new Date(planned.arrival.getTime() + delay) : null);

      if (arrival && arrival > train.expected) {
        const minutes = Math.round((arrival - train.expected) / 60000);
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
          arrival: arrival.toISOString(),
          stops: stops?.map((s) => ({ ...s, arrival: s.arrival.toISOString(), departure: s.departure.toISOString() })) ?? null,
          delay,
        };
        html = `<p class="trip-result">Arrivée à <b>${escapeHtml(toName)}</b> à <b>${hhmm(arrival)}</b>${same ? "" : " <small>(horaire prévu)</small>"}</p>
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

  const picker = showPicker();
  dlg.showModal();

  // Arrêts du train en arrière-plan : la liste se resserre sur les gares desservies
  fetchTrainStops(train.id, apiKey)
    .then((raw) => {
      if (raw) stops = servedStops(raw, train.expected);
      if (!dlg.open || !dlg.querySelector(".trip-hint")) return;
      picker.hint.textContent = stops ? "Gares où ce train s'arrête :" : "Toutes les gares de la ligne :";
      picker.draw();
    })
    .catch(() => {
      if (dlg.open && dlg.querySelector(".trip-hint")) picker.hint.textContent = "Toutes les gares de la ligne :";
    });
}

// ---------- Position du train et heures estimées ----------
// Heure estimée d'arrivée à un arrêt : temps réel si connu, sinon prévu + retard constaté
const estimate = (stop, delay) => stop.live ?? new Date(stop.arrival.getTime() + delay);
const estimateDeparture = (stop, delay) =>
  stop.live ? new Date(stop.live.getTime() + (stop.departure - stop.arrival)) : new Date(stop.departure.getTime() + delay);

function trainPosition(trip, now) {
  const stops = trip.stops;
  if (!stops?.length) return null;
  const delay = trip.delay ?? 0;
  const fromIdx = stops.findIndex((s) => s.id === trip.fromId);
  const toIdx = stops.findIndex((s) => s.id === trip.toId);
  // Prochain arrêt où le train n'est pas encore arrivé
  let next = stops.findIndex((s) => estimate(s, delay) > now);
  if (next === -1) next = stops.length;
  const prev = stops[next - 1];
  let where;
  if (next === 0) where = { text: `pas encore parti de ${stops[0].name}`, atStop: false };
  else if (prev && now < estimateDeparture(prev, delay)) where = { text: `à quai à ${prev.name}`, atStop: true };
  else if (next < stops.length) where = { text: `entre ${prev.name} et ${stops[next].name}`, atStop: false };
  else where = { text: `arrivé à ${prev.name}`, atStop: true };

  const upcoming = stops
    .slice(next, (toIdx >= 0 ? toIdx : stops.length - 1) + 1)
    .slice(0, 2)
    .map((s) => ({ ...s, at: estimate(s, delay) }));
  return { where, upcoming, fromIdx, toIdx, next };
}

// ---------- Mise à jour en temps réel du trajet ----------
export async function loadTrip(apiKey) {
  const trip = getTrip();
  if (!trip || !apiKey) return;
  const line = lineById(trip.lineId);
  if (!line) return;
  const now = new Date();
  const lookup = async (stationId) => findSameTrain(await fetchDepartures(monitoringRef(stationId), line.ref, apiKey), trip);
  try {
    // Trajet lancé avant cette version : on récupère ses arrêts une fois
    if (!trip.stops) {
      const raw = await fetchTrainStops(trip.id, apiKey).catch(() => null);
      if (raw) trip.stops = servedStops(raw, trip.departure);
    }

    // Deux gares interrogées par mise à jour (le reste = horaire prévu + retard constaté) :
    //   avant le départ → ta gare (départ, voie) + ta destination
    //   après le départ → la prochaine gare du train + ta destination
    // Si c'est la même gare, une seule requête (cache de fetchDepartures).
    const departed = now >= trip.departure;
    const nextStop = departed ? trainPosition(trip, now)?.upcoming[0] : null;
    const [here, next, there] = await Promise.all([
      departed ? null : lookup(trip.fromId),
      nextStop && nextStop.id !== trip.toId ? lookup(nextStop.id) : null,
      lookup(trip.toId),
    ]);

    if (here) {
      trip.departure = here.expected;
      trip.platform = here.platform || trip.platform;
      const planned = trip.stops?.find((s) => s.id === trip.fromId);
      if (planned) {
        planned.live = here.arrival;
        trip.delay = here.expected - planned.departure;
      }
    }
    if (next) {
      const target = trip.stops.find((s) => s.id === nextStop.id);
      if (target) {
        target.live = next.arrival;
        trip.delay = next.arrival - target.arrival; // dernier retard constaté
      }
    }
    const destination = trip.stops?.find((s) => s.id === trip.toId);
    if (there) {
      trip.arrival = there.arrival;
      if (destination) destination.live = there.arrival;
    } else if (destination) {
      trip.arrival = estimate(destination, trip.delay ?? 0);
    }

    if (getTrip()?.id !== trip.id) return; // trajet terminé entre-temps
    saveTrip({
      ...trip,
      departure: trip.departure.toISOString(),
      arrival: trip.arrival.toISOString(),
      stops: trip.stops?.map((s) => ({ ...s, arrival: s.arrival.toISOString(), departure: s.departure.toISOString(), live: s.live?.toISOString() ?? null })) ?? null,
    });
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

  let big, caption, progress;
  if (now < trip.departure) {
    big = minutesUntil(trip.departure, now);
    caption = `avant le départ${trip.platform ? ` · voie ${escapeHtml(trip.platform)}` : ""}`;
    progress = 0;
  } else if (now < trip.arrival) {
    big = minutesUntil(trip.arrival, now);
    caption = "avant l'arrivée";
    progress = Math.min(100, ((now - trip.departure) / total) * 100);
  } else {
    big = null;
    caption = `Arrivé à ${escapeHtml(to)}`;
    progress = 100;
  }

  // Où est le train, et les deux prochaines gares
  const pos = now < trip.arrival ? trainPosition(trip, now) : null;
  const live = pos
    ? `<div class="trip-live">
        <p class="trip-now"><span class="trip-dot ${pos.where.atStop ? "is-stopped" : ""}"></span>Le train est ${escapeHtml(pos.where.text)}</p>
        ${pos.upcoming.length ? `<ol class="trip-next">${pos.upcoming
          .map((s) => `<li class="${s.id === trip.toId ? "is-destination" : ""}${s.id === trip.fromId ? " is-origin" : ""}">
              <span class="trip-next-name">${escapeHtml(s.name)}${s.id === trip.fromId ? " <small>ta gare</small>" : ""}${s.id === trip.toId ? " <small>ta destination</small>" : ""}</span>
              <span class="trip-next-time"><b>${minutesUntil(s.at, now)} min</b><small>${hhmm(s.at)}${s.live ? "" : " prévu"}</small></span>
            </li>`)
          .join("")}</ol>` : ""}
      </div>`
    : "";

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
    ${live}
    <p class="trip-meta">${trip.mission ? `${escapeHtml(trip.mission)} · ` : ""}vers ${escapeHtml(shortName(trip.terminus))} · ${Math.round(total / 60000)} min de trajet</p>
  </section>`;
}
