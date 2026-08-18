import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const MAX_AUTH_BODY_BYTES = 32_000;
const MAX_RESPONSES_BODY_BYTES = 25_000_000;
const MAX_REALTIME_BODY_BYTES = 4_000_000;
const MAX_UPSTREAM_RESPONSE_BYTES = 5_000_000;
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const VOICE_TASK_ID = '00000000-0000-4000-8000-000000000000';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requestIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return request.socket.remoteAddress || 'unknown';
}

function createRateLimiter({ limit, windowMs }) {
  const buckets = new Map();
  return (key, now = Date.now()) => {
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    current.count += 1;
    if (buckets.size > 10_000) {
      for (const [bucketKey, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(bucketKey);
      }
    }
    return {
      allowed: current.count <= limit,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
    };
  };
}

const limitAuth = createRateLimiter({ limit: 15, windowMs: 15 * 60_000 });
const limitAccessCodeIp = createRateLimiter({
  limit: 100,
  windowMs: 15 * 60_000,
});
const limitAccessCodeUser = createRateLimiter({
  limit: 10,
  windowMs: 15 * 60_000,
});
const limitModel = createRateLimiter({ limit: 30, windowMs: 60_000 });
const limitModelDaily = createRateLimiter({ limit: 500, windowMs: 24 * 60 * 60_000 });
const limitVoice = createRateLimiter({ limit: 30, windowMs: 60_000 });

function applySecurityHeaders(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
}

function sendJson(response, status, value, extraHeaders = {}) {
  response.statusCode = status;
  response.setHeader('Content-Type', JSON_CONTENT_TYPE);
  for (const [name, headerValue] of Object.entries(extraHeaders)) {
    response.setHeader(name, headerValue);
  }
  response.end(JSON.stringify(value));
}

function sendBuffer(response, status, body, contentType, extraHeaders = {}) {
  response.statusCode = status;
  response.setHeader('Content-Type', contentType);
  response.setHeader('Content-Length', String(body.byteLength));
  for (const [name, headerValue] of Object.entries(extraHeaders)) {
    response.setHeader(name, headerValue);
  }
  response.end(body);
}

function waitForWritable(response) {
  return new Promise((resolve) => {
    const done = () => {
      response.off('close', done);
      response.off('drain', done);
      resolve();
    };
    response.once('close', done);
    response.once('drain', done);
  });
}

async function sendStream(
  response,
  status,
  stream,
  contentType,
  extraHeaders = {},
) {
  response.statusCode = status;
  response.setHeader('Content-Type', contentType);
  for (const [name, headerValue] of Object.entries(extraHeaders)) {
    response.setHeader(name, headerValue);
  }
  response.flushHeaders();
  for await (const chunk of stream) {
    if (response.destroyed) return;
    if (!response.write(chunk)) {
      await waitForWritable(response);
      if (response.destroyed) return;
    }
  }
  if (!response.destroyed) response.end();
}

async function readBody(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'Request body is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request, maxBytes) {
  const contentType = request.headers['content-type'] || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json.');
  }
  const body = await readBody(request, maxBytes);
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

function bearerToken(request) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string') return null;
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1] || null;
}

function enforceRateLimit(result) {
  if (!result.allowed) {
    const error = new HttpError(429, 'Too many requests. Please try again shortly.');
    error.retryAfterSeconds = result.retryAfterSeconds;
    throw error;
  }
}

async function readBoundedUpstreamBody(response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_UPSTREAM_RESPONSE_BYTES
  ) {
    throw new HttpError(502, 'Upstream response was unexpectedly large.');
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > MAX_UPSTREAM_RESPONSE_BYTES) {
    throw new HttpError(502, 'Upstream response was unexpectedly large.');
  }
  return body;
}

