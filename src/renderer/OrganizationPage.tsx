import { useCallback, useState } from 'react';

import type { AppLanguage, OrganizationSummary } from '../shared/contracts';

import { translate } from './app-language';
import { OrganizationBanner } from './features/account/OrganizationBanner';
import { OrganizationMembers } from './features/account/OrganizationMembers';
import { useOrganizationBanner } from './features/account/use-organization-banner';
import { useOrganizationMembers } from './features/account/use-organization-members';
import { useOrganizationProfile } from './features/account/use-organization-profile';

export function OrganizationPage({
  appLanguage,
  error,
  isLoading,
  onOpenClasses,
  onOrganizationChange,
  onRefresh,
  organization,
}: {
  appLanguage: AppLanguage;
  error: string | null;
  isLoading: boolean;
  onOpenClasses?: () => void;
  onOrganizationChange: (organization: OrganizationSummary) => void;
  onRefresh: () => Promise<OrganizationSummary | null | void>;
  organization: OrganizationSummary | null;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const organizationId = organization?.id ?? null;
  const isOrganizer = organization?.role === 'organizer';
  const t = useCallback(
    (
      message: string,
      replacements?: Readonly<Record<string, string | number>>,
    ) => translate(appLanguage, message, replacements),
    [appLanguage],
  );
  const {
    bannerError,
    bannerDraft,
    bannerInputId,
    isSavingBanner,
    selectBannerImage,
    saveHomeBanner,
    restoreDefaultHomeBanner,
  } = useOrganizationBanner({
    organization,
    t,
    setNotice,
    isOrganizer,
    onOrganizationChange,
  });

  const {
    profileError,
    saveOrganizationName,
    isSavingName,
    setOrganizationNameDraft,
    setProfileError,
    nameInputRef,
    organizationNameDraft,
  } = useOrganizationProfile({
    organization,
    isOrganizer,
    t,
    setNotice,
    onOrganizationChange,
  });

  const {
    membersError,
    addMember,
    isAdding,
    setEmail,
    emailInputRef,
    email,
    membersHeadingRef,
    memberCount,
    isLoadingMembers,
    loadMembers,
    members,
    cancellingMemberId,
    cancelPendingMember,
    canLoadMore,
    isLoadingMore,
  } = useOrganizationMembers({
    organizationId,
    isOrganizer,
    onOrganizationChange,
    t,
    setNotice,
    organization,
  });

  if (isLoading && !organization) {
    return (
      <section className="organization-page organization-page--centered">
        <p aria-live="polite">{t('Loading organization…')}</p>
      </section>
    );
  }

  if (!organization) {
    return (
      <section className="organization-page">
        <div className="organization-empty">
          <p className="eyebrow">{t('Organization access')}</p>
          <h1>{t('No organization to manage')}</h1>
          <p>
            {error ??
              t('This account does not manage an organization access code.')}
          </p>
          <button
            className="secondary-button"
            onClick={() => void onRefresh()}
            type="button"
          >
            {t('Refresh')}
          </button>
        </div>
      </section>
    );
  }

  const capacityPercent = Math.min(
    100,
    Math.round(
      (organization.capacity.assignedSeats / organization.capacity.maxSeats) *
        100,
    ),
  );
  const capacityFull = organization.capacity.state === 'full';

  return (
    <section className="organization-page">
      <header className="organization-heading">
        <div>
          <p className="eyebrow">{t('Organization settings')}</p>
          <h1>{organization.name}</h1>
          <p>
            {isOrganizer
              ? t('Manage your organization profile and access seats.')
              : t('View the organization that manages your Tro access.')}
          </p>
        </div>
        <span
          className={`organization-role-badge organization-role-badge--${organization.role}`}
        >
          {t(isOrganizer ? 'Organizer' : 'Member')}
        </span>
      </header>

      {error && (
        <div
          className="organization-alert organization-alert--error"
          role="alert"
        >
          <strong>{t('Organization refresh failed')}</strong>
          <span>{error}</span>
        </div>
      )}
      {membersError && (
        <div
          className="organization-alert organization-alert--error"
          role="alert"
        >
          <strong>{t('Something needs attention')}</strong>
          <span>{membersError}</span>
        </div>
      )}
      {profileError && (
        <div
          className="organization-alert organization-alert--error"
          role="alert"
        >
          <strong>{t('Organization name was not saved')}</strong>
          <span>{profileError}</span>
        </div>
      )}
      {bannerError && (
        <div
          className="organization-alert organization-alert--error"
          role="alert"
        >
          <strong>{t('Home banner was not saved')}</strong>
          <span>{bannerError}</span>
        </div>
      )}
      {isOrganizer && capacityFull && (
        <div
          className="organization-alert organization-alert--full"
          role="alert"
        >
          <strong>{t('All seats are assigned')}</strong>
          <span>
            {t('Cancel a pending reservation before adding another person.')}
          </span>
        </div>
      )}
      {notice && (
        <p className="organization-notice" role="status">
          {notice}
        </p>
      )}

      {isOrganizer ? (
        <form
          className="organization-profile"
          onSubmit={(event) => {
            event.preventDefault();
            void saveOrganizationName();
          }}
        >
          <div>
            <p className="eyebrow">{t('Organization profile')}</p>
            <label htmlFor="organization-name">{t('Organization name')}</label>
          </div>
          <div className="organization-profile__controls">
            <input
              autoComplete="organization"
              disabled={isSavingName}
              id="organization-name"
              maxLength={100}
              minLength={1}
              onChange={(event) => {
                setOrganizationNameDraft(event.target.value);
                setProfileError(null);
                setNotice(null);
              }}
              ref={nameInputRef}
              required
              type="text"
              value={organizationNameDraft}
            />
            <span className="organization-profile__count">
              {t('{count} of 100 characters', {
                count: organizationNameDraft.length,
              })}
            </span>
          </div>
          <button
            className="primary-button"
            disabled={
              isSavingName ||
              organizationNameDraft.trim().length < 1 ||
              organizationNameDraft.trim().length > 100
            }
            type="submit"
          >
            {isSavingName ? t('Saving name…') : t('Save name')}
          </button>
        </form>
      ) : (
        <section
          className="organization-managed-access"
          aria-labelledby="managed-access-heading"
        >
          <p className="eyebrow">{t('Managed access')}</p>
          <h2 id="managed-access-heading">
            {t('Your access is managed by this organization')}
          </h2>
          <p>
            {t(
              'You joined automatically with your verified Google email. You do not need to enter the organization code.',
            )}
          </p>
        </section>
      )}

      {isOrganizer && (
        <OrganizationBanner
          t={t}
          bannerDraft={bannerDraft}
          bannerInputId={bannerInputId}
          isSavingBanner={isSavingBanner}
          selectBannerImage={selectBannerImage}
          organization={organization}
          saveHomeBanner={saveHomeBanner}
          restoreDefaultHomeBanner={restoreDefaultHomeBanner}
        />
      )}

      <section
        className="organization-capacity"
        aria-labelledby="capacity-heading"
      >
        <div className="organization-capacity__copy">
          <div>
            <p className="eyebrow">{t('Access capacity')}</p>
            <h2 id="capacity-heading">
              {t('{assigned} of {maximum} seats assigned', {
                assigned: organization.capacity.assignedSeats,
                maximum: organization.capacity.maxSeats,
              })}
            </h2>
          </div>
          <strong>
            {t('{remaining} remaining', {
              remaining: organization.capacity.remainingSeats,
            })}
          </strong>
        </div>
        <div
          aria-label={t('{percent}% of seats assigned', {
            percent: capacityPercent,
          })}
          aria-valuemax={organization.capacity.maxSeats}
          aria-valuemin={0}
          aria-valuenow={organization.capacity.assignedSeats}
          className="organization-capacity__track"
          role="progressbar"
        >
          <span style={{ width: `${capacityPercent}%` }} />
        </div>
      </section>

      {isOrganizer && (
        <form
          className="organization-add-member"
          onSubmit={(event) => {
            event.preventDefault();
            void addMember();
          }}
        >
          <div className="organization-add-member__heading">
            <p className="eyebrow">{t('Access seats')}</p>
            <h2>{t('Invite a student or staff member')}</h2>
            <p>
              {t(
                'Reserve the exact Google account email. Tro does not send an invitation email, and the person does not need your organization code. They join automatically when they sign in.',
              )}
            </p>
          </div>
          <label htmlFor="organization-member-email">
            <span>{t('Google account email')}</span>
            <input
              autoComplete="email"
              disabled={capacityFull || isAdding}
              id="organization-member-email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t('student@example.com')}
              required
              type="email"
              ref={emailInputRef}
              value={email}
            />
          </label>
          <button
            className="primary-button"
            disabled={capacityFull || isAdding || email.trim().length === 0}
            type="submit"
          >
            {isAdding ? t('Reserving…') : t('Reserve seat')}
          </button>
        </form>
      )}

      {isOrganizer && (
        <OrganizationMembers
          t={t}
          membersHeadingRef={membersHeadingRef}
          memberCount={memberCount}
          isLoadingMembers={isLoadingMembers}
          loadMembers={loadMembers}
          members={members}
          appLanguage={appLanguage}
          cancellingMemberId={cancellingMemberId}
          cancelPendingMember={cancelPendingMember}
          canLoadMore={canLoadMore}
          isLoadingMore={isLoadingMore}
        />
      )}

      {isOrganizer && (
        <section
          className="organization-class-next-step"
          aria-labelledby="organization-class-next-step-heading"
        >
          <div>
            <p className="eyebrow">{t('Next step: class enrollment')}</p>
            <h2 id="organization-class-next-step-heading">
              {t('Add active students to a class separately')}
            </h2>
            <p>
              {t(
                'An organization seat provides Tro access, but it does not enroll someone in a class.',
              )}
            </p>
            <p>
              {t(
                'After the account exists and has the Student role, open Class workspaces, choose the class, then use People to add them.',
              )}
            </p>
          </div>
          {onOpenClasses && (
            <button
              className="secondary-button"
              onClick={onOpenClasses}
              type="button"
            >
              {t('Open Class workspaces')}
            </button>
          )}
        </section>
      )}
    </section>
  );
}
