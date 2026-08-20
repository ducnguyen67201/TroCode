import type {
  AppLanguage,
  CuaStatus,
  PrimaryLanguage,
} from '../shared/contracts';

import { translate } from './app-language';
import { BrandMark } from './BrandMark';
import {
  PRIMARY_LANGUAGE_OPTIONS,
  primaryLanguageLabel,
} from './language-options';
import {
  permissionStateLabel,
  type PermissionChecklist,
  type PermissionState,
} from './permission-onboarding';

interface PermissionOnboardingProps {
  appLanguage: AppLanguage;
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
  primaryLanguage: PrimaryLanguage;
}

const PERMISSIONS: ReadonlyArray<{
  description: string;
  icon: string;
  key: keyof PermissionChecklist;
  name: string;
}> = [
  {
    description: 'Lets Tro click, type, and control apps for you.',
    icon: '⌁',
    key: 'accessibility',
    name: 'Accessibility',
  },
  {
    description: 'Lets Tro see the screen and verify its work.',
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
  appLanguage,
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
  primaryLanguage,
}: PermissionOnboardingProps) {
  const t = (message: string) => translate(appLanguage, message);
  return (
    <main className="permission-onboarding">
      <div className="permission-onboarding__brand">
        <BrandMark />
        <div>
          <strong>Tro</strong>
          <span>{t('Desktop agent')}</span>
        </div>
      </div>

      <section
        aria-labelledby="permission-heading"
        className="permission-onboarding__card"
      >
        <div className="permission-onboarding__intro">
          <span className="permission-onboarding__step">
            {t('Quick setup')}
          </span>
          <p className="eyebrow">{t('Language first')}</p>
          <h1 id="permission-heading">
            {t('Choose how you talk with Tro')}
          </h1>
          <p>
            {t(
              'Text tasks work without microphone or computer permissions. Choose your spoken language now; voice and computer use remain optional and can be connected only when you need them.',
            )}
          </p>
          <label
            className="language-field permission-onboarding__language"
            htmlFor="onboarding-primary-language"
          >
            <span>{t('What language will you usually speak?')}</span>
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
                  {primaryLanguageLabel(option.code, appLanguage)}
                </option>
              ))}
            </select>
            <small>
              {t(
                'Tro uses this to keep voice transcription in the language you expect. You can change it later in Settings.',
              )}
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
                  <strong>{t(permission.name)}</strong>
                  <span>{t(permission.description)}</span>
                </span>
                <span className="permission-list__status">
                  <span
                    aria-label={`${t(permission.name)}: ${t(permissionStateLabel(state))}`}
                    className={`permission-state permission-state--${permissionTone(state)}`}
                  >
                    <span aria-hidden="true" />
                    {t(permissionStateLabel(state))}
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
                        {t('Request access')}
                      </button>
                    )}
                </span>
              </li>
            );
          })}
        </ul>

        {(error || computerStatus.state === 'error') && (
          <div className="permission-onboarding__error" role="alert">
            <strong>{t('Permission setup needs attention')}</strong>
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
            {isRequesting ? t('Saving…') : t('Continue to Tro')}
            {!isRequesting && <span aria-hidden="true">→</span>}
          </button>
          <button
            className="permission-refresh"
            disabled={isChecking || isLanguageLoading || isRequesting}
            onClick={onRefresh}
            type="button"
          >
            {isChecking ? t('Checking…') : t('Check again')}
          </button>
        </div>

        <p className="permission-onboarding__note" role="status">
          {t(
            'Optional permissions are shown here for visibility, but they do not block the workspace. Tro asks for them only when you choose voice or computer use.',
          )}
        </p>
      </section>
    </main>
  );
}
