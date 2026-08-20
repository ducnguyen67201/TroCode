import { spawn } from 'node:child_process';

import type { VoiceShortcutEvent } from '../../shared/contracts';

import { parseMacOSVoiceShortcutOutput } from './macos-voice-shortcut-watcher';

const WATCH_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class TroModifierState {
  [DllImport("user32.dll")]
  public static extern short GetAsyncKeyState(int vKey);
}
'@
$wasDown = $false
while ($true) {
  $leftControlDown = ([TroModifierState]::GetAsyncKeyState(0xA2) -band 0x8000) -ne 0
  $leftAltDown = ([TroModifierState]::GetAsyncKeyState(0xA4) -band 0x8000) -ne 0
  $isDown = $leftControlDown -and $leftAltDown
  if ($isDown -and -not $wasDown) {
    [Console]::Out.WriteLine('pressed')
    [Console]::Out.Flush()
  } elseif (-not $isDown -and $wasDown) {
    [Console]::Out.WriteLine('released')
    [Console]::Out.Flush()
  }
  $wasDown = $isDown
  Start-Sleep -Milliseconds 20
}
`;

interface WindowsVoiceShortcutWatcherOptions {
  logger?: Pick<Console, 'warn'>;
  onEvent(event: VoiceShortcutEvent): void;
}

export function watchWindowsGlobalVoiceShortcut({
  logger = console,
  onEvent,
}: WindowsVoiceShortcutWatcherOptions): () => void {
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      Buffer.from(WATCH_SCRIPT, 'utf16le').toString('base64'),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  let outputRemainder = '';
  let stderr = '';
  let stopped = false;

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
    logger.warn('[voice] Windows global voice shortcut watcher failed.', {
      error: { message: error.message, name: error.name },
    });
  });
  child.once('exit', (code, signal) => {
    if (stopped) return;
    logger.warn('[voice] Windows global voice shortcut watcher exited.', {
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
