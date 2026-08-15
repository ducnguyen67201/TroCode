import type { CuaStatus, PrimaryLanguage } from '../shared/contracts';

import { BrandMark } from './BrandMark';
import { PRIMARY_LANGUAGE_OPTIONS } from './language-options';
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
  isLanguageLoading: boolean;
  isRequesting: boolean;
  onLanguageChange(language: PrimaryLanguage): void;
  onEnable(): void;
  onOpenScreenRecordingSettings(): void;
  onRefresh(): void;
  permissionsComplete: boolean;
  primaryLanguage: PrimaryLanguage;
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
  isLanguageLoading,
  isRequesting,
  onLanguageChange,
  onEnable,
  onOpenScreenRecordingSettings,
  onRefresh,
  permissionsComplete,
  primaryLanguage,
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
          <p className="eyebrow">Language &amp; permissions</p>
          <h1 id="permission-heading">Enable TroCode to work for you</h1>
          <p>
            Choose your spoken language, then give TroCode the macOS permissions
            it needs to hear your request, use the computer, and confirm the
            result. You stay in control and can revoke permissions in System
            Settings at any time.
          </p>
          <label
            className="language-field permission-onboarding__language"
            htmlFor="onboarding-primary-language"
          >
            <span>What language will you usually speak?</span>
            <select
              disabled={isLanguageLoading || isRequesting}
              id="onboarding-primary-language"
              onChange={(event) =>
                onLanguageChange(event.target.value as PrimaryLanguage)
              }
              value={primaryLanguage}
            >
              {PRIMARY_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
            <small>
              TroCode uses this to keep voice transcription in the language you
              expect. You can change it later in Settings.
            </small>
          </label>
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
                        Request access
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
            disabled={isChecking || isLanguageLoading || isRequesting}
            onClick={onEnable}
            type="button"
          >
            {isRequesting
              ? 'Finishing setup…'
              : permissionsComplete
                ? 'Finish setup'
              : hasBlockedPermission
                ? 'Open permission settings'
                : 'Enable all permissions'}
            {!isRequesting && <span aria-hidden="true">→</span>}
          </button>
          <button
            className="permission-refresh"
            disabled={isChecking || isLanguageLoading || isRequesting}
            onClick={onRefresh}
            type="button"
          >
            {isChecking ? 'Checking…' : 'Check again'}
          </button>
        </div>

        <p className="permission-onboarding__note" role="status">
          TroCode registers itself with macOS for Screen Recording. If System
          Settings opens, switch on the TroCode row—you should not need the +
          button. Then return here and we’ll connect automatically. Screen
          Recording may require restarting TroCode once.
        </p>
      </section>
    </main>
  );
}
