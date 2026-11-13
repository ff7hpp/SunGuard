# SunGuard project context

SunGuard is an academic solar-operations interface for 300 panels in 20 rows and 15 columns. It has an overview, Three.js and 2D maps, inspector, alerts, session activity, three themes, and historical analytics.

## Architecture

- Vanilla JavaScript, Three.js, and esbuild produce the static frontend in `dist/`.
- `api/[...route].js` provides read-only Vercel functions backed by pooled Neon PostgreSQL. `server/neon-db.mjs` implements snapshot, seven-day aggregate, incident and panel-history queries.
- `server/server.mjs` serves the same historical data locally when `DATABASE_URL` exists. Its separate SQLite simulator supports scenario and lifecycle previews. The Vercel endpoints do not currently run the simulator.
- `db/001_sunguard.sql` defines the isolated `sunguard` schema. `scripts/neon-import.mjs` imports CSV in a transaction, checks conflicts and verifies all rows. Existing records are not overwritten.
- Neon project: `shy-paper-01481036`, branch: `production`. Keep all connection strings in server-side environment variables.

The CSV times are interpreted as Europe/Istanbul; their original wall-clock timestamps and exact decimal values are retained. Fault labels are mapped to warning or critical; missing panel readings appear as no signal. Lux is presented as illuminance, not irradiance. Efficiency and frequency are absent from the CSV and shown as unavailable. Imported readings are historical and must not be presented as live measurements.

The legacy Supabase configuration and client were present in an accessible project copy and are preserved; the running historical-data path uses Neon. The CSV is intentionally not committed: it exceeds GitHub's ordinary file limit and its distribution has not been established.
