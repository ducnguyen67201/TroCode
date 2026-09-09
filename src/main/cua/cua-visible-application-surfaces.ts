import { createHash, randomUUID } from 'node:crypto';

import type { CuaWindow, TrustedApplicationIdentity, VisibleApplicationSurface } from './cua-semantic-contracts';

const chromeNames = new Set(['google chrome', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']);
export function visibleApplicationSurfaces(application: TrustedApplicationIdentity, windows: readonly CuaWindow[], now: number): VisibleApplicationSurface[] {
  return windows.filter((window) => window.is_on_screen && window.on_current_space && window.bounds.width > 0 && window.bounds.height > 0 && application === 'chrome' && chromeNames.has(window.app_name.trim().toLocaleLowerCase('en-US')))
    .map((window) => ({ application, observationId: randomUUID(), observedAt: new Date(now).toISOString(),
      observationFingerprint: createHash('sha256').update(JSON.stringify({ application, bounds: window.bounds, pid: window.pid, windowId: window.window_id })).digest('hex') }));
}
