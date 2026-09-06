import type { PrimaryLanguage } from '../../../shared/contracts';
import { translate } from '../../app-language';
import {
  PRIMARY_LANGUAGE_OPTIONS,
  primaryLanguageLabel,
} from '../../language-options';

import { type SettingsSectionId } from './settings-navigation';
import type { SettingsPageProps } from './settings-types';

export function VoiceSettingsSection({
  activeSection,
  appLanguage,
  muteSystemAudioWhileSpeaking,
  onLanguageChange,
  onMuteSystemAudioWhileSpeakingChange,
  primaryLanguage,
  systemAudioMuteSupported,
}: Pick<
  SettingsPageProps,
  | 'appLanguage'
  | 'muteSystemAudioWhileSpeaking'
  | 'onLanguageChange'
  | 'onMuteSystemAudioWhileSpeakingChange'
  | 'primaryLanguage'
  | 'systemAudioMuteSupported'
> & { activeSection: SettingsSectionId }) {
  const t = (message: string, replacements?: Record<string, string | number>) =>
    translate(appLanguage, message, replacements);

  return (
    <div
      aria-labelledby="settings-nav-voice"
      className="settings-dialog__panel"
      hidden={activeSection !== 'voice'}
      id="settings-panel-voice"
      role="region"
    >
      <section
        className="settings-group"
        aria-labelledby="settings-voice-heading"
      >
        <div className="settings-group__heading">
          <div>
            <p className="eyebrow">{t('Voice input')}</p>
            <h2 id="settings-voice-heading">{t('Primary language')}</h2>
          </div>
          <span className="settings-badge">{t('OpenAI GPT Transcribe')}</span>
        </div>
        <div className="settings-row">
          <div>
            <strong>{t('Spoken language')}</strong>
            <p>
              {t(
                'Tro sends this as a transcription hint so short or noisy speech is less likely to be interpreted as an unexpected language or script.',
              )}
            </p>
          </div>
          <label className="language-field" htmlFor="settings-primary-language">
            <span>{t('Spoken language')}</span>
            <select
              id="settings-primary-language"
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
          </label>
        </div>
        <div
          className="settings-voice-shortcuts"
          aria-label={t('Voice shortcuts')}
        >
          <p>
            <strong>{t('Talk')}</strong>
            <span>
              {t('macOS: Command + Control · Windows: left Control + left Alt')}
            </span>
          </p>
          <p>
            <strong>{t('Switch mode')}</strong>
            <span>
              {t('macOS: Command + Backslash · Windows: Control + Backslash')}
            </span>
          </p>
        </div>
        <p className="settings-help">
          {t(
            'Write my words adds text without sending. Ask Tro sends the spoken request after a one-second Escape window.',
          )}
        </p>
        <label className="settings-toggle">
          <input
            checked={muteSystemAudioWhileSpeaking}
            disabled={!systemAudioMuteSupported}
            onChange={(event) =>
              onMuteSystemAudioWhileSpeakingChange(event.target.checked)
            }
            type="checkbox"
          />
          <span>
            <strong>{t('Mute other audio while speaking')}</strong>
            <small>
              {systemAudioMuteSupported
                ? t(
                    'Mute system output while you hold the voice shortcut, then restore its previous mute state when you release.',
                  )
                : t('System audio muting is currently available on macOS.')}
            </small>
          </span>
        </label>
      </section>
    </div>
  );
}
