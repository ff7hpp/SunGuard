import { isolate, panels as samples, states } from "./farm.js";
import { mountScene } from "./scene.js";
import { themes, validTheme } from "./theme.js";
import { metricCatalog, selectedMetrics, formatMetric } from "./live-client.mjs";
import { renderHistory } from "./history-charts.mjs";
import { activitySubject } from "./activity.mjs";
import { COLUMNS, PANEL_COUNT, HOTSPOT_INDEX } from "./grid.js";
import { gsap } from "gsap";
import Lenis from "lenis";
import { replaySummary, replayInterval } from "./replay.mjs";

const $ = selector => document.querySelector(selector);
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const lenis = new Lenis({ autoRaf: true });
  window.addEventListener('pagehide', () => lenis.destroy(), { once: true });
  gsap.from('.sidebar, main', { opacity: 0, y: 10, duration: 0.45, stagger: 0.08 });
}
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

let panels = samples.slice();
const activity = [];
const notes = new Map();
const isolated = new Set();
const dialog = $("#panel-dialog");
const stage = $("#stage");
const flat = $("#flat-map");
flat.style.gridTemplateColumns = `repeat(${COLUMNS}, minmax(17px, 1fr))`;
$("#hotspot").dataset.panel = HOTSPOT_INDEX;
let selected = null;
let page = "overview";
let view = "perspective";
let scene;
let liveSnapshot = null;
let hasImported = false;
let apiAvailable = false;
let historyDate = "";
let historyRequest = 0;
let historyLoaded = false;
let recordedHistory = null, replayIndex = 0, replayTimer = null, replayActive = false, replayPlaying = false, replayRequest = 0, replaySpeed = 1;
let widgetIds = selectedMetrics(JSON.parse(localStorage.getItem("heliofield-metrics") || "[]"));

const badge = status => `<span class="status ${status}">${states[status].mark} ${states[status].label}</span>`;
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
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLUMNS, ArrowUp: -COLUMNS }[event.key];
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
  return panels.filter(panel => ["critical", "warning", "offline"].includes(panel.status))
    .sort((a, b) => Number(b.status === "critical") - Number(a.status === "critical"));
}

function renderOverview() {
  const summary = liveSnapshot?.summary;
  const power = panels.reduce((sum, panel) => sum + (panel.power ?? 0), 0) / 1000;
  const healthy = panels.filter(panel => panel.status === "normal").length;
  const alerts = activeAlerts();
  $("#nav-alerts").textContent = alerts.length;
  $("#hotspot").hidden = panels[HOTSPOT_INDEX].status !== "critical";
  $("#metrics").innerHTML = `
    <article class="paper metric production"><div class="metric-label">${icon("bolt")} Power output</div><div class="reading">${power.toFixed(1)} <small>kW</small></div><p>Output at displayed sample time</p><button class="text-button" data-open="analytics">View recorded history</button></article>
    <article class="paper metric"><div class="metric-label">${icon("layers")} Array health</div><div class="reading">${healthy}<small> / ${PANEL_COUNT}</small></div><p>Modules in normal range</p><div class="progress"><span style="width:${healthy / PANEL_COUNT * 100}%"></span></div></article>
    <article class="paper metric"><div class="metric-label">${icon("bell")} Active alerts</div><div class="reading">${alerts.length}<small> open</small></div><p>${alerts.filter(panel => panel.status === "critical").length} critical · ${alerts.filter(panel => panel.status === "warning").length} warnings</p><button class="text-button" data-open="alerts">Inspect alerts ${icon("arrow")}</button></article>
    <article class="paper metric"><div class="metric-label">${icon("sun")} Field conditions</div><div class="reading">${Number.isFinite(summary?.averageTemperature) ? summary.averageTemperature.toFixed(1) : "—"}<small> °C</small></div><p>Average panel temperature</p><div class="environment"><span>Recorded value</span></div></article>`;
  $("#overview-alerts").innerHTML = `<div class="paper-head"><div><p class="eyebrow">FIELD EVENTS</p><h2>Needs attention</h2></div><button class="text-button" data-open="alerts">All alerts ${icon("arrow")}</button></div>${alertRows(alerts.slice(0, 3))}`;
}

