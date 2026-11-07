import { isolate, panels as samples, states } from "./farm.js";
import { mountScene } from "./scene.js";
import { themes, validTheme } from "./theme.js";

const $ = selector => document.querySelector(selector);
const icons = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5zm6-2v16m6-14v16"/>',
  chart: '<path d="M3 3v18h18M7 16l4-6 4 3 5-7"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h1m-1 6h1m-1 6h1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3zm0 9 8-4.5M4 7.5l8 4.5v9"/>',
  top: '<rect x="5" y="5" width="14" height="14" rx="2"/><circle cx="12" cy="12" r="2"/>',
  reset: '<path d="M4 11a8 8 0 1 1 2 6M4 5v6h6"/>',
  arrow: '<path d="M6 18 18 6M8 6h10v10"/>',
  bolt: '<path d="m13 2-8 12h6l-1 8 9-12h-6l1-8z"/>',
  cloud: '<path d="M6 18a4 4 0 1 1 1-8 6 6 0 0 1 11 2 3 3 0 1 1 0 6z"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
document.querySelectorAll("[data-icon]").forEach(el => { el.innerHTML = icon(el.dataset.icon); });

const panels = samples.slice();
const activity = [];
const notes = new Map();
const dialog = $("#panel-dialog");
const stage = $("#stage");
const flat = $("#flat-map");
let selected = null;
let page = "overview";
let view = "perspective";
let scene;

const badge = status => `<span class="status ${status}">${states[status].mark} ${states[status].label}</span>`;
const spark = (values, label, color = "currentColor") => {
  const max = Math.max(...values) * 1.12 || 1;
  const path = values.map((value, index) => `${index ? "L" : "M"}${(index / (values.length - 1) * 400).toFixed(1)} ${(70 - value / max * 65).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 400 74" preserveAspectRatio="none" role="img" aria-label="${label}"><path class="chart-grid" d="M0 24h400M0 48h400M0 72h400"/><path d="${path} L400 73 L0 73Z" fill="${color}" opacity=".10"/><path d="${path}" fill="none" stroke="${color}" stroke-width="1.75" vector-effect="non-scaling-stroke"/></svg>`;
};

$("#legend").innerHTML = Object.keys(states).map(badge).join("");

for (const panel of panels) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.panel = panel.index;
  button.tabIndex = panel.index ? -1 : 0;
  flat.append(button);
  updateTile(panel);
}

function updateTile(panel) {
  const tile = flat.children[panel.index];
  const state = states[panel.status];
  tile.className = panel.status;
  tile.textContent = state.mark;
  tile.title = tile.ariaLabel = `${panel.id} · ${state.label}`;
}

flat.addEventListener("keydown", event => {
  const index = Number(event.target.dataset.panel);
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 25, ArrowUp: -25 }[event.key];
  if (!step || !Number.isInteger(index)) return;
  event.preventDefault();
  const next = flat.children[index + step];
  if (next) {
    event.target.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  }
});

function setView(next, amount) {
  view = next;
  flat.hidden = view !== "grid";
  $("#canvas-host").hidden = view === "grid";
  for (const name of ["perspective", "top", "grid"]) {
    $(`#${name}`).setAttribute("aria-pressed", String(view === name));
  }
  for (const id of ["zoom-in", "zoom-out", "reset"]) $(`#${id}`).disabled = view === "grid";
  $("#camera-hint").textContent = view === "grid"
    ? "Select a module · Arrow keys move between modules"
    : "Drag to orbit · right-drag to pan · scroll to zoom";
  if (scene && view !== "grid") scene.view(view);
}

try {
  if (!window.WebGL2RenderingContext || !document.createElement("canvas").getContext("webgl2")) {
    throw new Error("WebGL 2 unavailable");
  }
  scene = mountScene($("#canvas-host"), panels, openPanel);
} catch {
  $("#perspective").disabled = $("#top").disabled = true;
  setView("grid");
  $("#camera-hint").textContent = "3D unavailable · Interactive 2D map";
}

$("#perspective").onclick = () => setView("perspective");
$("#top").onclick = () => setView("top");
$("#grid").onclick = () => setView("grid");
$("#zoom-in").onclick = () => scene?.zoom(5);
$("#zoom-out").onclick = () => scene?.zoom(-5);
$("#reset").onclick = () => setView("perspective");

function activeAlerts() {
  return panels.filter(panel => panel.status === "critical" || panel.status === "warning")
    .sort((a, b) => Number(b.status === "critical") - Number(a.status === "critical"));
}

const curve = [9, 12, 23, 28, 47, 57, 78, 69, 88, 92, 85, 90, 80, 74, 71, 58, 62, 49, 35];

