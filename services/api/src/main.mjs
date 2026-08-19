import { createServer } from 'node:http';

import pg from 'pg';

import { PostgresAccessCodeRepository } from './access-code-repository.mjs';
import { PostgresAgentTurnRepository } from './agent-turn-repository.mjs';
import { AgentTurnService } from './agent-turn-service.mjs';
import { loadConfig } from './config.mjs';
import { BudgetService } from './budget-service.mjs';
import { verifyGoogleIdToken } from './google-token-verifier.mjs';
import { runMigrations } from './migrate.mjs';
import { ModelCatalog } from './model-catalog.mjs';
import { OpenAiResponsesService } from './openai-responses-service.mjs';
import { OpenAiTranscriptionService } from './openai-transcription-service.mjs';
import { PostgresRateLimiter } from './rate-limit-repository.mjs';
import { createApiHandler } from './server.mjs';
import { PostgresSessionRepository } from './session-repository.mjs';
import { PostgresUsageRepository } from './usage-repository.mjs';
import { PostgresKnowledgeSpaceRepository } from './knowledge-space-repository.mjs';
import { PostgresKnowledgeSourceRepository } from './knowledge-source-repository.mjs';
import { PostgresActivityRepository } from './activity-repository.mjs';
import { S3ObjectStore } from './s3-object-store.mjs';
import { KnowledgeUploadService } from './knowledge-upload-service.mjs';
import { KnowledgeSpaceService } from './knowledge-space-service.mjs';
import { ActivityService } from './activity-service.mjs';
import { KnowledgeSearchService } from './knowledge-search-service.mjs';
import { InsightService } from './insight-service.mjs';
import { KnowledgeSpaceHttpController } from './knowledge-space-http-controller.mjs';

const config = loadConfig();
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.databasePoolMax,
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
const modelCatalog = new ModelCatalog();
for (const model of config.openAiModels) modelCatalog.priceFor(model);
const agentTurnRepository = new PostgresAgentTurnRepository(pool);
const agentTurnService = new AgentTurnService(agentTurnRepository, {
  mode: config.costGuard.mode,
});
const usageRepository = new PostgresUsageRepository(pool);
const budgetService = new BudgetService(usageRepository, config.costGuard);
const rateLimiter = new PostgresRateLimiter(pool, {
  hmacKey: config.sessionTokenHmacKey,
});
const responsesService = new OpenAiResponsesService({
  budgetService,
  catalog: modelCatalog,
  openAiApiKey: config.openAiApiKey,
});
const transcriptionService = new OpenAiTranscriptionService({
  budgetService,
  openAiApiKey: config.openAiApiKey,
});
const spaceRepository = new PostgresKnowledgeSpaceRepository(pool);
const sourceRepository = new PostgresKnowledgeSourceRepository(pool);
const activityRepository = new PostgresActivityRepository(pool);
const objectStore = config.knowledgeSpaces.enabled
  ? new S3ObjectStore(config.knowledgeSpaces.objectStore)
  : null;
const uploadService = objectStore
  ? new KnowledgeUploadService({ objectStore, sourceRepository })
  : null;
const spaceService = uploadService
  ? new KnowledgeSpaceService({
      hmacKey: config.sessionTokenHmacKey,
      sourceRepository,
      spaceRepository,
      uploadService,
    })
  : null;
const activityService = spaceService
  ? new ActivityService({ activityRepository, objectStore, spaceService, uploadService })
  : null;
const knowledgeController = new KnowledgeSpaceHttpController({
  accessCodeRepository,
  activityService,
  enabled: config.knowledgeSpaces.enabled,
  insightService: activityService
    ? new InsightService({ activityRepository, spaceService })
    : null,
  rateLimiter,
  searchService: config.knowledgeSpaces.enabled
    ? new KnowledgeSearchService(pool)
    : null,
  sessionRepository,
  spaceService,
});
const handler = createApiHandler({
  accessCodeRepository,
  agentTurnService,
  budgetService,
  config,
  healthCheck: async () => {
    try {
      await pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  },
  knowledgeController,
  rateLimiter,
  sessionRepository,
  transcriptionService,
  responsesService,
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
