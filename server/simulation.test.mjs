import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSimulation } from "./simulation.mjs";

function withSimulation(run) {
  const directory = mkdtempSync(join(tmpdir(), "heliopulse-simulation-"));
  const databasePath = join(directory, "farm.db");
  const simulation = createSimulation({ databasePath, now: () => new Date("2026-11-09T12:00:00Z") });
  try {
    return run(simulation, databasePath);
  } finally {
    simulation.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("a new simulation persists 500 uniquely addressed panels", () => {
  withSimulation((simulation, databasePath) => {
    const snapshot = simulation.snapshot();
    assert.equal(existsSync(databasePath), true);
    assert.equal(snapshot.panels.length, 500);
    assert.equal(new Set(snapshot.panels.map(panel => panel.id)).size, 500);
    assert.equal(snapshot.panels[102].index, 102);
    assert.equal(snapshot.panels[102].id, "R05-C03");
  });
});

test("a simulation tick appends telemetry and changes the live snapshot", () => {
  withSimulation(simulation => {
    const before = simulation.snapshot();
    simulation.tick();
    const after = simulation.snapshot();
    assert.equal(after.readingCount, before.readingCount + 500);
    assert.notEqual(after.generatedAt, before.generatedAt);
  });
});

test("the dust scenario degrades a deterministic zone and creates an alert", () => {
  withSimulation(simulation => {
    simulation.activateScenario("dust");
    const snapshot = simulation.snapshot();
    assert.equal(snapshot.scenario, "dust");
    assert.ok(snapshot.panels.filter(panel => panel.status === "warning").length >= 9);
    assert.ok(snapshot.alerts.some(alert => alert.code === "SOIL-01"));
  });
});