function renderOverview() {
  const power = panels.reduce((sum, panel) => sum + (panel.power ?? 0), 0) / 1000;
  const alerts = activeAlerts();
  $("#nav-alerts").textContent = alerts.length;
  $("#hotspot").hidden = panels[102].status !== "critical";
  $("#metrics").innerHTML = `
    <article class="paper metric production"><div class="metric-label">${icon("bolt")} Power output</div><div class="reading">${power.toFixed(1)} <small>kW</small></div><p>Current array output</p>${spark(curve, "Illustrative generation trend", "#a44525")}</article>
    <article class="paper metric"><div class="metric-label">${icon("layers")} Array health</div><div class="reading">${panels.filter(panel => panel.status === "normal").length}<small> / 500</small></div><p>Modules in normal range</p><div class="progress"><span style="width:${panels.filter(panel => panel.status === "normal").length / 5}%"></span></div></article>
    <article class="paper metric"><div class="metric-label">${icon("bell")} Active alerts</div><div class="reading">${alerts.length}<small> open</small></div><p>${alerts.filter(panel => panel.status === "critical").length} critical · ${alerts.filter(panel => panel.status === "warning").length} warnings</p><button class="text-button" data-open="alerts">Inspect alerts ${icon("arrow")}</button></article>
    <article class="paper metric"><div class="metric-label">${icon("sun")} Field conditions</div><div class="reading">31<small> °C</small></div><p>Ambient temperature</p><div class="environment"><span><b>860</b> W/m² irradiance</span><span><b>18</b> km/h wind</span></div></article>`;
  $("#overview-alerts").innerHTML = `<div class="paper-head"><div><p class="eyebrow">FIELD EVENTS</p><h2>Needs attention</h2></div><button class="text-button" data-open="alerts">All alerts ${icon("arrow")}</button></div>${alertRows(alerts.slice(0, 3))}`;
}

function issue(panel) {
  if (panel.status === "critical") return "High module temperature";
  if (panel.status === "warning") return "Output below expected range";
  if (panel.status === "offline") return "Telemetry unavailable";
  if (panel.status === "isolated") return "Virtual isolation applied";
  return "Readings within expected range";
}

function alertRows(alerts) {
  return alerts.length ? alerts.map(panel => `
    <button class="event-row" data-panel="${panel.index}"><strong>${panel.id}</strong><span>${issue(panel)}</span>${badge(panel.status)}${icon("arrow")}</button>`).join("")
    : '<p class="empty">No active alerts.</p>';
}

function navigate(next) {
  page = next;
  const button = $(`[data-page="${next}"]`);
  const title = { overview: "Overview", map: "Solar map", analytics: "Analytics", alerts: "Alerts", activity: "Activity log" }[next];
  document.querySelectorAll("[data-page]").forEach(item => item.removeAttribute("aria-current"));
  button.setAttribute("aria-current", "page");
  $("#crumb").textContent = title;
  const primary = next === "overview" || next === "map";
  $("#primary").hidden = !primary;
  $("#metrics").hidden = $("#overview-alerts").hidden = next === "map";
  $("#subpage").hidden = primary;
  if (primary) {
    $("#title").textContent = next === "map" ? "Solar map" : "Farm overview";
    $("#title").focus({ preventScroll: true });
  } else {
    const body = next === "analytics" ? `
      <article class="paper analysis"><div class="paper-head"><div><p class="eyebrow">GENERATION / DEMO HISTORY</p><h2>Array production</h2></div><div class="ranges" aria-label="Chart period"><button data-range="1" aria-pressed="true">1 day</button><button data-range="3" aria-pressed="false">3 days</button><button data-range="7" aria-pressed="false">7 days</button></div></div><div id="history-chart">${history(1)}</div></article>`
      : next === "alerts" ? `<article class="paper alert-section"><div class="paper-head"><h2>Active alerts</h2></div>${alertRows(activeAlerts())}</article>`
      : `<article class="paper alert-section"><div class="paper-head"><h2>Session events</h2></div><div id="activity-rows"></div></article>`;
    $("#subpage").innerHTML = `<header class="intro"><div><p class="eyebrow section-tag">OPERATIONS / ${title.toUpperCase()}</p><h1 tabindex="-1">${title}</h1><p>${{ analytics: "Review illustrative generation trends across time.", alerts: "Inspect modules that need attention.", activity: "Review simulated actions and maintenance changes." }[next]}</p></div></header>${body}`;
    if (next === "activity") renderActivity();
    $("#subpage h1").focus({ preventScroll: true });
  }
  window.scrollTo(0, 0);
}

function history(days) {
  const values = Array.from({ length: days }, (_, index) => curve.map(value => value * (1 - index * .065))).flat();
  return `${spark(values, `Illustrative generation trend across ${days} days`, "#a44525")}<div class="chart-caption"><span>${days === 1 ? "06:00" : `${days} days ago`}</span><span>Demo snapshot</span></div>`;
}

function renderActivity() {
  const container = $("#activity-rows");
  container.replaceChildren();
  if (!activity.length) container.textContent = "No actions recorded in this session.";
  for (const event of activity) {
    const row = document.createElement("p");
    row.textContent = `${event.time} · ${event.panel} · ${event.action}`;
    container.append(row);
  }
}

function log(action) {
  activity.unshift({ time: new Date().toLocaleTimeString("en-GB"), panel: panels[selected].id, action });
}

