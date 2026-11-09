import { createServer as createHttpServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createSimulation } from "./simulation.mjs";

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

export function createServer({ databasePath = resolve(projectDirectory, "data", "heliopulse.db"), staticDirectory = resolve(projectDirectory, "dist"), tickMs = 60_000 } = {}) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const simulation = createSimulation({ databasePath });
  const timer = setInterval(() => simulation.scheduledTick(), tickMs);
  timer.unref();
  const server = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    try {
      if (request.method === "GET" && url.pathname === "/api/health") return sendJson(response, 200, { status: "ok" });
      if (request.method === "GET" && url.pathname === "/api/snapshot") return sendJson(response, 200, simulation.snapshot());
      if (request.method === "GET" && url.pathname === "/api/scenarios") return sendJson(response, 200, { scenarios: simulation.scenarios, active: simulation.snapshot().scenario });
      if (request.method === "POST" && url.pathname === "/api/scenarios") {
        const body = await readJson(request);
        if (typeof body.scenario !== "string") return sendJson(response, 400, { error: "scenario must be a string" });
        try { return sendJson(response, 200, simulation.activateScenario(body.scenario)); }
        catch { return sendJson(response, 400, { error: "unknown scenario" }); }
      }
      if (request.method === "POST" && url.pathname === "/api/lifecycle/start") return sendJson(response, 200, simulation.startLifecycle());
      if (request.method === "POST" && url.pathname === "/api/lifecycle/advance") return sendJson(response, 200, simulation.advanceLifecycle());
      if (request.method === "POST" && url.pathname === "/api/tick") return sendJson(response, 200, simulation.scheduledTick());
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
      await new Promise(resolveClose => server.close(resolveClose));
      simulation.close();
    },
  };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const runtime = createServer();
  const address = await runtime.listen();
  console.log(`HelioPulse simulator running at http://127.0.0.1:${address.port}`);
  process.on("SIGINT", async () => { await runtime.close(); process.exit(0); });
}
