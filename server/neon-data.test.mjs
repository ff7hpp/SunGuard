import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotFromRows, historyFromRows, parsePanelNumber } from './neon-data.mjs';
import { renderHistory } from '../history-charts.mjs';
import { databaseUrl } from './neon-db.mjs';

test('SunGuard-specific database configuration takes precedence', () => {
  assert.equal(databaseUrl({ SUNGUARD_DATABASE_URL: 'selected', DATABASE_URL: 'other' }), 'selected');
  assert.equal(databaseUrl({ DATABASE_URL: 'fallback' }), 'fallback');
});

test('snapshot preserves imported values and represents missing panels as offline', () => {
  const snapshot = snapshotFromRows('2026-10-01T06:00:00.000Z', [{ panel_id: 1, voltage: 6.2375, current: .112, power: .687520953389545, temperature: 22.5, lux: 2756, ambient: 22.14215502497602, fault: 'normal', status: 'normal' }]);
  assert.equal(snapshot.panels.length, 300);
  assert.equal(snapshot.panels[0].power, .687520953389545);
  assert.equal(snapshot.panels[0].lux, 2756);
  assert.equal(snapshot.panels[1].status, 'offline');
  assert.equal(snapshot.collection.imported, true);
});

test('panel history accepts only valid array positions', () => {
  assert.equal(parsePanelNumber('1'), 1);
  assert.equal(parsePanelNumber('300'), 300);
  for (const value of ['0', '301', '1.5', '1 OR 1=1', '', null]) assert.equal(parsePanelNumber(value), null);
});

test('history uses actual dates and leaves unrecorded metrics empty', () => {
  const data = historyFromRows([{ time: '2026-10-01T06:00:00.000Z', power: 1, temperature: 22, voltage: 6, current: .1, recorded: 300, available: 300, illuminance: 2756 }], [], '2026-10-01');
  assert.equal(data.minutes[0].minute, 540);
  assert.equal(data.minutes[0].power, 1);
  assert.equal(data.minutes[0].efficiency, null);
  assert.equal(data.imported, true);
  const html = renderHistory(data);
  assert.equal((html.match(/class="paper history-card"/g) ?? []).length, 9);
  assert.match(html, /Not recorded in the imported file/);
  assert.match(html, /Illuminance/);
});
