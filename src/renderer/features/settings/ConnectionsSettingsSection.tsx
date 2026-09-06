import { ConnectedApplicationsCard } from './ConnectedApplicationsCard';
import { type SettingsSectionId } from './settings-navigation';
import type { SettingsPageProps } from './settings-types';

export function ConnectionsSettingsSection({
  activeSection,
  appLanguage,
}: Pick<SettingsPageProps, 'appLanguage'> & {
  activeSection: SettingsSectionId;
}) {
  return (
    <div
      aria-labelledby="settings-nav-connections"
      className="settings-dialog__panel"
      hidden={activeSection !== 'connections'}
      id="settings-panel-connections"
      role="region"
    >
      <ConnectedApplicationsCard appLanguage={appLanguage} />
    </div>
  );
}
