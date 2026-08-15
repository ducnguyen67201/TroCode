import { useCallback, useEffect, useRef, useState } from 'react';

import {
  detectPushToTalkPlatform,
  isPushToTalkChord,
  parseRealtimeTranscriptionEvent,
  pushToTalkShortcutName,
  type PushToTalkPlatform,
} from './push-to-talk';

export type VoiceInputStatus =
  | 'connecting'
  | 'idle'
  | 'listening'
  | 'processing'
  | 'requesting_permission'
  | 'unavailable';

interface UsePushToTalkOptions {
  disabled?: boolean;
  enabled?: boolean;
  onError(message: string): void;
  onTranscriptChange(transcript: string): void;
  onTranscriptSubmit(transcript: string): void;
}

interface PushToTalkState {
  cancel(): void;
  platform: PushToTalkPlatform;
  status: VoiceInputStatus;
}

interface ActiveVoiceTurn {
  channel: RTCDataChannel;
  committed: boolean;
  connection: RTCPeerConnection;
  resultTimer: ReturnType<typeof setTimeout> | null;
  stream: MediaStream;
  transcript: string;
}

const OPENAI_REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const CONNECTION_TIMEOUT_MS = 12_000;
const TRANSCRIPT_TIMEOUT_MS = 20_000;

function getPushToTalkPlatform(): PushToTalkPlatform {
  if (typeof navigator === 'undefined') return 'unsupported';
  return detectPushToTalkPlatform(navigator.platform, navigator.userAgent);
}

function closeVoiceTurn(turn: ActiveVoiceTurn): void {
  if (turn.resultTimer) clearTimeout(turn.resultTimer);
  turn.resultTimer = null;
  for (const track of turn.stream.getTracks()) track.stop();
  if (turn.channel.readyState !== 'closed') turn.channel.close();
  if (turn.connection.connectionState !== 'closed') turn.connection.close();
}

function waitForDataChannelOpen(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState === 'open') return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('OpenAI voice connection timed out.'));
    }, CONNECTION_TIMEOUT_MS);

    const cleanup = (): void => {
      clearTimeout(timer);
      channel.removeEventListener('open', handleOpen);
      channel.removeEventListener('close', handleClose);
      channel.removeEventListener('error', handleError);
    };
    const handleOpen = (): void => {
      cleanup();
      resolve();
    };
    const handleClose = (): void => {
      cleanup();
      reject(new Error('OpenAI closed the voice connection.'));
    };
    const handleError = (): void => {
      cleanup();
      reject(new Error('OpenAI voice could not establish a media connection.'));
    };

    channel.addEventListener('open', handleOpen);
    channel.addEventListener('close', handleClose);
    channel.addEventListener('error', handleError);
  });
}

function voiceConnectionErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Microphone access is required for voice input.';
  }
  if (error instanceof Error && error.message) return error.message;
  return 'TroCode could not connect to OpenAI voice.';
}

