# Development handoff

## Current integration

Base: GitHub `main` commit `99d846e` (SunGuard telemetry dashboard and CSV import). The `integration/multidevice-20261114` branch combines that frontend with locally developed Neon schema, transactional CSV import, historical APIs, and panel history. A backup of the pre-integration workspace was made under the user's Local AppData directory.

The Drive copy and `Abeer-Solar-Frontend` were based on `e18d687`; their accessible frontend is older than the current GitHub base. Drive's Supabase support files and build settings are preserved. Unpublished work on other computers cannot be verified from this machine.

## Verified data and known limitations

On 2026-11-14, the Neon production branch contained 1,070,811 readings, 300 panel IDs, and 3,570 measurement minutes from October 1–7, 2026. The source CSV and credentials are not in Git. CSV times are assumed to be Europe/Istanbul; verify that assumption with the data owner.

The Vercel production alias was serving commit `99d846e`; its snapshot and history APIs returned 404. The Vercel CLI can list environment metadata after sign-in. The production `DATABASE_URL` connects to a different Neon endpoint where `sunguard.readings` is absent; production must be corrected and verified before deployment. No production deployment or merge has been performed. The hosted simulator controls are not implemented; use the local simulator for scenario previews. Access control for public historical telemetry must be decided before exposing sensitive data.

Preview deployment `sunguard-43i97zfkv-abdulrahman-s-projects-169872f4.vercel.app` built commit `f4a2a14`. Its API returned 300 panels and 510 minutes for October 1; its browser loaded nine chart sections. The local browser also showed imported panel history, map controls, themes, and a mobile map. The updated Preview for commit `61a49e7` loaded all nine historical chart sections. At a 390px viewport, Analytics had no horizontal document overflow and its browser console showed no errors. Vercel CLI created an automation bypass during verification; the exact newly created bypass was subsequently revoked. The user's temporary directory contains `sunguard-vercel-check.env` and `sunguard-vercel-preview-check.env` with pulled environment configuration; remove them securely when permitted.

## Working across devices

At session start: inspect status, fetch, read this handoff, identify the correct branch, and reconcile local changes without overwriting them. At task completion: run relevant tests, update this handoff, commit the intended changes and push only to the authorized branch. Check the remote and deployment separately. Do not commit `.env` files, CSV data, generated SQLite files, or credentials.

Next: restore hosted simulator functionality, then validate the full UI and API before considering a production merge or deployment. The branch-scoped Preview secret `SUNGUARD_DATABASE_URL` takes precedence over the Neon-managed `DATABASE_URL`. Configure the correct production database without overwriting managed variables. Recover unsynchronized changes directly from the other computers.
