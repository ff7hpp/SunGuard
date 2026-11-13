import { snapshot, history, panelHistory } from '../server/neon-db.mjs';
import { parsePanelNumber } from '../server/neon-data.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/api/health') { const data = await snapshot(); return data ? res.status(200).json({ status: 'ok', storage: 'neon' }) : res.status(503).json({ error: 'No imported readings' }); }
    if (path === '/api/snapshot') { const data = await snapshot(); return data ? res.status(200).json(data) : res.status(503).json({ error: 'No imported readings' }); }
    if (path === '/api/panel-history') {
      const panel = parsePanelNumber(new URL(req.url, 'http://localhost').searchParams.get('panel'));
      return panel ? res.status(200).json(await panelHistory(panel)) : res.status(400).json({ error: 'Invalid panel' });
    }
    if (path === '/api/history') {
      const date = new URL(req.url, 'http://localhost').searchParams.get('date');
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Invalid date' });
      const data = await history(date || undefined);
      return data ? res.status(200).json(data) : res.status(404).json({ error: 'History unavailable for this date' });
    }
    return res.status(404).json({ error: 'not found' });
  } catch (error) { console.error('Database request failed:', error.code || error.name); return res.status(503).json({ error: 'Database unavailable' }); }
}
