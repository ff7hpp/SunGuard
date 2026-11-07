import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";

const file = new URL("./farm.js", import.meta.url);
const farm = existsSync(file) ? await import(file) : {};

test("all 500 positions are unique and the example fault has the right address", () => {
  assert.equal(farm.panels?.length, 500);
  assert.equal(new Set(farm.panels.map(panel => panel.id)).size, 500);
  assert.equal(farm.panels[102].id, "R05-C03");
  assert.equal(farm.panels[102].status, "critical");
});

test("a simulated isolation stops output and keeps the original sample", () => {
  assert.equal(typeof farm.isolate, "function");
  const original = farm.panels[102];
  const isolated = farm.isolate(original);
  assert.equal(isolated.status, "isolated");
  assert.equal(isolated.power, 0);
  assert.equal(original.status, "critical");
  assert.equal(farm.isolate(farm.panels[487]).status, "offline");
});
