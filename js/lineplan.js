// Plan de ligne officiel (PDF RATP/IDFM) affiché en bande sous les écrans de quai.
// Le PDF est dessiné dans la page avec PDF.js (vendor/pdfjs), sans ouvrir d'autre page.

const RER_PLAN_BASE = "https://assets-bff.bonjour-ratp.fr/maps/lineMaps/plan-de-ligne_";
const METRO_PLAN_BASE = "https://www.ratp.fr/sites/default/files/lines-assets/plan-de-ligne/metro/plan-de-ligne_metro_ligne-";
const PDFJS_DIR = "vendor/pdfjs/";
const MAX_CANVAS_PIXELS = 16_000_000; // limite de taille des images sur iPhone

// Adresse du PDF officiel d'une ligne, ou null si on ne la connaît pas.
export function planUrl(line) {
  const id = line.ref.split(":")[3]; // « STIF:Line::C01743: » → « C01743 »
  if (line.mode === "RER") return `${RER_PLAN_BASE}RER_SNCF_ligne-${line.code}_LIG:IDFM:${id}.pdf`;
  if (line.mode === "METRO") return `${METRO_PLAN_BASE}${line.code}.pdf`; // ex. …ligne-1.pdf, …ligne-3bis.pdf
  return null;
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

// Met en place la section « Plan de la ligne » dans `section` (vide si pas de plan connu).
export function mountLinePlan(section, line) {
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
