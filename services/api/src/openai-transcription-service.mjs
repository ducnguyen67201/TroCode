import {
  TRANSCRIPTION_CATALOG_VERSION,
  TRANSCRIPTION_MODEL,
} from './transcription-config.mjs';

const MAX_PROVIDER_RESPONSE_BYTES = 1_000_000;
const MAX_WAV_BYTES = 500_000;
const OPENAI_TRANSCRIPTIONS_URL =
  'https://api.openai.com/v1/audio/transcriptions';

export class TranscriptionServiceError extends Error {
  constructor(status, message, code = 'transcription_error') {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function boundedNumber(name, value, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function readAscii(buffer, offset, length) {
  return buffer.subarray(offset, offset + length).toString('ascii');
}

export function parsePcmWav(buffer, clientDurationMs = null) {
  if (!Buffer.isBuffer(buffer) || buffer.byteLength < 44) {
    throw new Error('Audio must be a complete PCM WAV file.');
  }
  if (buffer.byteLength > MAX_WAV_BYTES) {
    throw new Error('Audio WAV exceeds the segment size limit.');
  }
  if (
    readAscii(buffer, 0, 4) !== 'RIFF' ||
    readAscii(buffer, 8, 4) !== 'WAVE'
  ) {
    throw new Error('Audio must contain RIFF and WAVE headers.');
  }
  if (buffer.readUInt32LE(4) + 8 !== buffer.byteLength) {
    throw new Error('Audio WAV has an inconsistent RIFF size.');
  }

  let format = null;
  let data = null;
  let offset = 12;
  while (offset < buffer.byteLength) {
    if (offset + 8 > buffer.byteLength) {
      throw new Error('Audio WAV contains a truncated chunk header.');
    }
    const chunkId = readAscii(buffer, offset, 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > buffer.byteLength) {
      throw new Error('Audio WAV contains an inconsistent chunk size.');
    }
    if (chunkId === 'fmt ') {
      if (format || chunkSize < 16) {
        throw new Error('Audio WAV must contain one complete fmt chunk.');
      }
      format = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
        blockAlign: buffer.readUInt16LE(chunkStart + 12),
        byteRate: buffer.readUInt32LE(chunkStart + 8),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
      };
    } else if (chunkId === 'data') {
      if (data) throw new Error('Audio WAV must contain only one data chunk.');
      data = { byteLength: chunkSize, offset: chunkStart };
    }
    offset = chunkEnd + (chunkSize % 2);
  }

  if (!format || !data) {
    throw new Error('Audio WAV must contain fmt and data chunks.');
  }
  if (
    format.audioFormat !== 1 ||
    format.channels !== 1 ||
    format.sampleRate !== 16_000 ||
    format.bitsPerSample !== 16 ||
    format.blockAlign !== 2 ||
    format.byteRate !== 32_000
  ) {
    throw new Error('Audio must be mono 16 kHz 16-bit PCM WAV.');
  }
  if (data.byteLength === 0 || data.byteLength % format.blockAlign !== 0) {
    throw new Error('Audio WAV data must contain complete PCM samples.');
  }

  const durationMs = (data.byteLength / format.byteRate) * 1_000;
  boundedNumber('audio duration', durationMs, 300, 15_000);
  if (clientDurationMs !== null) {
    boundedNumber('client duration', clientDurationMs, 300, 15_000);
    if (Math.abs(clientDurationMs - durationMs) > 21) {
      throw new Error('Client audio duration does not match the WAV data.');
    }
  }
  return {
    dataByteLength: data.byteLength,
    durationMs,
    sampleRate: format.sampleRate,
  };
}

export function parseTranscriptionResponse(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('Provider transcription response must be an object.');
  }
  if (typeof value.text !== 'string' || value.text.trim().length > 8_000) {
    throw new Error('Provider transcription text is invalid.');
  }
  if (value.languages !== undefined) {
    if (!Array.isArray(value.languages)) {
      throw new Error('Provider transcription languages are invalid.');
    }
    for (const language of value.languages) {
      if (
        !language ||
        typeof language !== 'object' ||
        typeof language.code !== 'string' ||
        language.code.trim().length === 0 ||
        language.code.trim().length > 32
      ) {
        throw new Error('Provider transcription language is invalid.');
      }
    }
  }
  return { text: value.text.trim() };
}

async function readBoundedProviderBody(response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PROVIDER_RESPONSE_BYTES
  ) {
    throw new Error('Provider response exceeds the size limit.');
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error('Provider response exceeds the size limit.');
  }
  return body;
}

