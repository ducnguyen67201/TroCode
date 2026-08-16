import { describe, expect, it } from 'vitest';

import { parseMacOSVoiceShortcutOutput } from './macos-voice-shortcut-watcher';

describe('parseMacOSVoiceShortcutOutput', () => {
  it('parses press and release lines across process chunks', () => {
    const first = parseMacOSVoiceShortcutOutput('', 'ready\npre');

    expect(first.events).toEqual([]);
    expect(first.remainder).toBe('pre');

    const second = parseMacOSVoiceShortcutOutput(
      first.remainder,
      'ssed\nreleased\n',
    );

    expect(second.events).toEqual([
      { action: 'pressed', source: 'global' },
      { action: 'released', source: 'global' },
    ]);
    expect(second.remainder).toBe('');
  });

  it('ignores unknown helper output', () => {
    expect(parseMacOSVoiceShortcutOutput('', 'unknown\n')).toEqual({
      events: [],
      remainder: '',
    });
  });
});
