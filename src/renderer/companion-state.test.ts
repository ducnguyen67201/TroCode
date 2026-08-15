import { describe, expect, it } from 'vitest';

import { CompanionStateSchema } from '../shared/contracts';

import { getCompanionState } from './companion-state';

describe('cursor companion state', () => {
  it('accepts only supported IPC state values', () => {
    expect(CompanionStateSchema.parse('sending')).toBe('sending');
    expect(() => CompanionStateSchema.parse('busy')).toThrow();
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

  it('shows sending while transcription or task submission is in flight', () => {
    expect(
      getCompanionState({
        hasError: false,
        isSending: false,
        voiceStatus: 'processing',
      }),
    ).toBe('sending');
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
