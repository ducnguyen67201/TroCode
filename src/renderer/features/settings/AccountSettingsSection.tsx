import { translate } from '../../app-language';
import { planTitle } from '../../usage-presentation';

import { type SettingsSectionId } from './settings-navigation';
import type { SettingsPageProps } from './settings-types';

export function AccountSettingsSection({
  activeSection,
  appLanguage,
  isActivatingMembership,
  membershipError,
  membershipStatus,
  organization,
  organizationError,
  isLoadingOrganization,
  onActivateMembership,
  onOpenOrganization,
  onRefreshOrganization,
}: Pick<
  SettingsPageProps,
  | 'appLanguage'
  | 'isActivatingMembership'
  | 'membershipError'
  | 'membershipStatus'
  | 'organization'
  | 'organizationError'
  | 'isLoadingOrganization'
  | 'onActivateMembership'
  | 'onOpenOrganization'
  | 'onRefreshOrganization'
> & { activeSection: SettingsSectionId }) {
  const t = (message: string, replacements?: Record<string, string | number>) =>
    translate(appLanguage, message, replacements);

  return (
    <div
      aria-labelledby="settings-nav-account"
      className="settings-dialog__panel"
      hidden={activeSection !== 'account'}
      id="settings-panel-account"
      role="region"
    >
      <section
        className="settings-card settings-membership-card"
        aria-labelledby="membership-settings-heading"
      >
        <div className="settings-card__heading">
          <div>
            <p className="eyebrow">{t('Plan access')}</p>
            <h2 id="membership-settings-heading">{t('Promo code')}</h2>
          </div>
          <span className="settings-badge">
            {planTitle(membershipStatus?.plan ?? 'free')}
          </span>
        </div>
        <p className="settings-help">
          {membershipStatus?.plan === 'free'
            ? t(
                'You can keep using Tro Free. Enter a promo code here whenever you are ready to upgrade.',
              )
            : t('Your promo code is active on this account.')}
        </p>
        {membershipStatus?.plan === 'free' && (
          <form
            className="settings-promo-form"
            onSubmit={(event) => {
              event.preventDefault();
              const code = String(
                new FormData(event.currentTarget).get('promoCode') ?? '',
              ).trim();
              if (code.length >= 4) onActivateMembership(code);
            }}
          >
            <label className="settings-promo-field">
              <span>{t('Promo or access code')}</span>
              <input
                autoCapitalize="none"
                autoComplete="off"
                disabled={isActivatingMembership}
                minLength={4}
                name="promoCode"
                placeholder={t('Enter your promo code')}
                required
                spellCheck={false}
                type="text"
              />
            </label>
            <p
              className={`settings-feedback ${
                membershipError ? 'settings-feedback--error' : ''
              }`}
              role={membershipError ? 'alert' : 'status'}
            >
              {membershipError ?? membershipStatus.summary}
            </p>
            <div className="settings-actions">
              <button
                className="primary-button"
                disabled={isActivatingMembership}
                type="submit"
              >
                {isActivatingMembership
                  ? t('Checking…')
                  : t('Apply promo code')}
              </button>
            </div>
          </form>
        )}
      </section>

      {(organization ||
        organizationError ||
        (isLoadingOrganization && membershipStatus?.plan !== 'free')) && (
        <section
          className="settings-card settings-organization-card"
          aria-labelledby="organization-settings-summary-heading"
        >
          <div className="settings-card__heading">
            <div>
              <p className="eyebrow">{t('Organization access')}</p>
              <h2 id="organization-settings-summary-heading">
                {organization?.name ?? t('Organization settings')}
              </h2>
            </div>
            {organization && (
              <span className="settings-badge settings-badge--neutral">
                {t(organization.role === 'organizer' ? 'Organizer' : 'Member')}
              </span>
            )}
          </div>
          {organization ? (
            <>
              <dl className="settings-organization-summary">
                <div>
                  <dt>{t('Plan')}</dt>
                  <dd>{planTitle(organization.plan)}</dd>
                </div>
                <div>
                  <dt>{t('Assigned seats')}</dt>
                  <dd>
                    {t('{assigned} of {maximum}', {
                      assigned: organization.capacity.assignedSeats,
                      maximum: organization.capacity.maxSeats,
                    })}
                  </dd>
                </div>
              </dl>
              <p className="settings-help">
                {organization.role === 'organizer'
                  ? t(
                      'Manage your organization name and reserve seats by email. Students sign in with that address and do not need your code.',
                    )
                  : t(
                      'Your Tro access is managed by this organization. You do not need to enter its access code.',
                    )}
              </p>
              {organizationError && (
                <p
                  className="settings-feedback settings-feedback--error"
                  role="alert"
                >
                  {organizationError}
                </p>
              )}
              <div className="settings-actions">
                <button
                  className="primary-button"
                  onClick={onOpenOrganization}
                  type="button"
                >
                  {t('Open organization settings')}
                </button>
              </div>
            </>
          ) : isLoadingOrganization ? (
            <p className="settings-help" aria-live="polite">
              {t('Loading organization…')}
            </p>
          ) : (
            <>
              <p
                className="settings-feedback settings-feedback--error"
                role="alert"
              >
                {organizationError}
              </p>
              <div className="settings-actions">
                <button
                  className="secondary-button"
                  onClick={onRefreshOrganization}
                  type="button"
                >
                  {t('Try again')}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