function openPanel(index) {
  selected = index;
  renderPanel();
  if (!dialog.open) dialog.showModal();
}

function renderPanel() {
  const panel = panels[selected];
  const available = panel.power !== null;
  const reading = (value, unit) => value === null ? "Unavailable" : `${value} ${unit}`;
  const note = notes.get(panel.id);
  $("#panel-title").textContent = panel.id;
  $("#panel-content").innerHTML = `
    <div class="detail-meta"><span>Row ${panel.row} · Column ${panel.col}</span>${badge(panel.status)}</div>
    <div class="diagnosis ${panel.status}"><small>DEMO DIAGNOSTIC</small><h3>${issue(panel)}</h3>
    <p>${panel.status === "critical" ? "Possible cause: surface soiling or partial shading. Inspect the module to confirm."
      : panel.status === "warning" ? "Compare production with nearby modules under similar conditions."
      : panel.status === "offline" ? "The latest sample and recent readings are unavailable."
      : panel.status === "isolated" ? "Output was set to zero in this session. The sample history is preserved."
      : "The latest sample does not show an active anomaly."}</p></div>
    <h3>Latest sample <small>14:32 UTC</small></h3>
    <dl class="detail-readings"><div><dt>Output</dt><dd>${reading(panel.power, "W")}</dd></div><div><dt>Temperature</dt><dd>${reading(panel.temperature, "°C")}</dd></div><div><dt>DC voltage</dt><dd>${reading(panel.voltage, "V")}</dd></div><div><dt>Demo fault code</dt><dd>${panel.status === "critical" ? "TEMP-01" : panel.status === "warning" ? "PERF-02" : "—"}</dd></div></dl>
    <p class="context">Field context · 31 °C ambient · 860 W/m² irradiance · Dry<br>AC frequency and battery readings are unavailable in this demo.</p>
    <h3>Output history <small>Past 4 days · illustrative</small></h3>
    ${available ? spark([56, 74, 59, 81, 66, 85, 70, 86, samples[selected].status === "critical" ? 33 : 78], "Illustrative four-day output trend", "#e99a73") : '<p class="context">No history for this module.</p>'}
    <h3>Maintenance note</h3>
    <p id="saved-note" class="context">${note ? "" : "No note saved."}</p>
    <form id="note-form"><label for="note">Note for this module</label><textarea id="note" required maxlength="240" rows="2"></textarea><div class="actions"><button type="submit">${note ? "Update note" : "Add note"}</button>${note ? '<button type="button" id="delete-note">Delete note</button>' : ""}</div></form>
    <h3>Virtual control</h3>
    <form id="control-form"><label for="reason">Reason for isolation</label><input id="reason" maxlength="120" required placeholder="e.g. Inspect module temperature" ${!available || panel.status === "isolated" ? "disabled" : ""}><button class="primary-button" ${!available || panel.status === "isolated" ? "disabled" : ""}>Simulate isolation</button></form>`;
  if (note) {
    $("#saved-note").textContent = note;
    $("#note").value = note;
    $("#delete-note").onclick = () => {
      notes.delete(panel.id);
      log("Deleted maintenance note");
      refresh();
      $("#note").focus();
    };
  }
  $("#note-form").onsubmit = event => {
    event.preventDefault();
    const value = $("#note").value.trim();
    if (!value) return $("#note").focus();
    notes.set(panel.id, value);
    log(note ? "Updated maintenance note" : "Added maintenance note");
    refresh();
    $("#note").focus();
  };
  $("#control-form").onsubmit = event => {
    event.preventDefault();
    const reason = $("#reason").value.trim();
    if (!reason) return $("#reason").focus();
    const updated = isolate(panel);
    if (updated === panel) return;
    panels[selected] = updated;
    log(`Simulated isolation · ${reason} · Applied`);
    updateTile(updated);
    scene?.update(updated);
    refresh();
    $("#close-panel").focus();
  };
}

function refresh() {
  renderOverview();
  if (page === "alerts") $("#subpage .alert-section").innerHTML = `<div class="paper-head"><h2>Active alerts</h2></div>${alertRows(activeAlerts())}`;
  if (page === "activity") renderActivity();
  renderPanel();
}

document.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  const { panel, open, page: target, range } = button.dataset;
  if (panel !== undefined) openPanel(Number(panel));
  if (target || open) navigate(target || open);
  if (range) {
    document.querySelectorAll("[data-range]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    $("#history-chart").innerHTML = history(Number(range));
  }
});
function applyTheme(value) {
  const theme = validTheme(value);
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("heliofield-theme", theme);
  document.querySelectorAll("[data-theme]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.theme === theme));
  });
}
document.querySelectorAll(".theme-switcher [data-theme]").forEach(button => {
  button.onclick = () => applyTheme(button.dataset.theme);
});
applyTheme(validTheme(localStorage.getItem("heliofield-theme")));
$("#close-panel").onclick = () => dialog.close();
renderOverview();
