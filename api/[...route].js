import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { createTelemetry } from '../server/telemetry.mjs';
import { parsePanelNumber, snapshotFromRows } from '../server/neon-data.mjs';

let telemetry;
function recordedData() {
  if (!telemetry) {
    const db = new DatabaseSync(resolve('data/sunguard.db'), { readOnly: true });
    telemetry = createTelemetry(db, () => new Date(), undefined, { readOnly: true });
  }
  return telemetry;
}
function snapshot(at) {
  const data = recordedData();
  const time = at ?? data.latest()?.time;
  if (!time) return null;
  const rows = data.panels(time);
  return rows.length ? { ...snapshotFromRows(time, rows.map(row => ({ ...row, panel_id: row.panel + 1 }))), storage: 'sqlite' } : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/api/health') { const data = snapshot(); return data ? res.status(200).json({ status: 'ok', storage: 'sqlite' }) : res.status(503).json({ error: 'No imported readings' }); }
    if (path === '/api/snapshot') { const at = new URL(req.url, 'http://localhost').searchParams.get('at'); if (at && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(at) || !Number.isFinite(Date.parse(at)))) return res.status(400).json({ error: 'Invalid timestamp' }); const data = await snapshot(at); return data ? res.status(200).json(data) : res.status(404).json({ error: 'No reading at this time' }); }
    if (path === '/api/panel-history') {
      const panel = parsePanelNumber(new URL(req.url, 'http://localhost').searchParams.get('panel'));
      return panel ? res.status(200).json({ panel, timezone: 'Europe/Istanbul', readings: recordedData().panelHistory(panel) }) : res.status(400).json({ error: 'Invalid panel' });
    }
    if (path === '/api/history') {
      const date = new URL(req.url, 'http://localhost').searchParams.get('date');
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });
      const data = recordedData().history(date || undefined);
      return data ? res.status(200).json(data) : res.status(404).json({ error: 'History unavailable for this date' });
    }
    return res.status(404).json({ error: 'not found' });
  } catch (error) { console.error('Database request failed:', error.code || error.name); return res.status(503).json({ error: 'Database unavailable' }); }
}
