const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_MODEL = 'eleven_flash_v2_5';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_AUDIO_BYTES = 5_000_000;
const MAX_SPEECH_CHARACTERS = 240;

export interface SynthesizedSpeechStream {
  body: ReadableStream<Uint8Array>;
  mimeType: 'audio/mpeg';
  providerStatus: number;
  region?: string;
}

interface ElevenLabsTtsServiceOptions {
  accessTokenProvider?: () => Promise<string | null>;
  apiKey?: string;
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, 'warn'>;
  model?: string;
  timeoutMs?: number;
  voiceId?: string;
}

function abortError(): Error {
  const error = new Error('Speech synthesis was cancelled.');
  error.name = 'AbortError';
  return error;
}

export class ElevenLabsTtsService {
  private readonly accessTokenProvider?: () => Promise<string | null>;

  private readonly apiKey?: string;

  private readonly apiBaseUrl: string;

  private readonly fetchImpl: typeof fetch;

  private readonly logger: Pick<Console, 'warn'>;

  private readonly model: string;

  private readonly timeoutMs: number;

  private readonly voiceId?: string;

  constructor({
    accessTokenProvider,
    apiKey = process.env.ELEVENLABS_API_KEY,
    apiBaseUrl,
    fetchImpl = fetch,
    logger = console,
    model = process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_MODEL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    voiceId = process.env.ELEVENLABS_VOICE_ID,
  }: ElevenLabsTtsServiceOptions = {}) {
    this.accessTokenProvider = accessTokenProvider;
    this.apiKey = apiKey?.trim() || undefined;
    this.apiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.model = model.trim() || DEFAULT_MODEL;
    this.timeoutMs = timeoutMs;
    this.voiceId = voiceId?.trim() || undefined;
  }

  isConfigured(): boolean {
    return Boolean(
      (this.apiBaseUrl && this.accessTokenProvider) ||
        (this.apiKey && this.voiceId),
    );
  }

  async stream(
    rawText: string,
    signal?: AbortSignal,
  ): Promise<SynthesizedSpeechStream | null> {
    if (!this.apiBaseUrl && (!this.apiKey || !this.voiceId)) return null;
    const text = rawText.trim().slice(0, MAX_SPEECH_CHARACTERS);
    if (!text) return null;
    if (signal?.aborted) throw abortError();

    const controller = new AbortController();
    const handleAbort = (): void => controller.abort(signal?.reason);
    signal?.addEventListener('abort', handleAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(
      () => controller.abort('headers-timeout'),
      this.timeoutMs,
    );
    let ownsStream = false;

    const cleanup = (): void => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      signal?.removeEventListener('abort', handleAbort);
    };

    try {
      const accessToken = this.apiBaseUrl
        ? await this.accessTokenProvider?.()
        : null;
      if (this.apiBaseUrl && !accessToken) return null;
      const url = this.apiBaseUrl
        ? new URL(`${this.apiBaseUrl}/v1/elevenlabs/speech`)
        : new URL(
            `${ELEVENLABS_API_URL}/${encodeURIComponent(this.voiceId ?? '')}/stream`,
          );
      if (!this.apiBaseUrl) {
        url.searchParams.set('output_format', 'mp3_44100_128');
      }
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: this.apiBaseUrl
          ? {
              Accept: 'audio/mpeg',
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            }
          : {
              Accept: 'audio/mpeg',
              'Content-Type': 'application/json',
              'xi-api-key': this.apiKey ?? '',
            },
        body: JSON.stringify(
          this.apiBaseUrl ? { text } : { text, model_id: this.model },
        ),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`ElevenLabs returned HTTP ${response.status}.`);
      }
      const contentType = response.headers.get('content-type')?.toLowerCase();
      if (!contentType?.startsWith('audio/mpeg')) {
        throw new Error('ElevenLabs returned an unexpected content type.');
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_BYTES) {
        throw new Error('ElevenLabs returned an unexpectedly large audio file.');
      }
      if (!response.body) {
        throw new Error('ElevenLabs returned an empty audio stream.');
      }
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      ownsStream = true;
      return {
        body: boundedAudioStream(response.body, controller, cleanup),
        mimeType: 'audio/mpeg',
        providerStatus: response.status,
        ...boundedRegion(response.headers.get('x-region')),
      };
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (controller.signal.aborted) {
        throw new Error('ElevenLabs speech synthesis timed out.');
      }
      this.logger.warn('[voice:tts] stream failed', {
        reason: 'provider_error',
      });
      throw error;
    } finally {
      if (!ownsStream) cleanup();
    }
  }
}

function boundedAudioStream(
  source: ReadableStream<Uint8Array>,
  requestController: AbortController,
  cleanup: () => void,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let totalBytes = 0;
  let emittedBytes = false;
  let settled = false;

  const settle = (): void => {
    if (settled) return;
    settled = true;
    cleanup();
  };

  return new ReadableStream<Uint8Array>({
    async pull(output) {
      try {
        const result = await reader.read();
        if (result.done) {
          if (!emittedBytes) {
            throw new Error('ElevenLabs returned an empty audio stream.');
          }
          settle();
          output.close();
          return;
        }
        totalBytes += result.value.byteLength;
        if (totalBytes > MAX_AUDIO_BYTES) {
          requestController.abort('audio-size-limit');
          await reader.cancel('audio-size-limit');
          throw new Error('ElevenLabs returned an unexpectedly large audio file.');
        }
        emittedBytes = true;
        output.enqueue(result.value);
      } catch (error) {
        settle();
        output.error(error);
      }
    },
    async cancel(reason) {
      requestController.abort(reason);
      try {
        await reader.cancel(reason);
      } finally {
        settle();
      }
    },
  });
}

function boundedRegion(value: string | null): { region?: string } {
  const region = value?.trim();
  return region && /^[a-z0-9_-]{1,32}$/iu.test(region) ? { region } : {};
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, '') ?? '';
  if (!trimmed) return '';
  const url = new URL(trimmed);
  if (
    url.protocol !== 'https:' &&
    url.hostname !== '127.0.0.1' &&
    url.hostname !== 'localhost'
  ) {
    throw new Error('TROCODE_API_BASE_URL must use HTTPS.');
  }
  return url.toString().replace(/\/+$/, '');
}
