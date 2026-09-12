import { afterEach, expect, it, vi } from 'vitest';

import { withExecutionDiagnostics } from '../diagnostics/execution-diagnostics';

import { traceNativeCall } from './cua-execution-diagnostics';
import type { CuaOpenToolResult } from './cua-semantic-contracts';

afterEach(() => vi.restoreAllMocks());
const result = (overrides: Partial<CuaOpenToolResult> = {}): CuaOpenToolResult => ({
  degraded: false, isError: false, images: [], rawJson: '{}', text: '', ...overrides,
});

it('captures a native refusal with the parent call and target, without leaking arguments or the raw payload', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  const native = result({ isError: true, errorCode: 'foreground_ineffective', text: 'Could not activate window',
    structuredJson: JSON.stringify({ effect: 'refused', route: 'accessibility', refusal: { code: 'foreground_ineffective', reason: 'Window did not become foreground' }, document: 'private source' }) });
  const dispatch = vi.fn(async () => native);
  const returned = await withExecutionDiagnostics({ taskId: 'task', callId: 'call', lessonId: 'lesson' }, () =>
    traceNativeCall('click', { session: 'task', pid: 12, window_id: 34, delivery_mode: 'background', text: 'private input', token: 'private token' }, dispatch));
  expect(returned).toBe(native);
  expect(dispatch).toHaveBeenCalledOnce();
  const entries = log.mock.calls.map(([, line]) => JSON.parse(String(line)));
  const completed = entries.find((entry) => entry.event === 'cua.result');
  expect(completed).toMatchObject({ taskId: 'task', callId: 'call', lessonId: 'lesson', nativeTool: 'click', targetPid: 12, targetWindowId: 34, effect: 'refused', errorCode: 'foreground_ineffective', refusalCode: 'foreground_ineffective' });
  expect(entries.find((entry) => entry.event === 'cua.started')?.nativeCallId).toBe(completed.nativeCallId);
  expect(JSON.stringify(log.mock.calls)).not.toContain('private');
});

it('keeps native exceptions intact, redacts their diagnostics, and dispatches once', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  const error = new Error('Native rejected Bearer secret');
  const dispatch = vi.fn(async () => { throw error; });
  await expect(traceNativeCall('press_key', { key: 'private input' }, dispatch)).rejects.toBe(error);
  expect(dispatch).toHaveBeenCalledOnce();
  expect(log.mock.calls.some(([, line]) => JSON.parse(String(line)).event === 'cua.exception')).toBe(true);
  expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
});

it('does not print successful observation text, structured state, or image bytes', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  await traceNativeCall('get_window_state', {}, async () => result({ text: 'private document', rawJson: '{"text":"private document"}', images: [{ mimeType: 'image/png', dataBase64: 'private image' }] }));
  expect(JSON.stringify(log.mock.calls)).not.toContain('private');
  expect(log.mock.calls.map(([, line]) => JSON.parse(String(line))).find((entry) => entry.event === 'cua.result')).toMatchObject({ screenshotCount: 1, isError: false });
});
