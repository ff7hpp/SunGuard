import { readFile } from 'node:fs/promises';
import pg from 'pg';
const connectionString = process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) throw new Error('DATABASE_URL_UNPOOLED is required');
const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query(await readFile(new URL('../db/001_sunguard.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('SunGuard schema ready; 300 panel identifiers ensured.');
} catch (error) { await client.query('ROLLBACK'); throw error; } finally { await client.end(); }
