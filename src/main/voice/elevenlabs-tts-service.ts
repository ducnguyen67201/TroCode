const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_MODEL = 'eleven_flash_v2_5';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_AUDIO_BYTES = 5_000_000;
const MAX_SPEECH_CHARACTERS = 240;

export interface SynthesizedSpeech {
  dataBase64: string;
  mimeType: 'audio/mpeg';
}

interface ElevenLabsTtsServiceOptions {
  apiKey?: string;
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
  private readonly apiKey?: string;

  private readonly fetchImpl: typeof fetch;

  private readonly logger: Pick<Console, 'warn'>;

  private readonly model: string;

  private readonly timeoutMs: number;

  private readonly voiceId?: string;

  constructor({
    apiKey = process.env.ELEVENLABS_API_KEY,
    fetchImpl = fetch,
    logger = console,
    model = process.env.ELEVENLABS_MODEL_ID ?? DEFAULT_MODEL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    voiceId = process.env.ELEVENLABS_VOICE_ID,
  }: ElevenLabsTtsServiceOptions = {}) {
    this.apiKey = apiKey?.trim() || undefined;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.model = model.trim() || DEFAULT_MODEL;
    this.timeoutMs = timeoutMs;
    this.voiceId = voiceId?.trim() || undefined;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.voiceId);
  }

  async synthesize(
    rawText: string,
    signal?: AbortSignal,
  ): Promise<SynthesizedSpeech | null> {
    if (!this.apiKey || !this.voiceId) return null;
    const text = rawText.trim().slice(0, MAX_SPEECH_CHARACTERS);
    if (!text) return null;
    if (signal?.aborted) throw abortError();

    const controller = new AbortController();
    const handleAbort = (): void => controller.abort(signal?.reason);
    signal?.addEventListener('abort', handleAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const url = new URL(
        `${ELEVENLABS_API_URL}/${encodeURIComponent(this.voiceId)}`,
      );
      url.searchParams.set('output_format', 'mp3_44100_128');
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({ text, model_id: this.model }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`ElevenLabs returned HTTP ${response.status}.`);
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_BYTES) {
        throw new Error('ElevenLabs returned an unexpectedly large audio file.');
      }
      const audio = Buffer.from(await response.arrayBuffer());
      if (audio.byteLength > MAX_AUDIO_BYTES) {
        throw new Error('ElevenLabs returned an unexpectedly large audio file.');
      }
      if (audio.byteLength === 0) {
        throw new Error('ElevenLabs returned an empty audio file.');
      }
      return { dataBase64: audio.toString('base64'), mimeType: 'audio/mpeg' };
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (controller.signal.aborted) {
        throw new Error('ElevenLabs speech synthesis timed out.');
      }
      this.logger.warn('[voice:tts] synthesis failed', {
        error: error instanceof Error ? error.message.slice(0, 300) : 'Unknown error',
      });
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', handleAbort);
    }
  }
}
