import { COLUMNS, PANEL_COUNT } from "../grid.js";
import { collectionWindow, historyDates, openingTime } from "./schedule.mjs";

const MINUTE = 60_000;
const statuses = ["normal", "warning", "critical", "offline", "isolated"];
const fields = ["power", "temperature", "voltage", "current", "efficiency"];
const limits = [[0, 1e6], [-100, 200], [0, 1e5], [0, 1e5], [0, 100]];

export function panelId(index) {
  const row = String(Math.floor(index / COLUMNS) + 1).padStart(2, "0");
  const col = String(index % COLUMNS + 1).padStart(2, "0");
  return `R${row}-C${col}`;
}

const indexes = new Map(Array.from({ length: PANEL_COUNT }, (_, index) => [panelId(index), index]));

export class SimulationTelemetryProvider {
  sourceType = "simulated";

  read(timestamp, quality = "observed") {
    const time = Date.parse(timestamp);
    const slot = collectionWindow(new Date(time)).minute - 540;
    const wave = Math.sin(Math.PI * slot / 510);
    const day = Math.floor(time / 86_400_000);
    const irradiance = Math.round(180 + (650 + 90 * Math.sin(day)) * wave);
    const frequency = 50 + Math.round(9 * Math.sin(time / MINUTE / 23)) / 100;
    const panels = Array.from({ length: PANEL_COUNT }, (_, index) => {
      const variation = Math.sin(index / 7 + time / MINUTE / 15);
      const status = slot >= 160 && slot < 195 && index === day % PANEL_COUNT ? "warning"
        : slot >= 240 && slot < 260 && index === (day + 15) % PANEL_COUNT ? "critical"
        : slot >= 380 && slot < 410 && index === (day + 30) % PANEL_COUNT ? "offline" : "normal";
      const voltage = 39 + variation * 2;
      const temperature = status === "critical" ? 74 : 24 + 30 * wave + variation * 3;
      const efficiency = 91 - (temperature - 24) / 5 - (status === "warning" ? 12 : 0);
      const power = Math.round(irradiance * 0.6 * efficiency / 100);
      const metrics = status === "offline"
        ? { power: null, temperature: null, voltage: null, current: null, efficiency: null }
        : { power, temperature, voltage, current: power / voltage, efficiency };
      return { panel_id: panelId(index), status, ...metrics };
    });
    return { timestamp_utc: timestamp, source_type: this.sourceType, quality_status: quality, panels, irradiance, frequency };
  }
}

// A gateway adapter can fetch asynchronously and supply normalized batches to ingest().
// For scheduled collection, inject a synchronous reader backed by a gateway buffer.
export class RealTelemetryProvider {
  sourceType = "real";

  constructor(readNormalizedBatch) {
    if (typeof readNormalizedBatch !== "function") throw new TypeError("Gateway reader required");
    this.read = readNormalizedBatch;
  }
}

function measure(value, low, high) {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < low || value > high) throw new Error("Invalid telemetry value");
  return value;
}

function validate(batch, now, source) {
  const time = Date.parse(batch.timestamp_utc);
  if (!Number.isFinite(time) || time % MINUTE || time > now.getTime()
    || new Date(time).toISOString() !== batch.timestamp_utc || !collectionWindow(new Date(time)).active) {
    throw new Error("Invalid telemetry timestamp");
  }
  if (!["simulated", "real"].includes(source) || batch.source_type !== source
    || !["observed", "seeded", "estimated"].includes(batch.quality_status)
    || (source === "real" && batch.quality_status === "seeded")) throw new Error("Invalid telemetry provenance");
  const seen = new Set();
  const panels = batch.panels.map(panel => {
    const index = indexes.get(panel.panel_id);
    if (index === undefined || seen.has(index) || !statuses.includes(panel.status)) throw new Error("Invalid panel telemetry");
    seen.add(index);
    const values = fields.map((field, i) => measure(panel[field], ...limits[i]));
    if (panel.status === "offline" && values.some(value => value !== null)) throw new Error("Offline panel has measurements");
    return [index, ...values, panel.status];
  });
  return { panels, irradiance: measure(batch.irradiance, 0, 2000), frequency: measure(batch.frequency, 0, 100) };
}

const mean = values => {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
};

