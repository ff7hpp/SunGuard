import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "./server.mjs";
import { createSimulation } from "./simulation.mjs";
import { RealTelemetryProvider } from "./telemetry.mjs";
import { renderHistory } from "../history-charts.mjs";
import { metricCatalog } from "../live-client.mjs";

test("history API serves seven Istanbul dates and refreshes all nine charts after ingestion", async () => {
  let clock = new Date("2026-11-13T06:02:15Z");
  const runtime = createServer({ databasePath: ":memory:", now: () => clock, seedHistory: true, tickMs: 10 });
  const { port } = await runtime.listen(0);
  const api = async path => (await fetch(`http://127.0.0.1:${port}/api/${path}`)).json();
  try {
    const snapshot = await api("snapshot");
    assert.equal(snapshot.panels.length, 300);
    assert.equal(snapshot.collection.quality, "observed");
    const data = await api("history?date=2026-11-13");
    assert.deepEqual(data.days.map(day => day.date), ["2026-11-07","2026-11-08","2026-11-09","2026-11-10","2026-11-11","2026-11-12","2026-11-13"]);
    assert.equal(data.days[0].samples, 511);
    assert.equal(data.days[0].warning, 2);
    assert.equal(data.days[0].critical, 1);
    assert.deepEqual(data.minutes.map(row => row.minute), [540,541,542]);
    assert.deepEqual(data.minutes.map(row => row.quality), ["seeded","seeded","observed"]);
    assert.equal(data.minutes.at(-1).time, snapshot.generatedAt);
    for (const metric of metricCatalog) assert.ok(renderHistory(data).includes(metric.label));
    const before = renderHistory(data);
    clock = new Date("2026-11-13T06:03:02Z");
    for (let i = 0; i < 50; i++) {
      if ((await api("collection-status")).latestSample === "2026-11-13T06:03:00.000Z") break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const updated = await api("history?date=2026-11-13");
    assert.equal(updated.minutes.length, 4);
    assert.notEqual(renderHistory(updated), before);
    const week = await api("history");
    assert.equal(week.minutes.length, 6 * 511 + 4);
    assert.equal(new Set(week.minutes.map(row => row.date)).size, 7);
    const weeklyCharts = renderHistory(week);
    assert.equal((weeklyCharts.match(/class="history-area"/g) ?? []).length, 7);
    assert.equal((weeklyCharts.match(/class="history-heat-row"/g) ?? []).length, 7);
    assert.match(weeklyCharts, /history-gauge/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/history?date=2026-11-06`)).status, 400);
  } finally { await runtime.close(); }
});

test("real provider supports delayed partial batches, provenance and idempotency", () => {
  const now = () => new Date("2026-11-13T06:03:00.000Z");
  const provider = new RealTelemetryProvider(() => null);
  const simulation = createSimulation({ databasePath: ":memory:", now, provider });
  try {
    simulation.seedHistory();
    assert.equal(simulation.history().days.at(-1).samples, 0);
    assert.equal(simulation.collectScheduled().pending, true);
    const panel = { panel_id: "R01-C01", status: "normal", power: 400, temperature: 45, voltage: 40, current: 10, efficiency: 92 };
    const batch = { source_type: "real", timestamp_utc: "2026-11-13T06:01:00.000Z", quality_status: "observed", panels: [panel], irradiance: null, frequency: null };
    assert.equal(simulation.ingest(batch), 1);
    assert.equal(simulation.ingest(batch), 0);
    assert.throws(() => simulation.ingest({ ...batch, timestamp_utc: "2026-11-13T06:04:00.000Z" }), /timestamp/);
    assert.throws(() => simulation.ingest({ ...batch, panels: [{ ...panel, panel_id: "R21-C01" }] }), /panel/);
    assert.equal(simulation.ingest({ ...batch, panels: [{ ...panel, panel_id: "R01-C02" }], irradiance: 700, frequency: 50.01 }), 1);
    const data = simulation.history("2026-11-13");
    assert.equal(data.source, "real");
    assert.equal(data.minutes[0].recorded, 2);
    assert.equal(data.minutes[0].irradiance, 700);
    assert.equal(data.minutes[0].power, .8);
    assert.equal(simulation.snapshot().panels[2].power, null);
    assert.match(renderHistory(data), /Real measurements/);
  } finally { simulation.close(); }
});
