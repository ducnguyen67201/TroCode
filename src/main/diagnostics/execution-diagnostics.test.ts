import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDiagnosticFileSink, diagnosticText, executionDiagnostic, toolResultDiagnostic, withExecutionDiagnostics } from './execution-diagnostics';

afterEach(() => vi.restoreAllMocks());

describe('execution diagnostics', () => {
  it('keeps overlapping calls correlated and does not swallow or retry the original exception', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = new Error('Window activation failed');
    let unblock!: () => void;
    const blocked = new Promise<void>((resolve) => { unblock = resolve; });
    const action = vi.fn(async () => { await blocked; executionDiagnostic('native.failure'); throw error; });
    const first = withExecutionDiagnostics({ taskId: 'student-a', callId: 'call-a' }, action);
    await withExecutionDiagnostics({ taskId: 'student-b', callId: 'call-b' }, async () => {
      executionDiagnostic('native.success');
      unblock();
    });
    await expect(first).rejects.toBe(error);
    expect(action).toHaveBeenCalledOnce();
    const entries = log.mock.calls.map(([, line]) => JSON.parse(String(line)));
    expect(entries.find((entry) => entry.event === 'native.failure')).toMatchObject({ taskId: 'student-a', callId: 'call-a' });
    expect(entries.find((entry) => entry.event === 'native.success')).toMatchObject({ taskId: 'student-b', callId: 'call-b' });
    expect(entries.find((entry) => entry.event === 'tool.exception')).toMatchObject({ callId: 'call-a', error: 'Error: Window activation failed' });
  });

  it('redacts common credentials, URLs, account identifiers and native paths in errors', () => {
    const value = diagnosticText('Failed Bearer abc123 token="secret-value" sk-secretkey https://host.test/private?key=x person@example.com\nC:\\Users\\Student\\secret.md\n/Users/student/private.md');
    for (const secret of ['abc123', 'secret-value', 'sk-secretkey', 'host.test', 'person@example.com', 'Student', 'private.md']) expect(value).not.toContain(secret);
    expect(value).toContain('Failed');
    expect(diagnosticText('x'.repeat(5000))).toHaveLength(1500);
    expect(diagnosticText(new Error('Native failed', { cause: new Error('Foreground activation refused') }))).toContain('caused by Error: Foreground activation refused');
    expect(() => diagnosticText({ toString: () => { throw new Error('Invalid error'); } })).not.toThrow();
  });

  it('records opening status without logging result payloads or successful summaries', () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    toolResultDiagnostic({ status: 'confirmed', summary: 'private document', data: { operation: { id: 'operation-1', status: 'pending' }, text: 'private document', image: 'private image' } });
    const entry = JSON.parse(String(log.mock.calls[0]?.[1]));
    expect(entry).toMatchObject({ event: 'tool.result', status: 'confirmed', operationId: 'operation-1', openingStatus: 'pending' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private');
  });

  it('does not fail execution when the console throws', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => { throw new Error('Closed pipe'); });
    await expect(withExecutionDiagnostics({ callId: 'call' }, async () => 42)).resolves.toBe(42);
  });

  it('bounds persisted logs across writer restarts and tolerates an unwritable destination', () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), 'tro-diagnostics-'));
    const directory = path.join(folder, 'diagnostics');
    try {
      const write = createDiagnosticFileSink(directory, 64);
      for (let index = 0; index < 10; index++) write(JSON.stringify({ index }));
      const restarted = createDiagnosticFileSink(directory, 64);
      for (let index = 10; index < 20; index++) restarted(JSON.stringify({ index }));
      expect(readdirSync(directory).sort()).toEqual(['execution.jsonl', 'execution.previous.jsonl']);
      for (const name of readdirSync(directory)) expect(statSync(path.join(directory, name)).size).toBeLessThanOrEqual(64);
      expect(readFileSync(path.join(directory, 'execution.jsonl'), 'utf8')).toContain('19');
      const invalid = path.join(folder, 'file');
      writeFileSync(invalid, 'file');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const unavailable = createDiagnosticFileSink(invalid);
      expect(() => { unavailable('{}'); unavailable('{}'); }).not.toThrow();
      expect(warn).toHaveBeenCalledOnce();
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
});
