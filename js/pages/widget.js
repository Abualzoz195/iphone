// Emploi du temps du widget Scriptable : quelle gare favorite afficher selon l'heure et le jour.
// Enregistré sur le téléphone, puis transmis au widget par le fichier d'export.
import { lineBadge, escapeHtml } from "../screens.js";
import { app, store, lineById, stationOf, favorites, navbar } from "../common.js";

const KEY = "widgetSchedule";
const DAYS = ["L", "M", "M", "J", "V", "S", "D"]; // affichage
const DAY_NUMBERS = [1, 2, 3, 4, 5, 6, 0]; // numéros JavaScript (0 = dimanche)
const DAY_NAMES = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

// { slots: [{ start: "08:30", end: "09:30", days: [1,2,3,4,5], fav: "RER_B/474151" }], outside: "first" | "none" }
export function getSchedule() {
  const value = store.get(KEY, null);
  return { slots: Array.isArray(value?.slots) ? value.slots : [], outside: value?.outside === "none" ? "none" : "first" };
}
export function setSchedule(schedule) {
  store.set(KEY, schedule);
}

const favLabel = (key) => {
  const [lineId, stationId] = key.split("/");
  const line = lineById(lineId);
  const station = stationOf(line, stationId);
  return line && station ? { line, name: station.name } : null;
};

function daysText(days) {
  const set = new Set(days);
  if (set.size === 7) return "tous les jours";
  if (set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d))) return "du lundi au vendredi";
  if (set.size === 2 && set.has(0) && set.has(6)) return "le week-end";
  return DAY_NUMBERS.filter((d) => set.has(d)).map((d) => DAY_NAMES[d]).join(" ");
}

function slotRow(slot, index, favs) {
  const options = favs
    .map((f) => {
      const key = `${f.lineId}/${f.stationId}`;
      const label = favLabel(key);
      return label ? `<option value="${key}" ${key === slot.fav ? "selected" : ""}>${escapeHtml(`${label.line.mode === "METRO" ? "M" : label.line.mode === "BUS" ? "Bus" : "RER"} ${label.line.code} · ${label.name}`)}</option>` : "";
    })
    .join("");
  const missing = !favLabel(slot.fav);
  return `<li class="slot" data-index="${index}">
    <div class="slot-times">
      <input type="time" class="slot-input" data-field="start" value="${slot.start}" aria-label="Début">
      <span class="slot-dash">→</span>
      <input type="time" class="slot-input" data-field="end" value="${slot.end}" aria-label="Fin">
      <button type="button" class="slot-delete" data-delete-slot="${index}" aria-label="Supprimer ce créneau">−</button>
    </div>
    <div class="slot-days" role="group" aria-label="Jours">
      ${DAYS.map((letter, i) => {
        const day = DAY_NUMBERS[i];
        return `<button type="button" class="slot-day ${slot.days.includes(day) ? "is-on" : ""}" data-day="${day}" aria-pressed="${slot.days.includes(day)}">${letter}</button>`;
      }).join("")}
    </div>
    <select class="slot-input slot-fav" data-field="fav" aria-label="Gare affichée">
      ${missing ? `<option value="${slot.fav}" selected>Gare retirée des favoris</option>` : ""}${options}
    </select>
    <p class="slot-summary">${daysText(slot.days)}, de ${slot.start} à ${slot.end}${slot.end <= slot.start ? " (le lendemain)" : ""}</p>
  </li>`;
}

export function widgetPage() {
  const schedule = getSchedule();
  const favs = favorites();

  const draw = () => {
    app.innerHTML = `<div class="page">
      ${navbar("Widget", { back: "#/", backLabel: "Mes gares" })}
      <h2 class="group-label" style="margin-top:34px">Emploi du temps</h2>
      ${favs.length
        ? `<ul class="slot-list">${schedule.slots.map((s, i) => slotRow(s, i, favs)).join("") || `<li class="empty glass">Aucun créneau : le widget suit son réglage par défaut.</li>`}</ul>
           <div class="group" style="margin-top:12px"><button type="button" class="list-item is-action slot-add" data-add-slot>Ajouter un créneau</button></div>`
        : `<p class="empty">Ajoute d'abord des gares favorites.</p>`}
      <h2 class="group-label">En dehors des créneaux</h2>
      <div class="group">
        <label class="list-item"><input type="radio" name="outside" value="first" ${schedule.outside === "first" ? "checked" : ""}><span class="list-item-name">Afficher ma 1re gare</span></label>
        <label class="list-item"><input type="radio" name="outside" value="none" ${schedule.outside === "none" ? "checked" : ""}><span class="list-item-name">Ne rien afficher <small class="hint-inline">(aucune requête)</small></span></label>
      </div>
      <p class="group-footer">Le widget lit cet emploi du temps dans le fichier d'export : après une modification,
        refais <b>Réglages → Exporter</b> et enregistre le fichier dans iCloud Drive › Scriptable.
        Si le widget a un paramètre (numéro ou nom de gare), ce choix reste prioritaire.</p>
    </div>`;
  };
  const save = () => setSchedule(schedule);
  draw();

  // Un seul jeu d'écouteurs sur la page (le contenu est redessiné)
  app.onclick = (e) => {
    if (e.target.closest("[data-add-slot]")) {
      schedule.slots.push({ start: "08:00", end: "09:00", days: [1, 2, 3, 4, 5], fav: `${favs[0].lineId}/${favs[0].stationId}` });
      save();
      draw();
      return;
    }
    const del = e.target.closest("[data-delete-slot]");
    if (del) {
      schedule.slots.splice(+del.dataset.deleteSlot, 1);
      save();
      draw();
      return;
    }
    const dayButton = e.target.closest("[data-day]");
    if (dayButton) {
      const slot = schedule.slots[+dayButton.closest(".slot").dataset.index];
      const day = +dayButton.dataset.day;
      slot.days = slot.days.includes(day) ? slot.days.filter((d) => d !== day) : [...slot.days, day];
      save();
      draw();
    }
  };
  app.onchange = (e) => {
    const field = e.target.dataset.field;
    if (field) {
      const slot = schedule.slots[+e.target.closest(".slot").dataset.index];
      if (e.target.value) slot[field] = e.target.value;
      save();
      draw();
    } else if (e.target.name === "outside") {
      schedule.outside = e.target.value;
      save();
    }
  };
}
