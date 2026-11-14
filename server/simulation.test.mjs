import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSimulation } from "./simulation.mjs";
import { renderSimulationCharts } from "../history-charts.mjs";

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

test("a new simulation persists 300 uniquely addressed panels", () => {
  withSimulation((simulation, databasePath) => {
    const snapshot = simulation.snapshot();
    assert.equal(existsSync(databasePath), true);
    assert.equal(snapshot.panels.length, 300);
    assert.equal(new Set(snapshot.panels.map(panel => panel.id)).size, 300);
    assert.equal(snapshot.panels[62].index, 62);
    assert.equal(snapshot.panels[62].id, "R05-C03");
  });
});

test("a simulation tick appends telemetry and changes the live snapshot", () => {
  withSimulation(simulation => {
    const before = simulation.snapshot();
    simulation.tick();
    const after = simulation.snapshot();
    assert.equal(after.readingCount, before.readingCount + 300);
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

test("a lifecycle run advances through persisted fault and recovery events", () => {
  withSimulation(simulation => {
    simulation.startLifecycle();
    simulation.advanceLifecycle();
    simulation.advanceLifecycle();
    const snapshot = simulation.advanceLifecycle();
    assert.equal(snapshot.lifecycle.active, true);
    assert.equal(snapshot.lifecycle.step, 3);
    assert.equal(snapshot.scenario, "dust");
    assert.ok(snapshot.lifecycle.events.some(event => event.kind === "fault" && event.scenario === "dust"));
    assert.deepEqual(snapshot.lifecycle.series.map(row => row.step), [1, 2, 3]);
    assert.ok(snapshot.lifecycle.series[2].power < snapshot.lifecycle.series[1].power);
    assert.equal(snapshot.lifecycle.series[2].warning, 1);
    assert.notEqual(snapshot.lifecycle.series[1].frequency, snapshot.lifecycle.series[2].frequency);
    assert.equal((renderSimulationCharts(snapshot.lifecycle).match(/class="paper history-card"/g) ?? []).length, 7);
    assert.match(renderSimulationCharts(snapshot.lifecycle), /Stage 3 of 15/);
    assert.equal(simulation.history().days.reduce((total, day) => total + day.samples, 0), 0);
  });
});
