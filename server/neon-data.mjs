import { PANEL_COUNT, COLUMNS } from '../grid.js';
import { collectionWindow, historyDates } from './schedule.mjs';

const iso = value => new Date(value).toISOString();
const mean = values => { const v = values.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
export const panelId = index => `R${String(Math.floor(index / COLUMNS) + 1).padStart(2, '0')}-C${String(index % COLUMNS + 1).padStart(2, '0')}`;
export function parsePanelNumber(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,2}$/.test(value)) return null;
  const number = Number(value);
  return number <= PANEL_COUNT ? number : null;
}

export function snapshotFromRows(time, rows) {
  const found = new Map(rows.map(row => [Number(row.panel_id) - 1, row]));
  const panels = Array.from({ length: PANEL_COUNT }, (_, index) => {
    const row = found.get(index);
    return { index, id: panelId(index), row: Math.floor(index / COLUMNS) + 1, col: index % COLUMNS + 1,
      power: row?.power ?? null, temperature: row?.temperature ?? null, voltage: row?.voltage ?? null,
      current: row?.current ?? null, efficiency: null, status: row?.status ?? 'offline', quality: row ? 'observed' : null,
      lux: row?.lux ?? null, ambient: row?.ambient ?? null, fault: row?.fault ?? null };
  });
  const available = panels.filter(p => p.power !== null);
  const summary = { powerKw: available.reduce((a, p) => a + p.power, 0) / 1000,
    averageTemperature: mean(available.map(p => p.temperature)), averageEfficiency: null };
  for (const status of ['normal', 'warning', 'critical', 'offline']) summary[status] = panels.filter(p => p.status === status).length;
  const sample = iso(time);
  return { generatedAt: sample, scenario: 'normal', panels, summary, site: { irradiance: null, frequency: null },
    alerts: panels.filter(p => p.status !== 'normal').map(p => ({ panelId: p.id, severity: p.status === 'critical' ? 'critical' : 'warning', status: p.status })),
    collection: { imported: true, source: 'real', latestSample: sample, sampleTime: sample, active: false, localDate: collectionWindow(new Date(sample)).localDate, revision: sample },
    mode: 'scheduled', storage: 'neon', simulationAvailable: false, telemetryIntervalSeconds: 60, analyticsIntervalSeconds: 3600,
    lifecycle: { active: false, step: 0, total: 15, label: 'Available in local simulator', events: [] } };
}

export function historyFromRows(rows, incidents, latest, date) {
  const dates = historyDates(new Date(latest));
  if (date && !dates.includes(date)) return null;
  const minutes = rows.map(row => { const time = iso(row.time); const window = collectionWindow(new Date(time));
    return { ...row, time, date: window.localDate, minute: window.minute, quality: 'observed', efficiency: null, frequency: null, irradiance: null,
      availability: Number(row.recorded) ? 100 * Number(row.available) / PANEL_COUNT : null, recorded: Number(row.recorded), available: Number(row.available) }; });
  const events = incidents.map(row => ({ time: iso(row.time), panelId: panelId(Number(row.panel_id) - 1), status: row.status, severity: row.status === 'critical' ? 'critical' : 'warning' }));
  const days = dates.map(day => { const samples = minutes.filter(row => row.date === day); const dayEvents = events.filter(row => collectionWindow(new Date(row.time)).localDate === day);
    return { date: day, samples: samples.length, ...Object.fromEntries(['power','temperature','voltage','current','efficiency','frequency','availability'].map(key => [key, mean(samples.map(row => row[key]))])),
      tempMin: samples.length ? Math.min(...samples.map(row => row.tempMin)) : null, tempMax: samples.length ? Math.max(...samples.map(row => row.tempMax)) : null,
      voltageMin: mean(samples.map(row => row.voltageMin)), voltageMax: mean(samples.map(row => row.voltageMax)), currentMin: mean(samples.map(row => row.currentMin)), currentMax: mean(samples.map(row => row.currentMax)),
      recorded: mean(samples.map(row => 100 * row.recorded / PANEL_COUNT)), hourly: Array.from({length: 9}, (_, h) => mean(samples.filter(row => Math.floor(row.minute / 60) === 9 + h).map(row => row.illuminance))),
      warning: dayEvents.filter(row => row.severity === 'warning').length, critical: dayEvents.filter(row => row.severity === 'critical').length };
  });
  return { source: 'real', imported: true, timezone: 'Europe/Istanbul', days, date: date ?? null,
    minutes: date ? minutes.filter(row => row.date === date) : minutes, incidents: date ? events.filter(row => collectionWindow(new Date(row.time)).localDate === date) : events };
}
