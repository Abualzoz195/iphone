// Test de non-régression : parcourt toute l'app avec l'heure figée et des réponses d'API
// enregistrées (tests/donnees/), puis écrit le texte de chaque étape dans un fichier.
// Deux exécutions sur le même code doivent donner exactement le même résultat.
//
// Usage :  python3 -m http.server 8765 &   puis   node tests/parcours.mjs sortie.txt
// (Playwright doit être installé ; aucune requête n'est envoyée à la vraie API.)
import { createRequire } from "node:module";
// require() trouve aussi un Playwright installé globalement (NODE_PATH)
const { chromium, devices } = createRequire(import.meta.url)("playwright");
import fs from "node:fs";

const BASE = "http://localhost:8765/";
const DATA = new URL("./donnees/", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, DATA));
// Heure figée : celle de l'enregistrement des données
const NOW = new Date(JSON.parse(read("rerb-chatelet.json")).Siri.ServiceDelivery.ResponseTimestamp);

const shifted = (buffer, ms) =>
  JSON.stringify(JSON.parse(buffer), (key, value) =>
    /Time$/.test(key) && typeof value === "string" && key !== "ResponseTimestamp" && key !== "RecordedAtTime"
      ? new Date(new Date(value).getTime() + ms).toISOString()
      : value,
  );
const TRAIN = JSON.parse(read("train-arrets.json")).vehicle_journeys[0].name; // train dont on a les arrêts

const lines = [];
const log = (label, value) => lines.push(`## ${label}\n${String(value).replace(/\s+/g, " ").trim()}\n`);

const browser = await chromium.launch();
const context = await browser.newContext({ ...devices["iPhone 14"], serviceWorkers: "block", acceptDownloads: true, timezoneId: "Europe/Paris" });
await context.addInitScript(() => {
  if (sessionStorage.getItem("init")) return;
  sessionStorage.setItem("init", "1");
  localStorage.clear();
  localStorage.setItem("prim_apikey", "test");
  localStorage.setItem("favorites", JSON.stringify([
    { lineId: "RER_B", stationId: "474151" },
    { lineId: "METRO_14", stationId: "71264" },
    { lineId: "BUS_C01109", stationId: "71264" },
  ]));
  localStorage.setItem("expandedPreviews", JSON.stringify(["RER_B/474151", "METRO_14/71264"]));
});
await context.route(/^https:\/\/prim\./, (route) => {
  const url = decodeURIComponent(route.request().url());
  let body;
  if (url.includes("stop-monitoring") && url.includes("C01384")) body = read("metro14.json");
  else if (url.includes("stop-monitoring") && url.includes("C01109")) body = read("bus74.json");
  else if (url.includes("stop-monitoring") && url.includes("SP:474151:")) body = read("rerb-chatelet.json");
  // Autres gares du RER B : les horaires de Châtelet décalés de 3 min (le même train y passe plus tard)
  else if (url.includes("stop-monitoring")) body = shifted(read("rerb-chatelet.json"), 3 * 60000);
  else if (url.includes("general-message")) body = read("messages.json");
  else if (url.includes("/stop_areas")) body = read("bus74-arrets.json");
  else if (url.includes("vehicle_journeys")) body = read("train-arrets.json");
  else if (url.includes("places_nearby")) body = read("autour.json");
  else body = "{}";
  route.fulfill({ status: 200, body, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
});
await context.route(/^https:\/\/assets-bff\./, (route) => route.abort());

const page = await browser.contexts()[0].newPage();
await page.clock.install({ time: NOW });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const go = async (hash, wait = 1500) => {
  await page.goto(BASE + hash);
  await page.clock.runFor(wait);
  await page.waitForTimeout(300);
};
const text = (sel) => page.$eval(sel, (e) => e.innerText).catch(() => "(absent)");

await go("#/");
log("accueil", await text("#app"));
await page.click('.fav-card[data-key="BUS_C01109/71264"] .fav-toggle');
await page.clock.runFor(1500);
log("accueil, bus déplié", await text("#fav-list"));
await page.click("[data-action=edit]");
log("mode Modifier", await text("#app"));
await page.click("[data-action=edit]");

await go("#/lines");
await page.fill("#bus-search", "74");
log("lignes + recherche bus « 74 »", await text("#app"));
await go("#/line/RER_B");
await page.fill("#search", "chat");
log("ligne RER B, recherche « chat »", await text("#station-list"));
await go("#/line/BUS_C01109");
log("ligne bus 74", await text("#station-list"));

await go("#/board/RER_B/474151", 2500);
log("écran RER B Châtelet", await text("#screens"));
await go("#/board/METRO_14/71264", 2500);
log("écran métro 14 Châtelet", await text("#screens"));
log("plan métro 14", await page.$eval(".plan-svg", (s) => [...s.querySelectorAll("text")].map((t) => t.textContent).join(", ")).catch(() => "(absent)"));
await go("#/board/BUS_C01109/71264", 2500);
log("écran bus 74", await text("#screens"));

// Je monte dans ce train
await go("#/board/RER_B/474151", 2500);
await page.click(`.rer-row[data-train]:has(.rer-mission:text-is("${TRAIN}"))`);
await page.clock.runFor(1500);
log("fenêtre trajet", await text(".trip-dialog"));
await page.click(".trip-station");
await page.clock.runFor(1500);
log("résultat trajet", await text(".trip-dialog"));
const start = await page.$("[data-start]");
if (start) {
  await start.click();
  await page.clock.runFor(2500);
  log("carte Mon trajet", await text("#trip-slot"));
  await page.click("[data-action=end-trip]");
} else {
  await page.keyboard.press("Escape"); // ferme la fenêtre
}

// Emploi du temps du widget
await go("#/");
await page.click("[data-action=settings]");
await page.click("#open-widget");
await page.clock.runFor(500);
await page.click("[data-add-slot]");
await page.fill('.slot[data-index="0"] [data-field="start"]', "17:40");
await page.fill('.slot[data-index="0"] [data-field="end"]', "19:00");
await page.click('.slot[data-index="0"] [data-day="6"]'); // ajoute le samedi
await page.selectOption('.slot[data-index="0"] [data-field="fav"]', "METRO_14/71264");
await page.click('input[name="outside"][value="none"]');
log("page Widget", await text("#app"));
if (process.argv[3]) await page.screenshot({ path: process.argv[3] }); // capture facultative

// Réglages, export, import
await go("#/");
await page.click("[data-action=settings]");
const [download] = await Promise.all([page.waitForEvent("download"), page.click("#export-favs")]);
const exported = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
delete exported.exportedAt;
log("fichier exporté", JSON.stringify(exported));
page.on("dialog", (d) => d.accept());
await page.setInputFiles("#import-file", { name: "import.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ favorites: [{ lineId: "METRO_1", stationId: "71264" }, { lineId: "RER_Z", stationId: "1" }] })) });
await page.clock.runFor(500);
log("import", await text("#favs-status"));
await page.keyboard.press("Escape");
log("accueil après import", await text("#fav-list"));

log("erreurs JavaScript", errors.join(" | ") || "aucune");
await browser.close();
fs.writeFileSync(process.argv[2] || "parcours.txt", lines.join("\n"));
console.log(`${lines.length} étapes, ${errors.length} erreur(s) JavaScript`);
