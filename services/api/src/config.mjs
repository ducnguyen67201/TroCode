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
    environment.TROCODE_PLANNER_MODEL?.trim() ||
    'gpt-5.6-luna';
  const fallbackModel =
    environment.TROCODE_AGENT_FALLBACK_MODEL?.trim() ||
    environment.TROCODE_PLANNER_FALLBACK_MODEL?.trim() ||
    'gpt-5.6-terra';

  return {
    databaseUrl: required('DATABASE_URL', environment),
    elevenLabsApiKey: environment.ELEVENLABS_API_KEY?.trim() || null,
    elevenLabsModelId:
      environment.ELEVENLABS_MODEL_ID?.trim() || 'eleven_flash_v2_5',
    elevenLabsVoiceId: environment.ELEVENLABS_VOICE_ID?.trim() || null,
    googleClientId: required('GOOGLE_OAUTH_CLIENT_ID', environment),
    openAiApiKey: required('OPENAI_API_KEY', environment),
    openAiModels: new Set([primaryModel, fallbackModel]),
    port: positiveInteger('PORT', environment.PORT, 8080),
    sessionDurationDays: positiveInteger(
      'TROCODE_SESSION_DURATION_DAYS',
      environment.TROCODE_SESSION_DURATION_DAYS,
      30,
    ),
    sessionTokenHmacKey,
  };
}
