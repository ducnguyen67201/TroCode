import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { createApiHandler } from '../src/server.mjs';
import { ModelCatalog } from '../src/model-catalog.mjs';
import { OpenAiResponsesService } from '../src/openai-responses-service.mjs';

const TEST_USER = {
  email: 'person@example.com',
  id: 'google-subject-123',
  name: 'Test Person',
};
const TEST_TASK_ID = '11111111-1111-4111-8111-111111111111';
const TEST_REQUEST_ID = '22222222-2222-4222-8222-222222222222';

function memorySessions() {
  const sessions = new Map();
  let sequence = 0;
  return {
    authenticate: async (token) => sessions.get(token) || null,
    issue: async (user) => {
      const accessToken = `tro_live_${String(++sequence).padStart(43, 'a')}`;
      const session = {
        expiresAt: '2026-09-17T00:00:00.000Z',
        sessionId: `session-${sequence}`,
        user,
      };
      sessions.set(accessToken, session);
      return { accessToken, expiresAt: session.expiresAt, user };
    },
    revoke: async (sessionId) => {
      for (const [token, session] of sessions) {
        if (session.sessionId === sessionId) sessions.delete(token);
      }
    },
    rotate: async (session) => {
      for (const [token, current] of sessions) {
        if (current.sessionId === session.sessionId) sessions.delete(token);
      }
      const accessToken = `tro_live_${String(++sequence).padStart(43, 'b')}`;
      const next = {
        expiresAt: '2026-10-17T00:00:00.000Z',
        sessionId: `session-${sequence}`,
        user: session.user,
      };
      sessions.set(accessToken, next);
      return { accessToken, expiresAt: next.expiresAt, user: session.user };
    },
  };
}

async function withApi(run, { configOverride = {}, fetchImpl } = {}) {
  const sessions = memorySessions();
  const upstreamFetch =
    fetchImpl ||
    (async () =>
      new Response(JSON.stringify({ id: 'response-1', output: [] }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }));
  const budgetService = {
    markDispatched: async () => undefined,
    markUncertain: async () => undefined,
    realtimeCallEstimateMicroUsd: () => 5_000,
    release: async () => undefined,
    reserve: async () => undefined,
    settle: async () => undefined,
    snapshot: async () => ({
      actualMicroUsd: 1_000,
      daily: { limitMicroUsd: 2_000_000, remainingMicroUsd: 1_999_000, reservedMicroUsd: 0, settledMicroUsd: 1_000 },
      enforcementMode: 'enforce',
      estimatedMicroUsd: 0,
      monthEndsAt: '2026-09-01T00:00:00.000Z',
      monthly: { limitMicroUsd: 20_000_000, remainingMicroUsd: 19_999_000, reservedMicroUsd: 0, settledMicroUsd: 1_000 },
      periodStartsAt: '2026-08-01T00:00:00.000Z',
      task: { limitMicroUsd: 500_000, remainingMicroUsd: 499_000, reservedMicroUsd: 0, settledMicroUsd: 1_000 },
      warningThresholdMicroUsd: 16_000_000,
    }),
    speechEstimateMicroUsd: (characters) => characters * 60,
  };
  const responsesService = new OpenAiResponsesService({
    budgetService,
    catalog: new ModelCatalog({
      entries: {
        'test-model': {
          cachedInputMicroUsdPerMillion: 20_000,
          cacheWriteMicroUsdPerMillion: 250_000,
          inputMicroUsdPerMillion: 200_000,
          outputMicroUsdPerMillion: 1_200_000,
        },
      },
      version: 'test-v1',
    }),
    fetchImpl: upstreamFetch,
    openAiApiKey: 'sk-test-not-real',
  });
  const handler = createApiHandler({
    budgetService,
    config: {
      elevenLabsApiKey: null,
      elevenLabsModelId: 'eleven_flash_v2_5',
      elevenLabsVoiceId: null,
      googleClientId: 'client.apps.googleusercontent.com',
      openAiApiKey: 'sk-test-not-real',
      openAiModels: new Set(['test-model']),
      ...configOverride,
    },
    fetchImpl: upstreamFetch,
    healthCheck: async () => true,
    sessionRepository: sessions,
    responsesService,
    verifyGoogleIdToken: async (token) => {
      if (token !== 'valid-google-token') throw new Error('invalid');
      return TEST_USER;
    },
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run({ baseUrl, sessions });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function signIn(baseUrl) {
  const response = await fetch(`${baseUrl}/v1/auth/google/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: 'valid-google-token' }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

function responsesBody(model = 'test-model') {
  return {
    input: [],
    max_output_tokens: 100,
    model,
    parallel_tool_calls: false,
    store: false,
    tool_choice: 'auto',
    tools: [],
  };
}

test('health and readiness endpoints are public and hardened', async () => {
  await withApi(async ({ baseUrl }) => {
    const health = await fetch(`${baseUrl}/healthz`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('cache-control'), 'no-store');
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');

    const ready = await fetch(`${baseUrl}/readyz`);
    assert.deepEqual(await ready.json(), { database: 'ok', status: 'ok' });
  });
});

test('Google exchange creates an opaque session and rejects invalid tokens', async () => {
  await withApi(async ({ baseUrl }) => {
    const invalid = await fetch(`${baseUrl}/v1/auth/google/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'invalid' }),
    });
    assert.equal(invalid.status, 401);

    const session = await signIn(baseUrl);
    assert.match(session.accessToken, /^tro_live_/);
    assert.deepEqual(session.user, TEST_USER);
  });
});

