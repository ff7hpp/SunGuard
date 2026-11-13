import test from "node:test";
import assert from "node:assert/strict";
import { collectionWindow } from "./schedule.mjs";
import { createSimulation } from "./simulation.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Istanbul collection boundaries include 17:30", () => {
  for (const [time, active] of [["05:59",false],["06:00",true],["14:29",true],["14:30",true],["14:31",false]]) {
    assert.equal(collectionWindow(new Date(`2026-11-13T${time}:00Z`)).active, active, time);
  }
});

test("scheduled samples are unique and outside hours are ignored", () => {
  const directory = mkdtempSync(join(tmpdir(), "sunguard-schedule-"));
  const simulation = createSimulation({ databasePath: join(directory, "data.db") });
  try {
    const at = new Date("2026-11-13T06:00:00Z");
    assert.equal(simulation.collectScheduled(at).inserted, 300);
    assert.equal(simulation.collectScheduled(at).inserted, 0);
    assert.equal(simulation.collectScheduled(new Date("2026-11-13T14:31:00Z")).inserted, 0);
  } finally { simulation.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("scheduled snapshot survives a restart and stays separate from scenario previews", () => {
  const directory = mkdtempSync(join(tmpdir(), "sunguard-restart-"));
  const databasePath = join(directory, "data.db");
  const now = () => new Date("2026-11-13T14:30:00Z");
  let simulation = createSimulation({ databasePath, now });
  try {
    assert.equal(simulation.collectScheduled().inserted, 300);
    const scheduled = simulation.snapshot();
    assert.equal(scheduled.mode, "scheduled");
    assert.equal(scheduled.generatedAt, now().toISOString());
    assert.equal(simulation.activateScenario("missing").summary.offline, 3);
    assert.equal(simulation.showCollection().summary.offline, 0);
    simulation.close();
    simulation = createSimulation({ databasePath, now: () => new Date("2026-11-13T14:31:00Z") });
    assert.equal(simulation.collectScheduled().inserted, 0);
    assert.equal(simulation.snapshot().collection.active, false);
    assert.deepEqual(simulation.snapshot().panels, scheduled.panels);
  } finally { simulation.close(); rmSync(directory, { recursive: true, force: true }); }
});
