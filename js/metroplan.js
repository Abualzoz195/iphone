// Plan de ligne métro dessiné par l'app (SVG), à partir du schéma généré dans network.js :
// un tronc horizontal, des branches en dessous, ta station mise en évidence.
// Chaque station est un lien vers son écran de quai.
import { escapeHtml } from "./screens.js?v=20261120-1330";

const STEP = 46; // écart horizontal entre deux stations
const ROW_GAP = 70; // écart vertical entre le tronc et une branche
const PAD = 28; // marge à gauche et à droite
const CHAR = 7.2; // largeur moyenne d'une lettre (police 14 px)
const INK = "#1b2a87";

// Hauteur occupée par un nom penché à 45°
const labelHeight = (name) => Math.ceil(name.length * CHAR * Math.SQRT1_2) + 22;

export function metroPlanSvg(line, currentId) {
  const { trunk, branches } = line.plan;
  const nameOf = new Map(line.stations.map((s) => [s.id, s.name]));
  const termini = new Set([trunk[0], trunk.at(-1)]);

  // 1. Position de chaque station : x en « nombre de stations », row 0 = tronc, 1 = branche
  const points = new Map();
  trunk.forEach((id, i) => points.set(id, { x: i, row: 0 }));
  const branchRows = [];
  for (const branch of branches) {
    const n = branch.ids.length;
    const xs = branch.ids.map((_, j) => {
      if (branch.from !== null && branch.to !== null) return branch.from + ((j + 1) * (branch.to - branch.from)) / (n + 1); // boucle
      if (branch.from !== null) return branch.from + j + 1; // fourche en fin de ligne
      return branch.to - (n - j); // fourche en début de ligne
    });
    // Une nouvelle rangée seulement si la branche chevauche une autre
    const [lo, hi] = [Math.min(...xs) - 1, Math.max(...xs) + 1];
    let row = 1;
    while (branchRows.some((r) => r.row === row && r.hi > lo && r.lo < hi)) row++;
    branchRows.push({ row, lo, hi });
    branch.ids.forEach((id, j) => points.set(id, { x: xs[j], row }));
    if (branch.from === null) termini.add(branch.ids[0]); // terminus de la fourche
    else if (branch.to === null) termini.add(branch.ids.at(-1));
  }

  // 2. Passage en pixels
  const minX = Math.min(...[...points.values()].map((p) => p.x));
  const maxX = Math.max(...[...points.values()].map((p) => p.x));
  const maxRow = Math.max(0, ...[...points.values()].map((p) => p.row));
  const top = Math.max(...trunk.map((id) => labelHeight(nameOf.get(id) ?? ""))) + 10;
  const branchIds = branches.flatMap((b) => b.ids);
  const bottom = branchIds.length ? Math.max(...branchIds.map((id) => labelHeight(nameOf.get(id) ?? ""))) : 30;
  const px = (p) => PAD + (p.x - minX) * STEP;
  const py = (p) => top + p.row * ROW_GAP;
  // Largeur : jusqu'au bout du nom penché le plus à droite
  const width = Math.round(
    Math.max(...[...points.entries()].map(([id, p]) => px(p) + (nameOf.get(id) ?? "").length * CHAR * Math.SQRT1_2)) + PAD,
  );
  const height = Math.round(top + maxRow * ROW_GAP + bottom);

  // 3. Tracé de la ligne
  const path = (ids) => ids.map((id, i) => `${i ? "L" : "M"}${px(points.get(id)).toFixed(1)},${py(points.get(id))}`).join(" ");
  const strokes = [trunk, ...branches.map((b) => [...(b.from !== null ? [trunk[b.from]] : []), ...b.ids, ...(b.to !== null ? [trunk[b.to]] : [])])]
    .map((ids) => `<path d="${path(ids)}" fill="none" stroke="${line.color}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join("");

  // 4. Stations et noms (au-dessus pour le tronc, en dessous pour les branches)
  const stations = [...points.entries()]
    .map(([id, p]) => {
      const x = px(p).toFixed(1);
      const y = py(p);
      const name = nameOf.get(id) ?? id;
      const isHere = id === currentId;
      const isEnd = termini.has(id);
      const above = p.row === 0;
      const ly = above ? y - 14 : y + 18;
      const angle = above ? -45 : 45;
      const dot = isHere
        ? `<circle cx="${x}" cy="${y}" r="11" fill="#fff" stroke="#000" stroke-width="4"/><circle cx="${x}" cy="${y}" r="4" fill="#000"/>`
        : isEnd
          ? `<circle cx="${x}" cy="${y}" r="8" fill="#fff" stroke="#000" stroke-width="3"/>`
          : `<circle cx="${x}" cy="${y}" r="4.5" fill="#fff"/>`;
      const weight = isHere || isEnd ? 700 : 500;
      const label = `<text x="${x}" y="${ly}" transform="rotate(${angle} ${x} ${ly})" font-size="14" font-weight="${weight}" fill="${isHere ? "#000" : INK}"${isHere ? ' text-decoration="underline"' : ""}>${escapeHtml(name)}</text>`;
      return `<a href="#/board/${line.id}/${id}" aria-label="${escapeHtml(name)}">${dot}${label}<rect x="${px(p) - STEP / 2}" y="${y - 16}" width="${STEP}" height="32" fill="transparent"/></a>`;
    })
    .join("");

  const here = points.get(currentId);
  return {
    svg: `<svg class="plan-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Fira Sans, Helvetica, Arial, sans-serif" role="img" aria-label="Plan de la ligne ${escapeHtml(line.code)}">${strokes}${stations}</svg>`,
    width,
    height,
    currentX: here ? px(here) : 0,
  };
}