function isRejectedBeforeInference(status) {
  return [400, 401, 403, 404, 422].includes(status);
}

export class OpenAiTranscriptionService {
  constructor({ budgetService, fetchImpl = fetch, openAiApiKey }) {
    this.budgetService = budgetService;
    this.fetchImpl = fetchImpl;
    this.openAiApiKey = openAiApiKey;
  }

  async execute(input) {
    const startedAt = Date.now();
    let audio;
    let wav;
    try {
      audio = Buffer.from(input.body.audioBase64, 'base64');
      wav = parsePcmWav(audio, input.body.clientDurationMs);
    } catch {
      throw new TranscriptionServiceError(
        400,
        'The audio segment must be a valid bounded PCM WAV file.',
        'invalid_audio',
      );
    }
    const reservedMicroUsd =
      this.budgetService.transcriptionEstimateMicroUsd(
        Math.ceil(wav.durationMs),
      );
    await this.budgetService.reserve({
      catalogVersion: TRANSCRIPTION_CATALOG_VERSION,
      lane: 'transcription',
      model: TRANSCRIPTION_MODEL,
      planId: input.planId,
      requestId: input.requestId,
      reservedMicroUsd,
      taskId: input.body.utteranceId,
      userId: input.userId,
    });

    const form = new FormData();
    form.set('file', new Blob([audio], { type: 'audio/wav' }), 'segment.wav');
    form.set('model', TRANSCRIPTION_MODEL);
    form.append('languages[]', input.body.language);

    await this.budgetService.markDispatched(input.userId, input.requestId);
    let response;
    try {
      response = await this.fetchImpl(OPENAI_TRANSCRIPTIONS_URL, {
        body: form,
        headers: {
          Authorization: `Bearer ${this.openAiApiKey}`,
          'OpenAI-Safety-Identifier': input.safetyIdentifier,
        },
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      await this.budgetService.markUncertain(input.userId, input.requestId);
      throw new TranscriptionServiceError(
        502,
        'The transcription provider is temporarily unavailable. This call was not retried.',
        'ambiguous_dispatch',
      );
    }

    let providerBody;
    try {
      providerBody = await readBoundedProviderBody(response);
    } catch {
      await this.budgetService.markUncertain(input.userId, input.requestId);
      throw new TranscriptionServiceError(
        502,
        'The transcription provider returned an invalid response. This call was not retried.',
        'ambiguous_response',
      );
    }

    if (!response.ok) {
      if (isRejectedBeforeInference(response.status)) {
        await this.budgetService.release(
          input.userId,
          input.requestId,
          'rejected_before_inference',
        );
      } else {
        await this.budgetService.markUncertain(input.userId, input.requestId);
      }
      throw new TranscriptionServiceError(
        response.status,
        'The transcription provider rejected the audio request.',
        'provider_rejected',
      );
    }

    let transcription;
    try {
      transcription = parseTranscriptionResponse(
        JSON.parse(providerBody.toString('utf8')),
      );
    } catch {
      await this.budgetService.markUncertain(input.userId, input.requestId);
      throw new TranscriptionServiceError(
        502,
        'The transcription provider returned an invalid response. This call was not retried.',
        'ambiguous_response',
      );
    }

    const durationMs = Date.now() - startedAt;
    const billedSeconds = wav.durationMs / 1_000;
    const actualMicroUsd =
      this.budgetService.transcriptionActualMicroUsd(billedSeconds);
    const usageSource = 'actual';
    await this.budgetService.settle({
      actualMicroUsd,
      durationMs,
      requestId: input.requestId,
      usage: {
        audioDurationMs: Math.round(wav.durationMs),
        cacheWriteTokens: 0,
        cachedInputTokens: 0,
        inputTokens: 0,
        model: TRANSCRIPTION_MODEL,
        outputTokens: 0,
        reasoningTokens: 0,
        source: 'actual',
      },
      userId: input.userId,
    });

    console.info(
      JSON.stringify({
        audioDurationMs: Math.round(wav.durationMs),
        billedSeconds,
        byteCount: audio.byteLength,
        durationMs,
        event: 'voice.segment.completed',
        lane: 'transcription',
        microUsd: actualMicroUsd,
        model: TRANSCRIPTION_MODEL,
        requestId: input.requestId,
        taskId: input.body.utteranceId,
        usageSource,
      }),
    );

    return {
      audioDurationMs: Math.round(wav.durationMs),
      billedSeconds,
      model: TRANSCRIPTION_MODEL,
      text: transcription.text,
      usageSource,
    };
  }
}
