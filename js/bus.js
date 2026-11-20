// Bus : la liste des lignes est dans l'app (buslines.js), les arrêts sont téléchargés
// à la demande (1 requête Navitia par ligne, une seule fois) puis gardés sur le téléphone.
import { BUS_ROWS, NETWORKS } from "./buslines.js";
import { fetchNavitia } from "./prim.js";

const CACHE_PREFIX = "busStops:";
const EXTRA_KEY = "busExtraStops"; // arrêts vus via « Autour de moi » (identifiant parfois différent)
const memory = new Map(); // id de ligne → arrêts déjà lus

function cachedStops(lineId) {
  if (memory.has(lineId)) return memory.get(lineId);
  try {
    const stops = JSON.parse(localStorage.getItem(CACHE_PREFIX + lineId));
    if (Array.isArray(stops)) {
      memory.set(lineId, stops);
      return stops;
    }
  } catch { /* stockage indisponible */ }
  return null;
}

function extraStops() {
  try { return JSON.parse(localStorage.getItem(EXTRA_KEY)) ?? {}; } catch { return {}; }
}
export function rememberStop(lineId, station) {
  const extras = extraStops();
  const list = extras[lineId] ?? [];
  if (list.some((s) => s.id === station.id)) return;
  extras[lineId] = [...list, station];
  try { localStorage.setItem(EXTRA_KEY, JSON.stringify(extras)); } catch { /* */ }
}

// Même forme que les lignes RER/métro de network.js ; `stations` est vide tant que
// les arrêts de la ligne n'ont pas été téléchargés.
export const BUS_LINES = BUS_ROWS.map(([idfm, code, network, color, textColor]) => ({
  id: `BUS_${idfm}`,
  mode: "BUS",
  code,
  network: NETWORKS[network],
  ref: `STIF:Line::${idfm}:`,
  navitiaId: `line:IDFM:${idfm}`,
  color: `#${color}`,
  textColor: `#${textColor}`,
  get stations() {
    const stops = cachedStops(this.id) ?? [];
    const extras = (extraStops()[this.id] ?? []).filter((e) => !stops.some((s) => s.id === e.id));
    return extras.length ? [...stops, ...extras] : stops;
  },
}));

export const hasBusStops = (line) => cachedStops(line.id) !== null;

// Télécharge les arrêts d'une ligne de bus si besoin (une seule fois par ligne)
export async function ensureBusStops(line, apiKey) {
  if (line.mode !== "BUS" || hasBusStops(line)) return;
  const data = await fetchNavitia(`/lines/${line.navitiaId}/stop_areas`, { count: 500, depth: 0 }, apiKey);
  const stops = (data.stop_areas ?? []).map((s) => ({
    id: s.id.split(":").pop(),
    name: s.name,
    lat: Math.round(+s.coord.lat * 1e5) / 1e5,
    lon: Math.round(+s.coord.lon * 1e5) / 1e5,
  }));
  memory.set(line.id, stops);
  try { localStorage.setItem(CACHE_PREFIX + line.id, JSON.stringify(stops)); } catch { /* plein ou privé */ }
}

// Arrêts de bus à moins de 600 m (1 requête Navitia) : [{ line, station, km }]
export async function nearbyBusStops(position, apiKey) {
  const data = await fetchNavitia(
    `/coord/${position.lon};${position.lat}/places_nearby`,
    { "type[]": "stop_area", distance: 600, count: 30, depth: 3 }, // depth 3 : lignes de chaque arrêt
    apiKey,
  );
  const byId = new Map(BUS_LINES.map((l) => [l.navitiaId, l]));
  const results = [];
  for (const place of data.places_nearby ?? []) {
    const area = place.stop_area;
    if (!area) continue;
    const station = { id: area.id.split(":").pop(), name: area.name, lat: +area.coord.lat, lon: +area.coord.lon };
    for (const navLine of area.lines ?? []) {
      const line = byId.get(navLine.id);
      if (!line) continue;
      rememberStop(line.id, { ...station, lat: Math.round(station.lat * 1e5) / 1e5, lon: Math.round(station.lon * 1e5) / 1e5 });
      results.push({ line, station, km: (+place.distance || 0) / 1000 });
    }
  }
  return results;
}
