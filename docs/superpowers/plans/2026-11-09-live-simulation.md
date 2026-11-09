# Live Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the static HelioPulse prototype into a single-user local simulator backed by a durable SQLite database and a live API.

**Architecture:** A dependency-free Node HTTP server owns SQLite, seeds 500 virtual panels, writes a reading per simulated minute, and exposes bounded JSON endpoints. The existing static client polls a snapshot endpoint, renders live metrics/map states, and lets the admin trigger reversible fault scenarios and customise analysis widgets.

**Tech Stack:** Node.js 26 built-ins (`node:http`, `node:sqlite`), SQLite file database, existing esbuild/Three.js frontend, node:test.

**Spec:** `docs/01_DISCOVERY_SPEC_AR.md`

## Global Constraints

- Single local Admin / one virtual farm; authentication and cloud runtime are N/A for this local academic simulation.
- Telemetry is generated every 60 seconds; hourly summaries are calculated from persisted readings.
- SQLite database must remain local under `data/` and be git-ignored.
- Raw readings remain append-only; scenario configuration and dashboard widgets are editable.
- All fault scenarios must be visibly marked as simulated data.

## Review Focus

- A fresh database must seed exactly 500 unique panels and persist its data across server restarts.
- A simulator tick must append readings without mutating older readings.
- Invalid scenario names and malformed request bodies must return a safe 4xx response.
- The snapshot must return only a bounded recent history window.
- The web UI must remain usable when the local API is unavailable, displaying a clear demo/offline state.

---

### Task 1: Simulation persistence and engine

**Files:** create `server/simulation.mjs`, `server/simulation.test.mjs`; modify `.gitignore`.

- [ ] Write failing tests for seeded panel count, appended readings, and a dust scenario.
- [ ] Run `node --test server/simulation.test.mjs` and verify RED.
- [ ] Implement `createSimulation({ databasePath, now })`, `tick()`, `snapshot()`, and `activateScenario(name)` using SQLite.
- [ ] Re-run the focused test and verify GREEN.

### Task 2: Local HTTP API and runtime

**Files:** create `server/server.mjs`, `server/server.test.mjs`; modify `package.json`, `README_AR.md`.

- [ ] Write failing API tests for `/api/health`, `/api/snapshot`, `/api/scenarios`, and unknown routes.
- [ ] Run `node --test server/server.test.mjs` and verify RED.
- [ ] Implement `createServer({ databasePath, tickMs })` with static serving, JSON validation, minute timer, and clean shutdown.
- [ ] Add `npm run simulate` and document start/reset commands.
- [ ] Re-run focused tests and verify GREEN.

### Task 3: Live dashboard and configurable analysis

**Files:** modify `app.js`, `index.html`, `style.css`; create `live-client.test.mjs`.

- [ ] Write a failing test for the metric catalog and persisted widget selection model.
- [ ] Run `node --test live-client.test.mjs` and verify RED.
- [ ] Add API polling, live timestamp/status, Scenario controls, and an Analysis widget picker for nine metric types.
- [ ] Preserve current static data as a visible fallback when the local server is offline.
- [ ] Re-run focused tests and verify GREEN.

### Task 4: End-to-end verification and handoff

**Files:** modify `README_AR.md`; test all project tests.

- [ ] Run `npm test` and `npm run build`.
- [ ] Start the simulator against a temporary database; exercise snapshot, scenario activation, and persisted restart through real HTTP requests.
- [ ] Open the local site, verify live state, 2D map, analytics picker, and a scenario visually.
- [ ] Commit only after all checks succeed; push only after explicit user authorisation (already granted for this repository).
