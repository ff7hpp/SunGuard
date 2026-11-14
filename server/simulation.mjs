import { DatabaseSync } from "node:sqlite";
import { COLUMNS, PANEL_COUNT, HOTSPOT_INDEX } from "../grid.js";
import { createTelemetry } from "./telemetry.mjs";

const MINUTE = 60_000;
const scenarioNames = ["normal", "dust", "overheat", "shading", "inverter", "missing"];
const lifecyclePhases = [
  { scenario: "normal", kind: "baseline", label: "Baseline monitoring" },
  { scenario: "normal", kind: "baseline", label: "Stable generation" },
  { scenario: "dust", kind: "fault", label: "Dust accumulation detected" },
  { scenario: "dust", kind: "fault", label: "Dust impact increasing" },
  { scenario: "normal", kind: "maintenance", label: "Cleaning completed" },
  { scenario: "shading", kind: "fault", label: "Partial shading detected" },
  { scenario: "shading", kind: "fault", label: "Shading impact monitored" },
  { scenario: "normal", kind: "maintenance", label: "Shading issue cleared" },
  { scenario: "inverter", kind: "fault", label: "Inverter-zone degradation" },
  { scenario: "inverter", kind: "maintenance", label: "Inverter inspection applied" },
  { scenario: "normal", kind: "recovery", label: "Production recovered" },
  { scenario: "overheat", kind: "fault", label: "High temperature risk" },
  { scenario: "overheat", kind: "maintenance", label: "Thermal inspection applied" },
  { scenario: "normal", kind: "recovery", label: "Temperature normalised" },
  { scenario: "missing", kind: "fault", label: "Telemetry loss detected" },
];

function panelAddress(index) {
  return { id: `R${String(Math.floor(index / COLUMNS) + 1).padStart(2, "0")}-C${String(index % COLUMNS + 1).padStart(2, "0")}`, row: Math.floor(index / COLUMNS) + 1, col: index % COLUMNS + 1 };
}

function scenarioStatus(index, scenario) {
  if (scenario === "dust" && index >= 60 && index < 75) return "warning";
  if (scenario === "overheat" && [HOTSPOT_INDEX, 218].includes(index)) return "critical";
  if (scenario === "shading" && index >= 145 && index < 160) return "warning";
  if (scenario === "inverter" && index >= 180 && index < 195) return "warning";
  if (scenario === "missing" && [112, 287, 292].includes(index)) return "offline";
  return "normal";
}

function readingFor(index, scenario, tick, capturedAt) {
  const status = scenarioStatus(index, scenario);
  const wave = Math.sin((tick + index) / 17);
  let power = Math.round(480 + wave * 42 + (index % 11) * 4);
  let temperature = Math.round((39 + Math.sin((tick + index) / 21) * 4) * 10) / 10;
  let efficiency = Math.round((91 + Math.cos((tick + index) / 13) * 2) * 10) / 10;
  if (scenario === "dust" && status === "warning") { power = Math.round(power * 0.52); efficiency -= 16; }
  if (scenario === "overheat" && status === "critical") { power = Math.round(power * 0.42); temperature = 74; efficiency -= 21; }
  if (scenario === "shading" && status === "warning") { power = Math.round(power * 0.35); efficiency -= 28; }
  if (scenario === "inverter" && status === "warning") { power = Math.round(power * 0.62); }
  if (status === "offline") { power = null; temperature = null; efficiency = null; }
  return { panelIndex: index, capturedAt, power, temperature, voltage: power === null ? null : Math.round(39 + wave * 2), current: power === null ? null : Math.round((power / 39) * 10) / 10, efficiency, status };
}

function messageFor(scenario) {
  return {
    dust: { code: "SOIL-01", severity: "warning", message: "Simulated soiling detected in row 05." },
    overheat: { code: "TEMP-01", severity: "critical", message: "Simulated high module temperature." },
    shading: { code: "SHADE-01", severity: "warning", message: "Simulated partial shading detected." },
    inverter: { code: "INV-01", severity: "warning", message: "Simulated inverter-zone performance drop." },
    missing: { code: "DATA-01", severity: "warning", message: "Simulated missing telemetry." },
  }[scenario];
}

