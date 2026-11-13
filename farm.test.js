import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";

const file = new URL("./farm.js", import.meta.url);
const farm = existsSync(file) ? await import(file) : {};

test("all 300 positions are unique and the example fault has the right address", () => {
  assert.equal(farm.panels?.length, 300);
  assert.equal(new Set(farm.panels.map(panel => panel.id)).size, 300);
  assert.equal(farm.panels[62].id, "R05-C03");
  assert.equal(farm.panels[62].status, "critical");
});

test("a simulated isolation stops output and keeps the original sample", () => {
  assert.equal(typeof farm.isolate, "function");
  const original = farm.panels[62];
  const isolated = farm.isolate(original);
  assert.equal(isolated.status, "isolated");
  assert.equal(isolated.power, 0);
  assert.equal(original.status, "critical");
  assert.equal(farm.isolate(farm.panels[287]).status, "offline");
});
