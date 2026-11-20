// Navigation de l'app : accueil (favoris) → ligne → gare → écran de quai.
// Les pages sont repérées par l'adresse après « # » (ex. #/board/RER_B/474151).
// Chaque page est dans js/pages/, les outils partagés dans js/common.js.
import { app, stopTimers } from "./common.js";
import { endTrip } from "./trip.js";
import { homePage, drawPreviews, startHomePreviews, toggleFavoritePreview, isEditing, setEditing } from "./pages/home.js";
import { linesPage, linePage, nearbyPage } from "./pages/lines.js";
import { boardPage, startBoard, isBoardShown } from "./pages/board.js";
import { openSettings, initSettings } from "./settings.js";

// ---------- Routeur ----------
function route() {
  stopTimers();
  document.title = "Prochains trains";
  const [, page, a, b] = location.hash.split("/");
  if (page) setEditing(false); // on quitte le mode Modifier en changeant de page
  if (page === "lines") linesPage();
  else if (page === "line") linePage(a);
  else if (page === "nearby") nearbyPage();
  else if (page === "board") boardPage(a, b);
  else homePage();
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);

// Pas de requêtes quand l'app est en arrière-plan (batterie et quota)
document.addEventListener("visibilitychange", () => {
  const onHome = !location.hash || location.hash === "#/" || location.hash === "#";
  if (document.hidden) stopTimers();
  else if (isBoardShown()) startBoard();
  else if (onHome && !isEditing()) startHomePreviews();
});

// Boutons communs à plusieurs pages
app.addEventListener("click", (e) => {
  const toggle = e.target.closest("[data-toggle]");
  if (toggle) toggleFavoritePreview(toggle.dataset.toggle);
  if (e.target.closest("[data-action=end-trip]")) {
    endTrip();
    drawPreviews();
  }
  if (e.target.closest("[data-action=edit]")) {
    setEditing(!isEditing());
    homePage();
  }
  if (e.target.closest("[data-action=settings]")) openSettings();
});

initSettings(route);
route();
