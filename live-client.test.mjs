import assert from "node:assert/strict";
import test from "node:test";
import { lifecycleProgress, metricCatalog, selectedMetrics, formatMetric } from "./live-client.mjs";

test("metric summaries round measured values while preserving missing data", () => {
  assert.equal(formatMetric(22.108287545787547), "22.1");
  assert.equal(formatMetric(null), "—");
});

test("analysis catalog only offers metrics backed by imported telemetry", () => {
  assert.equal(metricCatalog.length, 7);
  assert.deepEqual(metricCatalog.map(metric => metric.id), ["power", "temperature", "voltage", "current", "illuminance", "availability", "alerts"]);
  assert.deepEqual(selectedMetrics([]), ["power", "temperature", "alerts"]);
  assert.deepEqual(selectedMetrics(["power", "frequency", "efficiency", "invalid"]), ["power"]);
});

test("lifecycle progress reports a bounded 15-step simulation", () => {
  assert.deepEqual(lifecycleProgress({ step: 3, total: 15 }), { current: 3, total: 15, percent: 20 });
  assert.deepEqual(lifecycleProgress(null), { current: 0, total: 15, percent: 0 });
});
