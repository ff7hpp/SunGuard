# Setup

1. Clone `https://github.com/ff7hpp/SunGuard.git` and check out the required integration branch.
2. Use Node.js 26. Run `npm ci`, then `npm run setup`, then `npm run simulate`. Open `http://127.0.0.1:4173/`. Setup imports the bundled compressed CSV into local SQLite; each computer has its own database. Do not set `DATABASE_URL` or `SUNGUARD_DATABASE_URL` in the shell when using local SQLite.
3. Copy `.env.example` to `.env.local` and set `DATABASE_URL` to the pooled Neon connection. `DATABASE_URL_UNPOOLED` is used only for migration and import. Never commit either file or a connection string.
4. Run `npm run simulate` and open `http://127.0.0.1:4173/`. With `DATABASE_URL`, historical endpoints use Neon; simulation controls operate separately in local SQLite. Without it, the existing simulator operates locally.
5. Run `npm test` and `npm run build` before committing.

For an empty, explicitly selected database only, run `npm run neon:migrate`. To import an authorized CSV, run `npm run neon:import -- <path-to-csv>`. Verify its source and timezone first. The CSV is not part of the repository. Do not rerun imports merely to check the data; use read-only queries.

Vercel uses the server-side `SUNGUARD_DATABASE_URL` when set, falling back to `DATABASE_URL`. The SunGuard-specific variable avoids overriding Neon-managed variables; set it for each verified target environment. Push an integration branch and verify a preview's frontend and API against the intended Neon branch before merging or deploying production. A successful Git push does not confirm deployment or environment configuration.