async function pipeBoundedUpstreamResponse({
  abortProvider,
  response,
  upstreamResponse,
}) {
  const declaredLength = Number(upstreamResponse.headers.get('content-length'));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_UPSTREAM_RESPONSE_BYTES
  ) {
    abortProvider('audio-size-limit');
    throw new HttpError(502, 'Speech playback is temporarily unavailable.');
  }
  const contentType = upstreamResponse.headers.get('content-type')?.toLowerCase();
  if (!contentType?.startsWith('audio/mpeg') || !upstreamResponse.body) {
    abortProvider('invalid-audio-response');
    throw new HttpError(502, 'Speech playback is temporarily unavailable.');
  }

  const reader = upstreamResponse.body.getReader();
  let totalBytes = 0;
  let wroteBytes = false;
  const handleClientClose = () => {
    if (!response.writableEnded) abortProvider('client-disconnected');
  };
  response.on('close', handleClientClose);
  response.statusCode = 200;
  response.setHeader('Content-Type', 'audio/mpeg');

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_UPSTREAM_RESPONSE_BYTES) {
        abortProvider('audio-size-limit');
        await reader.cancel('audio-size-limit');
        throw new Error('Speech audio exceeded the response limit.');
      }
      wroteBytes = true;
      if (!response.write(Buffer.from(value))) await once(response, 'drain');
    }
    if (!wroteBytes) throw new Error('Speech audio stream was empty.');
    response.end();
  } finally {
    response.off('close', handleClientClose);
    reader.releaseLock();
  }
}

async function proxyOpenAiJson({
  body,
  config,
  fetchImpl,
  safetyIdentifier,
  url,
}) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openAiApiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': safetyIdentifier,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new HttpError(502, 'The model provider is temporarily unavailable.');
  }
  return {
    body: await readBoundedUpstreamBody(response),
    contentType: response.headers.get('content-type') || JSON_CONTENT_TYPE,
    status: response.status,
  };
}

async function requireSession(request, sessionRepository) {
  const token = bearerToken(request);
  if (!token) throw new HttpError(401, 'Sign in to continue.');
  const session = await sessionRepository.authenticate(token);
  if (!session) throw new HttpError(401, 'Your session expired. Sign in again.');
  return session;
}

async function requireAccess(session, accessCodeRepository) {
  const status = await accessCodeRepository.getStatus(session.user.id);
  if (status.state !== 'active') {
    throw new HttpError(403, 'Enter a valid access code to use TroCode.');
  }
  return status;
}

function modelSafetyIdentifier(userId) {
  return createHash('sha256').update(`trocode:${userId}`).digest('hex');
}

function transcriptionSessionConfig(language) {
  return {
    type: 'transcription',
    audio: {
      input: {
        noise_reduction: { type: 'far_field' },
        transcription: {
          language,
          model: 'gpt-realtime-whisper',
        },
        turn_detection: null,
      },
    },
  };
}

