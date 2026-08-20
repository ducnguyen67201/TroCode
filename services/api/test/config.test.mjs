import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../src/config.mjs';

const VALID_ENVIRONMENT = {
  DATABASE_URL: 'postgres://example.test/trocode',
  GOOGLE_OAUTH_CLIENT_ID: 'client.apps.googleusercontent.com',
  OPENAI_API_KEY: 'sk-test-not-a-real-secret',
  TROCODE_SESSION_TOKEN_HMAC_KEY: 'a'.repeat(32),
};

test('loadConfig validates required production secrets', () => {
  assert.throws(
    () => loadConfig({ ...VALID_ENVIRONMENT, OPENAI_API_KEY: '' }),
    /OPENAI_API_KEY is required/,
  );
  assert.throws(
    () =>
      loadConfig({
        ...VALID_ENVIRONMENT,
        TROCODE_SESSION_TOKEN_HMAC_KEY: 'too-short',
      }),
    /at least 32 characters/,
  );
});

test('admin dashboard is opt-in and requires a strong access token', () => {
  assert.deepEqual(loadConfig(VALID_ENVIRONMENT).admin, {
    accessToken: null,
    enabled: false,
  });
  assert.throws(
    () =>
      loadConfig({
        ...VALID_ENVIRONMENT,
        TROCODE_ADMIN_ACCESS_TOKEN: 'too-short',
      }),
    /TROCODE_ADMIN_ACCESS_TOKEN must be at least 32 characters/u,
  );
  assert.deepEqual(
    loadConfig({
      ...VALID_ENVIRONMENT,
      TROCODE_ADMIN_ACCESS_TOKEN: 'a'.repeat(32),
    }).admin,
    { accessToken: 'a'.repeat(32), enabled: true },
  );
});

test('loadConfig restricts requests to configured models', () => {
  const config = loadConfig({
    ...VALID_ENVIRONMENT,
    TROCODE_AGENT_MODEL: 'primary-model',
  });

  assert.deepEqual([...config.openAiModels], ['primary-model']);
  assert.equal(config.sessionDurationDays, 30);
  assert.equal(config.costGuard.monthlyMicroUsd, 45_000_000);
  assert.equal(config.costGuard.dailyMicroUsd, 8_000_000);
  assert.equal(config.costGuard.taskMicroUsd, 5_000_000);
  assert.equal(config.costGuard.transcriptionMicroUsdPerMinute, 4_500);
  assert.equal(config.costGuard.mode, 'enforce');
});

test('loadConfig validates cost guard controls', () => {
  assert.throws(
    () =>
      loadConfig({
        ...VALID_ENVIRONMENT,
        TROCODE_COST_GUARD_MODE: 'disabled',
      }),
    /observe, enforce/,
  );
  const config = loadConfig({
    ...VALID_ENVIRONMENT,
    TROCODE_COST_GUARD_MODE: 'enforce',
    TROCODE_MONTHLY_BUDGET_MICRO_USD: '20000000',
  });
  assert.equal(config.costGuard.mode, 'enforce');
});

test('loadConfig validates transcription duration pricing', () => {
  assert.throws(
    () =>
      loadConfig({
        ...VALID_ENVIRONMENT,
        TROCODE_TRANSCRIPTION_MICRO_USD_PER_MINUTE: '0',
      }),
    /positive integer/u,
  );
  assert.equal(
    loadConfig({
      ...VALID_ENVIRONMENT,
      TROCODE_TRANSCRIPTION_MICRO_USD_PER_MINUTE: '7000',
    }).costGuard.transcriptionMicroUsdPerMinute,
    7_000,
  );
});

test('Knowledge Spaces defaults off and validates exact boolean values', () => {
  assert.deepEqual(loadConfig(VALID_ENVIRONMENT).knowledgeSpaces, {
    enabled: false,
    objectStore: null,
  });
  assert.throws(
    () => loadConfig({ ...VALID_ENVIRONMENT, TROCODE_KNOWLEDGE_SPACES_ENABLED: 'yes' }),
    /must be true or false/u,
  );
  assert.throws(
    () => loadConfig({ ...VALID_ENVIRONMENT, TROCODE_KNOWLEDGE_SPACES_ENABLED: 'true' }),
    /TROCODE_KNOWLEDGE_S3_ACCESS_KEY_ID is required/u,
  );
  const enabled = loadConfig({
    ...VALID_ENVIRONMENT,
    TROCODE_KNOWLEDGE_SPACES_ENABLED: 'true',
    TROCODE_KNOWLEDGE_S3_ACCESS_KEY_ID: 'key',
    TROCODE_KNOWLEDGE_S3_BUCKET: 'private-content',
    TROCODE_KNOWLEDGE_S3_REGION: 'us-east-1',
    TROCODE_KNOWLEDGE_S3_SECRET_ACCESS_KEY: 'secret',
  });
  assert.equal(enabled.knowledgeSpaces.enabled, true);
  assert.equal(enabled.knowledgeSpaces.objectStore.bucket, 'private-content');
});
