// Plan de ligne officiel (PDF RATP/IDFM) affiché en bande sous les écrans de quai.
// Le PDF est dessiné dans la page avec PDF.js (vendor/pdfjs), sans ouvrir d'autre page.

import { metroPlanSvg } from "./metroplan.js?v=20261120-1609";

const RER_PLAN_BASE = "https://assets-bff.bonjour-ratp.fr/maps/lineMaps/plan-de-ligne_";
const PDFJS_DIR = "vendor/pdfjs/";
const MAX_CANVAS_PIXELS = 16_000_000; // limite de taille des images sur iPhone

// Adresse du PDF officiel d'une ligne, ou null si on ne la connaît pas.
export function planUrl(line) {
  const id = line.ref.split(":")[3]; // « STIF:Line::C01743: » → « C01743 »
  if (line.mode === "RER") return `${RER_PLAN_BASE}RER_SNCF_ligne-${line.code}_LIG:IDFM:${id}.pdf`;
  return null; // métro : ratp.fr refuse l'affichage intégré, le plan est dessiné par l'app
}

// Charge PDF.js une seule fois, au premier plan affiché.
let pdfjsPromise = null;
function loadPdfJs() {
  pdfjsPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PDFJS_DIR + "pdf.min.js";
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_DIR + "pdf.worker.min.js";
      resolve(window.pdfjsLib);
    };
    script.onerror = () => {
      pdfjsPromise = null;
      reject(new Error("Lecteur PDF introuvable"));
    };
    document.head.appendChild(script);
  });
  return pdfjsPromise;
}

// Un PDF déjà téléchargé n'est pas retéléchargé en changeant de gare sur la même ligne.
const pages = new Map(); // url → Promise<page PDF>
function loadPage(url) {
  if (!pages.has(url)) {
    const promise = loadPdfJs()
      // Sans requêtes partielles : le serveur RATP ne les autorise pas depuis un autre site.
      .then((pdfjs) => pdfjs.getDocument({ url, disableRange: true, disableStream: true }).promise)
      .then((doc) => doc.getPage(1));
    promise.catch(() => pages.delete(url));
    pages.set(url, promise);
  }
  return pages.get(url);
}

// Dessine le plan dans `canvas` à la hauteur demandée (en points d'écran).
async function draw(canvas, page, cssHeight) {
  const base = page.getViewport({ scale: 1 });
  const scale = cssHeight / base.height;
  const cssWidth = base.width * scale;
  const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight)));
  const viewport = page.getViewport({ scale: scale * ratio });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
}

// Plan métro dessiné par l'app, avec la station `stationId` mise en évidence.
function mountDrawnPlan(section, line, stationId) {
  const plan = metroPlanSvg(line, stationId);
  section.hidden = false;
  section.innerHTML = `
    <div class="plan-head">
      <h2 class="plan-title">Plan de la ligne</h2>
      <button type="button" class="plan-toggle" aria-expanded="false">Agrandir</button>
    </div>
    <div class="plan-strip">${plan.svg}</div>
    <p class="plan-credit">Plan simplifié · touche une station pour voir ses prochains métros</p>`;

  const strip = section.querySelector(".plan-strip");
  const svg = section.querySelector(".plan-svg");
  const toggle = section.querySelector(".plan-toggle");
  let zoom = 1;

  const apply = () => {
    svg.style.width = `${plan.width * zoom}px`;
    svg.style.height = `${plan.height * zoom}px`;
    // Centre le plan sur ta station
    strip.scrollLeft = plan.currentX * zoom - strip.clientWidth / 2;
  };
  toggle.addEventListener("click", () => {
    zoom = zoom === 1 ? 1.6 : 1;
    toggle.textContent = zoom === 1 ? "Agrandir" : "Réduire";
    toggle.setAttribute("aria-expanded", String(zoom !== 1));
    apply();
  });
  requestAnimationFrame(apply);
}

// Met en place la section « Plan de la ligne » dans `section` (vide si pas de plan connu).
export function mountLinePlan(section, line, stationId) {
  if (line.mode === "METRO" && line.plan) return mountDrawnPlan(section, line, stationId);
  const url = planUrl(line);
  section.hidden = !url;
  if (!url) return;

  section.innerHTML = `
    <div class="plan-head">
      <h2 class="plan-title">Plan de la ligne</h2>
      <button type="button" class="plan-toggle" aria-expanded="false">Agrandir</button>
    </div>
    <div class="plan-strip">
      <p class="plan-status">Chargement du plan…</p>
      <canvas class="plan-canvas" hidden></canvas>
    </div>
    <p class="plan-credit">Plan © RATP / Île-de-France Mobilités · <a href="${url}" target="_blank" rel="noopener">PDF original</a></p>`;

  const strip = section.querySelector(".plan-strip");
  const canvas = section.querySelector(".plan-canvas");
  const status = section.querySelector(".plan-status");
  const toggle = section.querySelector(".plan-toggle");
  let expanded = false;

  const height = () => (expanded ? Math.min(Math.round(window.innerHeight * 0.7), 520) : 170);

  const render = async () => {
    try {
      const page = await loadPage(url);
      // Garde la même position relative dans le plan quand on agrandit/réduit
      const position = strip.scrollWidth > strip.clientWidth ? strip.scrollLeft / (strip.scrollWidth - strip.clientWidth) : 0;
      await draw(canvas, page, height());
      canvas.hidden = false;
      status.hidden = true;
      strip.scrollLeft = position * (strip.scrollWidth - strip.clientWidth);
    } catch {
      // Pas de réseau, ou site qui refuse l'affichage dans une autre app : on propose de l'ouvrir.
      status.innerHTML = `Impossible d'afficher le plan ici.<br><a class="plan-open" href="${url}" target="_blank" rel="noopener">Ouvrir le plan</a>`;
      status.hidden = false;
      toggle.hidden = true;
    }
  };

  toggle.addEventListener("click", () => {
    expanded = !expanded;
    toggle.textContent = expanded ? "Réduire" : "Agrandir";
    toggle.setAttribute("aria-expanded", String(expanded));
    render();
  });

  render();
}
