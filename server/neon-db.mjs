import pg from 'pg';
import { attachDatabasePool } from '@vercel/functions';
import { snapshotFromRows, historyFromRows } from './neon-data.mjs';

let pool;
export const databaseUrl = (env = process.env) => env.SUNGUARD_DATABASE_URL || env.DATABASE_URL;
function db() {
  if (!databaseUrl()) throw new Error('Database URL is not configured');
  if (!pool) { pool = new pg.Pool({ connectionString: databaseUrl(), max: 5 }); attachDatabasePool(pool); }
  return pool;
}
const status = `CASE WHEN fault IN ('hot_panel','open_circuit') THEN 'critical' WHEN fault = 'normal' THEN 'normal' ELSE 'warning' END`;
async function latest() {
  const { rows } = await db().query('SELECT max(measured_at) AS time FROM sunguard.readings');
  return rows[0].time;
}
export async function snapshot() {
  const time = await latest();
  if (!time) return null;
  const { rows } = await db().query(`SELECT panel_id, voltage::float8 AS voltage, current::float8 AS current, power::float8 AS power, temperature::float8 AS temperature, lux::float8 AS lux, ambient::float8 AS ambient, fault, ${status} AS status FROM sunguard.readings WHERE measured_at=$1 ORDER BY panel_id`, [time]);
  return snapshotFromRows(time, rows);
}
export async function panelHistory(panel) {
  const { rows } = await db().query(`SELECT measured_at AS time, power::float8 AS power, temperature::float8 AS temperature, voltage::float8 AS voltage, current::float8 AS current, fault FROM sunguard.readings WHERE panel_id=$1 ORDER BY measured_at DESC LIMIT 30`, [panel]);
  return { panel, timezone: 'Europe/Istanbul', readings: rows };
}
export async function history(date) {
  const time = await latest();
  if (!time) return null;
  const params = [time];
  const { rows } = await db().query(`SELECT measured_at AS time, (sum(power)/1000)::float8 AS power, (avg(temperature))::float8 AS temperature, (min(temperature))::float8 AS "tempMin", (max(temperature))::float8 AS "tempMax", (avg(voltage))::float8 AS voltage, (min(voltage))::float8 AS "voltageMin", (max(voltage))::float8 AS "voltageMax", (avg(current))::float8 AS current, (min(current))::float8 AS "currentMin", (max(current))::float8 AS "currentMax", (avg(lux))::float8 AS illuminance, (avg(ambient))::float8 AS ambient, count(*)::int AS recorded, count(*)::int AS available FROM sunguard.readings WHERE measured_at > $1::timestamptz - interval '7 days' AND measured_at <= $1 GROUP BY measured_at ORDER BY measured_at`, params);
  const { rows: incidents } = await db().query(`SELECT p.measured_at AS time, p.panel_id, ${status.replaceAll('fault', 'p.fault')} AS status FROM sunguard.readings p WHERE p.measured_at > $1::timestamptz - interval '7 days' AND p.measured_at <= $1 AND p.fault <> 'normal' AND NOT EXISTS (SELECT 1 FROM sunguard.readings prev WHERE prev.panel_id=p.panel_id AND prev.measured_at=p.measured_at - interval '1 minute' AND (CASE WHEN prev.fault IN ('hot_panel','open_circuit') THEN 'critical' WHEN prev.fault='normal' THEN 'normal' ELSE 'warning' END) = (${status.replaceAll('fault', 'p.fault')})) ORDER BY p.measured_at,p.panel_id`, params);
  return historyFromRows(rows, incidents, time, date);
}
