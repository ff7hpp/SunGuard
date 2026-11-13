# Development handoff

## Current integration

Base: GitHub `main` commit `99d846e` (SunGuard telemetry dashboard and CSV import). The `integration/multidevice-20261114` branch combines that frontend with locally developed Neon schema, transactional CSV import, historical APIs, and panel history. A backup of the pre-integration workspace was made under the user's Local AppData directory.

The Drive copy and `Abeer-Solar-Frontend` were based on `e18d687`; their accessible frontend is older than the current GitHub base. Drive's Supabase support files and build settings are preserved. Unpublished work on other computers cannot be verified from this machine.

## Verified data and known limitations

On 2026-11-14, the Neon production branch contained 1,070,811 readings, 300 panel IDs, and 3,570 measurement minutes from October 1–7, 2026. The source CSV and credentials are not in Git. CSV times are assumed to be Europe/Istanbul; verify that assumption with the data owner.

The Vercel production alias was serving commit `99d846e`; its snapshot and history APIs returned 404. The Vercel CLI can list environment metadata after sign-in. The production `DATABASE_URL` connects to a different Neon endpoint where `sunguard.readings` is absent; production must be corrected and verified before deployment. No production deployment or merge has been performed. The hosted simulator controls are not implemented; use the local simulator for scenario previews. Access control for public historical telemetry must be decided before exposing sensitive data.

## Working across devices

At session start: inspect status, fetch, read this handoff, identify the correct branch, and reconcile local changes without overwriting them. At task completion: run relevant tests, update this handoff, commit the intended changes and push only to the authorized branch. Check the remote and deployment separately. Do not commit `.env` files, CSV data, generated SQLite files, or credentials.

Next: review and test the integration branch, configure and verify a Vercel Preview with the correct server-side environment, then validate the full UI and API before considering a production merge or deployment. Branch-scoped preview configuration requires the branch to exist on GitHub. Recover any unsynchronized changes directly from the other computers.
