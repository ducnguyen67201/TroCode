import type { PrimaryLanguage } from '../shared/contracts';

import { PRIMARY_LANGUAGE_OPTIONS } from './language-options';

interface SettingsPageProps {
  error: string | null;
  hasChanges: boolean;
  isSaving: boolean;
  onLanguageChange(language: PrimaryLanguage): void;
  onSave(): void;
  primaryLanguage: PrimaryLanguage;
  saveMessage: string | null;
}

export function SettingsPage({
  error,
  hasChanges,
  isSaving,
  onLanguageChange,
  onSave,
  primaryLanguage,
  saveMessage,
}: SettingsPageProps) {
  return (
    <section className="settings-page" aria-labelledby="settings-heading">
      <div className="settings-heading">
        <p className="eyebrow">Preferences</p>
        <h1 id="settings-heading">Settings</h1>
        <p>
          Choose how TroCode should interpret your voice. This preference stays
          on this device and applies to every new push-to-talk turn.
        </p>
      </div>

      <form
        className="settings-card"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <div className="settings-card__heading">
          <div>
            <p className="eyebrow">Voice input</p>
            <h2>Primary language</h2>
          </div>
          <span className="settings-badge">OpenAI Realtime</span>
        </div>

        <label className="language-field" htmlFor="settings-primary-language">
          <span>Spoken language</span>
          <select
            id="settings-primary-language"
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
        </label>

        <p className="settings-help">
          TroCode sends this as a transcription hint so short or noisy speech is
          less likely to be interpreted as an unexpected language or script.
        </p>

        {(error || saveMessage) && (
          <p
            className={`settings-feedback ${
              error ? 'settings-feedback--error' : ''
            }`}
            role={error ? 'alert' : 'status'}
          >
            {error ?? saveMessage}
          </p>
        )}

        <div className="settings-actions">
          <button
            className="primary-button"
            disabled={isSaving || !hasChanges}
            type="submit"
          >
            {isSaving ? 'Saving…' : hasChanges ? 'Save language' : 'Saved'}
          </button>
        </div>
      </form>
    </section>
  );
}
