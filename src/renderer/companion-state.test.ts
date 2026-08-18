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
    expect(CompanionStateSchema.parse('working')).toBe('working');
    expect(CompanionStateSchema.parse('completed')).toBe('completed');
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
      kind: 'guidance',
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
    expect(
      CompanionGuidanceSchema.parse({
        kind: 'result',
        message: 'Your task is complete.',
        side: 'left',
      }),
    ).toMatchObject({ kind: 'result', message: 'Your task is complete.' });
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
        mediaUrl:
          'trocode-audio://speech/00000000-0000-4000-8000-000000000001',
        mimeType: 'audio/mpeg',
        source: 'elevenlabs',
        text: 'Read the task result.',
      }),
    ).toMatchObject({ mimeType: 'audio/mpeg', source: 'elevenlabs' });
    expect(
      CompanionSpeechSchema.safeParse({
        id: 'not-an-id',
        mediaUrl: 'https://example.com/speech.mp3',
        mimeType: 'audio/wav',
        source: 'elevenlabs',
        text: 'Read the task result.',
      }).success,
    ).toBe(false);
  });

  it('looks attentive throughout shortcut activation and listening', () => {
    for (const voiceStatus of [
      'requesting_permission',
      'listening',
    ] as const) {
      expect(
        getCompanionState({
          hasError: false,
          isSending: false,
          showTaskCompleted: false,
          taskPhase: null,
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
        showTaskCompleted: false,
        taskPhase: null,
        voiceStatus: 'processing',
      }),
    ).toBe('processing');
    expect(
      getCompanionState({
        hasError: false,
        isSending: true,
        showTaskCompleted: false,
        taskPhase: null,
        voiceStatus: 'idle',
      }),
    ).toBe('sending');
  });

  it('shows an error only when no newer interaction is active', () => {
    expect(
      getCompanionState({
        hasError: true,
        isSending: false,
        showTaskCompleted: false,
        taskPhase: null,
        voiceStatus: 'idle',
      }),
    ).toBe('error');
    expect(
      getCompanionState({
        hasError: true,
        isSending: false,
        showTaskCompleted: false,
        taskPhase: null,
        voiceStatus: 'listening',
      }),
    ).toBe('listening');
  });

  it('stays visibly active throughout task execution', () => {
    for (const taskPhase of [
      'idle',
      'interpreting',
      'clarifying',
      'ready',
      'planning',
      'observing',
      'acting',
      'verifying',
    ] as const) {
      expect(
        getCompanionState({
          hasError: false,
          isSending: false,
          showTaskCompleted: false,
          taskPhase,
          voiceStatus: 'idle',
        }),
      ).toBe('working');
    }
  });

  it('rests when the task needs attention instead of implying progress', () => {
    for (const taskPhase of [
      'awaiting_input',
      'awaiting_approval',
      'paused',
      'blocked',
      'failed',
      'cancelled',
    ] as const) {
      expect(
        getCompanionState({
          hasError: false,
          isSending: false,
          showTaskCompleted: false,
          taskPhase,
          voiceStatus: 'idle',
        }),
      ).toBe('idle');
    }
  });

  it('shows the explicit completion feedback after task work ends', () => {
    expect(
      getCompanionState({
        hasError: false,
        isSending: false,
        showTaskCompleted: true,
        taskPhase: 'completed',
        voiceStatus: 'idle',
      }),
    ).toBe('completed');
  });
});
