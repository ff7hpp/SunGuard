import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createServer } from "./server.mjs";

async function withServer(run) {
  const directory = mkdtempSync(join(tmpdir(), "heliopulse-api-"));
  const runtime = createServer({ databasePath: join(directory, "farm.db"), tickMs: 60_000 });
  const address = await runtime.listen(0);
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("health and snapshot expose a live seeded simulator", async () => {
  await withServer(async origin => {
    const health = await fetch(`${origin}/api/health`);
    const snapshot = await fetch(`${origin}/api/snapshot`);
    assert.deepEqual(await health.json(), { status: "ok" });
    assert.equal((await snapshot.json()).panels.length, 500);
  });
});

test("scenario API activates a simulated dust fault", async () => {
  await withServer(async origin => {
    const response = await fetch(`${origin}/api/scenarios`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: "dust" }) });
    const snapshot = await response.json();
    assert.equal(response.status, 200);
    assert.equal(snapshot.scenario, "dust");
    assert.ok(snapshot.alerts.some(alert => alert.code === "SOIL-01"));
  });
});

test("scenario API rejects unknown scenarios", async () => {
  await withServer(async origin => {
    const response = await fetch(`${origin}/api/scenarios`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: "unknown" }) });
    assert.equal(response.status, 400);
  });
});

test("lifecycle API starts a 15-step simulation", async () => {
  await withServer(async origin => {
    const response = await fetch(`${origin}/api/lifecycle/start`, { method: "POST" });
    const snapshot = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(snapshot.lifecycle, { active: true, step: 0, total: 15, label: "Lifecycle ready", events: [] });
  });
});

test("manual tick advances an active lifecycle by one period", async () => {
  await withServer(async origin => {
    await fetch(`${origin}/api/lifecycle/start`, { method: "POST" });
    const response = await fetch(`${origin}/api/tick`, { method: "POST" });
    const snapshot = await response.json();
    assert.equal(snapshot.lifecycle.step, 1);
    assert.equal(snapshot.lifecycle.events[0].kind, "baseline");
  });
});