export function createTelemetry(db, now, provider, { readOnly = false } = {}) {
  if (!readOnly) db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry_minutes (
      source TEXT NOT NULL, time TEXT NOT NULL, quality TEXT NOT NULL,
      irradiance REAL, frequency REAL, PRIMARY KEY(source, time)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS telemetry_panels (
      source TEXT NOT NULL, time TEXT NOT NULL, panel INTEGER NOT NULL, quality TEXT NOT NULL,
      power REAL, temperature REAL, voltage REAL, current REAL, efficiency REAL, status TEXT NOT NULL,
      PRIMARY KEY(source, time, panel)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS csv_panel_details (
      time TEXT NOT NULL, panel INTEGER NOT NULL, lux REAL NOT NULL, ambient REAL NOT NULL,
      fault TEXT NOT NULL, PRIMARY KEY(time, panel)
    ) WITHOUT ROWID;
    INSERT OR IGNORE INTO telemetry_minutes
      SELECT source, captured_at, 'observed', NULL, NULL FROM scheduled_readings GROUP BY source, captured_at;
    INSERT OR IGNORE INTO telemetry_panels
      SELECT source, captured_at, panel_index, 'observed', power_w, temperature_c,
        voltage_v, current_a, efficiency_pct, status FROM scheduled_readings;
  `);
  const imported = !provider && Boolean(db.prepare("SELECT 1 FROM csv_panel_details LIMIT 1").get());
  provider ??= imported ? new RealTelemetryProvider(() => null) : new SimulationTelemetryProvider();
  const source = provider.sourceType;
  const insertMinute = db.prepare(`
    INSERT INTO telemetry_minutes VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source,time) DO UPDATE SET
      irradiance=COALESCE(telemetry_minutes.irradiance,excluded.irradiance),
      frequency=COALESCE(telemetry_minutes.frequency,excluded.frequency)
    WHERE (telemetry_minutes.irradiance IS NULL AND excluded.irradiance IS NOT NULL)
       OR (telemetry_minutes.frequency IS NULL AND excluded.frequency IS NOT NULL)`);
  const insertPanel = db.prepare(`
    INSERT INTO telemetry_panels VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source,time,panel) DO UPDATE SET
      power=COALESCE(telemetry_panels.power,excluded.power),
      temperature=COALESCE(telemetry_panels.temperature,excluded.temperature),
      voltage=COALESCE(telemetry_panels.voltage,excluded.voltage),
      current=COALESCE(telemetry_panels.current,excluded.current),
      efficiency=COALESCE(telemetry_panels.efficiency,excluded.efficiency),
      status=CASE WHEN telemetry_panels.status='offline' THEN excluded.status ELSE telemetry_panels.status END
    WHERE (telemetry_panels.status='offline' AND excluded.status!='offline')
       OR (telemetry_panels.power IS NULL AND excluded.power IS NOT NULL)
       OR (telemetry_panels.temperature IS NULL AND excluded.temperature IS NOT NULL)
       OR (telemetry_panels.voltage IS NULL AND excluded.voltage IS NOT NULL)
       OR (telemetry_panels.current IS NULL AND excluded.current IS NOT NULL)
       OR (telemetry_panels.efficiency IS NULL AND excluded.efficiency IS NOT NULL)`);
  const complete = db.prepare("SELECT 1 FROM telemetry_minutes WHERE source=? AND time=?");
  const latest = db.prepare("SELECT * FROM telemetry_minutes WHERE source=? AND time<=? ORDER BY time DESC LIMIT 1");
  const readPanels = db.prepare(`SELECT p.*, d.lux, d.ambient, d.fault FROM telemetry_panels p
    LEFT JOIN csv_panel_details d ON p.source='real' AND d.time=p.time AND d.panel=p.panel
    WHERE p.source=? AND p.time=? ORDER BY p.panel`);
  let revision = 0;
  const range = db.prepare(`
    SELECT m.time, m.quality, m.irradiance, m.frequency, SUM(p.power)/1000.0 AS power,
      MIN(p.temperature) AS tempMin, MAX(p.temperature) AS tempMax, AVG(p.temperature) AS temperature,
      AVG(p.voltage) AS voltage, MIN(p.voltage) AS voltageMin, MAX(p.voltage) AS voltageMax,
      AVG(p.current) AS current, MIN(p.current) AS currentMin, MAX(p.current) AS currentMax,
      AVG(p.efficiency) AS efficiency, AVG(d.lux) AS illuminance, AVG(d.ambient) AS ambient, COUNT(p.panel) AS recorded,
      SUM(CASE WHEN p.status IN ('normal','warning','critical') AND p.power IS NOT NULL THEN 1 ELSE 0 END) AS available
    FROM telemetry_minutes m LEFT JOIN telemetry_panels p USING (source, time)
    LEFT JOIN csv_panel_details d ON m.source='real' AND d.time=p.time AND d.panel=p.panel
    WHERE m.source=? AND m.time>=? AND m.time<=? GROUP BY m.time ORDER BY m.time`);
  const faults = db.prepare(`
    SELECT p.time, p.panel, p.status FROM telemetry_panels p
    WHERE p.source=? AND p.time>=? AND p.time<=? AND p.status IN ('warning','critical','offline')
      AND NOT EXISTS (
        SELECT 1 FROM telemetry_panels prev WHERE prev.source=p.source AND prev.panel=p.panel
        AND prev.time=strftime('%Y-%m-%dT%H:%M:%fZ',p.time,'-1 minute') AND prev.status=p.status
      ) ORDER BY p.time,p.panel`);

  function write(batch, clock) {
    const { panels, irradiance, frequency } = validate(batch, clock, source);
    const time = batch.timestamp_utc;
    const siteChanges = insertMinute.run(source, time, batch.quality_status, irradiance, frequency).changes;
    let inserted = 0;
    for (const [index, ...values] of panels) {
      inserted += insertPanel.run(source, time, index, batch.quality_status, ...values).changes;
    }
    if (siteChanges || inserted) revision++;
    return inserted;
  }

  function transaction(action) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  let cache;
  return {
    ingest(batch, clock = now()) { return transaction(() => write(batch, clock)); },
    collect(at = now()) {
      const window = collectionWindow(at);
      if (imported || !window.active) return { ...window, active: false, inserted: 0 };
      const batch = provider.read(window.sampleTime);
      if (batch && batch.timestamp_utc !== window.sampleTime) throw new Error("Provider returned a different minute");
      return { ...window, pending: !batch, inserted: batch ? this.ingest(batch, at) : 0 };
    },
    seed(at = now()) {
      if (!(provider instanceof SimulationTelemetryProvider)) return;
      transaction(() => {
        for (const date of historyDates(at)) {
          const start = openingTime(date);
          for (let slot = 0; slot <= 510 && start + slot * MINUTE < at.getTime() - at.getTime() % MINUTE; slot++) {
            const time = new Date(start + slot * MINUTE).toISOString();
            if (!complete.get(source, time)) write(provider.read(time, "seeded"), at);
          }
        }
      });
    },
    latest() {
      return latest.get(source, now().toISOString());
    },
    panels(time) { return readPanels.all(source, time); },
    panelHistory(panel) {
      return db.prepare(`SELECT p.time, p.power, p.temperature, p.voltage, p.current, d.fault
        FROM telemetry_panels p JOIN csv_panel_details d ON d.time=p.time AND d.panel=p.panel
        WHERE p.source='real' AND p.panel=? ORDER BY p.time DESC LIMIT 30`).all(panel - 1);
    },
    status() {
      const row = this.latest();
      const window = collectionWindow(now());
      return { ...window, active: !imported && window.active, imported, latestSample: row?.time ?? null, source, quality: row?.quality ?? null, revision };
    },
    history(date) {
      const clock = now();
      const dates = historyDates(imported ? new Date(this.latest().time) : clock);
      if (date && !dates.includes(date)) return null;
      const key = `${dates.at(-1)}:${revision}`;
      if (cache?.key !== key) {
        const first = new Date(openingTime(dates[0])).toISOString();
        const rows = range.all(source, first, clock.toISOString());
        const incidents = faults.all(source, first, clock.toISOString()).map(event => ({
          ...event, panelId: panelId(event.panel), severity: event.status === "critical" ? "critical" : "warning"
        }));
        const byDay = new Map(dates.map(day => [day, { minutes: [], incidents: [] }]));
        for (const row of rows) {
          const { localDate, minute } = collectionWindow(new Date(row.time));
          byDay.get(localDate)?.minutes.push({ ...row, date: localDate, minute, availability: row.recorded ? 100 * row.available / PANEL_COUNT : null });
        }
        for (const event of incidents) byDay.get(collectionWindow(new Date(event.time)).localDate)?.incidents.push(event);
        const days = dates.map(day => {
          const { minutes, incidents: events } = byDay.get(day);
          const averages = Object.fromEntries(["power","temperature","voltage","current","efficiency","frequency","availability"]
            .map(metric => [metric, mean(minutes.map(row => row[metric]))]));
          const temperatures = minutes.filter(row => row.tempMin !== null);
          return {
            date: day, ...averages, samples: minutes.length,
            tempMin: temperatures.length ? Math.min(...temperatures.map(row => row.tempMin)) : null,
            tempMax: temperatures.length ? Math.max(...temperatures.map(row => row.tempMax)) : null,
            voltageMin: mean(minutes.map(row => row.voltageMin)),
            voltageMax: mean(minutes.map(row => row.voltageMax)),
            currentMin: mean(minutes.map(row => row.currentMin)),
            currentMax: mean(minutes.map(row => row.currentMax)),
            recorded: mean(minutes.map(row => 100 * row.recorded / PANEL_COUNT)),
            hourly: Array.from({ length: 9 }, (_, hour) =>
              mean(minutes.filter(row => Math.floor(row.minute / 60) === 9 + hour).map(row => row.irradiance))),
            warning: events.filter(event => event.severity === "warning").length,
            critical: events.filter(event => event.severity === "critical").length
          };
        });
        cache = { key, byDay, days };
      }
      const selected = date ? cache.byDay.get(date) : null;
      return { source, imported, timezone: "Europe/Istanbul", days: cache.days, date: date ?? null,
        minutes: selected?.minutes ?? [...cache.byDay.values()].flatMap(day => day.minutes),
        incidents: selected?.incidents ?? [...cache.byDay.values()].flatMap(day => day.incidents) };
    }
  };
}
