import { spawnSync } from 'node:child_process';
import { createSimulation } from '../server/simulation.mjs';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
mkdirSync('data', { recursive: true });
const database = createSimulation({ databasePath: 'data/sunguard.db' });
database.close();
for (const args of [['scripts/import-telemetry.mjs', 'dataset/SunGuard7days.csv.gz'], ['scripts/build.mjs']]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
if (process.env.VERCEL === '1') {
  const published = new DatabaseSync('data/sunguard.db');
  published.exec('PRAGMA journal_mode=DELETE; VACUUM');
  published.close();
}
console.log('Setup complete. Run npm run simulate to start SunGuard.');
