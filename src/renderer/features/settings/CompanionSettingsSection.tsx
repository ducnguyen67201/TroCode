import { translate } from '../../app-language';
import { CompanionCustomizationCard } from '../../CompanionCustomizationCard';

import { type SettingsSectionId } from './settings-navigation';
import type { SettingsPageProps } from './settings-types';

export function CompanionSettingsSection({
  activeSection,
  appLanguage,
  classroomPetEnabled,
  companionBusy,
  companionError,
  companionStatus,
  onActivateCompanion,
  onActivateSavedCompanion,
  onClassroomPetEnabledChange,
  onGenerateCompanion,
  onUseDefaultCompanion,
}: Pick<
  SettingsPageProps,
  | 'appLanguage'
  | 'classroomPetEnabled'
  | 'companionBusy'
  | 'companionError'
  | 'companionStatus'
  | 'onActivateCompanion'
  | 'onActivateSavedCompanion'
  | 'onClassroomPetEnabledChange'
  | 'onGenerateCompanion'
  | 'onUseDefaultCompanion'
> & { activeSection: SettingsSectionId }) {
  const t = (message: string, replacements?: Record<string, string | number>) =>
    translate(appLanguage, message, replacements);

  return (
    <div
      aria-labelledby="settings-nav-companion"
      className="settings-dialog__panel"
      hidden={activeSection !== 'companion'}
      id="settings-panel-companion"
      role="region"
    >
      <section
        className="settings-group desktop-pet-settings-card"
        aria-labelledby="settings-desktop-pet-heading"
      >
        <div className="settings-group__heading">
          <div>
            <p className="eyebrow">{t('Personalization')}</p>
            <h2 id="settings-desktop-pet-heading">{t('Desktop pet')}</h2>
          </div>
          <span className="settings-badge settings-badge--neutral">
            {classroomPetEnabled ? t('Enabled') : t('Disabled')}
          </span>
        </div>
        <label
          className="settings-toggle"
          htmlFor="settings-classroom-pet-enabled"
        >
          <input
            checked={classroomPetEnabled}
            id="settings-classroom-pet-enabled"
            onChange={(event) =>
              onClassroomPetEnabledChange(event.target.checked)
            }
            type="checkbox"
          />
          <span>
            <strong>{t('Show desktop pet')}</strong>
            <small>
              {t(
                'Show a stateful animated companion on your desktop. Drag it anywhere you like; it reacts to task progress, pointer hover, and occasional local task or classroom messages. Hover checks only whether the pointer is over the pet on this device; coordinates are never recorded, stored, or sent. It does not inspect apps, websites, or typing.',
              )}
            </small>
          </span>
        </label>
      </section>

      <CompanionCustomizationCard
        appLanguage={appLanguage}
        busy={companionBusy}
        error={companionError}
        onActivate={onActivateCompanion}
        onActivateSaved={onActivateSavedCompanion}
        onGenerate={onGenerateCompanion}
        onUseDefault={onUseDefaultCompanion}
        status={companionStatus}
      />
    </div>
  );
}
