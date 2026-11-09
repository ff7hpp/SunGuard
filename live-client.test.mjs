import assert from "node:assert/strict";
import test from "node:test";
import { lifecycleProgress, metricCatalog, selectedMetrics } from "./live-client.mjs";

test("analysis catalog provides nine metrics and preserves a focused default", () => {
  assert.equal(metricCatalog.length, 9);
  assert.deepEqual(selectedMetrics([]), ["power", "temperature", "alerts"]);
  assert.deepEqual(selectedMetrics(["power", "frequency", "invalid"]), ["power", "frequency"]);
});

test("lifecycle progress reports a bounded 15-step simulation", () => {
  assert.deepEqual(lifecycleProgress({ step: 3, total: 15 }), { current: 3, total: 15, percent: 20 });
  assert.deepEqual(lifecycleProgress(null), { current: 0, total: 15, percent: 0 });
});
