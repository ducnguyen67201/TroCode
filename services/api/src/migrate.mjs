import { readdir, readFile } from 'node:fs/promises';

export async function runMigrations(pool) {
  const migrationsUrl = new URL('../migrations/', import.meta.url);
  const entries = await readdir(migrationsUrl, { withFileTypes: true });
  const migrationNames = entries
    .filter(
      (entry) =>
        entry.isFile() && /^\d+_[a-z0-9_]+\.sql$/u.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();

  for (const migrationName of migrationNames) {
    const sql = await readFile(new URL(migrationName, migrationsUrl), 'utf8');
    await pool.query(sql);
  }
}
