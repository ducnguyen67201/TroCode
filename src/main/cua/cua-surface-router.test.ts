import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { CuaAuthorizationBroker } from './cua-authorization-broker';
import type { CuaOpenToolResult } from './cua-semantic-contracts';
import {
  CuaSurfaceRouter,
  selectWindow,
  type CuaToolCaller,
} from './cua-surface-router';

const capabilities = {
  browserActions: true,
  browserPrepare: true,
  browserState: true,
  capabilityVersion: '1',
  verification: true,
  windowActions: true,
  windowState: true,
};

function result(structured: unknown, overrides: Partial<CuaOpenToolResult> = {}) {
  return {
    text: '',
    images: [],
    structuredJson: JSON.stringify(structured),
    isError: false,
    degraded: false,
    rawJson: JSON.stringify(structured),
    ...overrides,
  } satisfies CuaOpenToolResult;
}

const windowRecord = {
  window_id: 7,
  pid: 42,
  app_name: 'Visual Studio Code',
  title: 'main.py',
  bounds: { x: 0, y: 25, width: 1_440, height: 875 },
  z_index: 10,
  is_on_screen: true,
  on_current_space: true,
};

function router(callTool: CuaToolCaller) {
  return new CuaSurfaceRouter({
    authorizationBroker: new CuaAuthorizationBroker({
      allow: 0 as never,
      deny: 1 as never,
      cancel: 2 as never,
    }),
    callTool,
    capabilities: () => capabilities,
    ownProcessId: 999,
    now: () => Date.parse('2026-08-19T00:00:00.000Z'),
  });
}

describe('CuaSurfaceRouter', () => {
  it('selects the top non-TroCode window and refuses ambiguous null stacking', () => {
    expect(
      selectWindow(
        [
          { ...windowRecord, app_name: 'TroCode', pid: 999, z_index: 20 },
          windowRecord,
        ],
        999,
      )?.window_id,
    ).toBe(7);
    expect(
      selectWindow(
        [
          { ...windowRecord, z_index: null },
          { ...windowRecord, window_id: 8, z_index: null },
        ],
        999,
      ),
    ).toBeUndefined();
  });

  it('observes an exact window without a screenshot and stores opaque refs', async () => {
    const callTool = vi.fn(async (name: string) => {
      if (name === 'list_windows') return result({ windows: [windowRecord] });
      if (name === 'get_window_state') {
        return result({
          snapshot_id: 's12345678',
          tree_markdown: '[button] Run',
          elements: [
            {
              element_index: 3,
              element_token: 'private-token',
              role: 'button',
              label: 'Run',
              frame: { x: 10, y: 20, w: 100, h: 30 },
            },
          ],
        });
      }
      throw new Error(`Unexpected ${name}`);
    });
    const service = router(callTool);
    const taskId = randomUUID();
    const observation = await service.observeCurrentSurface(taskId);

    expect(observation).toMatchObject({
      route: 'window_accessibility',
      surface: { kind: 'code_editor', application: 'Visual Studio Code' },
      elements: [{ ref: 'e1', role: 'button', name: 'Run' }],
    });
    expect(JSON.stringify(observation)).not.toContain('private-token');
    expect(service.referenceStore.resolve(taskId, observation!.observationId, 'e1').raw)
      .toMatchObject({ elementToken: 'private-token' });
  });

  it('uses a typed browser ref and returns fresh semantic state after a click', async () => {
    let snapshot = 1;
    const callTool = vi.fn(async (name: string) => {
      if (name === 'list_windows') {
        return result({
          windows: [{ ...windowRecord, app_name: 'Google Chrome', title: 'Editor' }],
        });
      }
      if (name === 'get_browser_state') {
        return result({
          target_id: 'private-target',
          tab_id: 'private-tab',
          snapshot_id: `p${snapshot}`,
          title: 'Editor',
          url: 'https://example.com/editor',
          text: snapshot === 1 ? 'Run' : 'Passed',
          elements: [
            { ref: `p${snapshot}:1`, role: 'button', name: 'Run' },
          ],
        });
      }
      if (name === 'browser_click') {
        snapshot += 1;
        return result({ effect: 'confirmed', route: 'trusted_input' }, {
          text: 'Clicked.',
        });
      }
      throw new Error(`Unexpected ${name}`);
    });
    const service = router(callTool);
    const taskId = randomUUID();
    const observation = (await service.observeCurrentSurface(taskId))!;
    const outcome = await service.execute(
      taskId,
      observation.observationId,
      { kind: 'click_element', ref: 'e1', button: 'left', count: 1 },
    );

    expect(outcome.status).toBe('confirmed');
    expect(outcome.observation?.text).toBe('Passed');
    expect(callTool).toHaveBeenCalledWith(
      'browser_click',
      expect.objectContaining({
        target_id: 'private-target',
        tab_id: 'private-tab',
        ref: 'p1:1',
      }),
      undefined,
    );
  });

  it('maps a stale refusal to not executed without replaying it', async () => {
    const callTool = vi.fn(async (name: string) => {
      if (name === 'list_windows') return result({ windows: [windowRecord] });
      if (name === 'get_window_state') {
        return result({
          snapshot_id: 's12345678',
          elements: [
            { element_index: 1, element_token: 'token', role: 'button', label: 'Run' },
          ],
        });
      }
      if (name === 'click') {
        return result(
          { refusal: { code: 'stale_element_token' } },
          { isError: true, errorCode: 'stale_element_token', text: 'Stale.' },
        );
      }
      throw new Error(`Unexpected ${name}`);
    });
    const service = router(callTool);
    const taskId = randomUUID();
    const observation = (await service.observeCurrentSurface(taskId))!;
    const outcome = await service.execute(taskId, observation.observationId, {
      kind: 'click_element',
      ref: 'e1',
      button: 'left',
      count: 1,
    });
    expect(outcome.status).toBe('not_executed');
    expect(callTool.mock.calls.filter(([name]) => name === 'click')).toHaveLength(1);
  });
});