function issue(panel) {
  if (panel.fault && panel.fault !== "normal" && panel.status !== "isolated") {
    const label = panel.fault.replaceAll("_", " ");
    return label[0].toUpperCase() + label.slice(1);
  }
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
  const title = { overview: "Overview", analytics: "Analytics", alerts: "Alerts", activity: "Activity log" }[next];
  document.querySelectorAll("[data-page]").forEach(item => item.removeAttribute("aria-current"));
  button.setAttribute("aria-current", "page");
  const primary = next === "overview";
  $("#primary").hidden = !primary;
  $("#metrics").hidden = $("#overview-alerts").hidden = false;
  $("#subpage").hidden = primary;
  if (primary) {
    $("#title").textContent = "Farm overview";
    $("#title").focus({ preventScroll: true });
  } else {
    const body = next === "analytics" ? renderAnalytics()
      : next === "alerts" ? `<article class="paper alert-section"><div class="paper-head"><h2>Active alerts</h2></div>${alertRows(activeAlerts())}</article>`
      : `<article class="paper alert-section"><div class="paper-head"><h2>Session events</h2></div><div id="activity-rows"></div></article>`;
    $("#subpage").innerHTML = `<header class="intro"><h1 tabindex="-1">${title}</h1></header>${body}${next === "analytics" ? analyticsChartsShell() : ""}`;
    if (next === "analytics") {
      historyLoaded = false;
      void loadHistory();
    }
    if (next === "activity") renderActivity();
    $("#subpage h1").focus({ preventScroll: true });
  }
  window.scrollTo(0, 0);
}

function analyticsChartsShell() {
  return `<section class="paper history" aria-label="Telemetry charts">
    <div class="paper-head replay-heading"><div><p class="eyebrow">RECORDED DATA</p><h2>Historical replay</h2></div><button data-replay-map="true">Show solar map</button></div>
    <p class="context replay-intro">Move through the recorded minutes. The map, readings, alerts, and charts follow the same timestamp.</p>
    <div class="replay-toolbar"><div class="replay-actions"><button class="primary-button" data-replay-play="true">Play recorded data</button><button data-replay-pause="true">Pause</button><button data-replay-latest="true">Return to latest sample</button><label class="replay-speed">Speed <select id="replay-speed">${[1, 5, 10, 50, 100].map(speed => `<option value="${speed}" ${speed === replaySpeed ? "selected" : ""}>${speed}×</option>`).join("")}</select></label></div><label class="replay-scrubber">Recorded minute<input id="replay-position" type="range" min="0" max="0" value="0"></label></div>
    <div class="replay-state"><p id="replay-status" role="status" class="context">Choose a period to load recordings.</p><p id="replay-analysis" class="replay-analysis"></p></div>
    <p id="chart-feedback" role="status" class="context"></p>
    <div id="history-view"><div class="paper-head"><h2>Seven-day history</h2><label>Period <select id="history-date"><option value="">Seven days</option></select></label></div>
      <p id="history-feedback" class="context" role="status"></p><div id="history-content"></div></div>
  </section>`;
}

async function loadHistory() {
  const content = $("#history-content");
  if (page !== "analytics" || !content) return;
  const request = ++historyRequest;
  const feedback = $("#history-feedback");
  if (!historyLoaded) feedback.textContent = "Loading history…";
  const selected = historyDate;
  try {
    let response = await fetch(selected ? `/api/history?date=${encodeURIComponent(selected)}` : "/api/history", { cache: "no-store" });
    if (selected && response.status === 400) {
      if (request !== historyRequest || !content.isConnected) return;
      historyDate = "";
      return loadHistory();
    }
    if (!response.ok) throw new Error("History unavailable");
    const result = await response.json();
    if (request !== historyRequest || !content.isConnected) return;
    const select = $("#history-date");
    if (select.options.length !== 8 || select.options[7]?.value !== result.days.at(-1)?.date) {
      select.replaceChildren(new Option("Seven days", ""), ...result.days.map(day => new Option(day.date, day.date)));
    }
    select.value = historyDate;
    const continuing = replayActive && recordedHistory?.date === result.date;
    recordedHistory = result;
    if (!continuing) { replayIndex = 0; clearInterval(replayTimer); replayTimer = null; replayActive = false; replayPlaying = false; replayRequest++; }
    const slider = $("#replay-position");
    slider.max = String(Math.max(0, result.minutes.length - 1)); slider.value = String(replayIndex);
    const summary = replaySummary(result);
    const faults = Object.entries(Object.groupBy(result.incidents.filter(event => event.fault), event => event.fault)).sort((a,b) => b[1].length - a[1].length).map(([name, events]) => `${name.replaceAll('_', ' ')}: ${events.length}`).join(' · ');
    $("#replay-analysis").textContent = `${result.date ?? "Seven days"} · ${result.minutes.length} recorded minutes · mean power ${summary.averagePower?.toFixed(2) ?? "—"} kW · peak temperature ${summary.peakTemperature?.toFixed(1) ?? "—"} °C · ${summary.incidents} recorded fault starts · ${summary.missing} missing panel readings. ${faults || 'No recorded faults.'} Suggested action: inspect affected panels and recorded fault labels; a fault label does not confirm a repair.`;
    $("#replay-status").textContent = result.minutes.length ? "Ready to replay recorded readings." : "No recorded readings for this period.";
    content.innerHTML = renderHistory(result, continuing ? result.minutes[replayIndex]?.time : null);
    feedback.textContent = "";
    historyLoaded = true;
  } catch {
    if (request === historyRequest && content.isConnected) {
      feedback.textContent = historyLoaded ? "History refresh failed. Showing previous results." : "History unavailable. Start the local SunGuard server.";
    }
  }
}

