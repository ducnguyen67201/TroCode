import type {
  CompanionSpeech,
  CompanionSpeechPlaybackReason,
  CompanionSpeechPlaybackReport,
} from '../shared/contracts';

export type GuidanceAudioStatus =
  | 'loading'
  | 'speaking'
  | 'fallback'
  | 'paused';

interface AudioLike {
  addEventListener(type: string, listener: () => void): void;
  load(): void;
  pause(): void;
  play(): Promise<void>;
  removeEventListener(type: string, listener: () => void): void;
  src: string;
}

interface UtteranceLike {
  lang: string;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onstart: (() => void) | null;
  rate: number;
}

interface SpeechSynthesisLike {
  cancel(): void;
  pause(): void;
  resume(): void;
  speak(utterance: UtteranceLike): void;
}

interface GuidanceAudioPlaybackOptions {
  audioFactory?: () => AudioLike;
  message: string;
  onStatus(status: GuidanceAudioStatus): void;
  paused: boolean;
  report(report: CompanionSpeechPlaybackReport): void;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  speech: CompanionSpeech;
  speechSynthesis?: SpeechSynthesisLike | null;
  startupTimeoutMs?: number;
  utteranceFactory?: (message: string) => UtteranceLike;
  clearTimer?: (timer: unknown) => void;
}

export interface GuidanceAudioPlayback {
  dispose(): void;
  setPaused(paused: boolean): void;
}

export function createGuidanceAudioPlayback({
  audioFactory = () => new Audio() as AudioLike,
  clearTimer = (timer) => window.clearTimeout(timer as number),
  message,
  onStatus,
  paused: initiallyPaused,
  report,
  setTimer = (callback, delayMs) => window.setTimeout(callback, delayMs),
  speech,
  speechSynthesis =
    'speechSynthesis' in window
      ? (window.speechSynthesis as unknown as SpeechSynthesisLike)
      : null,
  startupTimeoutMs = 4_000,
  utteranceFactory = (text) =>
    new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
}: GuidanceAudioPlaybackOptions): GuidanceAudioPlayback {
  let audio: AudioLike | null = null;
  let disposed = false;
  let fallbackStarted = false;
  let paused = initiallyPaused;
  let startupTimer: unknown = null;
  let utterance: UtteranceLike | null = null;

  const sendReport = (
    phase: CompanionSpeechPlaybackReport['phase'],
    source: CompanionSpeechPlaybackReport['source'],
    reason?: CompanionSpeechPlaybackReason,
  ): void => {
    if (disposed) return;
    report({ id: speech.id, phase, source, ...(reason ? { reason } : {}) });
  };

  const clearStartupTimer = (): void => {
    if (startupTimer === null) return;
    clearTimer(startupTimer);
    startupTimer = null;
  };

  const stopAudio = (): void => {
    clearStartupTimer();
    if (!audio) return;
    audio.pause();
    audio.removeEventListener('playing', handleAudioPlaying);
    audio.removeEventListener('ended', handleAudioEnded);
    audio.removeEventListener('error', handleAudioError);
    audio.src = '';
    audio.load();
    audio = null;
  };

  const startSystemSpeech = (
    reason: CompanionSpeechPlaybackReason,
    reportFallback: boolean,
  ): void => {
    if (disposed || fallbackStarted) return;
    fallbackStarted = true;
    stopAudio();
    if (reportFallback) sendReport('fallback_started', speech.source, reason);
    onStatus(paused ? 'paused' : 'fallback');
    if (!speechSynthesis) {
      sendReport('failed', 'system', 'fallback_error');
      return;
    }
    try {
      speechSynthesis.cancel();
      utterance = utteranceFactory(message);
      utterance.lang = /[À-ỹ]/u.test(message) ? 'vi-VN' : 'en-US';
      utterance.rate = 0.92;
      utterance.onstart = () => {
        if (disposed || utterance === null) return;
        sendReport('playing', 'system');
        onStatus(paused ? 'paused' : 'fallback');
        if (paused) speechSynthesis.pause();
      };
      utterance.onend = () => {
        if (disposed || utterance === null) return;
        sendReport('ended', 'system');
      };
      utterance.onerror = () => {
        if (disposed || utterance === null) return;
        sendReport('failed', 'system', 'fallback_error');
      };
      speechSynthesis.speak(utterance);
      if (paused) speechSynthesis.pause();
    } catch {
      sendReport('failed', 'system', 'fallback_error');
    }
  };

  function handleAudioPlaying(): void {
    if (disposed || fallbackStarted) return;
    clearStartupTimer();
    sendReport('playing', 'elevenlabs');
    onStatus(paused ? 'paused' : 'speaking');
    if (paused) audio?.pause();
  }

  function handleAudioEnded(): void {
    if (disposed || fallbackStarted) return;
    clearStartupTimer();
    sendReport('ended', 'elevenlabs');
  }

  function handleAudioError(): void {
    startSystemSpeech('decode_error', true);
  }

  if (speech.source === 'system') {
    startSystemSpeech('not_configured', true);
  } else {
    onStatus(initiallyPaused ? 'paused' : 'loading');
    audio = audioFactory();
    audio.addEventListener('playing', handleAudioPlaying);
    audio.addEventListener('ended', handleAudioEnded);
    audio.addEventListener('error', handleAudioError);
    audio.src = speech.mediaUrl;
    startupTimer = setTimer(
      () => startSystemSpeech('startup_timeout', true),
      startupTimeoutMs,
    );
    void audio.play().catch(() =>
      startSystemSpeech('autoplay_rejected', true),
    );
    if (initiallyPaused) audio.pause();
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      stopAudio();
      if (utterance) {
        utterance.onstart = null;
        utterance.onend = null;
        utterance.onerror = null;
        utterance = null;
      }
      speechSynthesis?.cancel();
    },
    setPaused(nextPaused) {
      if (disposed || paused === nextPaused) return;
      paused = nextPaused;
      onStatus(paused ? 'paused' : fallbackStarted ? 'fallback' : 'speaking');
      if (fallbackStarted) {
        if (paused) speechSynthesis?.pause();
        else speechSynthesis?.resume();
        return;
      }
      if (!audio) return;
      if (paused) audio.pause();
      else {
        void audio.play().catch(() =>
          startSystemSpeech('autoplay_rejected', true),
        );
      }
    },
  };
}
