import { readFile } from 'node:fs/promises';

export async function runMigrations(pool) {
  for (const name of [
    '001_hosted_sessions.sql',
    '002_model_usage_budgets.sql',
  ]) {
    const migrationUrl = new URL(`../migrations/${name}`, import.meta.url);
    const sql = await readFile(migrationUrl, 'utf8');
    await pool.query(sql);
  }
}
