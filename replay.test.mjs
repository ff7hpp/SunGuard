import test from 'node:test';
import assert from 'node:assert/strict';
import { replaySummary } from './replay.mjs';

test('summarizes only recorded minutes and incidents', () => {
  const result = replaySummary({ minutes: [{power: 2, temperature: 30, recorded: 299}, {power: 4, temperature: 40, recorded: 300}], incidents: [{severity:'warning'}, {severity:'critical'}] });
  assert.equal(result.averagePower, 3);
  assert.equal(result.peakTemperature, 40);
  assert.equal(result.missing, 1);
  assert.equal(result.incidents, 2);
});
