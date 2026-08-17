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
const SECOND_TEST_USER = {
  email: 'second@example.com',
  id: 'google-subject-456',
  name: 'Second Person',
};

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

function memoryAccessCodes(
  limits = { CODEA: 10, CODEB: 10 },
) {
  const assignments = new Map();
  const codes = new Map(
    Object.entries(limits).map(([code, maxUsers]) => [
      code.toUpperCase(),
      { maxUsers, users: new Set() },
    ]),
  );

  function statusFor(userId, newlyRedeemed = false) {
    const assignedCode = assignments.get(userId);
    if (!assignedCode) {
      return {
        maxUsers: null,
        state: 'inactive',
        summary: 'Enter an access code to continue.',
        usedUsers: null,
      };
    }
    const code = codes.get(assignedCode);
    return {
      maxUsers: code.maxUsers,
      newlyRedeemed,
      state: 'active',
      summary: 'Access code accepted.',
      usedUsers: code.users.size,
    };
  }

  return {
    getStatus: async (userId) => statusFor(userId),
    redeem: async (userId, input) => {
      const normalized =
        typeof input === 'string' ? input.trim().toUpperCase() : '';
      const current = assignments.get(userId);
      if (current) {
        return current === normalized
          ? { kind: 'active', status: statusFor(userId) }
          : { kind: 'account_already_linked' };
      }
      const code = codes.get(normalized);
      if (!code) return { kind: 'invalid_code' };
      if (code.users.size >= code.maxUsers) return { kind: 'code_full' };
      code.users.add(userId);
      assignments.set(userId, normalized);
      return { kind: 'active', status: statusFor(userId, true) };
    },
  };
}

async function withApi(
  run,
  { accessCodeLimits, configOverride = {}, fetchImpl } = {},
) {
  const sessions = memorySessions();
  const accessCodes = memoryAccessCodes(accessCodeLimits);
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
    accessCodeRepository: accessCodes,
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
      if (token === 'valid-google-token') return TEST_USER;
      if (token === 'valid-google-token-2') return SECOND_TEST_USER;
      throw new Error('invalid');
    },
  });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run({ accessCodes, baseUrl, sessions });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function signIn(baseUrl, idToken = 'valid-google-token') {
  const response = await fetch(`${baseUrl}/v1/auth/google/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function redeemAccessCode(baseUrl, accessToken, code = 'CODEA') {
  return fetch(`${baseUrl}/v1/access-code-redemptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  });
}

async function signInAndActivate(baseUrl) {
  const session = await signIn(baseUrl);
  const activation = await redeemAccessCode(baseUrl, session.accessToken);
  assert.equal(activation.status, 201);
  return session;
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

test('access codes enforce one code per account and an atomic user limit', async () => {
  await withApi(
    async ({ baseUrl }) => {
      const firstSession = await signIn(baseUrl);
      const initialStatus = await fetch(
        `${baseUrl}/v1/access-code-redemptions/me`,
        { headers: { Authorization: `Bearer ${firstSession.accessToken}` } },
      );
      assert.deepEqual(await initialStatus.json(), {
        maxUsers: null,
        state: 'inactive',
        summary: 'Enter an access code to continue.',
        usedUsers: null,
      });

      const invalid = await redeemAccessCode(
        baseUrl,
        firstSession.accessToken,
        'missing',
      );
      assert.equal(invalid.status, 400);

      const redeemed = await redeemAccessCode(
        baseUrl,
        firstSession.accessToken,
        ' codea ',
      );
      assert.equal(redeemed.status, 201);
      assert.deepEqual(await redeemed.json(), {
        maxUsers: 1,
        newlyRedeemed: true,
        state: 'active',
        summary: 'Access code accepted.',
        usedUsers: 1,
      });

      const sameCode = await redeemAccessCode(
        baseUrl,
        firstSession.accessToken,
        'CODEA',
      );
      assert.equal(sameCode.status, 200);

      const differentCode = await redeemAccessCode(
        baseUrl,
        firstSession.accessToken,
        'CODEB',
      );
      assert.equal(differentCode.status, 409);
      assert.deepEqual(await differentCode.json(), {
        error: 'This account is already linked to a different access code.',
      });

      const secondSession = await signIn(baseUrl, 'valid-google-token-2');
      const full = await redeemAccessCode(
        baseUrl,
        secondSession.accessToken,
        'CODEA',
      );
      assert.equal(full.status, 409);
      assert.deepEqual(await full.json(), {
        error: 'This access code has reached its user limit.',
      });

      const firstStatus = await fetch(
        `${baseUrl}/v1/access-code-redemptions/me`,
        { headers: { Authorization: `Bearer ${firstSession.accessToken}` } },
      );
      assert.deepEqual(await firstStatus.json(), {
        maxUsers: 1,
        newlyRedeemed: false,
        state: 'active',
        summary: 'Access code accepted.',
        usedUsers: 1,
      });
    },
    { accessCodeLimits: { CODEA: 1, CODEB: 10 } },
  );
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
      const accessRequired = await fetch(`${baseUrl}/v1/openai/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(responsesBody()),
      });
      assert.equal(accessRequired.status, 403);
      assert.deepEqual(await accessRequired.json(), {
        error: 'Enter a valid access code to use TroCode.',
      });

      const activation = await redeemAccessCode(baseUrl, session.accessToken);
      assert.equal(activation.status, 201);
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
    const session = await signInAndActivate(baseUrl);
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
  let upstreamUrl;
  let upstreamRequest;
  await withApi(
    async ({ baseUrl }) => {
      const session = await signInAndActivate(baseUrl);
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
      assert.match(String(upstreamUrl), /\/voice-id\/stream\?output_format=mp3_44100_128$/);
    },
    {
      configOverride: {
        elevenLabsApiKey: 'eleven-secret',
        elevenLabsVoiceId: 'voice-id',
      },
      fetchImpl: async (url, options) => {
        upstreamUrl = url;
        upstreamRequest = options;
        return new Response(Uint8Array.from([1, 2, 3]), {
          headers: { 'Content-Type': 'audio/mpeg' },
          status: 200,
        });
      },
    },
  );
});

test('hosted speech delivers its first chunk before provider completion', async () => {
  let releaseSecondChunk;
  const secondChunk = new Promise((resolve) => {
    releaseSecondChunk = resolve;
  });
  let pulls = 0;
  await withApi(
    async ({ baseUrl }) => {
      const session = await signInAndActivate(baseUrl);
      const response = await fetch(`${baseUrl}/v1/elevenlabs/speech`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Stream this step' }),
      });
      const reader = response.body.getReader();
      const first = await reader.read();
      assert.deepEqual(first.value, Uint8Array.from([1, 2]));
      releaseSecondChunk();
      const second = await reader.read();
      assert.deepEqual(second.value, Uint8Array.from([3]));
      await reader.cancel();
    },
    {
      configOverride: {
        elevenLabsApiKey: 'eleven-secret',
        elevenLabsVoiceId: 'voice-id',
      },
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            async pull(controller) {
              pulls += 1;
              if (pulls === 1) {
                controller.enqueue(Uint8Array.from([1, 2]));
                return;
              }
              await secondChunk;
              controller.enqueue(Uint8Array.from([3]));
              controller.close();
            },
          }),
          { headers: { 'Content-Type': 'audio/mpeg' }, status: 200 },
        ),
    },
  );
});

test('realtime calls accept only SDP and language and build provider form data', async () => {
  let upstreamRequest;
  await withApi(
    async ({ baseUrl }) => {
      const session = await signInAndActivate(baseUrl);
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
