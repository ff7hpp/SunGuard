import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';

const path = process.argv[2];
if (!path || !process.env.DATABASE_URL_UNPOOLED) throw new Error('Usage: npm run neon:import -- <CSV path>; DATABASE_URL_UNPOOLED is required');
const expected = 'datetime,voltage_v,current_a,power_w,panel_temperature_c,light_lux,ambient_temperature_c,fault_type,panel_id';
const input = createReadStream(path, { encoding: 'utf8', highWaterMark: 64 * 1024 });
let head = '';
for await (const chunk of input) { head += chunk; if (head.includes('\n')) break; if (head.length > 4096) throw new Error('Invalid CSV header'); }
if (head.split(/\r?\n/, 1)[0].replace(/^\uFEFF/, '') !== expected) throw new Error('Unexpected CSV header');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL_UNPOOLED });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query(`CREATE TEMP TABLE import_raw (datetime text, voltage text, current text, power text, temperature text, lux text, ambient text, fault text, panel_id text) ON COMMIT DROP`);
  await pipeline(createReadStream(path), client.query(copyFrom('COPY import_raw FROM STDIN WITH (FORMAT csv, HEADER true)')));
  const invalid = await client.query(`SELECT count(*)::int AS count FROM import_raw WHERE datetime !~ '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:00$' OR panel_id !~ '^([1-9]|[1-9][0-9]|[12][0-9][0-9]|300)$' OR fault NOT IN ('normal','hot_panel','open_circuit','dust_degradation','partial_shading','loose_connection','full_shading','sensor_spike') OR voltage !~ '^[+]?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?$' OR current !~ '^[+]?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?$' OR power !~ '^[+]?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?$' OR temperature !~ '^[-+]?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?$' OR lux !~ '^[+]?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?$' OR ambient !~ '^[-+]?[0-9]+([.][0-9]+)?([eE][-+]?[0-9]+)?$' OR datetime IS NULL OR panel_id IS NULL OR fault IS NULL OR voltage IS NULL OR current IS NULL OR power IS NULL OR temperature IS NULL OR lux IS NULL OR ambient IS NULL`);
  if (invalid.rows[0].count) throw new Error(`CSV has ${invalid.rows[0].count} invalid readings`);
  await client.query(`CREATE TEMP TABLE import_typed ON COMMIT DROP AS SELECT panel_id::integer AS panel_id, datetime::timestamp AS original_datetime, datetime::timestamp AT TIME ZONE 'Europe/Istanbul' AS measured_at, voltage::numeric AS voltage, current::numeric AS current, power::numeric AS power, temperature::numeric AS temperature, lux::numeric AS lux, ambient::numeric AS ambient, fault FROM import_raw`);
  const stats = await client.query('SELECT count(*)::int AS rows, count(DISTINCT panel_id)::int AS panels, count(DISTINCT measured_at)::int AS minutes FROM import_typed');
  if (!stats.rows[0].rows) throw new Error('CSV contains no readings');
  const duplicates = await client.query('SELECT 1 FROM import_typed GROUP BY panel_id, measured_at HAVING count(*) > 1 LIMIT 1');
  if (duplicates.rowCount) throw new Error('CSV contains duplicate panel/timestamp keys');
  const conflicts = await client.query(`SELECT 1 FROM import_typed i JOIN sunguard.readings r USING(panel_id, measured_at) WHERE (i.original_datetime,i.voltage,i.current,i.power,i.temperature,i.lux,i.ambient,i.fault) IS DISTINCT FROM (r.original_datetime,r.voltage,r.current,r.power,r.temperature,r.lux,r.ambient,r.fault) LIMIT 1`);
  if (conflicts.rowCount) throw new Error('CSV conflicts with an existing reading; no data was changed');
  const inserted = await client.query(`INSERT INTO sunguard.readings(panel_id,measured_at,original_datetime,voltage,current,power,temperature,lux,ambient,fault) SELECT panel_id,measured_at,original_datetime,voltage,current,power,temperature,lux,ambient,fault FROM import_typed ON CONFLICT (panel_id,measured_at) DO NOTHING`);
  const verified = await client.query(`SELECT count(*)::int AS count FROM import_typed i JOIN sunguard.readings r USING(panel_id,measured_at) WHERE (i.original_datetime,i.voltage,i.current,i.power,i.temperature,i.lux,i.ambient,i.fault) IS NOT DISTINCT FROM (r.original_datetime,r.voltage,r.current,r.power,r.temperature,r.lux,r.ambient,r.fault)`);
  if (verified.rows[0].count !== stats.rows[0].rows) throw new Error('Post-import verification failed');
  await client.query('COMMIT');
  console.log(JSON.stringify({ ...stats.rows[0], inserted: inserted.rowCount, verified: verified.rows[0].count, timestampZone: 'Europe/Istanbul' }));
} catch (error) { await client.query('ROLLBACK'); throw error; } finally { await client.end(); }
