import { spawn } from 'node:child_process';

import type { VoiceShortcutEvent } from '../../shared/contracts';

export const MACOS_VOICE_SHORTCUT_HELPER_NAME =
  'trocode-macos-voice-shortcut';

interface ParsedShortcutOutput {
  events: VoiceShortcutEvent[];
  remainder: string;
}

interface MacOSVoiceShortcutWatcherOptions {
  executablePath: string;
  logger?: Pick<Console, 'warn'>;
  onEvent(event: VoiceShortcutEvent): void;
}

export function parseMacOSVoiceShortcutOutput(
  previous: string,
  chunk: string,
): ParsedShortcutOutput {
  const lines = `${previous}${chunk}`.split('\n');
  const remainder = lines.pop() ?? '';
  const events: VoiceShortcutEvent[] = [];

  for (const line of lines) {
    const eventName = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (eventName === 'pressed' || eventName === 'released') {
      events.push({ action: eventName, source: 'global' });
    }
  }

  return { events, remainder };
}

export function watchMacOSGlobalVoiceShortcut({
  executablePath,
  logger = console,
  onEvent,
}: MacOSVoiceShortcutWatcherOptions): () => void {
  const child = spawn(executablePath, [], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let outputRemainder = '';
  let stopped = false;
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    const parsed = parseMacOSVoiceShortcutOutput(outputRemainder, chunk);
    outputRemainder = parsed.remainder;
    for (const event of parsed.events) onEvent(event);
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-1_000);
  });

  child.once('error', (error) => {
    if (stopped) return;
    logger.warn('[voice] macOS global voice shortcut helper failed.', {
      error: { message: error.message, name: error.name },
    });
  });
  child.once('exit', (code, signal) => {
    if (stopped) return;
    logger.warn('[voice] macOS global voice shortcut helper exited.', {
      code,
      signal,
      stderr: stderr.trim() || undefined,
    });
  });

  return () => {
    stopped = true;
    if (child.exitCode === null && child.signalCode === null) child.kill();
  };
}
