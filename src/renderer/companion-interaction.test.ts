import { describe, expect, it } from 'vitest';

import {
  getFocusedApprovalShortcut,
  isApprovalExpired,
} from './companion-interaction';

describe('cursor-card approval controls', () => {
  it('requires a deliberate modified shortcut for approval or denial', () => {
    expect(
      getFocusedApprovalShortcut({
        altKey: false,
        ctrlKey: false,
        key: 'Enter',
        metaKey: true,
        shiftKey: true,
      }),
    ).toBe('approve');
    expect(
      getFocusedApprovalShortcut({
        altKey: false,
        ctrlKey: true,
        key: 'Backspace',
        metaKey: false,
        shiftKey: true,
      }),
    ).toBe('deny');
  });

  it('never treats plain enter, typed yes, or a partial chord as approval', () => {
    for (const shortcut of [
      {
        altKey: false,
        ctrlKey: false,
        key: 'Enter',
        metaKey: false,
        shiftKey: false,
      },
      {
        altKey: false,
        ctrlKey: false,
        key: 'yes',
        metaKey: false,
        shiftKey: false,
      },
      {
        altKey: false,
        ctrlKey: false,
        key: 'Enter',
        metaKey: true,
        shiftKey: false,
      },
    ]) {
      expect(getFocusedApprovalShortcut(shortcut)).toBeNull();
    }
  });

  it('expires approval at the exact deadline', () => {
    const expiresAt = '2026-08-17T12:05:00.000Z';

    expect(isApprovalExpired(expiresAt, Date.parse(expiresAt) - 1)).toBe(false);
    expect(isApprovalExpired(expiresAt, Date.parse(expiresAt))).toBe(true);
  });
});
