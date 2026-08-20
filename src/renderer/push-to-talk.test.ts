import { describe, expect, it } from 'vitest';

import {
  detectPushToTalkPlatform,
  globalPushToTalkShortcutName,
  isPushToTalkChord,
  pushToTalkShortcutName,
} from './push-to-talk';

describe('push-to-talk shortcuts', () => {
  it('detects supported desktop platforms', () => {
    expect(detectPushToTalkPlatform('MacIntel', 'Electron')).toBe('macos');
    expect(detectPushToTalkPlatform('Win32', 'Electron')).toBe('windows');
    expect(detectPushToTalkPlatform('Linux x86_64', 'Electron')).toBe(
      'unsupported',
    );
  });

  it('accepts either Command and Control side on macOS', () => {
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
    expect(pushToTalkShortcutName('windows')).toBe('left Alt + left Control');
    expect(globalPushToTalkShortcutName('windows')).toBe(
      'left Alt + left Control',
    );
    expect(globalPushToTalkShortcutName('macos')).toBe('Command + Control');
  });
});
