import { DatabaseSync } from "node:sqlite";

const PANEL_COUNT = 500;
const MINUTE = 60_000;
const scenarioNames = ["normal", "dust", "overheat", "shading", "inverter", "missing"];

function panelAddress(index) {
  return { id: `R${String(Math.floor(index / 25) + 1).padStart(2, "0")}-C${String(index % 25 + 1).padStart(2, "0")}`, row: Math.floor(index / 25) + 1, col: index % 25 + 1 };
}

function scenarioStatus(index, scenario) {
  if (scenario === "dust" && index >= 100 && index < 125) return "warning";
  if (scenario === "overheat" && [102, 368].includes(index)) return "critical";
  if (scenario === "shading" && index >= 245 && index < 260) return "warning";
  if (scenario === "inverter" && index >= 300 && index < 325) return "warning";
  if (scenario === "missing" && [212, 487, 492].includes(index)) return "offline";
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

export function createSimulation({ databasePath, now = () => new Date() }) {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS panels (panel_index INTEGER PRIMARY KEY, panel_id TEXT UNIQUE NOT NULL, row_number INTEGER NOT NULL, column_number INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS readings (id INTEGER PRIMARY KEY, panel_index INTEGER NOT NULL, captured_at TEXT NOT NULL, power_w REAL, temperature_c REAL, voltage_v REAL, current_a REAL, efficiency_pct REAL, status TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS readings_panel_time ON readings(panel_index, captured_at DESC);
    CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY, code TEXT NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL, active INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
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

  let currentTime = new Date(getMeta.get("generatedAt")?.value ?? now().toISOString());
  let tickNumber = Number(getMeta.get("tickNumber")?.value ?? 0);
  let scenario = getMeta.get("scenario")?.value ?? "normal";

  function persistState() {
    setMeta.run("generatedAt", currentTime.toISOString());
    setMeta.run("tickNumber", String(tickNumber));
    setMeta.run("scenario", scenario);
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
    return {
      powerKw: Math.round(available.reduce((sum, panel) => sum + panel.power, 0) / 100) / 10,
      averageTemperature: Math.round(available.reduce((sum, panel) => sum + panel.temperature, 0) / Math.max(available.length, 1) * 10) / 10,
      averageEfficiency: Math.round(available.reduce((sum, panel) => sum + panel.efficiency, 0) / Math.max(available.length, 1) * 10) / 10,
      normal: statuses.normal?.length ?? 0,
      warning: statuses.warning?.length ?? 0,
      critical: statuses.critical?.length ?? 0,
      offline: statuses.offline?.length ?? 0,
    };
  }

  return {
    tick() {
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
    snapshot() {
      const panels = panelRows.all();
      return { generatedAt: currentTime.toISOString(), scenario, panels, summary: summary(panels), alerts: activeAlerts.all(), readingCount: readingCount.get().count, telemetryIntervalSeconds: 60, analyticsIntervalSeconds: 3600 };
    },
    close() { db.close(); },
    scenarios: scenarioNames,
  };
}
