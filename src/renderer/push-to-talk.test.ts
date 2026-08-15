import { describe, expect, it } from 'vitest';

import {
  detectPushToTalkPlatform,
  isPushToTalkChord,
  parseRealtimeTranscriptionEvent,
  pushToTalkShortcutName,
  readRecognitionTranscript,
  speechRecognitionErrorMessage,
} from './push-to-talk';

describe('push-to-talk helpers', () => {
  it('detects the desktop platform', () => {
    expect(detectPushToTalkPlatform('MacIntel', 'Electron')).toBe('macos');
    expect(detectPushToTalkPlatform('Win32', 'Electron')).toBe('windows');
    expect(detectPushToTalkPlatform('Linux x86_64', 'Electron')).toBe(
      'unsupported',
    );
  });

  it('accepts Command and Control from either side on macOS', () => {
    expect(
      isPushToTalkChord('macos', new Set(['MetaLeft', 'ControlRight'])),
    ).toBe(true);
    expect(isPushToTalkChord('macos', new Set(['MetaLeft']))).toBe(false);
  });

  it('requires left Alt and left Control on Windows', () => {
    expect(
      isPushToTalkChord('windows', new Set(['AltLeft', 'ControlLeft'])),
    ).toBe(true);
    expect(
      isPushToTalkChord('windows', new Set(['AltRight', 'ControlLeft'])),
    ).toBe(false);
    expect(
      isPushToTalkChord('windows', new Set(['AltLeft', 'ControlRight'])),
    ).toBe(false);
    expect(pushToTalkShortcutName('windows')).toBe('left Alt + left Control');
  });

  it('combines final and interim speech results', () => {
    const results = {
      0: { 0: { transcript: 'open YouTube' }, isFinal: true },
      1: { 0: { transcript: 'for me' }, isFinal: false },
      length: 2,
    };

    expect(readRecognitionTranscript(results)).toEqual({
      combined: 'open YouTube for me',
      final: 'open YouTube',
      interim: 'for me',
    });
  });

  it('turns recognition failures into actionable messages', () => {
    expect(speechRecognitionErrorMessage('not-allowed')).toContain(
      'Microphone access',
    );
    expect(speechRecognitionErrorMessage('no-speech', 'windows')).toContain(
      'left Alt + left Control',
    );
    expect(speechRecognitionErrorMessage('aborted')).toBeNull();
  });
});

describe('parseRealtimeTranscriptionEvent', () => {
  it('parses transcript deltas and completed turns', () => {
    expect(
      parseRealtimeTranscriptionEvent(
        JSON.stringify({
          type: 'conversation.item.input_audio_transcription.delta',
          delta: 'open YouTube',
        }),
      ),
    ).toEqual({ type: 'delta', delta: 'open YouTube' });

    expect(
      parseRealtimeTranscriptionEvent(
        JSON.stringify({
          type: 'conversation.item.input_audio_transcription.completed',
          transcript: ' open YouTube for me ',
        }),
      ),
    ).toEqual({ type: 'completed', transcript: 'open YouTube for me' });
  });

  it('ignores malformed and unrelated events', () => {
    expect(parseRealtimeTranscriptionEvent('not-json')).toBeNull();
    expect(
      parseRealtimeTranscriptionEvent(JSON.stringify({ type: 'session.created' })),
    ).toBeNull();
  });
});
