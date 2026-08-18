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

test('loadConfig restricts requests to configured models', () => {
  const config = loadConfig({
    ...VALID_ENVIRONMENT,
    TROCODE_AGENT_MODEL: 'primary-model',
  });

  assert.deepEqual([...config.openAiModels], ['primary-model']);
  assert.equal(config.sessionDurationDays, 30);
  assert.equal(config.costGuard.monthlyMicroUsd, 20_000_000);
  assert.equal(config.costGuard.dailyMicroUsd, 2_000_000);
  assert.equal(config.costGuard.taskMicroUsd, 500_000);
  assert.equal(config.costGuard.transcriptionMicroUsdPerMinute, 6_000);
  assert.equal(config.costGuard.mode, 'observe');
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
