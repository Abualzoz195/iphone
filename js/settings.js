// Réglages (clé API), export / import des gares, compteur de requêtes,
// version publiée et service worker.
import { usageStats, DAILY_QUOTA } from "./prim.js";
import { rememberStop } from "./bus.js";
import { store, apiKey, lineById, stationOf, favorites } from "./common.js";
import { expandedKeys } from "./pages/home.js";
import { getSchedule, setSchedule } from "./pages/widget.js";

let route = () => {}; // fourni par app.js

const dialog = document.getElementById("settings-dialog");

export function openSettings() {
  document.getElementById("api-key").value = apiKey();
  showVersion();
  dialog.showModal();
}

dialog.addEventListener("close", () => {
  if (dialog.returnValue !== "save") return;
  try { localStorage.setItem("prim_apikey", document.getElementById("api-key").value.trim()); } catch { /* */ }
  route();
});

// ---------- Export / import des favoris ----------
const favsStatus = (text) => (document.getElementById("favs-status").textContent = text);

// Sur iPhone : feuille de partage (Enregistrer dans Fichiers, AirDrop…) ; ailleurs : téléchargement.
// Uniquement le fichier : un titre ou un texte deviendrait un fichier .txt séparé sur iPhone.
async function shareFile(file) {
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] });
    return;
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

