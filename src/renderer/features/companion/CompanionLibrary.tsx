import desktopPetUrl from '../../../assets/tro-desktop-pet.png';
import type { CompanionCustomizationStatus } from '../../../shared/contracts';
import { appLocale } from '../../app-language';

import type { CompanionCustomizationBusy } from './customization-types';

interface CompanionLibraryProps {
  t: (
    message: string,
    replacements?: Record<string, string | number>,
  ) => string;
  status: CompanionCustomizationStatus;
  isDefaultActive: boolean;
  isBusy: boolean;
  onUseDefault: () => Promise<void>;
  onActivateSaved: (companionId: string) => Promise<void>;
  appLanguage: 'en' | 'vi';
  busy: CompanionCustomizationBusy;
}

export function CompanionLibrary({
  t,
  status,
  isDefaultActive,
  isBusy,
  onUseDefault,
  onActivateSaved,
  appLanguage,
  busy,
}: CompanionLibraryProps) {
  return (
    <section
      aria-labelledby="saved-companions-heading"
      className="companion-customization-library"
    >
      <div className="companion-customization-library__heading">
        <div>
          <h3 id="saved-companions-heading">{t('Pick a pet')}</h3>
          <p>
            {t(
              'Choose Tro or a pet you generated. Switching does not use a preview.',
            )}
          </p>
        </div>
        <span>
          {t('{count} custom pets', {
            count: status.savedCompanions.length,
          })}
        </span>
      </div>
      <div className="companion-customization-library__grid">
        <button
          aria-label={isDefaultActive ? t('Tro, active') : t('Use Tro')}
          aria-pressed={isDefaultActive}
          className={`companion-customization-library__item${isDefaultActive ? ' is-active' : ''}`}
          disabled={isBusy || isDefaultActive}
          onClick={() => void onUseDefault()}
          type="button"
        >
          <span className="companion-customization-library__preview">
            <img alt="" src={desktopPetUrl} />
          </span>
          <span className="companion-customization-library__copy">
            <strong>Tro</strong>
            <small>{t('Animated default pet')}</small>
          </span>
          <span className="companion-customization-library__action">
            {isDefaultActive ? t('Active') : t('Use')}
          </span>
        </button>

        {status.savedCompanions.map((companion, index) => {
          const isActive =
            status.appearance.kind === 'custom' &&
            status.appearance.revision === companion.id;
          const label = t('Generated pet {number}', {
            number: index + 1,
          });
          return (
            <button
              aria-label={
                isActive
                  ? t('{name}, active', { name: label })
                  : t('Use {name}', { name: label })
              }
              aria-pressed={isActive}
              className={`companion-customization-library__item${isActive ? ' is-active' : ''}`}
              disabled={isBusy || isActive}
              key={companion.id}
              onClick={() => void onActivateSaved(companion.id)}
              type="button"
            >
              <span className="companion-customization-library__preview">
                <img alt="" src={companion.assetUrl} />
              </span>
              <span className="companion-customization-library__copy">
                <strong>{label}</strong>
                <small>
                  {t('Created {date}', {
                    date: new Intl.DateTimeFormat(appLocale(appLanguage), {
                      dateStyle: 'medium',
                      timeZone: 'UTC',
                    }).format(new Date(companion.createdAt)),
                  })}
                </small>
              </span>
              <span className="companion-customization-library__action">
                {isActive
                  ? t('Active')
                  : busy === 'selecting'
                    ? t('Switching…')
                    : t('Use')}
              </span>
            </button>
          );
        })}
      </div>
      <p className="companion-customization-library__privacy">
        {t('Generated pets stay encrypted on this device.')}
      </p>
    </section>
  );
}