export function usePushToTalk({
  disabled = false,
  enabled = true,
  onError,
  onTranscriptChange,
  onTranscriptSubmit,
}: UsePushToTalkOptions): PushToTalkState {
  const [platform] = useState<PushToTalkPlatform>(getPushToTalkPlatform);
  const [status, setStatus] = useState<VoiceInputStatus>(() =>
    enabled && platform !== 'unsupported' ? 'idle' : 'unavailable',
  );
  const activeTurnRef = useRef<ActiveVoiceTurn | null>(null);
  const attemptRef = useRef(0);
  const pressedCodesRef = useRef(new Set<string>());
  const chordHeldRef = useRef(false);
  const disabledRef = useRef(disabled);
  const enabledRef = useRef(enabled);
  const onErrorRef = useRef(onError);
  const onTranscriptChangeRef = useRef(onTranscriptChange);
  const onTranscriptSubmitRef = useRef(onTranscriptSubmit);

  useEffect(() => {
    disabledRef.current = disabled;
    enabledRef.current = enabled;
    onErrorRef.current = onError;
    onTranscriptChangeRef.current = onTranscriptChange;
    onTranscriptSubmitRef.current = onTranscriptSubmit;
  }, [disabled, enabled, onError, onTranscriptChange, onTranscriptSubmit]);

  const cancel = useCallback(() => {
    attemptRef.current += 1;
    pressedCodesRef.current.clear();
    chordHeldRef.current = false;

    const turn = activeTurnRef.current;
    activeTurnRef.current = null;
    if (turn) closeVoiceTurn(turn);

    setStatus(
      enabledRef.current && platform !== 'unsupported'
        ? 'idle'
        : 'unavailable',
    );
  }, [platform]);

  const failTurn = useCallback(
    (turn: ActiveVoiceTurn, message: string): void => {
      if (activeTurnRef.current !== turn) return;
      activeTurnRef.current = null;
      chordHeldRef.current = false;
      closeVoiceTurn(turn);
      setStatus(enabledRef.current ? 'idle' : 'unavailable');
      onErrorRef.current(message);
    },
    [],
  );

  const beginListening = useCallback(async () => {
    if (
      disabledRef.current ||
      !enabledRef.current ||
      platform === 'unsupported' ||
      chordHeldRef.current ||
      activeTurnRef.current
    ) {
      return;
    }

    chordHeldRef.current = true;
    const attempt = attemptRef.current + 1;
    attemptRef.current = attempt;
    setStatus('requesting_permission');

    let pendingStream: MediaStream | null = null;
    let pendingTurn: ActiveVoiceTurn | null = null;

    try {
      pendingStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      if (attemptRef.current !== attempt || !chordHeldRef.current) {
        for (const track of pendingStream.getTracks()) track.stop();
        return;
      }

      setStatus('connecting');
      const session = await window.tro.createVoiceSession();
      if (attemptRef.current !== attempt || !chordHeldRef.current) {
        for (const track of pendingStream.getTracks()) track.stop();
        return;
      }

      const connection = new RTCPeerConnection();
      const channel = connection.createDataChannel('oai-events');
      const turn: ActiveVoiceTurn = {
        channel,
        committed: false,
        connection,
        resultTimer: null,
        stream: pendingStream,
        transcript: '',
      };
      pendingTurn = turn;
      activeTurnRef.current = turn;

      for (const track of pendingStream.getTracks()) {
        connection.addTrack(track, pendingStream);
      }

      channel.addEventListener('message', (event) => {
        if (
          activeTurnRef.current !== turn ||
          typeof event.data !== 'string'
        ) {
          return;
        }

        const transcriptionEvent = parseRealtimeTranscriptionEvent(event.data);
        if (!transcriptionEvent) return;

        if (transcriptionEvent.type === 'delta') {
          turn.transcript += transcriptionEvent.delta;
          onTranscriptChangeRef.current(turn.transcript.trimStart());
          return;
        }

        if (transcriptionEvent.type === 'error') {
          failTurn(turn, transcriptionEvent.message);
          return;
        }

        const transcript =
          transcriptionEvent.transcript || turn.transcript.trim();
        const shouldSubmit = turn.committed && transcript.length >= 2;
        activeTurnRef.current = null;
        closeVoiceTurn(turn);
        setStatus(enabledRef.current ? 'idle' : 'unavailable');

        if (shouldSubmit) {
          onTranscriptChangeRef.current(transcript);
          onTranscriptSubmitRef.current(transcript);
        } else if (turn.committed) {
          onErrorRef.current(
            `No speech was detected. Hold ${pushToTalkShortcutName(platform)} and try again.`,
          );
        }
      });

      connection.addEventListener('connectionstatechange', () => {
        if (connection.connectionState === 'failed') {
          failTurn(turn, 'The OpenAI voice media connection failed.');
        }
      });

      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      const response = await fetch(OPENAI_REALTIME_CALLS_URL, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${session.clientSecret}`,
          'Content-Type': 'application/sdp',
        },
      });
      const answerSdp = await response.text();
      if (!response.ok) {
        throw new Error('OpenAI rejected the realtime voice connection.');
      }

      await connection.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp,
      });
      await waitForDataChannelOpen(channel);

      if (
        attemptRef.current !== attempt ||
        !chordHeldRef.current ||
        activeTurnRef.current !== turn
      ) {
        if (activeTurnRef.current === turn) activeTurnRef.current = null;
        closeVoiceTurn(turn);
        return;
      }

      setStatus('listening');
    } catch (error) {
      if (pendingTurn && activeTurnRef.current === pendingTurn) {
        activeTurnRef.current = null;
        closeVoiceTurn(pendingTurn);
      } else if (pendingStream) {
        for (const track of pendingStream.getTracks()) track.stop();
      }

      if (attemptRef.current !== attempt) return;
      chordHeldRef.current = false;
      setStatus(enabledRef.current ? 'idle' : 'unavailable');
      onErrorRef.current(voiceConnectionErrorMessage(error));
    }
  }, [failTurn, platform]);

  const finishListening = useCallback(() => {
    if (!chordHeldRef.current) return;
    chordHeldRef.current = false;

    const turn = activeTurnRef.current;
    if (!turn || turn.channel.readyState !== 'open') {
      attemptRef.current += 1;
      if (turn) {
        activeTurnRef.current = null;
        closeVoiceTurn(turn);
      }
      setStatus(enabledRef.current ? 'idle' : 'unavailable');
      onErrorRef.current(
        'Voice was still connecting. Hold the shortcut until “Listening” appears, then speak.',
      );
      return;
    }

    turn.committed = true;
    setStatus('processing');
    turn.channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    for (const track of turn.stream.getTracks()) track.stop();
    turn.resultTimer = setTimeout(() => {
      failTurn(turn, 'OpenAI voice did not return a transcript in time.');
    }, TRANSCRIPT_TIMEOUT_MS);
  }, [failTurn]);

  useEffect(() => {
    enabledRef.current = enabled;
    if (!enabled) cancel();
  }, [cancel, enabled, platform]);

  useEffect(() => {
    const pressedCodes = pressedCodesRef.current;

    const handleKeyDown = (event: KeyboardEvent): void => {
      pressedCodes.add(event.code);

      if (event.key === 'Escape' && chordHeldRef.current) {
        event.preventDefault();
        cancel();
        return;
      }

      if (event.repeat || !isPushToTalkChord(platform, pressedCodes)) return;
      event.preventDefault();
      void beginListening();
    };

    const handleKeyUp = (event: KeyboardEvent): void => {
      pressedCodes.delete(event.code);
      if (
        !chordHeldRef.current ||
        isPushToTalkChord(platform, pressedCodes)
      ) {
        return;
      }
      event.preventDefault();
      finishListening();
    };

    const handleBlur = (): void => {
      pressedCodes.clear();
      finishListening();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      pressedCodes.clear();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      cancel();
    };
  }, [beginListening, cancel, finishListening, platform]);

  const visibleStatus =
    !enabled || platform === 'unsupported'
      ? 'unavailable'
      : status === 'unavailable'
        ? 'idle'
        : status;

  return { cancel, platform, status: visibleStatus };
}
