import pg from 'pg';
import { loadConfig } from './config.mjs';
import { KnowledgeIngestionJobRepository } from './knowledge-ingestion-job-repository.mjs';
import { KnowledgeIngestionWorker } from './knowledge-ingestion-worker.mjs';
import { PostgresKnowledgeSourceRepository } from './knowledge-source-repository.mjs';
import { S3ObjectStore } from './s3-object-store.mjs';

const config = loadConfig();
if (!config.knowledgeSpaces.enabled) throw new Error('Knowledge Spaces worker is disabled.');
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.databasePoolMax, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined });
const objectStore = new S3ObjectStore(config.knowledgeSpaces.objectStore);
const worker = new KnowledgeIngestionWorker({
  jobRepository: new KnowledgeIngestionJobRepository(pool), objectStore,
  sourceRepository: new PostgresKnowledgeSourceRepository(pool),
});
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
while (!stopping) {
  const worked = await worker.runOnce();
  if (!worked) await new Promise((resolve) => setTimeout(resolve, 1_000));
}
await pool.end();
