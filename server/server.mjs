import { createServer as createHttpServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createSimulation } from "./simulation.mjs";
import { parsePanelNumber } from "./neon-data.mjs";

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error("Request body is too large");
  }
  try { return JSON.parse(raw || "{}"); } catch { throw new Error("Request body must be JSON"); }
}

export function createServer({ databasePath = resolve(projectDirectory, "data", "sunguard.db"), staticDirectory = resolve(projectDirectory, "dist"), tickMs = 1_000, seedHistory = false, now = () => new Date(), provider } = {}) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const simulation = createSimulation({ databasePath, now, provider });
  const remote = (process.env.SUNGUARD_DATABASE_URL || process.env.DATABASE_URL) ? import('./neon-db.mjs') : null;
  let simulationPreview = false;
  if (seedHistory && !remote) simulation.seedHistory();
  let lastMinute;
  function collect() {
    if (remote) return;
    const at = now();
    const minute = Math.floor(at.getTime() / 60_000);
    if (minute === lastMinute) return;
    try {
      if (!simulation.collectScheduled(at).pending) lastMinute = minute;
    } catch (error) { console.error("Telemetry collection failed:", error.message); }
  }
  collect();
  const timer = setInterval(collect, tickMs);
  timer.unref();
  let lifecycleTimer;
  function scheduleLifecycle() {
    lifecycleTimer = setInterval(() => {
      if (!simulation.advanceLifecycle().lifecycle.active) clearInterval(lifecycleTimer);
    }, 4_000);
    lifecycleTimer.unref();
  }
  function startLifecycle() {
    if (simulation.snapshot().lifecycle.active) return simulation.snapshot();
    clearInterval(lifecycleTimer);
    const snapshot = simulation.startLifecycle();
    scheduleLifecycle();
    return snapshot;
  }
  if (simulation.snapshot().lifecycle.active) scheduleLifecycle();
  const server = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    try {
      if (request.method === "GET" && url.pathname === "/api/health") return sendJson(response, 200, { status: "ok" });
      if (request.method === "GET" && url.pathname === "/api/snapshot") {
        if (remote && !simulationPreview) { const snapshot = await (await remote).snapshot(); if (snapshot) return sendJson(response, 200, { ...snapshot, simulationAvailable: true }); }
        return sendJson(response, 200, simulation.snapshot());
      }
      if (request.method === "GET" && url.pathname === "/api/collection-status") return sendJson(response, 200, simulation.collectionStatus());
      if (request.method === "GET" && url.pathname === "/api/panel-history") {
        const panel = parsePanelNumber(url.searchParams.get("panel"));
        if (!panel) return sendJson(response, 400, { error: "Invalid panel" });
        return remote ? sendJson(response, 200, await (await remote).panelHistory(panel)) : sendJson(response, 503, { error: "Imported history unavailable" });
      }
      if (request.method === "GET" && url.pathname === "/api/history") {
        const history = remote ? await (await remote).history(url.searchParams.get("date") ?? undefined) : simulation.history(url.searchParams.get("date") ?? undefined);
        return history ? sendJson(response, 200, history) : sendJson(response, 400, { error: "Date outside the seven-day window" });
      }
      if (request.method === "POST" && url.pathname === "/api/collection/view") { simulationPreview = false; const data = remote ? await (await remote).snapshot() : null; return sendJson(response, 200, data ? { ...data, simulationAvailable: true } : simulation.showCollection()); }
      if (request.method === "GET" && url.pathname === "/api/scenarios") return sendJson(response, 200, { scenarios: simulation.scenarios, active: simulation.snapshot().scenario });
      if (request.method === "POST" && url.pathname === "/api/scenarios") {
        simulationPreview = true;
        const body = await readJson(request);
        if (typeof body.scenario !== "string") return sendJson(response, 400, { error: "scenario must be a string" });
        try { return sendJson(response, 200, simulation.activateScenario(body.scenario)); }
        catch { return sendJson(response, 400, { error: "unknown scenario" }); }
      }
      if (request.method === "POST" && url.pathname === "/api/lifecycle/start") { simulationPreview = true; return sendJson(response, 200, startLifecycle()); }
      if (request.method === "POST" && url.pathname === "/api/lifecycle/advance") return sendJson(response, 200, simulation.advanceLifecycle());
      if (request.method === "POST" && url.pathname === "/api/tick") { simulationPreview = true; return sendJson(response, 200, simulation.scheduledTick()); }
      if (request.method !== "GET" && request.method !== "HEAD") return sendJson(response, 405, { error: "method not allowed" });

      const requestedPath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
      const filePath = resolve(staticDirectory, requestedPath);
      if (!filePath.startsWith(`${staticDirectory}${sep}`) && filePath !== resolve(staticDirectory, "index.html")) return sendJson(response, 403, { error: "forbidden" });
      const file = readFileSync(filePath);
      response.writeHead(200, { "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream", "cache-control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : file);
    } catch (error) {
      if (error.code === "ENOENT") return sendJson(response, 404, { error: "not found" });
      return sendJson(response, 400, { error: error.message ?? "bad request" });
    }
  });

  return {
    async listen(port = 4173) {
      await new Promise((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(port, "127.0.0.1", () => { server.off("error", rejectListen); resolveListen(); });
      });
      return server.address();
    },
    async close() {
      clearInterval(timer);
      clearInterval(lifecycleTimer);
      await new Promise(resolveClose => server.close(resolveClose));
      simulation.close();
    },
  };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const runtime = createServer({ seedHistory: true });
  const address = await runtime.listen();
  console.log(`SunGuard simulator running at http://127.0.0.1:${address.port}`);
  process.on("SIGINT", async () => { await runtime.close(); process.exit(0); });
}
