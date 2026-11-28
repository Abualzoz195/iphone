// Appels à l'API PRIM d'Île-de-France Mobilités et lecture des réponses SIRI.
// Doc : https://prim.iledefrance-mobilites.fr

const BASE_URL = "https://prim.iledefrance-mobilites.fr/marketplace";

export class PrimError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // "auth" | "network" | "quota" | "http"
  }
}

// ---------- Compteur de requêtes (quota PRIM : 1 000 / jour et par API) ----------
// L'API ne laisse pas le navigateur lire son compteur officiel : l'app compte donc elle-même
// ses requêtes. Remise à zéro à minuit UTC (1 h ou 2 h du matin à Paris), comme le quota PRIM.
export const DAILY_QUOTA = 1000;
const USAGE_KEY = "primUsage";
const requestLog = []; // horodatage des requêtes de cette session (pour le débit par minute)

const apiOf = (path) =>
  path.startsWith("/stop-monitoring") ? "passages"
  : path.startsWith("/general-message") ? "infotrafic"
  : path.startsWith("/estimated-timetable") ? "ligne" // trains de toute la ligne (quota à part)
  : "navitia";
const utcDay = () => new Date().toISOString().slice(0, 10);

function readUsage() {
  try {
    const usage = JSON.parse(localStorage.getItem(USAGE_KEY));
    if (usage?.day === utcDay()) return usage;
  } catch { /* stockage indisponible */ }
  return { day: utcDay(), passages: 0, infotrafic: 0, navitia: 0, ligne: 0 };
}
function writeUsage(usage) {
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(usage)); } catch { /* */ }
}
function countRequest(api) {
  requestLog.push({ at: Date.now(), api });
  const usage = readUsage();
  usage[api] = (usage[api] ?? 0) + 1;
  writeUsage(usage);
}

// Débit = requêtes de la dernière minute. La fenêtre fait 59 s pour contenir exactement
// deux mises à jour (toutes les 30 s), sans en compter une troisième par effet de bord.
const WINDOW_MS = 59000;
export function usageStats() {
  const now = Date.now();
  while (requestLog.length && now - requestLog[0].at > WINDOW_MS) requestLog.shift();
  const perMinute = requestLog.length;
  const passagesPerMinute = requestLog.filter((r) => r.api === "passages").length;
  const usage = readUsage();
  const remaining = Math.max(0, DAILY_QUOTA - usage.passages);
  return {
    perMinute,
    remaining, // « Prochains passages », le quota qui s'épuise en premier
    minutesLeft: passagesPerMinute > 0 ? remaining / passagesPerMinute : Infinity,
    usage,
  };
}

