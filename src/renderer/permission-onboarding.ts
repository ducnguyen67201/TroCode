import type { CuaStatus } from '../shared/contracts';

export type PermissionState =
  | 'blocked'
  | 'checking'
  | 'granted'
  | 'not_required'
  | 'required'
  | 'unavailable';

export interface PermissionChecklist {
  accessibility: PermissionState;
  microphone: PermissionState;
  screenRecording: PermissionState;
}

interface PermissionStatusLike {
  state: 'denied' | 'granted' | 'prompt';
}

interface PermissionsLike {
  query(descriptor: PermissionDescriptor): Promise<PermissionStatusLike>;
}

interface ScreenRecordingPermissionApi {
  connectComputer(): Promise<CuaStatus>;
}

function cuaPermissionState(
  status: CuaStatus,
  permission: 'accessibility' | 'screenRecording',
  loaded: boolean,
): PermissionState {
  if (!loaded) return 'checking';
  if (status.platform === 'win32' || status.platform === 'linux') {
    return 'not_required';
  }
  if (status.platform !== 'darwin') return 'unavailable';
  if (!status.permissions) {
    return status.state === 'error' ? 'unavailable' : 'checking';
  }
  return status.permissions[permission] ? 'granted' : 'required';
}

export function createPermissionChecklist(
  computerStatus: CuaStatus,
  microphone: PermissionState,
  computerStatusLoaded: boolean,
): PermissionChecklist {
  return {
    accessibility: cuaPermissionState(
      computerStatus,
      'accessibility',
      computerStatusLoaded,
    ),
    microphone,
    screenRecording: cuaPermissionState(
      computerStatus,
      'screenRecording',
      computerStatusLoaded,
    ),
  };
}

export function isPermissionSetupComplete(
  checklist: PermissionChecklist,
  computerStatus: CuaStatus,
): boolean {
  const permissionIsReady = (state: PermissionState): boolean =>
    state === 'granted' || state === 'not_required';

  return (
    computerStatus.state === 'ready' &&
    computerStatus.available &&
    Object.values(checklist).every(permissionIsReady)
  );
}

export function shouldConnectAfterPermissionRefresh(
  computerStatus: CuaStatus,
): boolean {
  if (computerStatus.state !== 'disconnected') return false;
  if (computerStatus.platform === 'darwin') {
    return (
      computerStatus.permissions?.accessibility === true &&
      computerStatus.permissions.screenRecording === true
    );
  }
  return (
    computerStatus.platform === 'win32' || computerStatus.platform === 'linux'
  );
}

export function permissionStateLabel(state: PermissionState): string {
  switch (state) {
    case 'blocked':
      return 'Blocked';
    case 'checking':
      return 'Checking';
    case 'granted':
      return 'Enabled';
    case 'not_required':
      return 'Not required';
    case 'required':
      return 'Required';
    case 'unavailable':
      return 'Unavailable';
  }
}

export async function requestScreenRecordingPermission(
  api: ScreenRecordingPermissionApi,
): Promise<CuaStatus> {
  return api.connectComputer();
}

export async function inspectMicrophonePermission(
  permissions: PermissionsLike | undefined = navigator.permissions,
): Promise<PermissionState> {
  if (!permissions) return 'required';

  try {
    const status = await permissions.query({
      name: 'microphone' as PermissionName,
    });
    if (status.state === 'granted') return 'granted';
    if (status.state === 'denied') return 'blocked';
    return 'required';
  } catch {
    return 'required';
  }
}