export function createSimulation({ databasePath, now = () => new Date(), provider }) {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS panels (panel_index INTEGER PRIMARY KEY, panel_id TEXT UNIQUE NOT NULL, row_number INTEGER NOT NULL, column_number INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS readings (id INTEGER PRIMARY KEY, panel_index INTEGER NOT NULL, captured_at TEXT NOT NULL, power_w REAL, temperature_c REAL, voltage_v REAL, current_a REAL, efficiency_pct REAL, status TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS readings_panel_time ON readings(panel_index, captured_at DESC);
    CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY, code TEXT NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL, active INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS lifecycle_events (id INTEGER PRIMARY KEY, step INTEGER NOT NULL, scenario TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL, captured_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS scheduled_readings (panel_index INTEGER NOT NULL, captured_at TEXT NOT NULL, power_w REAL, temperature_c REAL, voltage_v REAL, current_a REAL, efficiency_pct REAL, status TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'simulated', PRIMARY KEY (panel_index, captured_at));
    CREATE INDEX IF NOT EXISTS scheduled_readings_time ON scheduled_readings(captured_at, panel_index);
  `);
  const getMeta = db.prepare("SELECT value FROM metadata WHERE key = ?");
  const setMeta = db.prepare("INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const countPanels = db.prepare("SELECT COUNT(*) AS count FROM panels");
  const insertPanel = db.prepare("INSERT INTO panels(panel_index, panel_id, row_number, column_number) VALUES (?, ?, ?, ?)");
  const insertReading = db.prepare("INSERT INTO readings(panel_index, captured_at, power_w, temperature_c, voltage_v, current_a, efficiency_pct, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const panelRows = db.prepare(`SELECT p.panel_index AS "index", p.panel_id AS id, p.row_number AS row, p.column_number AS col, r.power_w AS power, r.temperature_c AS temperature, r.voltage_v AS voltage, r.current_a AS current, r.efficiency_pct AS efficiency, r.status FROM panels p JOIN readings r ON r.id = (SELECT id FROM readings WHERE panel_index = p.panel_index ORDER BY id DESC LIMIT 1) ORDER BY p.panel_index`);
  const readingCount = db.prepare("SELECT COUNT(*) AS count FROM readings");
  const activeAlerts = db.prepare("SELECT code, severity, message, created_at AS createdAt FROM alerts WHERE active = 1 ORDER BY id DESC");
  const clearAlerts = db.prepare("UPDATE alerts SET active = 0 WHERE active = 1");
  const insertAlert = db.prepare("INSERT INTO alerts(code, severity, message, created_at, active) VALUES (?, ?, ?, ?, 1)");
  const eventRows = db.prepare("SELECT step, scenario, kind, message, captured_at AS capturedAt FROM lifecycle_events ORDER BY id");
  const insertEvent = db.prepare("INSERT INTO lifecycle_events(step, scenario, kind, message, captured_at) VALUES (?, ?, ?, ?, ?)");
  const clearEvents = db.prepare("DELETE FROM lifecycle_events");
  const telemetry = createTelemetry(db, now, provider);

  let currentTime = new Date(getMeta.get("generatedAt")?.value ?? now().toISOString());
  let tickNumber = Number(getMeta.get("tickNumber")?.value ?? 0);
  let scenario = getMeta.get("scenario")?.value ?? "normal";
  let lifecycleStep = Number(getMeta.get("lifecycleStep")?.value ?? 0);
  let lifecycleActive = getMeta.get("lifecycleActive")?.value === "1";
  let lifecycleSeries = JSON.parse(getMeta.get("lifecycleSeries")?.value ?? "[]");
  let preview = lifecycleActive || (!telemetry.status().imported && getMeta.get("preview")?.value === "1");

  function persistState() {
    setMeta.run("generatedAt", currentTime.toISOString());
    setMeta.run("tickNumber", String(tickNumber));
    setMeta.run("scenario", scenario);
    setMeta.run("lifecycleStep", String(lifecycleStep));
    setMeta.run("lifecycleActive", lifecycleActive ? "1" : "0");
    setMeta.run("lifecycleSeries", JSON.stringify(lifecycleSeries));
    setMeta.run("preview", preview ? "1" : "0");
  }

  function writeReadings() {
    const capturedAt = currentTime.toISOString();
    for (let index = 0; index < PANEL_COUNT; index += 1) {
      const reading = readingFor(index, scenario, tickNumber, capturedAt);
      insertReading.run(reading.panelIndex, reading.capturedAt, reading.power, reading.temperature, reading.voltage, reading.current, reading.efficiency, reading.status);
    }
  }

  function appendReadings() {
    db.exec("BEGIN");
    try {
      writeReadings();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  if (countPanels.get().count === 0) {
    db.exec("BEGIN");
    try {
      for (let index = 0; index < PANEL_COUNT; index += 1) {
        const panel = panelAddress(index);
        insertPanel.run(index, panel.id, panel.row, panel.col);
      }
      writeReadings();
      persistState();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function summary(panels) {
    const statuses = Object.groupBy(panels, panel => panel.status);
    const available = panels.filter(panel => panel.power !== null);
    const average = field => {
      const values = available.map(panel => panel[field]).filter(Number.isFinite);
      return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : null;
    };
    return {
      powerKw: Math.round(available.reduce((sum, panel) => sum + panel.power, 0) / 100) / 10,
      averageTemperature: average("temperature"),
      averageEfficiency: average("efficiency"),
      normal: statuses.normal?.length ?? 0,
      warning: statuses.warning?.length ?? 0,
      critical: statuses.critical?.length ?? 0,
      offline: statuses.offline?.length ?? 0,
    };
  }

  return {
    collectScheduled(at) { return telemetry.collect(at); },
    collectionStatus() { return telemetry.status(); },
    seedHistory() { telemetry.seed(); },
    history(date) { return telemetry.history(date); },
    ingest(batch) { return telemetry.ingest(batch); },
    showCollection() {
      if (!lifecycleActive) {
        preview = false;
        persistState();
      }
      return this.snapshot();
    },
    tick() {
      preview = true;
      currentTime = new Date(currentTime.getTime() + MINUTE);
      tickNumber += 1;
      appendReadings();
      persistState();
      return this.snapshot();
    },
    activateScenario(nextScenario) {
      if (!scenarioNames.includes(nextScenario)) throw new Error(`Unknown scenario: ${nextScenario}`);
      scenario = nextScenario;
      clearAlerts.run();
      const alert = messageFor(scenario);
      if (alert) insertAlert.run(alert.code, alert.severity, alert.message, currentTime.toISOString());
      this.tick();
      return this.snapshot();
    },
    snapshot(at) {
      const collection = this.collectionStatus();
      if (at && !telemetry.panels(at).length) return null;
      if (at) collection.latestSample = at;
      const useScheduled = !preview && Boolean(collection.latestSample);
      const stored = useScheduled ? new Map(telemetry.panels(collection.latestSample).map(row => [row.panel, row])) : null;
      const panels = stored ? Array.from({ length: PANEL_COUNT }, (_, index) => {
        const { power = null, temperature = null, voltage = null, current = null, efficiency = null, status = "offline", quality = null, lux = null, ambient = null, fault = null } = stored.get(index) ?? {};
        return { index, ...panelAddress(index), power, temperature, voltage, current, efficiency, status, quality, lux, ambient, fault };
      }) : panelRows.all();
      const currentPhase = lifecyclePhases[Math.max(0, lifecycleStep - 1)];
      const site = useScheduled ? telemetry.latest() : null;
      const alerts = useScheduled ? panels.filter(panel => ["warning", "critical", "offline"].includes(panel.status))
        .map(panel => ({ panelId: panel.id, severity: panel.status === "critical" ? "critical" : "warning", status: panel.status }))
        : activeAlerts.all();
      return { generatedAt: useScheduled ? collection.latestSample : currentTime.toISOString(), scenario: useScheduled ? "normal" : scenario, panels, summary: summary(panels), site: site && { irradiance: site.irradiance, frequency: site.frequency }, alerts, collection, mode: useScheduled ? "scheduled" : "preview", readingCount: readingCount.get().count, telemetryIntervalSeconds: 60, analyticsIntervalSeconds: 3600, lifecycle: { active: lifecycleActive, step: lifecycleStep, total: lifecyclePhases.length, label: lifecycleStep ? currentPhase.label : "Lifecycle ready", events: eventRows.all(), ...(lifecycleSeries.length ? { series: lifecycleSeries } : {}) } };
    },
    startLifecycle() {
      if (lifecycleActive) return this.snapshot();
      preview = true;
      lifecycleStep = 0;
      lifecycleSeries = [];
      lifecycleActive = true;
      scenario = "normal";
      clearAlerts.run();
      clearEvents.run();
      persistState();
      return this.snapshot();
    },
    advanceLifecycle() {
      if (!lifecycleActive) return this.snapshot();
      const phase = lifecyclePhases[lifecycleStep];
      scenario = phase.scenario;
      clearAlerts.run();
      const alert = messageFor(scenario);
      if (alert) insertAlert.run(alert.code, alert.severity, alert.message, currentTime.toISOString());
      insertEvent.run(lifecycleStep + 1, scenario, phase.kind, phase.label, currentTime.toISOString());
      currentTime = new Date(currentTime.getTime() + MINUTE);
      tickNumber += 1;
      appendReadings();
      lifecycleStep += 1;
      const panels = panelRows.all();
      const previous = lifecycleSeries.at(-1);
      const stats = field => {
        const values = panels.map(panel => panel[field]).filter(Number.isFinite);
        return { average: values.reduce((a, b) => a + b, 0) / values.length, min: Math.min(...values), max: Math.max(...values) };
      };
      const temperature = stats("temperature");
      const voltage = stats("voltage");
      const current = stats("current");
      const available = panels.filter(panel => panel.power !== null).length;
      lifecycleSeries.push({
        step: lifecycleStep, scenario, samples: 1, power: summary(panels).powerKw,
        temperature: temperature.average, tempMin: temperature.min, tempMax: temperature.max,
        voltage: voltage.average, voltageMin: voltage.min, voltageMax: voltage.max,
        current: current.average, currentMin: current.min, currentMax: current.max,
        efficiency: summary(panels).averageEfficiency,
        irradiance: Math.round(780 + 95 * Math.sin(tickNumber / 3) - (scenario === "shading" ? 230 : 0)),
        frequency: 50 + Math.round(70 * Math.sin(tickNumber / 4) + (scenario === "inverter" ? 260 : 0)) / 1000,
        recorded: 100, availability: 100 * available / PANEL_COUNT,
        warning: previous?.scenario !== scenario && alert?.severity === "warning" ? 1 : 0,
        critical: previous?.scenario !== scenario && alert?.severity === "critical" ? 1 : 0
      });
      if (lifecycleStep === lifecyclePhases.length) lifecycleActive = false;
      persistState();
      return this.snapshot();
    },
    scheduledTick() { return lifecycleActive ? this.advanceLifecycle() : this.tick(); },
    close() { db.close(); },
    scenarios: scenarioNames,
  };
}
