import assert from "node:assert/strict";
import test from "node:test";
import { metricCatalog, selectedMetrics } from "./live-client.mjs";

test("analysis catalog provides nine metrics and preserves a focused default", () => {
  assert.equal(metricCatalog.length, 9);
  assert.deepEqual(selectedMetrics([]), ["power", "temperature", "alerts"]);
  assert.deepEqual(selectedMetrics(["power", "frequency", "invalid"]), ["power", "frequency"]);
});
