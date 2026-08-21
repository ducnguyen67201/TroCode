const MIN_SECRET_LENGTH = 32;

function required(name, environment) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function positiveInteger(name, value, fallback) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function enumValue(name, value, allowed, fallback) {
  const normalized = value?.trim() || fallback;
  if (!allowed.includes(normalized)) {
    throw new Error(`${name} must be one of: ${allowed.join(', ')}.`);
  }
  return normalized;
}

function booleanValue(name, value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function percentage(name, value, fallback) {
  const normalized = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > 100) {
    throw new Error(`${name} must be an integer from 0 to 100.`);
  }
  return normalized;
}

function commaSeparated(value) {
  return [...new Set(String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean))];
}

export function loadConfig(environment = process.env) {
  const sessionTokenHmacKey = required(
    'TROCODE_SESSION_TOKEN_HMAC_KEY',
    environment,
  );
  if (sessionTokenHmacKey.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `TROCODE_SESSION_TOKEN_HMAC_KEY must be at least ${MIN_SECRET_LENGTH} characters.`,
    );
  }

  const primaryModel =
    environment.TROCODE_AGENT_MODEL?.trim() ||
    'gpt-5.6-luna';
  const backendAgentEnabled = booleanValue(
    'TROCODE_BACKEND_AGENT_ENABLED',
    environment.TROCODE_BACKEND_AGENT_ENABLED,
    false,
  );
  const agentStateEncryptionKeys = environment.TROCODE_AGENT_STATE_ENCRYPTION_KEYS?.trim() || '';
  if (backendAgentEnabled && !agentStateEncryptionKeys) {
    throw new Error('TROCODE_AGENT_STATE_ENCRYPTION_KEYS is required when the backend agent is enabled.');
  }
  const agentRuntimeProtocolVersion = positiveInteger(
    'TROCODE_AGENT_RUNTIME_PROTOCOL_VERSION',
    environment.TROCODE_AGENT_RUNTIME_PROTOCOL_VERSION,
    2,
  );
  if (agentRuntimeProtocolVersion !== 2) {
    throw new Error('TROCODE_AGENT_RUNTIME_PROTOCOL_VERSION must be 2.');
  }

  const knowledgeSpacesEnabled = booleanValue(
    'TROCODE_KNOWLEDGE_SPACES_ENABLED',
    environment.TROCODE_KNOWLEDGE_SPACES_ENABLED,
    false,
  );
  const adminAccessToken = environment.TROCODE_ADMIN_ACCESS_TOKEN?.trim() || null;
  if (adminAccessToken && adminAccessToken.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `TROCODE_ADMIN_ACCESS_TOKEN must be at least ${MIN_SECRET_LENGTH} characters.`,
    );
  }
  const knowledgeObjectStore = knowledgeSpacesEnabled
    ? {
        accessKeyId: required('TROCODE_KNOWLEDGE_S3_ACCESS_KEY_ID', environment),
        bucket: required('TROCODE_KNOWLEDGE_S3_BUCKET', environment),
        endpoint: environment.TROCODE_KNOWLEDGE_S3_ENDPOINT?.trim() || null,
        forcePathStyle: booleanValue(
          'TROCODE_KNOWLEDGE_S3_FORCE_PATH_STYLE',
          environment.TROCODE_KNOWLEDGE_S3_FORCE_PATH_STYLE,
          false,
        ),
        region: required('TROCODE_KNOWLEDGE_S3_REGION', environment),
        secretAccessKey: required(
          'TROCODE_KNOWLEDGE_S3_SECRET_ACCESS_KEY',
          environment,
        ),
      }
    : null;

  return {
    agentRuntime: {
      canaryUsers: new Set(commaSeparated(environment.TROCODE_BACKEND_AGENT_CANARY_USERS)),
      compactionItemThreshold: positiveInteger(
        'TROCODE_AGENT_COMPACTION_ITEM_THRESHOLD',
        environment.TROCODE_AGENT_COMPACTION_ITEM_THRESHOLD,
        80,
      ),
      currentEncryptionKeyVersion: positiveInteger(
        'TROCODE_AGENT_STATE_KEY_VERSION',
        environment.TROCODE_AGENT_STATE_KEY_VERSION,
        1,
      ),
      enabled: backendAgentEnabled,
      intentAuthorization: {
        canaryUsers: new Set(commaSeparated(
          environment.TROCODE_INTENT_AUTHORIZATION_CANARY_USERS,
        )),
        enabled: booleanValue(
          'TROCODE_INTENT_AUTHORIZATION_ENABLED',
          environment.TROCODE_INTENT_AUTHORIZATION_ENABLED,
          false,
        ),
        rolloutPercent: percentage(
          'TROCODE_INTENT_AUTHORIZATION_ROLLOUT_PERCENT',
          environment.TROCODE_INTENT_AUTHORIZATION_ROLLOUT_PERCENT,
          0,
        ),
      },
      encryptionKeys: agentStateEncryptionKeys,
      heartbeatTtlMs: positiveInteger(
        'TROCODE_DESKTOP_WORKER_TTL_MS',
        environment.TROCODE_DESKTOP_WORKER_TTL_MS,
        35_000,
      ),
      leaseMs: positiveInteger(
        'TROCODE_AGENT_LEASE_MS',
        environment.TROCODE_AGENT_LEASE_MS,
        30_000,
      ),
      maxActiveRunsPerUser: positiveInteger(
        'TROCODE_AGENT_MAX_ACTIVE_RUNS_PER_USER',
        environment.TROCODE_AGENT_MAX_ACTIVE_RUNS_PER_USER,
        2,
      ),
      maxQueueDepth: positiveInteger(
        'TROCODE_AGENT_MAX_QUEUE_DEPTH',
        environment.TROCODE_AGENT_MAX_QUEUE_DEPTH,
        1_000,
      ),
      payloadTtlMs: positiveInteger(
        'TROCODE_AGENT_PAYLOAD_TTL_MS',
        environment.TROCODE_AGENT_PAYLOAD_TTL_MS,
        7 * 24 * 60 * 60 * 1_000,
      ),
      playwrightCdpEnabled: booleanValue(
        'TROCODE_PLAYWRIGHT_CDP_ENABLED',
        environment.TROCODE_PLAYWRIGHT_CDP_ENABLED,
        false,
      ),
      protocolVersion: agentRuntimeProtocolVersion,
      rolloutPercent: percentage(
        'TROCODE_BACKEND_AGENT_ROLLOUT_PERCENT',
        environment.TROCODE_BACKEND_AGENT_ROLLOUT_PERCENT,
        0,
      ),
    },
    admin: {
      accessToken: adminAccessToken,
      enabled: Boolean(adminAccessToken),
    },
    costGuard: {
      dailyMicroUsd: positiveInteger(
        'TROCODE_DAILY_BUDGET_MICRO_USD',
        environment.TROCODE_DAILY_BUDGET_MICRO_USD,
        8_000_000,
      ),
      enabled: booleanValue(
        'TROCODE_PAID_CALLS_ENABLED',
        environment.TROCODE_PAID_CALLS_ENABLED,
        true,
      ),
      mode: enumValue(
        'TROCODE_COST_GUARD_MODE',
        environment.TROCODE_COST_GUARD_MODE,
        ['observe', 'enforce'],
        'enforce',
      ),
      monthlyMicroUsd: positiveInteger(
        'TROCODE_MONTHLY_BUDGET_MICRO_USD',
        environment.TROCODE_MONTHLY_BUDGET_MICRO_USD,
        45_000_000,
      ),
      reservationTtlMs: positiveInteger(
        'TROCODE_RESERVATION_TTL_MS',
        environment.TROCODE_RESERVATION_TTL_MS,
        120_000,
      ),
      realtimeCallMicroUsd: positiveInteger(
        'TROCODE_REALTIME_CALL_ESTIMATE_MICRO_USD',
        environment.TROCODE_REALTIME_CALL_ESTIMATE_MICRO_USD,
        5_000,
      ),
      speechMicroUsdPerThousandCharacters: positiveInteger(
        'TROCODE_SPEECH_MICRO_USD_PER_THOUSAND_CHARACTERS',
        environment.TROCODE_SPEECH_MICRO_USD_PER_THOUSAND_CHARACTERS,
        60_000,
      ),
      transcriptionMicroUsdPerMinute: positiveInteger(
        'TROCODE_TRANSCRIPTION_MICRO_USD_PER_MINUTE',
        environment.TROCODE_TRANSCRIPTION_MICRO_USD_PER_MINUTE,
        4_500,
      ),
      taskMicroUsd: positiveInteger(
        'TROCODE_TASK_BUDGET_MICRO_USD',
        environment.TROCODE_TASK_BUDGET_MICRO_USD,
        5_000_000,
      ),
      warningPercent: positiveInteger(
        'TROCODE_BUDGET_WARNING_PERCENT',
        environment.TROCODE_BUDGET_WARNING_PERCENT,
        80,
      ),
    },
    databaseUrl: required('DATABASE_URL', environment),
    databasePoolMax: positiveInteger(
      'TROCODE_DATABASE_POOL_MAX',
      environment.TROCODE_DATABASE_POOL_MAX,
      10,
    ),
    elevenLabsApiKey: environment.ELEVENLABS_API_KEY?.trim() || null,
    elevenLabsModelId:
      environment.ELEVENLABS_MODEL_ID?.trim() || 'eleven_flash_v2_5',
    elevenLabsVoiceId: environment.ELEVENLABS_VOICE_ID?.trim() || null,
    googleClientId: required('GOOGLE_OAUTH_CLIENT_ID', environment),
    knowledgeSpaces: {
      enabled: knowledgeSpacesEnabled,
      objectStore: knowledgeObjectStore,
    },
    openAiApiKey: required('OPENAI_API_KEY', environment),
    openAiModels: new Set([
      primaryModel,
      'gpt-5.6-luna',
      'gpt-5.6-terra',
      'gpt-5.6-sol',
      ...commaSeparated(environment.TROCODE_AGENT_MODEL_ALLOWLIST),
    ]),
    port: positiveInteger('PORT', environment.PORT, 8080),
    sessionDurationDays: positiveInteger(
      'TROCODE_SESSION_DURATION_DAYS',
      environment.TROCODE_SESSION_DURATION_DAYS,
      30,
    ),
    sessionTokenHmacKey,
  };
}