$("#subpage").addEventListener("change", event => {
  if (event.target.id === "replay-speed") {
    replaySpeed = Number(event.target.value);
    if (replayTimer) startReplayTimer();
    return;
  }
  if (event.target.id === "replay-position") { replayIndex = Number(event.target.value); void showReplay(); return; }
  if (event.target.id !== "history-date") return;
  historyDate = event.target.value;
  historyLoaded = false;
  void loadHistory();
});

function metricValue(id) {
  const summary = liveSnapshot?.summary ?? {};
  const total = panels.length || PANEL_COUNT;
  const available = panels.filter(panel => panel.power !== null && panel.status !== "isolated");
  const average = field => {
    const values = available.map(panel => panel[field]).filter(value => value != null).map(Number);
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : "—";
  };
  return {
    power: `${(panels.reduce((sum, panel) => sum + (panel.power ?? 0), 0) / 1000).toFixed(1)} kW`,
    temperature: `${formatMetric(summary.averageTemperature ?? average("temperature"))} °C`,
    voltage: `${average("voltage")} V`, current: `${average("current")} A`, illuminance: `${average("lux")} lux`, availability: `${Math.round(available.length / total * 100)} %`,
    alerts: `${activeAlerts().length} open`,
  }[id];
}

function renderAnalytics() {
  const widgets = widgetIds.map(id => {
    const metric = metricCatalog.find(item => item.id === id);
    return `<article class="paper metric analysis-widget"><div class="metric-label">${metric.label}</div><div class="reading">${metricValue(id)}</div><p>${metric.level} · live snapshot</p></article>`;
  }).join("");
  const catalog = metricCatalog.map(metric => `<button class="metric-choice" data-metric="${metric.id}" aria-pressed="${widgetIds.includes(metric.id)}"><strong>${widgetIds.includes(metric.id) ? "✓" : "+"} ${metric.label}</strong><small>${metric.level} · ${metric.unit}</small></button>`).join("");
  return `<article class="paper analysis"><div class="paper-head"><h2>Recorded analysis</h2></div><div class="analysis-grid">${widgets}</div><details class="widget-catalog"><summary>+ Add or remove analysis widgets</summary><div>${catalog}</div></details><p class="context">${hasImported ? "Values reflect the displayed recorded minute." : "Recorded history is not available yet."}</p></article>`;
}