export function createApiHandler({
  accessCodeRepository,
  budgetService,
  config,
  fetchImpl = fetch,
  healthCheck,
  sessionRepository,
  responsesService,
  verifyGoogleIdToken,
}) {
  return async function handleRequest(request, response) {
    const requestId = randomUUID();
    const startedAt = Date.now();
    applySecurityHeaders(response);
    response.setHeader('X-Request-Id', requestId);

    try {
      if (request.headers.origin) {
        throw new HttpError(403, 'Browser-origin requests are not allowed.');
      }
      const url = new URL(request.url || '/', 'http://localhost');
      const path = url.pathname;

      if (request.method === 'GET' && path === '/healthz') {
        sendJson(response, 200, {
          status: 'ok',
          version: process.env.RAILWAY_GIT_COMMIT_SHA || 'local',
        });
        return;
      }

      if (request.method === 'GET' && path === '/readyz') {
        const ready = await healthCheck();
        sendJson(response, ready ? 200 : 503, {
          database: ready ? 'ok' : 'unavailable',
          status: ready ? 'ok' : 'degraded',
        });
        return;
      }

      if (request.method === 'POST' && path === '/v1/auth/google/exchange') {
        enforceRateLimit(limitAuth(requestIp(request)));
        const body = await readJson(request, MAX_AUTH_BODY_BYTES);
        if (
          !body ||
          typeof body !== 'object' ||
          typeof body.idToken !== 'string'
        ) {
          throw new HttpError(400, 'idToken is required.');
        }
        let user;
        try {
          user = await verifyGoogleIdToken(body.idToken, {
            clientId: config.googleClientId,
            fetchImpl,
          });
        } catch {
          throw new HttpError(401, 'Google sign-in could not be verified.');
        }
        const session = await sessionRepository.issue(user);
        sendJson(response, 201, session);
        return;
      }

      if (request.method === 'POST' && path === '/v1/auth/session/refresh') {
        const current = await requireSession(request, sessionRepository);
        enforceRateLimit(limitAuth(`refresh:${current.user.id}`));
        const rotated = await sessionRepository.rotate(current);
        if (!rotated) throw new HttpError(401, 'Your session expired. Sign in again.');
        sendJson(response, 200, rotated);
        return;
      }

      if (request.method === 'DELETE' && path === '/v1/auth/session') {
        const current = await requireSession(request, sessionRepository);
        await sessionRepository.revoke(current.sessionId);
        response.statusCode = 204;
        response.end();
        return;
      }

      if (
        request.method === 'GET' &&
        path === '/v1/access-code-redemptions/me'
      ) {
        const session = await requireSession(request, sessionRepository);
        sendJson(
          response,
          200,
          await accessCodeRepository.getStatus(session.user.id),
        );
        return;
      }

      if (
        request.method === 'POST' &&
        path === '/v1/access-code-redemptions'
      ) {
        const session = await requireSession(request, sessionRepository);
        enforceRateLimit(
          limitAccessCodeUser(`access-user:${session.user.id}`),
        );
        enforceRateLimit(
          limitAccessCodeIp(`access-ip:${requestIp(request)}`),
        );
        const body = await readJson(request, MAX_AUTH_BODY_BYTES);
        if (!body || typeof body !== 'object' || typeof body.code !== 'string') {
          throw new HttpError(400, 'Access code is required.');
        }
        const result = await accessCodeRepository.redeem(
          session.user.id,
          body.code,
        );
        if (result.kind === 'invalid_code') {
          throw new HttpError(400, 'This access code is not valid.');
        }
        if (result.kind === 'code_full') {
          throw new HttpError(
            409,
            'This access code has reached its user limit.',
          );
        }
        if (result.kind === 'account_already_linked') {
          throw new HttpError(
            409,
            'This account is already linked to a different access code.',
          );
        }
        sendJson(
          response,
          result.status.newlyRedeemed ? 201 : 200,
          result.status,
        );
        return;
      }

      if (request.method === 'POST' && path === '/v1/openai/responses') {
        const session = await requireSession(request, sessionRepository);
        await requireAccess(session, accessCodeRepository);
        enforceRateLimit(limitModel(session.user.id));
        enforceRateLimit(limitModelDaily(`daily:${session.user.id}`));
        const body = await readJson(request, MAX_RESPONSES_BODY_BYTES);
        const requestId = request.headers['x-trocode-request-id'];
        const taskId = request.headers['x-trocode-task-id'];
        if (
          !body ||
          typeof body !== 'object' ||
          typeof body.model !== 'string' ||
          !config.openAiModels.has(body.model) ||
          !Array.isArray(body.input) ||
          body.input.length > 256 ||
          !Array.isArray(body.tools) ||
          body.tools.length > 24 ||
          body.tool_choice !== 'auto' ||
          body.parallel_tool_calls !== false ||
          body.store !== false ||
          !Number.isInteger(body.max_output_tokens) ||
          body.max_output_tokens < 1 ||
          body.max_output_tokens > 4_000 ||
          typeof requestId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestId) ||
          typeof taskId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(taskId)
        ) {
          throw new HttpError(400, 'Responses request is invalid.');
        }
        const execute = body.stream === true ? 'executeStream' : 'execute';
        const upstream = await responsesService[execute]({
          body,
          requestId,
          safetyIdentifier: modelSafetyIdentifier(session.user.id),
          taskId,
          userId: session.user.id,
        });
        if (upstream.stream) {
          await sendStream(
            response,
            upstream.status,
            upstream.stream,
            upstream.contentType,
            upstream.headers,
          );
        } else {
          sendBuffer(
            response,
            upstream.status,
            upstream.body,
            upstream.contentType,
            upstream.headers,
          );
        }
        return;
      }

      if (request.method === 'GET' && path === '/v1/usage/budget') {
        const session = await requireSession(request, sessionRepository);
        const taskId = url.searchParams.get('taskId');
        if (
          taskId &&
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(taskId)
        ) {
          throw new HttpError(400, 'taskId is invalid.');
        }
        sendJson(
          response,
          200,
          await budgetService.snapshot(session.user.id, taskId),
        );
        return;
      }

      if (request.method === 'POST' && path === '/v1/openai/realtime/calls') {
        const session = await requireSession(request, sessionRepository);
        await requireAccess(session, accessCodeRepository);
        enforceRateLimit(limitVoice(session.user.id));
        const requestBody = await readJson(request, MAX_REALTIME_BODY_BYTES);
        const language = requestBody?.language;
        const offerSdp = requestBody?.offerSdp;
        if (
          (language !== 'en' && language !== 'vi') ||
          typeof offerSdp !== 'string' ||
          !offerSdp.startsWith('v=0') ||
          offerSdp.length > 1_000_000
        ) {
          throw new HttpError(400, 'Realtime call request is invalid.');
        }
        const formData = new FormData();
        formData.set('sdp', offerSdp);
        formData.set(
          'session',
          JSON.stringify(transcriptionSessionConfig(language)),
        );
        let upstreamResponse;
        const reservedMicroUsd = budgetService.realtimeCallEstimateMicroUsd();
        await budgetService.reserve({
          catalogVersion: 'voice-estimate-v1',
          lane: 'realtime_transcription',
          model: 'gpt-realtime-whisper',
          requestId,
          reservedMicroUsd,
          taskId: VOICE_TASK_ID,
          userId: session.user.id,
        });
        await budgetService.markDispatched(session.user.id, requestId);
        try {
          upstreamResponse = await fetchImpl(OPENAI_REALTIME_CALLS_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${config.openAiApiKey}`,
              'OpenAI-Safety-Identifier': modelSafetyIdentifier(session.user.id),
            },
            body: formData,
            signal: AbortSignal.timeout(30_000),
          });
        } catch {
          await budgetService.markUncertain(session.user.id, requestId);
          throw new HttpError(502, 'The voice provider is temporarily unavailable.');
        }
        const upstreamBody = await readBoundedUpstreamBody(upstreamResponse);
        if (upstreamResponse.ok) {
          await budgetService.settle({
            actualMicroUsd: reservedMicroUsd,
            durationMs: Date.now() - startedAt,
            requestId,
            usage: {
              cacheWriteTokens: 0,
              cachedInputTokens: 0,
              inputTokens: 0,
              model: 'gpt-realtime-whisper',
              outputTokens: 0,
              reasoningTokens: 0,
              source: 'estimated',
            },
            userId: session.user.id,
          });
        } else if ([400, 401, 403, 404, 422].includes(upstreamResponse.status)) {
          await budgetService.release(
            session.user.id,
            requestId,
            'rejected_before_inference',
          );
        } else {
          await budgetService.markUncertain(session.user.id, requestId);
        }
        sendBuffer(
          response,
          upstreamResponse.status,
          upstreamBody,
          upstreamResponse.headers.get('content-type') || 'application/sdp',
        );
        return;
      }

      if (request.method === 'POST' && path === '/v1/elevenlabs/speech') {
        const session = await requireSession(request, sessionRepository);
        await requireAccess(session, accessCodeRepository);
        enforceRateLimit(limitVoice(`tts:${session.user.id}`));
        if (!config.elevenLabsApiKey || !config.elevenLabsVoiceId) {
          throw new HttpError(503, 'Speech playback is not configured.');
        }
        const body = await readJson(request, MAX_AUTH_BODY_BYTES);
        const text = typeof body?.text === 'string' ? body.text.trim() : '';
        if (!text || text.length > 240) {
          throw new HttpError(400, 'Speech text must contain 1 to 240 characters.');
        }
        const ttsUrl = `${ELEVENLABS_API_URL}/${encodeURIComponent(config.elevenLabsVoiceId)}/stream?output_format=mp3_44100_128`;
        let upstreamResponse;
        const reservedMicroUsd = budgetService.speechEstimateMicroUsd(
          text.length,
        );
        await budgetService.reserve({
          catalogVersion: 'voice-estimate-v1',
          lane: 'speech',
          model: config.elevenLabsModelId,
          requestId,
          reservedMicroUsd,
          taskId: VOICE_TASK_ID,
          userId: session.user.id,
        });
        await budgetService.markDispatched(session.user.id, requestId);
        const providerController = new AbortController();
        const providerHeaderTimer = setTimeout(
          () => providerController.abort('headers-timeout'),
          20_000,
        );
        try {
          upstreamResponse = await fetchImpl(ttsUrl, {
            method: 'POST',
            headers: {
              Accept: 'audio/mpeg',
              'Content-Type': 'application/json',
              'xi-api-key': config.elevenLabsApiKey,
            },
            body: JSON.stringify({ text, model_id: config.elevenLabsModelId }),
            signal: providerController.signal,
          });
        } catch {
          await budgetService.markUncertain(session.user.id, requestId);
          throw new HttpError(502, 'Speech playback is temporarily unavailable.');
        } finally {
          clearTimeout(providerHeaderTimer);
        }
        if (upstreamResponse.ok) {
          await budgetService.settle({
            actualMicroUsd: reservedMicroUsd,
            durationMs: Date.now() - startedAt,
            requestId,
            usage: {
              cacheWriteTokens: 0,
              cachedInputTokens: 0,
              inputTokens: 0,
              model: config.elevenLabsModelId,
              outputTokens: 0,
              characterCount: text.length,
              reasoningTokens: 0,
              source: 'estimated',
            },
            userId: session.user.id,
          });
        } else if ([400, 401, 403, 404, 422].includes(upstreamResponse.status)) {
          await budgetService.release(
            session.user.id,
            requestId,
            'rejected_before_inference',
          );
        } else {
          await budgetService.markUncertain(session.user.id, requestId);
        }
        if (!upstreamResponse.ok) {
          providerController.abort('provider-error');
          throw new HttpError(
            upstreamResponse.status >= 500 ? 503 : 502,
            'Speech playback is temporarily unavailable.',
          );
        }
        await pipeBoundedUpstreamResponse({
          abortProvider: (reason) => providerController.abort(reason),
          response,
          upstreamResponse,
        });
        return;
      }

      throw new HttpError(404, 'Endpoint not found.');
    } catch (error) {
      const isTypedHttpError =
        error instanceof HttpError ||
        (error &&
          typeof error === 'object' &&
          Number.isInteger(error.status) &&
          error.status >= 400 &&
          error.status <= 599);
      const status = isTypedHttpError ? error.status : 500;
      const message =
        isTypedHttpError ? error.message : 'An internal error occurred.';
      const extraHeaders =
        error instanceof HttpError && error.retryAfterSeconds
          ? { 'Retry-After': String(error.retryAfterSeconds) }
          : {};
      if (status >= 500) {
        console.error(
          JSON.stringify({
            durationMs: Date.now() - startedAt,
            event: 'request.failed',
            method: request.method,
            path: request.url?.split('?')[0],
            requestId,
            status,
          }),
        );
      }
      if (!response.headersSent) {
        sendJson(
          response,
          status,
          {
            ...(typeof error?.code === 'string' ? { code: error.code } : {}),
            error: message,
          },
          extraHeaders,
        );
      }
      else response.destroy();
    } finally {
      console.info(
        JSON.stringify({
          durationMs: Date.now() - startedAt,
          event: 'request.completed',
          method: request.method,
          path: request.url?.split('?')[0],
          requestId,
          status: response.statusCode,
        }),
      );
    }
  };
}
