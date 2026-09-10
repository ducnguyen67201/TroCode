import type * as React from 'react';

import type { OrganizationMember } from '../../../shared/contracts';

import { formatJoinedDate } from './organization-presentation';

interface OrganizationMembersProps {
  t: (
    message: string,
    replacements?: Readonly<Record<string, string | number>>,
  ) => string;
  membersHeadingRef: React.RefObject<HTMLHeadingElement | null>;
  memberCount: number;
  isLoadingMembers: boolean;
  loadMembers: (options?: {
    append?: boolean;
    offset?: number;
  }) => Promise<void>;
  members: OrganizationMember[];
  appLanguage: 'en' | 'vi';
  cancellingMemberId: string | null;
  cancelPendingMember: (member: OrganizationMember) => Promise<void>;
  canLoadMore: boolean;
  isLoadingMore: boolean;
}

export function OrganizationMembers({
  t,
  membersHeadingRef,
  memberCount,
  isLoadingMembers,
  loadMembers,
  members,
  appLanguage,
  cancellingMemberId,
  cancelPendingMember,
  canLoadMore,
  isLoadingMore,
}: OrganizationMembersProps) {
  return (
    <section className="organization-members" aria-labelledby="members-heading">
      <div className="organization-members__heading">
        <div>
          <p className="eyebrow">{t('People')}</p>
          <h2 id="members-heading" ref={membersHeadingRef} tabIndex={-1}>
            {t('{count} assigned seats', { count: memberCount })}
          </h2>
        </div>
        <button
          className="secondary-button"
          disabled={isLoadingMembers}
          onClick={() => void loadMembers()}
          type="button"
        >
          {isLoadingMembers ? t('Refreshing…') : t('Refresh')}
        </button>
      </div>

      {isLoadingMembers && members.length === 0 ? (
        <p className="organization-members__loading" aria-live="polite">
          {t('Loading members…')}
        </p>
      ) : members.length === 0 ? (
        <p className="organization-members__loading">
          {t('No seats have been assigned yet.')}
        </p>
      ) : (
        <ul className="organization-member-list">
          {members.map((member) => (
            <li key={member.id}>
              <span className="organization-member-avatar" aria-hidden="true">
                {(member.name ?? member.email).slice(0, 1).toUpperCase()}
              </span>
              <div className="organization-member-copy">
                <strong>{member.name ?? member.email}</strong>
                {member.name && <span>{member.email}</span>}
                <small>
                  {member.state === 'active'
                    ? t('Joined {date}', {
                        date: formatJoinedDate(
                          member.joinedAt ?? member.createdAt,
                          appLanguage,
                        ),
                      })
                    : t('Reserved {date}', {
                        date: formatJoinedDate(member.createdAt, appLanguage),
                      })}
                </small>
              </div>
              <div className="organization-member-actions">
                <span
                  className={`organization-member-state organization-member-state--${member.state}`}
                >
                  {member.state === 'active' ? t('Active') : t('Pending')}
                </span>
                {member.state === 'pending' && (
                  <button
                    className="organization-cancel-button"
                    disabled={cancellingMemberId !== null}
                    onClick={() => void cancelPendingMember(member)}
                    type="button"
                  >
                    {cancellingMemberId === member.id
                      ? t('Cancelling…')
                      : t('Cancel reservation')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canLoadMore && (
        <button
          className="organization-load-more secondary-button"
          disabled={isLoadingMore}
          onClick={() =>
            void loadMembers({ append: true, offset: members.length })
          }
          type="button"
        >
          {isLoadingMore ? t('Loading…') : t('Load more')}
        </button>
      )}
    </section>
  );
}
