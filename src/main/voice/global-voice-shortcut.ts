import { spawn } from 'node:child_process';

import type { VoiceShortcutEvent } from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/desktop-api';

export const WINDOWS_GLOBAL_VOICE_SHORTCUT = 'Control+Alt+Space';
const WINDOWS_KEY_RELEASE_POLL_INTERVAL_MS = 30;
const WINDOWS_KEY_RELEASE_POLL_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class TroCodeKeyboardState {
  [DllImport("user32.dll")]
  public static extern short GetAsyncKeyState(int vKey);
}
'@

$keys = @(0x11, 0x12, 0x20)
while ($true) {
  $allDown = $true
  foreach ($key in $keys) {
    if (([TroCodeKeyboardState]::GetAsyncKeyState($key) -band 0x8000) -eq 0) {
      $allDown = $false
      break
    }
  }

  if (-not $allDown) {
    exit 0
  }

  Start-Sleep -Milliseconds ${WINDOWS_KEY_RELEASE_POLL_INTERVAL_MS}
}
`;

interface GlobalShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

interface VoiceShortcutTarget {
  isDestroyed(): boolean;
  isFocused(): boolean;
  webContents: {
    send(channel: string, value: VoiceShortcutEvent): void;
  };
}

interface GlobalVoiceShortcutOptions {
  getTarget(): VoiceShortcutTarget | null;
  logger?: Pick<Console, 'warn'>;
  platform: NodeJS.Platform;
  registry: GlobalShortcutRegistry;
  waitForRelease?: VoiceShortcutReleaseWatcher;
  watchForMacOSShortcut?: VoiceShortcutWatcher;
}

type VoiceShortcutReleaseWatcher = (signal: AbortSignal) => Promise<void>;
type VoiceShortcutWatcher = (
  listener: (event: VoiceShortcutEvent) => void,
) => () => void;

function encodedPowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export function waitForWindowsGlobalVoiceShortcutRelease(
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encodedPowerShellCommand(WINDOWS_KEY_RELEASE_POLL_SCRIPT),
      ],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    );

    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', handleAbort);
      if (error) reject(error);
      else resolve();
    };

    const handleAbort = (): void => {
      child.kill();
      finish();
    };

    child.once('error', (error) => finish(error));
    child.once('exit', (code, processSignal) => {
      if (signal.aborted || code === 0) {
        finish();
        return;
      }

      finish(
        new Error(
          `Windows voice shortcut release watcher exited with code ${code ?? 'null'} and signal ${processSignal ?? 'null'}.`,
        ),
      );
    });

    signal.addEventListener('abort', handleAbort, { once: true });
    if (signal.aborted) handleAbort();
  });
}

export function registerGlobalVoiceShortcut({
  getTarget,
  logger = console,
  platform,
  registry,
  waitForRelease = waitForWindowsGlobalVoiceShortcutRelease,
  watchForMacOSShortcut,
}: GlobalVoiceShortcutOptions): () => void {
  const sendVoiceShortcutEvent = (
    event: VoiceShortcutEvent,
    options: { allowFocused: boolean },
  ): boolean => {
    const target = getTarget();
    if (!target || target.isDestroyed()) return false;
    if (!options.allowFocused && target.isFocused()) return false;

    target.webContents.send(IPC_CHANNELS.voiceShortcut, event);
    return true;
  };

  if (platform === 'darwin') {
    if (!watchForMacOSShortcut) {
      logger.warn('[voice] macOS global voice shortcut helper is unavailable.');
      return () => undefined;
    }

    return watchForMacOSShortcut((event) => {
      sendVoiceShortcutEvent(event, {
        allowFocused: event.action === 'released',
      });
    });
  }

  if (platform !== 'win32') return () => undefined;

  let releaseController: AbortController | null = null;

  const registered = registry.register(WINDOWS_GLOBAL_VOICE_SHORTCUT, () => {
    if (releaseController) return;

    const sent = sendVoiceShortcutEvent(
      {
        action: 'pressed',
        source: 'global',
      },
      { allowFocused: false },
    );
    if (!sent) return;

    const controller = new AbortController();
    releaseController = controller;
    void waitForRelease(controller.signal)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        logger.warn('[voice] Global voice shortcut release watcher failed.', {
          error:
            error instanceof Error
              ? {
                  message: error.message,
                  name: error.name,
                }
              : {
                  message: String(error),
                },
        });
      })
      .then(() => {
        if (releaseController !== controller) return;
        releaseController = null;
        if (controller.signal.aborted) return;

        sendVoiceShortcutEvent(
          {
            action: 'released',
            source: 'global',
          },
          { allowFocused: true },
        );
      });
  });

  if (!registered) {
    logger.warn('[voice] Could not register global voice shortcut.', {
      accelerator: WINDOWS_GLOBAL_VOICE_SHORTCUT,
    });
    return () => undefined;
  }

  return () => {
    releaseController?.abort();
    releaseController = null;
    registry.unregister(WINDOWS_GLOBAL_VOICE_SHORTCUT);
  };
}
