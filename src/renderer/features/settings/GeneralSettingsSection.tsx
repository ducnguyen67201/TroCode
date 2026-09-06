import type { AppLanguage } from '../../../shared/contracts';
import {
  APP_LANGUAGE_OPTIONS,
  appLanguageLabel,
  translate,
} from '../../app-language';

import { type SettingsSectionId } from './settings-navigation';
import type { SettingsPageProps } from './settings-types';

export function GeneralSettingsSection({
  activeSection,
  appLanguage,
  onAppLanguageChange,
}: Pick<SettingsPageProps, 'appLanguage' | 'onAppLanguageChange'> & {
  activeSection: SettingsSectionId;
}) {
  const t = (message: string, replacements?: Record<string, string | number>) =>
    translate(appLanguage, message, replacements);

  return (
    <div
      aria-labelledby="settings-nav-general"
      className="settings-dialog__panel"
      hidden={activeSection !== 'general'}
      id="settings-panel-general"
      role="region"
    >
      <section
        className="settings-group"
        aria-labelledby="settings-interface-heading"
      >
        <div className="settings-group__heading">
          <div>
            <p className="eyebrow">{t('App interface')}</p>
            <h2 id="settings-interface-heading">{t('App language')}</h2>
          </div>
          <span className="settings-badge settings-badge--neutral">
            {appLanguageLabel(appLanguage)}
          </span>
        </div>
        <div className="settings-row">
          <div>
            <strong>{t('Interface language')}</strong>
            <p>
              {t(
                'Choose the language used for navigation, settings, and other Tro controls.',
              )}
            </p>
          </div>
          <label className="language-field" htmlFor="settings-app-language">
            <span>{t('Interface language')}</span>
            <select
              id="settings-app-language"
              onChange={(event) =>
                onAppLanguageChange(event.target.value as AppLanguage)
              }
              value={appLanguage}
            >
              {APP_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
    </div>
  );
}
