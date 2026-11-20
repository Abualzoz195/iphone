// Service worker : l'app s'ouvre instantanément et marche hors connexion.
//
// - Fichiers de l'app : servis depuis le téléphone, puis revérifiés en arrière-plan
//   (« stale-while-revalidate »). Si un fichier a changé sur GitHub, la page est prévenue
//   et propose de recharger. Plus besoin de numéro de version dans les adresses.
// - Plans RER (PDF bonjour-ratp.fr) : gardés 7 jours.
// - PDF.js (vendor/) : gardé tel quel, il ne change jamais.
// - API PRIM : jamais mise en cache (horaires toujours en direct).
//
// Pour forcer un nettoyage complet des caches, change le numéro de CACHE_VERSION.
const CACHE_VERSION = 5; // 5 : nouvelle icône
const APP_CACHE = `app-${CACHE_VERSION}`;
const PLANS_CACHE = `plans-${CACHE_VERSION}`;
const LIB_CACHE = `lib-${CACHE_VERSION}`;
const PLAN_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

// Fichiers téléchargés dès l'installation (les autres sont gardés au premier usage)
const APP_FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/style.css",
  "js/app.js",
  "js/common.js",
  "js/settings.js",
  "js/pages/home.js",
  "js/pages/lines.js",
  "js/pages/board.js",
  "js/pages/widget.js",
  "js/bus.js",
  "js/buslines.js",
  "js/config.js",
  "js/lineplan.js",
  "js/metroplan.js",
  "js/network.js",
  "js/prim.js",
  "js/screens.js",
  "js/trip.js",
  "fonts/fira-sans-400.woff2",
  "fonts/fira-sans-500.woff2",
  "fonts/fira-sans-600.woff2",
  "fonts/fira-sans-700.woff2",
  "scriptable/ProchainsTrains.js",
  "icons/icon-32.png",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(APP_FILES.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  const keep = new Set([APP_CACHE, PLANS_CACHE, LIB_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.hostname === "prim.iledefrance-mobilites.fr") return; // horaires : réseau uniquement
  if (url.hostname === "assets-bff.bonjour-ratp.fr") return event.respondWith(planFirst(request));
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/vendor/")) return event.respondWith(cacheFirst(request, LIB_CACHE));
  // Script du widget : toujours la dernière version (on l'installe pour le copier dans Scriptable)
  if (url.pathname.includes("/scriptable/")) return event.respondWith(networkFirst(request));
  event.respondWith(staleWhileRevalidate(request, event));
});

// Plans RER : le PDF gardé sert pendant 7 jours, puis on le retélécharge
async function planFirst(request) {
  const cache = await caches.open(PLANS_CACHE);
  const cached = await cache.match(request);
  const age = cached ? Date.now() - Number(cached.headers.get("x-saved-at") || 0) : Infinity;
  if (cached && age < PLAN_MAX_AGE_MS) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const headers = new Headers(response.headers);
      headers.set("x-saved-at", String(Date.now()));
      const body = await response.clone().arrayBuffer();
      await cache.put(request, new Response(body, { status: 200, headers }));
    }
    return response;
  } catch (err) {
    if (cached) return cached; // hors connexion : l'ancien plan plutôt que rien
    throw err;
  }
}

// Réseau d'abord, copie du téléphone seulement hors connexion
async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

// Réponse immédiate depuis le téléphone, mise à jour en arrière-plan
async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(APP_CACHE);
  // Navigation (ouverture de l'app) : toujours la page principale ; on ignore « ?v=… »
  const key = request.mode === "navigate" ? new Request(new URL("./", self.location).href) : request;
  const cached = await cache.match(key, { ignoreSearch: true });
  const previous = cached?.clone(); // copie pour comparer : `cached` part vers la page

  const refresh = fetch(key, { cache: "no-cache" })
    .then(async (response) => {
      if (!response.ok) return response;
      const changed = previous && !(await sameContent(previous, response.clone()));
      await cache.put(key, response.clone());
      if (changed) notifyUpdate();
      return response;
    })
    .catch(() => cached);

  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return refresh;
}

async function sameContent(a, b) {
  const etagA = a.headers.get("etag");
  const etagB = b.headers.get("etag");
  if (etagA && etagB) return etagA === etagB;
  const [textA, textB] = await Promise.all([a.clone().text(), b.text()]);
  return textA === textB;
}

// Prévient les pages ouvertes qu'une nouvelle version est prête (une seule fois par lot)
let notifyTimer = null;
function notifyUpdate() {
  clearTimeout(notifyTimer);
  notifyTimer = setTimeout(async () => {
    for (const client of await self.clients.matchAll({ type: "window" })) client.postMessage({ type: "update-available" });
  }, 1500);
}