test('model proxy requires authentication and enforces model allowlist', async () => {
  let upstreamRequest;
  await withApi(
    async ({ baseUrl }) => {
      const unauthenticated = await fetch(`${baseUrl}/v1/openai/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(responsesBody()),
      });
      assert.equal(unauthenticated.status, 401);

      const session = await signIn(baseUrl);
      const invalidModel = await fetch(`${baseUrl}/v1/openai/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(responsesBody('other-model')),
      });
      assert.equal(invalidModel.status, 400);

      const valid = await fetch(`${baseUrl}/v1/openai/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
          'X-Trocode-Request-Id': TEST_REQUEST_ID,
          'X-Trocode-Task-Id': TEST_TASK_ID,
        },
        body: JSON.stringify(responsesBody()),
      });
      assert.equal(valid.status, 200);
      assert.equal((await valid.json()).id, 'response-1');
      assert.match(upstreamRequest.headers['OpenAI-Safety-Identifier'], /^[a-f0-9]{64}$/);
      assert.equal(upstreamRequest.headers.Authorization, 'Bearer sk-test-not-real');
    },
    {
      fetchImpl: async (_url, options) => {
        upstreamRequest = options;
        return new Response(JSON.stringify({ id: 'response-1', output: [] }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      },
    },
  );
});

test('usage budget returns only the authenticated caller snapshot', async () => {
  await withApi(async ({ baseUrl }) => {
    const unauthenticated = await fetch(`${baseUrl}/v1/usage/budget`);
    assert.equal(unauthenticated.status, 401);
    const session = await signIn(baseUrl);
    const response = await fetch(
      `${baseUrl}/v1/usage/budget?taskId=${TEST_TASK_ID}`,
      { headers: { Authorization: `Bearer ${session.accessToken}` } },
    );
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    assert.equal(snapshot.monthly.limitMicroUsd, 20_000_000);
    assert.equal('prompt' in snapshot, false);
  });
});

test('session refresh rotates the credential and sign-out revokes it', async () => {
  await withApi(async ({ baseUrl }) => {
    const session = await signIn(baseUrl);
    const refreshedResponse = await fetch(`${baseUrl}/v1/auth/session/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    assert.equal(refreshedResponse.status, 200);
    const refreshed = await refreshedResponse.json();
    assert.notEqual(refreshed.accessToken, session.accessToken);

    const oldCredential = await fetch(`${baseUrl}/v1/openai/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(responsesBody()),
    });
    assert.equal(oldCredential.status, 401);

    const signOut = await fetch(`${baseUrl}/v1/auth/session`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${refreshed.accessToken}` },
    });
    assert.equal(signOut.status, 204);
  });
});

test('hosted speech requires a session and keeps the provider key upstream', async () => {
  let upstreamRequest;
  await withApi(
    async ({ baseUrl }) => {
      const session = await signIn(baseUrl);
      const response = await fetch(`${baseUrl}/v1/elevenlabs/speech`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Xin chào' }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(
        new Uint8Array(await response.arrayBuffer()),
        Uint8Array.from([1, 2, 3]),
      );
      assert.equal(upstreamRequest.headers['xi-api-key'], 'eleven-secret');
      assert.equal(upstreamRequest.headers.Authorization, undefined);
    },
    {
      configOverride: {
        elevenLabsApiKey: 'eleven-secret',
        elevenLabsVoiceId: 'voice-id',
      },
      fetchImpl: async (_url, options) => {
        upstreamRequest = options;
        return new Response(Uint8Array.from([1, 2, 3]), {
          headers: { 'Content-Type': 'audio/mpeg' },
          status: 200,
        });
      },
    },
  );
});

test('realtime calls accept only SDP and language and build provider form data', async () => {
  let upstreamRequest;
  await withApi(
    async ({ baseUrl }) => {
      const session = await signIn(baseUrl);
      const invalid = await fetch(`${baseUrl}/v1/openai/realtime/calls`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ language: 'fr', offerSdp: 'v=0\r\noffer' }),
      });
      assert.equal(invalid.status, 400);

      const valid = await fetch(`${baseUrl}/v1/openai/realtime/calls`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ language: 'vi', offerSdp: 'v=0\r\noffer' }),
      });
      assert.equal(valid.status, 200);
      assert.equal(await valid.text(), 'v=0\r\nanswer');
      assert(upstreamRequest.body instanceof FormData);
      assert.equal(upstreamRequest.body.get('sdp'), 'v=0\r\noffer');
      const providerSession = JSON.parse(upstreamRequest.body.get('session'));
      assert.equal(providerSession.type, 'transcription');
      assert.equal(providerSession.audio.input.transcription.language, 'vi');
      assert.equal(
        providerSession.audio.input.transcription.model,
        'gpt-realtime-whisper',
      );
    },
    {
      fetchImpl: async (_url, options) => {
        upstreamRequest = options;
        return new Response('v=0\r\nanswer', {
          headers: { 'Content-Type': 'application/sdp' },
          status: 200,
        });
      },
    },
  );
});
