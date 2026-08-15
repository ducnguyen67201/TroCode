import { describe, expect, it, vi } from 'vitest';

import type { CuaStatus } from '../shared/contracts';
import {
  createPermissionChecklist,
  inspectMicrophonePermission,
  isPermissionSetupComplete,
  permissionStateLabel,
} from './permission-onboarding';

const READY_CUA_STATUS: CuaStatus = {
  state: 'ready',
  available: true,
  platform: 'darwin',
  permissions: {
    accessibility: true,
    screenRecording: true,
  },
  summary: 'Connected.',
  nextActions: [],
};

describe('permission onboarding', () => {
  it('maps each macOS grant independently', () => {
    const checklist = createPermissionChecklist(
      {
        ...READY_CUA_STATUS,
        state: 'permission_required',
        available: false,
        permissions: {
          accessibility: true,
          screenRecording: false,
        },
      },
      'required',
      true,
    );

    expect(checklist).toEqual({
      accessibility: 'granted',
      microphone: 'required',
      screenRecording: 'required',
    });
  });

  it('does not complete until permissions and the CUA runtime are ready', () => {
    const checklist = createPermissionChecklist(
      READY_CUA_STATUS,
      'granted',
      true,
    );

    expect(isPermissionSetupComplete(checklist, READY_CUA_STATUS)).toBe(true);
    expect(
      isPermissionSetupComplete(checklist, {
        ...READY_CUA_STATUS,
        state: 'disconnected',
        available: false,
      }),
    ).toBe(false);
    expect(
      isPermissionSetupComplete(
        { ...checklist, microphone: 'blocked' },
        READY_CUA_STATUS,
      ),
    ).toBe(false);
  });

  it('does not require macOS-only grants on other supported platforms', () => {
    const checklist = createPermissionChecklist(
      { ...READY_CUA_STATUS, platform: 'win32', permissions: undefined },
      'granted',
      true,
    );

    expect(checklist.accessibility).toBe('not_required');
    expect(checklist.screenRecording).toBe('not_required');
    expect(permissionStateLabel(checklist.accessibility)).toBe('Not required');
  });

  it('reads microphone permission without starting a recording', async () => {
    const query = vi.fn(async () => ({ state: 'denied' as const }));

    await expect(inspectMicrophonePermission({ query })).resolves.toBe(
      'blocked',
    );
    expect(query).toHaveBeenCalledOnce();
  });
});
