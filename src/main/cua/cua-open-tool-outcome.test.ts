import { expect, it } from 'vitest';

import { isCuaObservationTool } from './cua-observation-tools';
import { cuaOpenToolOutcome } from './cua-open-tool-outcome';
import type { CuaOpenToolResult } from './cua-semantic-contracts';

it.each(['unverifiable', 'suspected_noop', 'partial', 'confirmed', 'refused'] as const)('preserves native %s without treating an unverified input as success', (effect) => {
  const result: CuaOpenToolResult = { text: 'Native receipt', images: [], isError: false, degraded: false, rawJson: JSON.stringify({ effect }) };
  const outcome = cuaOpenToolOutcome('press_key', result);
  expect(outcome.recovery).toBe(['unverifiable', 'suspected_noop'].includes(effect) ? 'observe' : undefined);
  expect(outcome.status).toBe(effect === 'confirmed' ? 'confirmed' : effect === 'refused' ? 'denied' : 'unknown');
  expect(cuaOpenToolOutcome('arbitrary_mutation', result).recovery).toBeUndefined();
  expect(cuaOpenToolOutcome('press_key', { ...result, isError: true }).recovery).toBeUndefined();
});

it('classifies native observations conservatively, including optional exports', () => {
  expect(isCuaObservationTool('get_accessibility_tree', { pid: 9992 })).toBe(true);
  expect(isCuaObservationTool('press_key', {})).toBe(false);
  expect(isCuaObservationTool('future_read_named_mutation', {})).toBe(false);
  expect(isCuaObservationTool('get_window_state', { screenshot_out_file: 'screen.png' })).toBe(false);
});
