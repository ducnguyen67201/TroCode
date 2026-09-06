import { resolve } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { readStylesheet } from '../test-support/read-stylesheet';

import {
  isVoiceModeToggleShortcut,
  nextVoiceMode,
  VoiceModeControl,
  voiceModeToggleShortcutDescriptor,
} from './VoiceModeControl';

describe('VoiceModeControl', () => {
  it('identifies the selected mode with text, icon, color hook, and pressed state', () => {
    const markup = renderToStaticMarkup(
      <VoiceModeControl
        appLanguage="en"
        mode="task"
        onChange={vi.fn()}
        platform="macos"
      />,
    );

    expect(markup).toContain('Write my words');
    expect(markup).toContain('Ask Tro');
    expect(markup).toContain('voice-mode-option--task');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('Hold');
    expect(markup).toContain('⌘');
    expect(markup).toContain('Switch');
    expect(markup).toContain('aria-keyshortcuts="Meta+\\"');
  });

  it('uses one shared two-key talk shortcut on Windows', () => {
    const markup = renderToStaticMarkup(
      <VoiceModeControl
        appLanguage="en"
        mode="dictation"
        onChange={vi.fn()}
        platform="windows"
      />,
    );

    expect(markup).toContain('Left Ctrl');
    expect(markup).toContain('Left Alt');
    expect(markup).not.toContain('Left Shift');
    expect(markup).toContain('aria-keyshortcuts="Control+\\"');
  });

  it('supports the optional platform toggle without stealing modified variants', () => {
    const baseEvent = {
      altKey: false,
      ctrlKey: false,
      key: '\\',
      metaKey: false,
      shiftKey: false,
    };

    expect(
      isVoiceModeToggleShortcut({ ...baseEvent, metaKey: true }, 'macos'),
    ).toBe(true);
    expect(
      isVoiceModeToggleShortcut({ ...baseEvent, ctrlKey: true }, 'windows'),
    ).toBe(true);
    expect(
      isVoiceModeToggleShortcut(
        { ...baseEvent, metaKey: true, shiftKey: true },
        'macos',
      ),
    ).toBe(false);
    expect(voiceModeToggleShortcutDescriptor('unsupported')).toBeNull();
    expect(nextVoiceMode('dictation')).toBe('task');
    expect(nextVoiceMode('task')).toBe('dictation');
  });

  it('keeps the task composer voice controls bounded by responsive CSS constraints', () => {
    const css = readStylesheet(resolve(__dirname, '../index.css'));

    expect(css).toContain('container-name: task-composer;');
    expect(css).toContain('container-type: inline-size;');
    expect(css).toContain(
      'grid-template-columns: minmax(160px, 0.38fr) minmax(0, 1fr);',
    );
    expect(css).toContain(
      'grid-template-columns: minmax(92px, 110px) minmax(0, 1fr);',
    );
    expect(css).toContain('flex-wrap: wrap;');
    expect(css).toContain('@container task-composer (max-width: 700px)');
    expect(css).toContain('@container task-composer (max-width: 620px)');
    expect(css).toContain('@container task-composer (max-width: 440px)');
  });
});
