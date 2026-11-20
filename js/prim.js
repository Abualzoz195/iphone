// Appels à l'API PRIM d'Île-de-France Mobilités et lecture des réponses SIRI.
// Doc : https://prim.iledefrance-mobilites.fr

const BASE_URL = "https://prim.iledefrance-mobilites.fr/marketplace";

export class PrimError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // "auth" | "network" | "http"
  }
}

async function primGet(path, params, apiKey) {
  const url = new URL(BASE_URL + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  let response;
  try {
    response = await fetch(url, { headers: { apikey: apiKey, Accept: "application/json" } });
  } catch {
    throw new PrimError("network", "Pas de connexion à l'API PRIM");
  }
  if (response.status === 401 || response.status === 403) {
    throw new PrimError("auth", "Clé API refusée");
  }
  if (!response.ok) {
    throw new PrimError("http", `Erreur API (${response.status})`);
  }
  return response.json();
}

// SIRI met les textes dans des tableaux [{ value: "..." }].
const text = (field) => (Array.isArray(field) ? field[0]?.value : field?.value) ?? "";

// Prochains passages d'une ligne à un arrêt.
export async function fetchDepartures(monitoringRef, lineRef, apiKey) {
  const data = await primGet("/stop-monitoring", { MonitoringRef: monitoringRef, LineRef: lineRef }, apiKey);
  const visits = data?.Siri?.ServiceDelivery?.StopMonitoringDelivery?.[0]?.MonitoredStopVisit ?? [];
  return parseVisits(visits);
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
      mission: text(journey.JourneyNote) || text(journey.VehicleJourneyName).replace(/\d+$/, ""),
      destination: text(journey.DestinationName) || text(call.DestinationDisplay),
      direction: journey.DirectionRef?.value ?? "",
      platform: call.DeparturePlatformName?.value ?? call.ArrivalPlatformName?.value ?? "",
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

  return departures.sort((a, b) => a.expected - b.expected);
}

// Messages d'info trafic (travaux, perturbations) d'une ligne.
export async function fetchMessages(lineRef, apiKey) {
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