async function syncLiveData() {
  if (replayActive) return;
  try {
    const response = await fetch("/api/snapshot", { cache: "no-store" });
    if (!response.ok) throw new Error("snapshot unavailable");
    const previousSnapshot = liveSnapshot;
    const previouslyAvailable = apiAvailable;
    const snapshot = await response.json();
    if (snapshot.panels.length !== PANEL_COUNT) throw new Error("Unexpected panel count");
    liveSnapshot = snapshot;
    hasImported ||= Boolean(snapshot.collection?.imported);
    panels = snapshot.panels.map(panel => isolated.has(panel.id) ? isolate(panel) : panel);
    apiAvailable = true;
    if (page === "analytics" && (!previouslyAvailable ||
      previousSnapshot?.collection?.latestSample !== snapshot.collection?.latestSample ||
      previousSnapshot?.collection?.revision !== snapshot.collection?.revision ||
      previousSnapshot?.collection?.localDate !== snapshot.collection?.localDate)) void loadHistory();
    $(".snapshot small").textContent = snapshot.collection?.imported ? "RECORDED SAMPLE" : "SIMULATION SNAPSHOT";
    const time = new Date(snapshot.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });
    $(".snapshot strong").innerHTML = `${time} <em>TRT</em>`;
    if (previouslyAvailable && previousSnapshot?.generatedAt === snapshot.generatedAt
      && previousSnapshot?.mode === snapshot.mode
      && previousSnapshot?.collection?.revision === snapshot.collection?.revision
      && previousSnapshot?.lifecycle?.active === snapshot.lifecycle?.active
      && previousSnapshot?.lifecycle?.step === snapshot.lifecycle?.step) return;
    panels.forEach(panel => { updateTile(panel); scene?.update(panel); });
    renderOverview();
    if (page === "alerts") $("#subpage .alert-section").innerHTML = `<div class="paper-head"><h2>Active alerts</h2></div>${alertRows(activeAlerts())}`;
    if (page === "analytics") {
      const scrollPosition = window.scrollY;
      const catalogOpen = $("#subpage .widget-catalog").open;
      $("#subpage .analysis").outerHTML = renderAnalytics();
      $("#subpage .widget-catalog").open = catalogOpen;
      window.scrollTo(0, scrollPosition);
    }
  } catch {
    apiAvailable = false;
  }
}

