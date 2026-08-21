import { createServer } from 'node:http';

import pg from 'pg';
import { OpenAIResponsesCompactionSession } from '@openai/agents';

import { PostgresAccessCodeRepository } from './access-code-repository.mjs';
import { AdminHttpController } from './admin-http-controller.mjs';
import { PostgresAdminRepository } from './admin-repository.mjs';
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
import { AgentStateCrypto, parseAgentStateKeys } from './agent-state-crypto.mjs';
import { PostgresAgentRunRepository } from './agent-run-repository.mjs';
import { AgentRunService } from './agent-run-service.mjs';
import { OutcomeCompiler } from './outcome-compiler.mjs';
import { OutcomeVerifier } from './outcome-verifier.mjs';
import { DesktopWorkerController } from './desktop-worker-controller.mjs';
import { AgentEventStream } from './agent-event-stream.mjs';
import { AgentRuntimeHttpController } from './agent-runtime-http-controller.mjs';
import { BudgetedResponsesTransport } from './budgeted-responses-transport.mjs';
import { BackendAgentRuntime } from './backend-agent-runtime.mjs';
import { DurableAgentSession, createCompactingAgentSession } from './durable-agent-session.mjs';
import { AgentModelPolicy, ProviderCircuitBreaker } from './agent-model-policy.mjs';
import { AgentRunWorker } from './agent-run-worker.mjs';
import { AgentVisualSidecar } from './agent-visual-sidecar.mjs';
import { AgentRolloutPolicy } from './agent-rollout-policy.mjs';

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
const adminController = config.admin.enabled
  ? new AdminHttpController({
      accessToken: config.admin.accessToken,
      rateLimiter,
      repository: new PostgresAdminRepository(pool, {
        hmacKey: config.sessionTokenHmacKey,
      }),
    })
  : null;
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
let agentRuntimeController = null;
let agentRunWorker = null;
let agentWorkerTimer = null;
let agentMaintenanceTimer = null;
let runAgentMaintenance = null;
if (config.agentRuntime.encryptionKeys) {
  const stateCrypto = new AgentStateCrypto({
    currentKeyVersion: config.agentRuntime.currentEncryptionKeyVersion,
    keys: parseAgentStateKeys(
      config.agentRuntime.encryptionKeys,
      config.agentRuntime.currentEncryptionKeyVersion,
    ),
  });
  const agentRunRepository = new PostgresAgentRunRepository(pool);
  const visualSidecar = new AgentVisualSidecar();
  const rolloutPolicy = new AgentRolloutPolicy({
    canaryUsers: config.agentRuntime.canaryUsers,
    enabled: config.agentRuntime.enabled,
    hmacKey: config.sessionTokenHmacKey,
    rolloutPercent: config.agentRuntime.rolloutPercent,
  });
  const intentAuthorizationPolicy = new AgentRolloutPolicy({
    canaryUsers: config.agentRuntime.intentAuthorization.canaryUsers,
    enabled:
      config.agentRuntime.enabled &&
      config.agentRuntime.intentAuthorization.enabled &&
      config.agentRuntime.protocolVersion === 2,
    hmacKey: config.sessionTokenHmacKey,
    rolloutPercent: config.agentRuntime.intentAuthorization.rolloutPercent,
  });
  const outcomeCompiler = new OutcomeCompiler();
  const agentRunService = new AgentRunService({
    agentTurnService,
    crypto: stateCrypto,
    outcomeCompiler,
    maxActiveRunsPerUser: config.agentRuntime.maxActiveRunsPerUser,
    maxQueueDepth: config.agentRuntime.maxQueueDepth,
    intentAuthorizationPolicy,
    payloadTtlMs: config.agentRuntime.payloadTtlMs,
    repository: agentRunRepository,
  });
  const desktopWorkerController = new DesktopWorkerController({
    crypto: stateCrypto,
    heartbeatTtlMs: config.agentRuntime.heartbeatTtlMs,
    pool,
    repository: agentRunRepository,
    visualSidecar,
  });
  runAgentMaintenance = async () => {
    await desktopWorkerController.expireStale();
    await agentRunRepository.expire();
    await agentRunRepository.expireToolInvocations();
    await agentRunRepository.cleanupExpiredPayloads();
  };
  const modelPolicy = new AgentModelPolicy({ allowedModels: config.openAiModels });
  const budgetedTransport = new BudgetedResponsesTransport({
    budgetService,
    catalog: modelCatalog,
    circuitBreaker: new ProviderCircuitBreaker(),
  });
  const backendAgentRuntime = new BackendAgentRuntime({
    budgetedTransport,
    modelPolicy,
    openAiApiKey: config.openAiApiKey,
  });
  const sessionFactory = (runId) => createCompactingAgentSession({
    client: backendAgentRuntime.openAiClient,
    compactionModel: 'gpt-5.6-luna',
    maxItems: config.agentRuntime.compactionItemThreshold,
    openAIResponsesCompactionSession: OpenAIResponsesCompactionSession,
    session: new DurableAgentSession({ crypto: stateCrypto, pool, runId }),
  });
  agentRunWorker = new AgentRunWorker({
    agentRuntime: backendAgentRuntime,
    crypto: stateCrypto,
    desktopWorkerController,
    leaseMs: config.agentRuntime.leaseMs,
    modelPolicy,
    outcomeVerifier: new OutcomeVerifier(),
    repository: agentRunRepository,
    runService: agentRunService,
    sessionFactory,
    visualSidecar,
  });
  agentRuntimeController = new AgentRuntimeHttpController({
    desktopWorkerController,
    eventStream: new AgentEventStream({
      listEvents: (userId, runId, afterSequence) =>
        agentRunService.events(userId, runId, afterSequence),
      repository: agentRunRepository,
    }),
    rolloutPolicy,
    runService: agentRunService,
  });
}
const handler = createApiHandler({
  accessCodeRepository,
  adminController,
  agentRuntimeController,
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
  if (agentRunWorker) {
    let running = false;
    agentWorkerTimer = setInterval(() => {
      if (running) return;
      running = true;
      agentRunWorker.runOnce().catch((error) => {
        console.error(JSON.stringify({
          event: 'agent.worker.failed',
          code: typeof error?.code === 'string' ? error.code : 'agent_worker_error',
          name: error instanceof Error ? error.name : 'UnknownError',
        }));
      }).finally(() => {
        running = false;
      });
    }, 250);
    agentWorkerTimer.unref();
    agentMaintenanceTimer = setInterval(() => {
      void runAgentMaintenance?.().catch((error) => {
        console.error(JSON.stringify({
          event: 'agent.maintenance.failed',
          code: typeof error?.code === 'string' ? error.code : 'agent_maintenance_error',
          name: error instanceof Error ? error.name : 'UnknownError',
        }));
      });
    }, 60_000);
    agentMaintenanceTimer.unref();
  }
});

async function shutdown(signal) {
  console.info(JSON.stringify({ event: 'server.stopping', signal }));
  if (agentWorkerTimer) clearInterval(agentWorkerTimer);
  if (agentMaintenanceTimer) clearInterval(agentMaintenanceTimer);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
