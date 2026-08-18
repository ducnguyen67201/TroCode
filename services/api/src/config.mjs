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

  return {
    costGuard: {
      dailyMicroUsd: positiveInteger(
        'TROCODE_DAILY_BUDGET_MICRO_USD',
        environment.TROCODE_DAILY_BUDGET_MICRO_USD,
        2_000_000,
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
        'observe',
      ),
      monthlyMicroUsd: positiveInteger(
        'TROCODE_MONTHLY_BUDGET_MICRO_USD',
        environment.TROCODE_MONTHLY_BUDGET_MICRO_USD,
        20_000_000,
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
      taskMicroUsd: positiveInteger(
        'TROCODE_TASK_BUDGET_MICRO_USD',
        environment.TROCODE_TASK_BUDGET_MICRO_USD,
        500_000,
      ),
      warningPercent: positiveInteger(
        'TROCODE_BUDGET_WARNING_PERCENT',
        environment.TROCODE_BUDGET_WARNING_PERCENT,
        80,
      ),
    },
    databaseUrl: required('DATABASE_URL', environment),
    elevenLabsApiKey: environment.ELEVENLABS_API_KEY?.trim() || null,
    elevenLabsModelId:
      environment.ELEVENLABS_MODEL_ID?.trim() || 'eleven_flash_v2_5',
    elevenLabsVoiceId: environment.ELEVENLABS_VOICE_ID?.trim() || null,
    googleClientId: required('GOOGLE_OAUTH_CLIENT_ID', environment),
    openAiApiKey: required('OPENAI_API_KEY', environment),
    openAiModels: new Set([primaryModel]),
    port: positiveInteger('PORT', environment.PORT, 8080),
    sessionDurationDays: positiveInteger(
      'TROCODE_SESSION_DURATION_DAYS',
      environment.TROCODE_SESSION_DURATION_DAYS,
      30,
    ),
    sessionTokenHmacKey,
  };
}