async function showReplay() {
  const minute = recordedHistory?.minutes[replayIndex];
  if (!minute) return;
  const request = ++replayRequest;
  replayActive = true;
  try {
    const response = await fetch(`/api/snapshot?at=${encodeURIComponent(minute.time)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Recorded sample unavailable");
    const snapshot = await response.json();
    if (request !== replayRequest || !replayActive) return;
    liveSnapshot = snapshot;
    panels = snapshot.panels;
    panels.forEach(panel => { updateTile(panel); scene?.update(panel); });
    renderOverview();
    $(".snapshot small").textContent = "RECORDED SAMPLE";
    $(".snapshot strong").textContent = new Date(minute.time).toLocaleTimeString("en-GB", {timeZone:"Europe/Istanbul", hour:"2-digit", minute:"2-digit"}) + " TRT";
    if ($("#replay-position")) $("#replay-position").value = String(replayIndex);
    $("#map-replay-controls").hidden = false;
    $("#map-replay-status").textContent = new Date(minute.time).toLocaleString("en-GB", {timeZone:"Europe/Istanbul"}) + " TRT";
    if ($("#replay-status")) $("#replay-status").textContent = `${replayIndex + 1} / ${recordedHistory.minutes.length} · ${new Date(minute.time).toLocaleString("en-GB", {timeZone:"Europe/Istanbul"})} TRT`;
    if (page === "analytics") $("#subpage .analysis").outerHTML = renderAnalytics();
    if (page === "analytics" && $("#history-content")) $("#history-content").innerHTML = renderHistory(recordedHistory, minute.time);
  } catch { clearInterval(replayTimer); replayTimer = null; replayPlaying = false; if ($("#replay-status")) $("#replay-status").textContent = "Could not load the recorded sample. Retry playback."; }
}

function startReplayTimer() {
  clearInterval(replayTimer);
  replayTimer = setInterval(() => {
    if (replayIndex >= (recordedHistory?.minutes.length ?? 0) - 1) { clearInterval(replayTimer); replayTimer = null; replayPlaying = false; return; }
    replayIndex++;
    void showReplay();
  }, replayInterval(replaySpeed));
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
  activity.unshift({ time: new Date().toLocaleTimeString("en-GB"), panel: activitySubject(selected, panels), action });
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
    <div class="diagnosis ${panel.status}"><small>${panel.fault ? "IMPORTED FAULT STATUS" : "SAMPLE STATUS"}</small><h3>${issue(panel)}</h3>
    <p>${panel.fault ? "Status from the imported CSV." : panel.status === "critical" ? "Possible cause: surface soiling or partial shading. Inspect the module to confirm."
      : panel.status === "warning" ? "Compare production with nearby modules under similar conditions."
      : panel.status === "offline" ? "The latest sample and recent readings are unavailable."
      : panel.status === "isolated" ? "Output was set to zero in this session. The sample history is preserved."
      : "The latest sample does not show an active anomaly."}</p></div>
    <h3>Displayed sample <small>${liveSnapshot ? new Date(liveSnapshot.generatedAt).toLocaleString("en-GB", { timeZone: "Europe/Istanbul" }) + " TRT" : "Unavailable"}</small></h3>
    <dl class="detail-readings"><div><dt>Output</dt><dd>${reading(panel.power, "W")}</dd></div><div><dt>Temperature</dt><dd>${reading(panel.temperature, "°C")}</dd></div><div><dt>DC voltage</dt><dd>${reading(panel.voltage, "V")}</dd></div><div><dt>DC current</dt><dd>${reading(panel.current ?? null, "A")}</dd></div></dl>
    ${panel.fault ? `<p class="context">Ambient temperature: ${reading(panel.ambient, "°C")} · Illuminance: ${reading(panel.lux, "lux")}</p>`
      : '<p class="context">Recorded field context unavailable.</p>'}
    ${liveSnapshot?.collection?.imported ? '<details id="panel-history"><summary>Recent recorded readings</summary><p class="context" id="panel-history-content">Open to load the latest 30 readings.</p></details>' : ''}
    <h3>Maintenance note</h3>
    <p id="saved-note" class="context">${note ? "" : "No note saved."}</p>
    <form id="note-form"><label for="note">Note for this module</label><textarea id="note" required maxlength="240" rows="2"></textarea><div class="actions"><button type="submit">${note ? "Update note" : "Add note"}</button>${note ? '<button type="button" id="delete-note">Delete note</button>' : ""}</div></form>
    <h3>Virtual control</h3>
    <form id="control-form"><label for="reason">Reason for isolation</label><input id="reason" maxlength="120" required placeholder="e.g. Inspect module temperature" ${!available || panel.status === "isolated" ? "disabled" : ""}><button class="primary-button" ${!available || panel.status === "isolated" ? "disabled" : ""}>Simulate isolation</button></form>`;
  const historical = $("#panel-history");
  if (historical) historical.ontoggle = async () => {
    if (!historical.open || historical.dataset.loaded) return;
    const content = historical.querySelector("#panel-history-content");
    content.textContent = "Loading recorded readings…";
    try {
      const response = await fetch(`/api/panel-history?panel=${panel.index + 1}`, { cache: "no-store" });
      if (!response.ok) throw new Error("History unavailable");
      const data = await response.json();
      if (!historical.isConnected) return;
      content.replaceChildren();
      if (!data.readings.length) content.textContent = "No recorded readings for this panel.";
      for (const item of data.readings) {
        const row = document.createElement("span");
        row.style.display = "block";
        row.textContent = `${new Date(item.time).toLocaleString("en-GB", { timeZone: "Europe/Istanbul" })} TRT · ${item.power} W · ${item.temperature} °C · ${item.voltage} V · ${item.current} A · ${item.fault.replaceAll("_", " ")}`;
        content.append(row);
      }
      historical.dataset.loaded = "true";
    } catch { if (historical.isConnected) content.textContent = "Recorded readings unavailable. Close and reopen to retry."; }
  };
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
    isolated.add(panel.id);
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

document.addEventListener("click", async event => {
  const button = event.target.closest("button");
  if (!button) return;
  const { panel, open, page: target } = button.dataset;
  if (panel !== undefined) openPanel(Number(panel));
  if (target || open) navigate(target || open);
  if (button.dataset.replayPlay) {
    if (replayPlaying) return;
    clearInterval(replayTimer);
    replayTimer = null;
    if (!recordedHistory?.minutes.length) return;
    replayPlaying = true;
    await showReplay();
    if (replayPlaying) startReplayTimer();
  }
  if (button.dataset.replayPause) { clearInterval(replayTimer); replayTimer = null; replayPlaying = false; }
  if (button.dataset.replayLatest) { clearInterval(replayTimer); replayTimer = null; replayActive = false; replayPlaying = false; replayRequest++; $("#map-replay-controls").hidden = true; await syncLiveData(); }
  if (button.dataset.replayMap) { navigate("overview"); $(".viewer").scrollIntoView({ block: "start" }); }
  if (button.dataset.metric) {
    const metric = button.dataset.metric;
    widgetIds = widgetIds.includes(metric) ? widgetIds.filter(id => id !== metric) : [...widgetIds, metric];
    widgetIds = selectedMetrics(widgetIds);
    localStorage.setItem("heliofield-metrics", JSON.stringify(widgetIds));
    navigate("analytics");
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
syncLiveData();
setInterval(syncLiveData, 1_000);
