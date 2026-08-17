import { createServer } from 'node:http';

import pg from 'pg';

import { PostgresAccessCodeRepository } from './access-code-repository.mjs';
import { loadConfig } from './config.mjs';
import { verifyGoogleIdToken } from './google-token-verifier.mjs';
import { runMigrations } from './migrate.mjs';
import { createApiHandler } from './server.mjs';
import { PostgresSessionRepository } from './session-repository.mjs';

const config = loadConfig();
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : undefined,
});

await runMigrations(pool);

const sessionRepository = new PostgresSessionRepository(pool, {
  hmacKey: config.sessionTokenHmacKey,
  sessionDurationDays: config.sessionDurationDays,
});
const accessCodeRepository = new PostgresAccessCodeRepository(pool, {
  hmacKey: config.sessionTokenHmacKey,
});
const handler = createApiHandler({
  accessCodeRepository,
  config,
  healthCheck: async () => {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  },
  sessionRepository,
  verifyGoogleIdToken,
});
const server = createServer(handler);
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 100;

server.listen(config.port, '0.0.0.0', () => {
  console.info(
    JSON.stringify({ event: 'server.ready', port: config.port }),
  );
});

async function shutdown(signal) {
  console.info(JSON.stringify({ event: 'server.stopping', signal }));
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
