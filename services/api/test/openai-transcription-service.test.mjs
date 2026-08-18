import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OpenAiTranscriptionService,
  parsePcmWav,
  parseTranscriptionResponse,
} from '../src/openai-transcription-service.mjs';

const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const UTTERANCE_ID = '11111111-1111-4111-8111-111111111111';

function wav(durationMs = 300, overrides = {}) {
  const sampleRate = overrides.sampleRate ?? 16_000;
  const channels = overrides.channels ?? 1;
  const bitsPerSample = overrides.bitsPerSample ?? 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataBytes = Math.round((durationMs / 1_000) * sampleRate * blockAlign);
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(buffer.byteLength - 8, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(overrides.audioFormat ?? 1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * blockAlign, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

function input(audio = wav()) {
  return {
    body: {
      audioBase64: audio.toString('base64'),
      clientDurationMs: 300,
      language: 'en',
      utteranceId: UTTERANCE_ID,
    },
    requestId: REQUEST_ID,
    safetyIdentifier: 'safe-user',
    userId: 'user-1',
  };
}

function budget(calls) {
  return {
    markDispatched: async () => calls.push('dispatch'),
    markUncertain: async () => calls.push('uncertain'),
    release: async () => calls.push('release'),
    reserve: async (value) => calls.push(['reserve', value]),
    settle: async (value) => calls.push(['settle', value]),
    transcriptionActualMicroUsd: (seconds) => Math.ceil(seconds * 100),
    transcriptionEstimateMicroUsd: (durationMs) => Math.ceil(durationMs / 10),
  };
}

test('strict PCM WAV parser validates format, duration, and client metadata', () => {
  assert.deepEqual(parsePcmWav(wav(), 300), {
    dataByteLength: 9_600,
    durationMs: 300,
    sampleRate: 16_000,
  });
  for (const invalid of [
    Buffer.alloc(44),
    wav(300, { audioFormat: 3 }),
    wav(300, { channels: 2 }),
    wav(300, { sampleRate: 8_000 }),
    wav(300, { bitsPerSample: 8 }),
    wav(299),
    wav(15_001),
  ]) {
    assert.throws(() => parsePcmWav(invalid, 300));
  }
  const inconsistent = wav();
  inconsistent.writeUInt32LE(1, 40);
  assert.throws(() => parsePcmWav(inconsistent, 300), /chunk|sample/u);
  assert.throws(() => parsePcmWav(wav(), 350), /does not match/u);
});

test('provider parser requires bounded duration usage when present', () => {
  assert.deepEqual(
    parseTranscriptionResponse({
      duration: 0.3,
      text: ' hello ',
      usage: { seconds: 0.31, type: 'duration' },
    }),
    { billedSeconds: 0.31, duration: 0.3, text: 'hello' },
  );
  assert.equal(
    parseTranscriptionResponse({ duration: 0.3, text: 'hello' }).billedSeconds,
    null,
  );
  assert.throws(() =>
    parseTranscriptionResponse({
      duration: 0.3,
      text: 'hello',
      usage: { seconds: 0.3, type: 'tokens' },
    }),
  );
});

test('invalid client audio is rejected before any budget reservation or dispatch', async () => {
  const calls = [];
  const service = new OpenAiTranscriptionService({
    budgetService: budget(calls),
    fetchImpl: async () => {
      throw new Error('provider must not be called');
    },
    openAiApiKey: 'secret',
  });
  await assert.rejects(service.execute(input(Buffer.alloc(60))), {
    code: 'invalid_audio',
    status: 400,
  });
  assert.deepEqual(calls, []);
});

test('transcription service sends exact multipart fields and settles duration usage', async () => {
  const calls = [];
  let observedRequest;
  const service = new OpenAiTranscriptionService({
    budgetService: budget(calls),
    fetchImpl: async (url, request) => {
      observedRequest = { request, url };
      return new Response(
        JSON.stringify({
          duration: 0.3,
          text: 'open YouTube',
          usage: { seconds: 0.31, type: 'duration' },
        }),
        { headers: { 'Content-Type': 'application/json' }, status: 200 },
      );
    },
    openAiApiKey: 'secret',
  });
  const result = await service.execute(input());

  assert.equal(observedRequest.url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(observedRequest.request.method, 'POST');
  assert.equal(observedRequest.request.headers.Authorization, 'Bearer secret');
  assert.equal(observedRequest.request.headers['OpenAI-Safety-Identifier'], 'safe-user');
  assert.equal(observedRequest.request.body.get('model'), 'whisper-1');
  assert.equal(observedRequest.request.body.get('language'), 'en');
  assert.equal(observedRequest.request.body.get('response_format'), 'verbose_json');
  assert.equal(observedRequest.request.body.get('temperature'), '0');
  assert.equal(observedRequest.request.body.get('file').name, 'segment.wav');
  assert.equal(observedRequest.request.body.get('file').type, 'audio/wav');
  assert(observedRequest.request.signal instanceof AbortSignal);
  assert.equal(calls[0][0], 'reserve');
  assert.equal(calls[0][1].lane, 'transcription');
  assert.equal(calls[0][1].taskId, UTTERANCE_ID);
  assert.equal(calls[1], 'dispatch');
  assert.equal(calls[2][0], 'settle');
  assert.equal(calls[2][1].usage.audioDurationMs, 300);
  assert.deepEqual(result, {
    audioDurationMs: 300,
    billedSeconds: 0.31,
    model: 'whisper-1',
    text: 'open YouTube',
    usageSource: 'actual',
  });
});

test('missing provider usage preserves text and marks the reservation uncertain', async () => {
  const calls = [];
  const service = new OpenAiTranscriptionService({
    budgetService: budget(calls),
    fetchImpl: async () =>
      new Response(JSON.stringify({ duration: 0.3, text: 'hello' }), {
        status: 200,
      }),
    openAiApiKey: 'secret',
  });
  const result = await service.execute(input());
  assert.deepEqual(calls.slice(1), ['dispatch', 'uncertain']);
  assert.equal(result.text, 'hello');
  assert.equal(result.usageSource, 'missing');
});

test('malformed success is uncertain and is not retried', async () => {
  const calls = [];
  let fetchCount = 0;
  const service = new OpenAiTranscriptionService({
    budgetService: budget(calls),
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ duration: 0.3, text: 42 }), {
        status: 200,
      });
    },
    openAiApiKey: 'secret',
  });
  await assert.rejects(service.execute(input()), {
    code: 'ambiguous_response',
    status: 502,
  });
  assert.equal(fetchCount, 1);
  assert.equal(calls.at(-1), 'uncertain');
});

test('known provider rejection releases; ambiguous failures are uncertain and never retried', async () => {
  for (const [response, expected] of [
    [new Response('{}', { status: 400 }), 'release'],
    [new Response('{}', { status: 500 }), 'uncertain'],
    [null, 'uncertain'],
  ]) {
    const calls = [];
    let fetchCount = 0;
    const service = new OpenAiTranscriptionService({
      budgetService: budget(calls),
      fetchImpl: async () => {
        fetchCount += 1;
        if (!response) throw new Error('timeout');
        return response;
      },
      openAiApiKey: 'secret',
    });
    await assert.rejects(service.execute(input()));
    assert.equal(fetchCount, 1);
    assert.equal(calls.at(-1), expected);
  }
});
