import { describe, expect, it } from 'vitest';

import {
  CuaBrowserStateSchema,
  CuaWindowStateSchema,
  deriveCuaSemanticCapabilities,
  parseCuaStructuredResult,
} from './cua-semantic-contracts';

describe('CUA semantic contracts', () => {
  it('derives independent window and browser capability groups', () => {
    expect(
      deriveCuaSemanticCapabilities({
        capability_version: '1',
        schema_version: '1',
        tools: [
          'list_windows',
          'get_window_state',
          'click',
          'type_text',
          'press_key',
          'scroll',
          'get_browser_state',
          'browser_click',
          'browser_type',
          'browser_pointer',
          'browser_prepare',
          'verify_state',
        ].map((name) => ({ name })),
      }),
    ).toEqual({
      browserActions: true,
      browserPrepare: true,
      browserState: true,
      capabilityVersion: '1',
      verification: true,
      windowActions: true,
      windowState: true,
    });
  });

  it('keeps window semantics usable when browser tools are absent', () => {
    const capabilities = deriveCuaSemanticCapabilities({
      capability_version: '1',
      schema_version: '1',
      tools: [
        'list_windows',
        'get_window_state',
        'click',
        'type_text',
        'press_key',
        'scroll',
      ].map((name) => ({ name })),
    });
    expect(capabilities.windowState).toBe(true);
    expect(capabilities.windowActions).toBe(true);
    expect(capabilities.browserState).toBe(false);
  });

  it('parses bounded window and browser state without requiring extensions', () => {
    expect(
      CuaWindowStateSchema.parse({
        snapshot_id: 's12345678',
        elements: [
          {
            element_index: 3,
            element_token: 'opaque',
            role: 'AXButton',
            label: 'Run',
          },
        ],
      }).elements[0]?.label,
    ).toBe('Run');
    expect(
      CuaBrowserStateSchema.parse({
        target_id: 'target',
        tab_id: 'tab',
        refs: [{ ref: 'p1:2', role: 'button', name: 'Run' }],
      }).refs?.[0]?.ref,
    ).toBe('p1:2');
  });

  it('rejects malformed native structured JSON', () => {
    expect(() =>
      parseCuaStructuredResult(
        { rawJson: '{', structuredJson: undefined },
        CuaWindowStateSchema,
      ),
    ).toThrow('malformed structured JSON');
  });
});
