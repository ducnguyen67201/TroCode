import { describe, expect, it } from 'vitest';

import {
  CompanionGuidanceSchema,
  CompanionSpeechSchema,
  CompanionStateSchema,
  CompanionVoiceActivitySchema,
} from '../shared/contracts';

import { getCompanionState } from './companion-state';

describe('cursor companion state', () => {
  it('accepts only supported IPC state values', () => {
    expect(CompanionStateSchema.parse('guiding')).toBe('guiding');
    expect(CompanionStateSchema.parse('sending')).toBe('sending');
    expect(CompanionStateSchema.parse('processing')).toBe('processing');
    expect(() => CompanionStateSchema.parse('busy')).toThrow();
  });

  it('keeps teaching callouts brief at the companion IPC boundary', () => {
    expect(
      CompanionGuidanceSchema.parse({
        message: 'Use present continuous because “now” marks an action in progress.',
        playback: 'paused',
        side: 'right',
        target: 'Question 2',
      }),
    ).toEqual({
      message: 'Use present continuous because “now” marks an action in progress.',
      playback: 'paused',
      side: 'right',
      target: 'Question 2',
    });
    expect(
      CompanionGuidanceSchema.safeParse({
        message: 'x'.repeat(241),
        side: 'right',
      }).success,
    ).toBe(false);
  });

  it('bounds live voice activity sent to the transcript island', () => {
    expect(
      CompanionVoiceActivitySchema.parse({
        phase: 'listening',
        transcript: 'Open YouTube',
      }),
    ).toEqual({
      appLanguage: 'en',
      phase: 'listening',
      transcript: 'Open YouTube',
    });
    expect(
      CompanionVoiceActivitySchema.safeParse({
        phase: 'idle',
        transcript: '',
      }).success,
    ).toBe(false);
    expect(
      CompanionVoiceActivitySchema.safeParse({
        phase: 'processing',
        transcript: 'x'.repeat(8_001),
      }).success,
    ).toBe(false);
  });

  it('accepts only bounded MP3 companion speech at the IPC boundary', () => {
    expect(
      CompanionSpeechSchema.parse({
        id: '00000000-0000-4000-8000-000000000001',
        dataBase64: 'AQIDBA==',
        mimeType: 'audio/mpeg',
      }),
    ).toMatchObject({ mimeType: 'audio/mpeg' });
    expect(
      CompanionSpeechSchema.safeParse({
        id: 'not-an-id',
        dataBase64: 'AQIDBA==',
        mimeType: 'audio/wav',
      }).success,
    ).toBe(false);
  });

  it('looks attentive throughout shortcut activation and listening', () => {
    for (const voiceStatus of [
      'requesting_permission',
      'connecting',
      'listening',
    ] as const) {
      expect(
        getCompanionState({
          hasError: false,
          isSending: false,
          voiceStatus,
        }),
      ).toBe('listening');
    }
  });

  it('distinguishes voice processing from task submission', () => {
    expect(
      getCompanionState({
        hasError: false,
        isSending: false,
        voiceStatus: 'processing',
      }),
    ).toBe('processing');
    expect(
      getCompanionState({
        hasError: false,
        isSending: true,
        voiceStatus: 'idle',
      }),
    ).toBe('sending');
  });

  it('shows an error only when no newer interaction is active', () => {
    expect(
      getCompanionState({
        hasError: true,
        isSending: false,
        voiceStatus: 'idle',
      }),
    ).toBe('error');
    expect(
      getCompanionState({
        hasError: true,
        isSending: false,
        voiceStatus: 'listening',
      }),
    ).toBe('listening');
  });
});