async function primGet(path, params, apiKey) {
  const url = new URL(BASE_URL + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const api = apiOf(path);
  countRequest(api);

  let response;
  try {
    response = await fetch(url, { headers: { apikey: apiKey, Accept: "application/json" } });
  } catch {
    throw new PrimError("network", "Pas de connexion à l'API PRIM");
  }
  if (response.status === 429) {
    // Quota du jour épuisé : le compteur local se cale sur la réalité
    const usage = readUsage();
    usage[api] = Math.max(usage[api] ?? 0, DAILY_QUOTA);
    writeUsage(usage);
    throw new PrimError("quota", "Quota du jour épuisé (remise à zéro vers 1 h du matin)");
  }
  if (response.status === 401 || response.status === 403) {
    throw new PrimError("auth", "Clé API refusée");
  }
  if (!response.ok) {
    throw new PrimError("http", `Erreur API (${response.status})`);
  }
  return response.json();
}

// Voie : l'API renvoie parfois « unknown » quand elle n'est pas encore attribuée
const knownPlatform = (value) => (value && !/^unknown$/i.test(value) ? value : "");

// SIRI met les textes dans des tableaux [{ value: "..." }].
const text = (field) => (Array.isArray(field) ? field[0]?.value : field?.value) ?? "";

// Requête Navitia générique (arrêts d'une ligne de bus, arrêts proches…). Quota Navitia séparé.
export function fetchNavitia(path, params, apiKey) {
  return primGet(`/v2/navitia${path}`, params, apiKey);
}

// Liste ordonnée des arrêts d'un train RER précis (horaires prévus, en heure UTC « HHMMSS »).
// L'identifiant temps réel (…VehicleJourney::<uuid>:LOC) et celui de Navitia partagent le même uuid.
// Renvoie null si le train est introuvable.
// Les arrêts d'un train ne changent pas : gardés en mémoire (1 requête par train)
const trainStopsCache = new Map(); // uuid → promesse

export function fetchTrainStops(trainId, apiKey) {
  const uuid = trainId?.match(/VehicleJourney::([0-9a-f-]{36})/i)?.[1];
  if (!uuid) return Promise.resolve(null);
  if (!trainStopsCache.has(uuid)) {
    const promise = loadTrainStops(uuid, apiKey);
    trainStopsCache.set(uuid, promise);
    promise.catch(() => trainStopsCache.delete(uuid)); // erreur réseau : on réessaiera
  }
  return trainStopsCache.get(uuid);
}

async function loadTrainStops(uuid, apiKey) {
  let data;
  try {
    // Sans le tracé ni les perturbations : 125 Ko au lieu de 340 (≈ 10 Ko compressés)
    data = await primGet(
      `/v2/navitia/vehicle_journeys/vehicle_journey:IDFM:TN:SNCF:${uuid}`,
      { depth: 2, disable_geojson: true, disable_disruption: true },
      apiKey,
    );
  } catch (err) {
    if (err instanceof PrimError && err.kind === "http") return null; // train inconnu de Navitia
    throw err;
  }
  const journey = data?.vehicle_journeys?.[0];
  if (!journey) return null;
  return journey.stop_times.map((st) => ({
    id: st.stop_point.stop_area.id.split(":").pop(),
    // Identifiant de la gare dans la liste « tous les trains de la ligne » (…monomodalStopPlace:45102)
    place: st.stop_point.id?.match(/monomodalStopPlace:(\d+)/)?.[1] ?? null,
    name: st.stop_point.stop_area.name ?? st.stop_point.name,
    arrivalUtc: st.utc_arrival_time,
    departureUtc: st.utc_departure_time,
    // Gare traversée sans arrêt (mission directe)
    skipped: Boolean(st.skipped_stop) || (!st.pickup_allowed && !st.drop_off_allowed),
  }));
}

// Tous les trains en circulation sur une ligne, avec leurs prochains arrêts (≈ 1 h 30 d'avance).
// Seule source où un train « sans arrêt » se voit : il passe par les gares voisines, pas par la tienne.
// 41 Ko compressés (650 Ko de JSON) : redemandé au plus toutes les 2 min.
const TIMETABLE_CACHE_MS = 2 * 60000;
const timetableCache = new Map(); // ligne → { at, promise }

export function fetchLineTrains(lineRef, apiKey) {
  const hit = timetableCache.get(lineRef);
  if (hit && Date.now() - hit.at < TIMETABLE_CACHE_MS) return hit.promise;
  const promise = primGet("/estimated-timetable", { LineRef: lineRef }, apiKey).then(parseLineTrains);
  timetableCache.set(lineRef, { at: Date.now(), promise });
  promise.catch(() => timetableCache.delete(lineRef));
  return promise;
}

export function parseLineTrains(data) {
  const frames = data?.Siri?.ServiceDelivery?.EstimatedTimetableDelivery?.[0]?.EstimatedJourneyVersionFrame ?? [];
  return frames.flatMap((frame) => frame.EstimatedVehicleJourney ?? []).map((journey) => ({
    id: journey.DatedVehicleJourneyRef?.value ?? "",
    mission: missionLabel(journey),
    destination: text(journey.DestinationName),
    direction: journey.DirectionRef?.value ?? "",
    calls: (journey.EstimatedCalls?.EstimatedCall ?? [])
      .map((call) => ({
        place: call.StopPointRef?.value?.match(/SP:(\d+)/)?.[1],
        time: new Date(call.ExpectedArrivalTime ?? call.ExpectedDepartureTime ?? call.AimedArrivalTime ?? call.AimedDepartureTime),
      }))
      .filter((call) => call.place && !isNaN(call.time))
      .sort((a, b) => a.time - b.time), // l'API ne les donne pas dans l'ordre
  }));
}

// Prochains passages d'une ligne à un arrêt.
// Petit cache pour économiser le quota (1 000 requêtes/jour) : une même gare demandée deux fois
// en même temps ou à moins de 20 s d'intervalle (aperçu + trajet, par ex.) = une seule requête.
const CACHE_MS = 20000;
const departuresCache = new Map(); // "arrêt|ligne" → { at, promise }

export function fetchDepartures(monitoringRef, lineRef, apiKey) {
  const key = `${monitoringRef}|${lineRef}`;
  const hit = departuresCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = primGet("/stop-monitoring", { MonitoringRef: monitoringRef, LineRef: lineRef }, apiKey).then((data) =>
    parseVisits(data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit ?? []),
  );
  departuresCache.set(key, { at: Date.now(), promise });
  promise.catch(() => departuresCache.delete(key)); // une erreur n'est pas gardée en cache
  return promise;
}

// Nom de la mission tel qu'affiché en gare : « ERIC53 » si dispo, sinon le code « ROPE ».
function missionLabel(journey) {
  const note = text(journey.JourneyNote);
  const name = text(journey.VehicleJourneyName).replace(/^RATP/, "");
  return /^[A-Z]{4}\d{2}$/.test(name) ? name : note;
}

export function parseVisits(visits) {
  const seen = new Set();
  const departures = [];

  for (const visit of visits) {
    const journey = visit.MonitoredVehicleJourney ?? {};
    const call = journey.MonitoredCall ?? {};
    const id = journey.FramedVehicleJourneyRef?.DatedVehicleJourneyRef ?? visit.ItemIdentifier;
    if (seen.has(id)) continue;
    seen.add(id);

    const expected = call.ExpectedDepartureTime ?? call.ExpectedArrivalTime ?? call.AimedDepartureTime ?? call.AimedArrivalTime;
    const aimed = call.AimedDepartureTime ?? call.AimedArrivalTime ?? expected;
    if (!expected) continue;

    const expectedDate = new Date(expected);
    const aimedDate = new Date(aimed);
    const statuses = [call.DepartureStatus, call.ArrivalStatus];

    departures.push({
      id,
      mission: missionLabel(journey),
      // Nom unique du train dans la journée (ex. « ERIO55 »), pour le retrouver dans une autre gare
      trainName: text(journey.VehicleJourneyName).replace(/^RATP/, ""),
      // Heure d'arrivée à cet arrêt (sert à l'estimation du trajet « Je monte dans ce train »)
      arrival: new Date(call.ExpectedArrivalTime ?? call.AimedArrivalTime ?? expected),
      missionCode: text(journey.JourneyNote),
      destination: text(journey.DestinationName) || text(call.DestinationDisplay),
      direction: journey.DirectionRef?.value ?? "",
      platform: knownPlatform(call.DeparturePlatformName?.value) || knownPlatform(call.ArrivalPlatformName?.value),
      expected: expectedDate,
      aimed: aimedDate,
      // Le statut « onTime » de l'API n'est pas fiable : on calcule le retard nous-mêmes.
      delayMinutes: Math.round((expectedDate - aimedDate) / 60000),
      cancelled: statuses.includes("cancelled"),
      atStop: call.VehicleAtStop === true,
      // true / false si l'info existe, null si l'API ne dit rien
      longTrain: journey.VehicleFeatureRef?.length ? journey.VehicleFeatureRef.includes("longTrain") : null,
    });
  }

  departures.sort((a, b) => a.expected - b.expected);

  // Sur le RER, la RATP et la SNCF annoncent parfois le même train :
  // même sens, même destination, même code mission, à moins de 2 min d'écart → doublon.
  const kept = [];
  for (const dep of departures) {
    const twin = kept.find(
      (k) =>
        dep.missionCode && // le métro n'a pas de code mission : jamais dédoublonné
        k.direction === dep.direction &&
        k.destination === dep.destination &&
        k.missionCode === dep.missionCode &&
        Math.abs(k.expected - dep.expected) < 120000,
    );
    if (!twin) kept.push(dep);
    else if (!twin.platform && dep.platform) twin.platform = dep.platform;
  }
  return kept;
}

// Messages d'info trafic (travaux, perturbations) d'une ligne.
// Info trafic : une ligne n'est redemandée qu'après 5 min, même en passant d'une gare à l'autre.
const MESSAGES_CACHE_MS = 5 * 60000;
const messagesCache = new Map(); // ligne → { at, promise }

export function fetchMessages(lineRef, apiKey) {
  const hit = messagesCache.get(lineRef);
  if (hit && Date.now() - hit.at < MESSAGES_CACHE_MS) return hit.promise;
  const promise = loadMessages(lineRef, apiKey);
  messagesCache.set(lineRef, { at: Date.now(), promise });
  promise.catch(() => messagesCache.delete(lineRef));
  return promise;
}

async function loadMessages(lineRef, apiKey) {
  const data = await primGet("/general-message", { LineRef: lineRef }, apiKey);
  const infos = data?.Siri?.ServiceDelivery?.GeneralMessageDelivery?.[0]?.InfoMessage ?? [];
  const now = Date.now();

  return infos
    .filter((info) => !info.ValidUntilTime || new Date(info.ValidUntilTime) > now)
    .map((info) => {
      const messages = info.Content?.Message ?? [];
      const short = messages.find((m) => m.MessageType === "SHORT_MESSAGE") ?? messages[0];
      return {
        id: info.InfoMessageIdentifier?.value ?? info.ItemIdentifier,
        channel: info.InfoChannelRef?.value ?? "",
        text: (short?.MessageText?.value ?? "").replace(/\s+/g, " ").trim(),
      };
    })
    .filter((m) => m.text);
}
