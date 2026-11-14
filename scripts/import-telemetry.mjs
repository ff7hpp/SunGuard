import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { PANEL_COUNT } from "../grid.js";
import { collectionWindow } from "../server/schedule.mjs";

const [path] = process.argv.slice(2);
if (!path) throw new Error("Usage: node scripts/import-telemetry.mjs <CSV path>");
const columns = "datetime,voltage_v,current_a,power_w,panel_temperature_c,light_lux,ambient_temperature_c,fault_type,panel_id";
const severity = new Map([
  ["normal", "normal"], ["hot_panel", "critical"], ["open_circuit", "critical"],
  ...["dust_degradation", "partial_shading", "loose_connection", "full_shading", "sensor_spike"].map(fault => [fault, "warning"])
]);
const db = new DatabaseSync(fileURLToPath(new URL("../data/sunguard.db", import.meta.url)));
db.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
let row = 0;
let inserted = 0;
const timestamps = new Map();
try {
  db.exec(`CREATE TABLE IF NOT EXISTS csv_panel_details (
    time TEXT NOT NULL, panel INTEGER NOT NULL, lux REAL NOT NULL, ambient REAL NOT NULL,
    fault TEXT NOT NULL, PRIMARY KEY(time, panel)
  ) WITHOUT ROWID`);
  const minute = db.prepare("INSERT OR IGNORE INTO telemetry_minutes(source,time,quality) VALUES ('real',?,'observed')");
  const reading = db.prepare(`
    INSERT INTO telemetry_panels(source,time,panel,quality,power,temperature,voltage,current,efficiency,status)
    VALUES ('real',?,?,'observed',?,?,?,?,NULL,?) ON CONFLICT(source,time,panel) DO NOTHING`);
  const details = db.prepare("INSERT OR IGNORE INTO csv_panel_details VALUES (?,?,?,?,?)");
  const existing = db.prepare(`SELECT power, temperature, voltage, current, status, lux, ambient, fault
    FROM telemetry_panels JOIN csv_panel_details USING(time,panel) WHERE source='real' AND time=? AND panel=?`);
  const seen = new Map();
  const input = createReadStream(path);
  for await (const line of createInterface({ input: path.endsWith('.gz') ? input.pipe(createGunzip()) : input, crlfDelay: Infinity })) {
    row++;
    if (row === 1) {
      if (line.replace(/^\uFEFF/, "") !== columns) throw new Error("Unexpected CSV header");
      continue;
    }
    if (!line.trim()) continue;
    const values = line.split(",");
    const [local, voltage, current, power, temperature, lux, ambient, fault, panelId] = values;
    if (values.length !== 9 || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:00$/.test(local) || !severity.has(fault)) {
      throw new Error(`Invalid reading at line ${row}`);
    }
    let time = timestamps.get(local);
    if (!time) {
      // This CSV uses Turkey wall time. All supplied dates are in October 2026 (UTC+03:00).
      const instant = new Date(local.replace(" ", "T") + "+03:00");
      const window = collectionWindow(instant);
      const minuteOfDay = Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
      if (!window.active || window.localDate !== local.slice(0, 10) || window.minute !== minuteOfDay || instant > new Date()) {
        throw new Error(`Invalid Istanbul timestamp at line ${row}`);
      }
      time = window.sampleTime;
      timestamps.set(local, time);
      minute.run(time);
      seen.set(time, new Uint8Array(PANEL_COUNT));
    }
    const index = Number(panelId) - 1;
    const numeric = [power, temperature, voltage, current, lux, ambient];
    if (!/^\d+$/.test(panelId) || index < 0 || index >= PANEL_COUNT || numeric.some(value => !value.trim() || !Number.isFinite(Number(value)))
      || [power, voltage, current, lux].some(value => Number(value) < 0)) throw new Error(`Invalid panel or measurement at line ${row}`);
    const keys = seen.get(time);
    if (keys[index]) throw new Error(`Duplicate panel and timestamp at line ${row}`);
    keys[index] = 1;
    const status = severity.get(fault);
    const measurements = numeric.map(Number);
    if (reading.run(time, index, ...measurements.slice(0, 4), status).changes) {
      details.run(time, index, ...measurements.slice(4), fault);
      inserted++;
    } else {
      const previous = existing.get(time, index);
      if (!previous || [...measurements, status, fault].some((value, i) =>
        value !== previous[["power","temperature","voltage","current","lux","ambient","status","fault"][i]])) {
        throw new Error(`Conflicting saved reading at line ${row}`);
      }
    }
  }
  if (!timestamps.size) throw new Error("CSV contains no readings");
  db.exec("COMMIT");
  console.log(JSON.stringify({ inserted, minutes: timestamps.size, timestampZone: "Europe/Istanbul" }));
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}