document.getElementById("export-favs").addEventListener("click", async () => {
  // Pour les bus, on joint l'arrêt (nom, position) : sur un autre téléphone, un arrêt trouvé via
  // « Autour de moi » n'est pas forcément dans la liste officielle de la ligne.
  // Le bloc « widget » sert au widget Scriptable, qui lit ce fichier dans iCloud Drive.
  const withStops = favorites().map((f) => {
    const line = lineById(f.lineId);
    const found = stationOf(line, f.stationId);
    const out = line?.mode === "BUS" && found ? { ...f, station: found } : { ...f };
    if (line) {
      out.widget = {
        mode: line.mode,
        code: line.code,
        color: line.color,
        textColor: line.textColor,
        lineRef: line.ref,
        stationName: found?.name ?? "",
        monitoringRef: `STIF:StopArea:SP:${f.stationId}:`,
      };
    }
    return out;
  });
  const data = {
    app: "prochains-trains",
    format: 3,
    exportedAt: new Date().toISOString(),
    favorites: withStops,
    expandedPreviews: expandedKeys(), // aperçus dépliés
    widgetSchedule: getSchedule(), // emploi du temps du widget Scriptable
  };
  const name = `mes-gares-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(data, null, 2)], name, { type: "application/json" });
  try {
    await shareFile(file);
    favsStatus(`${data.favorites.length} gare(s) exportée(s).`);
  } catch (err) {
    if (err.name !== "AbortError") favsStatus("Export impossible : " + err.message);
  }
});

document.getElementById("import-favs").addEventListener("click", () => document.getElementById("import-file").click());

document.getElementById("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // permet de réimporter le même fichier
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const list = Array.isArray(data) ? data : data.favorites;
    if (!Array.isArray(list)) throw new Error("ce fichier ne contient pas de gares");
    // On ne garde que les gares qui existent dans l'app, sans doublon
    const seen = new Set();
    const valid = list.filter((f) => {
      const key = `${f?.lineId}/${f?.stationId}`;
      const line = lineById(f?.lineId);
      // Arrêt de bus joint au fichier : on le mémorise pour pouvoir l'afficher tout de suite
      if (line?.mode === "BUS" && f.station?.id === String(f.stationId) && f.station.name) {
        rememberStop(line.id, { id: f.station.id, name: f.station.name, lat: +f.station.lat || 0, lon: +f.station.lon || 0 });
      }
      const known = stationOf(line, f?.stationId) || (line?.mode === "BUS" && /^\d+$/.test(String(f?.stationId)));
      if (seen.has(key) || !known) return false;
      seen.add(key);
      return true;
    }).map(({ lineId, stationId }) => ({ lineId, stationId }));
    if (!valid.length) throw new Error("aucune gare reconnue dans ce fichier");
    if (!confirm(`Remplacer tes ${favorites().length} gare(s) par les ${valid.length} du fichier ?`)) return;
    store.set("favorites", valid);
    // Aperçus dépliés (fichiers récents) ; sinon, par défaut le premier seulement
    if (Array.isArray(data.expandedPreviews)) {
      const keys = new Set(valid.map((f) => `${f.lineId}/${f.stationId}`));
      store.set("expandedPreviews", data.expandedPreviews.filter((k) => keys.has(k)));
    } else {
      store.set("expandedPreviews", null);
    }
    // Emploi du temps du widget : on garde les créneaux dont la gare a été importée
    if (data.widgetSchedule && Array.isArray(data.widgetSchedule.slots)) {
      const keys = new Set(valid.map((f) => `${f.lineId}/${f.stationId}`));
      setSchedule({
        slots: data.widgetSchedule.slots.filter((s) => keys.has(s.fav) && /^\d\d:\d\d$/.test(s.start) && /^\d\d:\d\d$/.test(s.end)),
        outside: data.widgetSchedule.outside === "none" ? "none" : "first",
      });
    }
    const skipped = list.length - valid.length;
    favsStatus(`${valid.length} gare(s) importée(s)${skipped ? `, ${skipped} ignorée(s)` : ""}.`);
    route();
  } catch (err) {
    favsStatus("Import impossible : " + err.message);
  }
});

// ---------- Compteur de requêtes (discret, en haut à droite, sur toutes les pages) ----------
// Ligne 1 : requêtes de la dernière minute. Ligne 2 : « Prochains passages » restants
// aujourd'hui (compte local, ≈) et autonomie estimée au débit actuel, app ouverte.
const hud = document.createElement("div");
hud.className = "quota-hud";
hud.setAttribute("aria-hidden", "true");
document.body.appendChild(hud);

function formatDuration(minutes) {
  if (!isFinite(minutes)) return "∞";
  if (minutes < 60) return `${Math.floor(minutes)} min`;
  const h = Math.floor(minutes / 60);
  return h >= 24 ? "> 24 h" : `${h} h ${String(Math.floor(minutes % 60)).padStart(2, "0")}`;
}

function drawHud() {
  const { perMinute, remaining, minutesLeft, usage } = usageStats();
  hud.innerHTML = `<span>${perMinute} req/min</span><span>≈${remaining}/${DAILY_QUOTA} · ${formatDuration(minutesLeft)}</span>`;
  hud.title = `Aujourd'hui (UTC) : passages ${usage.passages}, info trafic ${usage.infotrafic}, Navitia ${usage.navitia}`;
  hud.classList.toggle("is-low", remaining < 150);
}
drawHud();
setInterval(drawHud, 2000);

// ---------- Version, hors connexion et mises à jour (service worker) ----------
// La version affichée est la date de publication de la page sur GitHub Pages :
// plus besoin de numéro de version à changer à la main.
async function showVersion() {
  const el = document.getElementById("app-version");
  try {
    const response = await fetch("index.html", { method: "HEAD", cache: "no-store" });
    const date = new Date(response.headers.get("last-modified"));
    el.textContent = isNaN(date)
      ? "inconnue"
      : date.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    el.textContent = "inconnue (hors connexion)";
  }
  document.getElementById("offline-status").textContent = navigator.serviceWorker?.controller
    ? "disponible hors connexion"
    : "pas encore disponible hors connexion";
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("sw.js")
    .then((registration) => registration.update()) // vérifie à chaque lancement si sw.js a changé
    .catch(() => { /* navigation privée ou navigateur sans service worker */ });

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type !== "update-available" || document.querySelector(".update-toast")) return;
    const toast = document.createElement("button");
    toast.type = "button";
    toast.className = "update-toast";
    toast.innerHTML = "Nouvelle version disponible · <b>Recharger</b>";
    toast.addEventListener("click", () => location.reload());
    document.body.appendChild(toast);
  });
}

// app.js donne la fonction de navigation (pour réafficher la page après un import)
// Script du widget : Scriptable affiche comme script tout fichier .js du dossier
// iCloud Drive › Scriptable. On le propose donc en fichier, comme l'export.
document.getElementById("install-widget").addEventListener("click", async () => {
  const status = document.getElementById("widget-status");
  try {
    const response = await fetch("scriptable/ProchainsTrains.js", { cache: "no-store" });
    if (!response.ok) throw new Error(`script introuvable (${response.status})`);
    const file = new File([await response.text()], "Prochains trains.js", { type: "text/plain" }); // .js = script pour Scriptable
    await shareFile(file);
    status.innerHTML = "Choisis <b>Enregistrer dans Fichiers → iCloud Drive › Scriptable</b>, puis exporte tes gares au même endroit.";
  } catch (err) {
    if (err.name !== "AbortError") status.textContent = "Impossible de préparer le script : " + err.message;
  }
});

document.getElementById("open-widget").addEventListener("click", () => {
  dialog.close();
  location.hash = "#/widget";
});

export function initSettings(onChange) {
  route = onChange;
}
