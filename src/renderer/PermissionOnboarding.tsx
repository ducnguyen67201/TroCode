import type { CuaStatus } from '../shared/contracts';

import { BrandMark } from './BrandMark';
import {
  permissionStateLabel,
  type PermissionChecklist,
  type PermissionState,
} from './permission-onboarding';

interface PermissionOnboardingProps {
  checklist: PermissionChecklist;
  computerStatus: CuaStatus;
  error: string | null;
  isChecking: boolean;
  isRequesting: boolean;
  onEnable(): void;
  onOpenScreenRecordingSettings(): void;
  onRefresh(): void;
}

const PERMISSIONS: ReadonlyArray<{
  description: string;
  icon: string;
  key: keyof PermissionChecklist;
  name: string;
}> = [
  {
    description: 'Lets TroCode click, type, and control apps for you.',
    icon: '⌁',
    key: 'accessibility',
    name: 'Accessibility',
  },
  {
    description: 'Lets TroCode see the screen and verify its work.',
    icon: '▣',
    key: 'screenRecording',
    name: 'Screen Recording',
  },
  {
    description: 'Lets you use push-to-talk voice commands.',
    icon: '●',
    key: 'microphone',
    name: 'Microphone',
  },
] as const;

function permissionTone(state: PermissionState): string {
  if (state === 'granted' || state === 'not_required') return 'ready';
  if (state === 'blocked' || state === 'unavailable') return 'blocked';
  return 'pending';
}

export function PermissionOnboarding({
  checklist,
  computerStatus,
  error,
  isChecking,
  isRequesting,
  onEnable,
  onOpenScreenRecordingSettings,
  onRefresh,
}: PermissionOnboardingProps) {
  const hasBlockedPermission = Object.values(checklist).some(
    (state) => state === 'blocked',
  );

  return (
    <main className="permission-onboarding">
      <div className="permission-onboarding__brand">
        <BrandMark />
        <div>
          <strong>TroCode</strong>
          <span>Desktop agent</span>
        </div>
      </div>

      <section
        aria-labelledby="permission-heading"
        className="permission-onboarding__card"
      >
        <div className="permission-onboarding__intro">
          <span className="permission-onboarding__step">One-time setup</span>
          <p className="eyebrow">Permissions</p>
          <h1 id="permission-heading">Enable TroCode to work for you</h1>
          <p>
            TroCode needs these macOS permissions to hear your request, use the
            computer, and confirm the result. You stay in control and can revoke
            them in System Settings at any time.
          </p>
        </div>

        <ul className="permission-list">
          {PERMISSIONS.map((permission) => {
            const state = checklist[permission.key];
            return (
              <li key={permission.key}>
                <span className="permission-list__icon" aria-hidden="true">
                  {permission.icon}
                </span>
                <span className="permission-list__copy">
                  <strong>{permission.name}</strong>
                  <span>{permission.description}</span>
                </span>
                <span className="permission-list__status">
                  <span
                    aria-label={`${permission.name}: ${permissionStateLabel(state)}`}
                    className={`permission-state permission-state--${permissionTone(state)}`}
                  >
                    <span aria-hidden="true" />
                    {permissionStateLabel(state)}
                  </span>
                  {permission.key === 'screenRecording' &&
                    state !== 'granted' &&
                    state !== 'not_required' &&
                    state !== 'checking' && (
                      <button
                        className="permission-settings-button"
                        disabled={isRequesting}
                        onClick={onOpenScreenRecordingSettings}
                        type="button"
                      >
                        Open settings
                      </button>
                    )}
                </span>
              </li>
            );
          })}
        </ul>

        {(error || computerStatus.state === 'error') && (
          <div className="permission-onboarding__error" role="alert">
            <strong>Permission setup needs attention</strong>
            <span>{error ?? computerStatus.summary}</span>
          </div>
        )}

        <div className="permission-onboarding__actions">
          <button
            className="primary-button"
            disabled={isChecking || isRequesting}
            onClick={onEnable}
            type="button"
          >
            {isRequesting
              ? 'Waiting for macOS…'
              : hasBlockedPermission
                ? 'Open permission settings'
                : 'Enable all permissions'}
            {!isRequesting && <span aria-hidden="true">→</span>}
          </button>
          <button
            className="permission-refresh"
            disabled={isChecking || isRequesting}
            onClick={onRefresh}
            type="button"
          >
            {isChecking ? 'Checking…' : 'Check again'}
          </button>
        </div>

        <p className="permission-onboarding__note" role="status">
          macOS may open System Settings. Enable TroCode there, then return to
          this window—we’ll check and connect automatically. Screen Recording
          may require restarting TroCode once.
        </p>
      </section>
    </main>
  );
}
