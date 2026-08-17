import { readFile } from 'node:fs/promises';

export async function runMigrations(pool) {
  const migrationUrl = new URL('../migrations/001_hosted_sessions.sql', import.meta.url);
  const sql = await readFile(migrationUrl, 'utf8');
  await pool.query(sql);
}
