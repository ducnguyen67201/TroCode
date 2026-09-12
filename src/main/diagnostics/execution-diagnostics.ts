import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

import type { ToolExecutionResult } from '../agent/agent-contracts';

type Fields = Record<string, string | number | boolean | null | undefined>;
const context = new AsyncLocalStorage<Fields>();
let fileSink: ((line: string) => void) | undefined;

/** Diagnostic prose only; never pass arguments, source content, or observations. */
export function diagnosticText(value: unknown): string {
  let text: string;
  try {
    text = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
    let cause = value instanceof Error ? value.cause : undefined;
    for (let depth = 0; cause !== undefined && depth < 3; depth++) {
      text += `; caused by ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`;
      cause = cause instanceof Error ? cause.cause : undefined;
    }
  } catch { text = 'Diagnostic error details unavailable'; }
  return text
    .replace(/Bearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(/\b(?:sk-[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/gu, '[credential]')
    .replace(/\b(?:token|password|secret|api[_-]?key|authorization)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/giu, '[credential]')
    .replace(/\b(?:https?|file):\/\/[^\s<>]+/giu, '[url]')
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+/gu, '[email]')
    .replace(/(?:[A-Za-z]:\\|\\\\)[^\r\n"<>]+/gu, '[path]')
    .replace(/\/(?:Users|home|private|tmp|var|Applications)\/[^\r\n"<>]+/gu, '[path]')
    .replace(/[\r\n\t]+/gu, ' ')
    .slice(0, 1500);
}

/** Logging must never change execution, even when stdout or the disk is unavailable. */
export function executionDiagnostic(event: string, fields: Fields = {}): void {
  try {
    const record = { ...context.getStore(), ...fields, event, timestamp: new Date().toISOString() };
    const sanitized = Object.fromEntries(Object.entries(record).map(([key, value]) =>
      [key, typeof value === 'string' ? diagnosticText(value) : value]));
    const line = JSON.stringify(sanitized);
    try { console.info('[execution]', line); } catch { /* Diagnostics cannot fail a tool. */ }
    try { fileSink?.(line); } catch { /* A sink failure cannot fail a tool. */ }
  } catch { /* Diagnostic construction is best effort. */ }
}

export function withExecutionDiagnostics<T>(fields: Fields, execute: () => Promise<T>): Promise<T> {
  return context.run({ ...context.getStore(), ...fields }, async () => {
    const started = performance.now();
    executionDiagnostic('tool.received');
    try { return await execute(); }
    catch (error) {
      executionDiagnostic('tool.exception', { error: diagnosticText(error) });
      throw error;
    } finally {
      executionDiagnostic('tool.settled', { durationMs: Math.round(performance.now() - started) });
    }
  });
}

export function toolResultDiagnostic(result: ToolExecutionResult): void {
  const operation = result.data?.operation;
  const opening = operation && typeof operation === 'object' ? operation as Record<string, unknown> : undefined;
  executionDiagnostic('tool.result', {
    status: result.status,
    recovery: result.recovery,
    error: result.status === 'confirmed' ? undefined : diagnosticText(result.summary),
    observationId: result.observation?.observationId,
    observationRoute: result.observation?.route,
    elementCount: result.observation?.elements?.length,
    hasScreenshot: Boolean(result.observation?.screenshot),
    operationId: typeof opening?.id === 'string' ? opening.id : undefined,
    openingStatus: typeof opening?.status === 'string' ? opening.status : undefined,
  });
}

/** Two files, at most 2 MiB each. Only the dedicated diagnostics directory is touched. */
export function createDiagnosticFileSink(directory: string, maxBytes = 2 * 1024 * 1024): (line: string) => void {
  const current = path.join(directory, 'execution.jsonl');
  const previous = path.join(directory, 'execution.previous.jsonl');
  let warned = false;
  return (line) => {
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const entry = `${line}\n`;
      if (Buffer.byteLength(entry) > maxBytes) return;
      if (existsSync(current) && statSync(current).size + Buffer.byteLength(entry) > maxBytes) {
        rmSync(previous, { force: true });
        renameSync(current, previous);
      }
      appendFileSync(current, entry, { mode: 0o600 });
    } catch {
      if (!warned) {
        warned = true;
        try { console.warn('[execution] Diagnostic file unavailable; terminal logging continues.'); } catch { /* Best effort. */ }
      }
    }
  };
}

export function initializeExecutionDiagnostics(userData: string, build: string): void {
  const directory = path.join(userData, 'diagnostics');
  fileSink = createDiagnosticFileSink(directory);
  try { console.info(`[execution] Log file: ${path.join(directory, 'execution.jsonl')}`); } catch { /* Best effort. */ }
  executionDiagnostic('app.started', { build, platform: process.platform, pid: process.pid });
}
