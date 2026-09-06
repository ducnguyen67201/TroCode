import type * as React from 'react';

import type {
  AddKnowledgeSpaceMembersResult,
  KnowledgeGroup,
  KnowledgeSpaceMember,
  KnowledgeSpaceSummary,
} from '../../../shared/contracts';
import { randomUUID } from '../../../shared/renderer-uuid';

interface SpacePeoplePanelProps {
  space: KnowledgeSpaceSummary;
  t: (
    message: string,
    replacements?: Readonly<Record<string, string | number>>,
  ) => string;
  members: KnowledgeSpaceMember[];
  teacherCount: number;
  studentCount: number;
  parsedMemberEmails: { emails: string[]; invalid: string[] };
  setMemberEmails: React.Dispatch<React.SetStateAction<string>>;
  memberEmails: string;
  setMemberRole: React.Dispatch<
    React.SetStateAction<'facilitator' | 'participant'>
  >;
  memberRole: 'facilitator' | 'participant';
  availableMemberRoles: ('facilitator' | 'participant')[];
  addingMembers: boolean;
  addMembers: () => Promise<void>;
  memberResult: AddKnowledgeSpaceMembersResult | null;
  setRosterQuery: React.Dispatch<React.SetStateAction<string>>;
  rosterQuery: string;
  setRosterRole: React.Dispatch<
    React.SetStateAction<'teacher' | 'student' | 'all'>
  >;
  rosterRole: 'teacher' | 'student' | 'all';
  visibleMembers: KnowledgeSpaceMember[];
  groups: KnowledgeGroup[];
  setGroupName: React.Dispatch<React.SetStateAction<string>>;
  groupName: string;
  loadGroups: () => Promise<void>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

export function SpacePeoplePanel({
  space,
  t,
  members,
  teacherCount,
  studentCount,
  parsedMemberEmails,
  setMemberEmails,
  memberEmails,
  setMemberRole,
  memberRole,
  availableMemberRoles,
  addingMembers,
  addMembers,
  memberResult,
  setRosterQuery,
  rosterQuery,
  setRosterRole,
  rosterRole,
  visibleMembers,
  groups,
  setGroupName,
  groupName,
  loadGroups,
  setError,
}: SpacePeoplePanelProps) {
  return (
    <section
      aria-labelledby={`space-tab-${space.id}-people`}
      className="space-panel people-panel"
      id={`space-panel-${space.id}-people`}
      role="tabpanel"
      tabIndex={0}
    >
      <div className="section-heading-row people-panel__heading">
        <div>
          <p className="eyebrow">{t('Class community')}</p>
          <h2>{t('People')}</h2>
          <p>
            {t(
              'Add people after their account exists and an administrator assigns their Teacher or Student role.',
            )}
          </p>
        </div>
        <span className="people-panel__total">
          <strong>{members.length}</strong>
          {t('on the roster')}
        </span>
      </div>

      <div className="people-console">
        <aside
          className="people-composition"
          aria-label={t('Roster composition')}
        >
          <p className="eyebrow">{t('At a glance')}</p>
          <div className="people-composition__total">
            <strong>{members.length}</strong>
            <span>{t('people')}</span>
          </div>
          <dl>
            <div>
              <dt>
                <i className="role-dot role-dot--teacher" aria-hidden="true" />
                {t('Teachers')}
              </dt>
              <dd>{teacherCount}</dd>
            </div>
            <div>
              <dt>
                <i className="role-dot role-dot--student" aria-hidden="true" />
                {t('Students')}
              </dt>
              <dd>{studentCount}</dd>
            </div>
          </dl>
          <p>{t('Roles are verified before anyone is added.')}</p>
        </aside>

        <div className="member-composer">
          <div className="member-composer__heading">
            <div>
              <p className="eyebrow">{t('Add registered accounts')}</p>
              <h3>{t('Build the roster')}</h3>
            </div>
            <span>
              {parsedMemberEmails.emails.length}
              <small>/ 500</small>
            </span>
          </div>
          <div className="class-member-add">
            <label>
              {t('Registered account emails')}
              <textarea
                onChange={(event) => setMemberEmails(event.target.value)}
                placeholder={t('One email per line, comma, or space')}
                rows={6}
                value={memberEmails}
              />
              <small>
                {t('Add up to 500 people per batch. You can repeat as needed.')}
              </small>
            </label>
            <div className="member-composer__actions">
              <label>
                {t('Add as')}
                <select
                  onChange={(event) =>
                    setMemberRole(
                      event.target.value as 'facilitator' | 'participant',
                    )
                  }
                  value={memberRole}
                >
                  {availableMemberRoles.map((role) => (
                    <option key={role} value={role}>
                      {t(role === 'facilitator' ? 'Teacher' : 'Student')}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary-button"
                disabled={
                  addingMembers ||
                  parsedMemberEmails.emails.length === 0 ||
                  parsedMemberEmails.emails.length > 500 ||
                  parsedMemberEmails.invalid.length > 0
                }
                onClick={() => void addMembers()}
                type="button"
              >
                {t(addingMembers ? 'Adding…' : 'Add to class')}
                {!addingMembers && <span aria-hidden="true">→</span>}
              </button>
            </div>
          </div>
        </div>
      </div>
      {parsedMemberEmails.invalid.length > 0 && (
        <p className="form-error" role="alert">
          {t('Check these email entries')}:{' '}
          {parsedMemberEmails.invalid.join(', ')}
        </p>
      )}
      {parsedMemberEmails.emails.length > 500 && (
        <p className="form-error" role="alert">
          {t('Use 500 or fewer emails in each batch.')}
        </p>
      )}
      {memberResult && (
        <div className="member-add-result" role="status">
          <div className="member-add-result__heading">
            <span aria-hidden="true">✓</span>
            <div>
              <strong>{t('Roster update complete')}</strong>
              <p>
                {t('Every account was checked against its classroom role.')}
              </p>
            </div>
          </div>
          <dl className="member-add-result__stats">
            <div className="member-add-result__stat member-add-result__stat--added">
              <dt>{t('Added')}</dt>
              <dd>{memberResult.addedEmails.length}</dd>
            </div>
            <div>
              <dt>{t('Already here')}</dt>
              <dd>{memberResult.alreadyMemberEmails.length}</dd>
            </div>
            <div>
              <dt>{t('Role mismatch')}</dt>
              <dd>{memberResult.roleMismatchEmails.length}</dd>
            </div>
            <div>
              <dt>{t('Unavailable')}</dt>
              <dd>{memberResult.unavailableEmails.length}</dd>
            </div>
          </dl>
          {(memberResult.roleMismatchEmails.length > 0 ||
            memberResult.unavailableEmails.length > 0) && (
            <details>
              <summary>{t('Review accounts that need attention')}</summary>
              {memberResult.roleMismatchEmails.length > 0 && (
                <p>
                  <strong>{t('Wrong Admin-assigned role')}</strong>
                  {memberResult.roleMismatchEmails.join(', ')}
                </p>
              )}
              {memberResult.unavailableEmails.length > 0 && (
                <p>
                  <strong>{t('Account not found or unavailable')}</strong>
                  {memberResult.unavailableEmails.join(', ')}
                </p>
              )}
            </details>
          )}
        </div>
      )}

      <div className="roster-heading">
        <div>
          <p className="eyebrow">{t('Everyone in this class')}</p>
          <h3>{t('Class roster')}</h3>
        </div>
        <span>{members.length}</span>
      </div>
      <div className="roster-toolbar">
        <label className="roster-search">
          <span>{t('Find a person')}</span>
          <input
            onChange={(event) => setRosterQuery(event.target.value)}
            placeholder={t('Search name, email, or account ID')}
            type="search"
            value={rosterQuery}
          />
        </label>
        <label>
          <span>{t('Show role')}</span>
          <select
            onChange={(event) =>
              setRosterRole(event.target.value as typeof rosterRole)
            }
            value={rosterRole}
          >
            <option value="all">{t('Everyone')}</option>
            <option value="teacher">{t('Teachers')}</option>
            <option value="student">{t('Students')}</option>
          </select>
        </label>
        <span className="roster-toolbar__result" aria-live="polite">
          <strong>{visibleMembers.length}</strong>
          {t('shown')}
        </span>
      </div>
      <div
        className="class-roster-wrap"
        role="region"
        aria-label={t('Class roster')}
        tabIndex={0}
      >
        <table className="knowledge-table">
          <thead>
            <tr>
              <th>{t('Person')}</th>
              <th>{t('Role')}</th>
              <th>{t('Account ID')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleMembers.map((member) => (
              <tr key={member.userId}>
                <td>
                  <strong>{member.name}</strong>
                  <small>{member.email}</small>
                </td>
                <td>
                  <span className={`roster-role roster-role--${member.role}`}>
                    <i aria-hidden="true" />
                    {t(
                      member.role === 'participant'
                        ? 'Student'
                        : member.role === 'owner'
                          ? 'Teacher · Owner'
                          : 'Teacher',
                    )}
                  </span>
                </td>
                <td>
                  <code>{member.userId}</code>
                </td>
              </tr>
            ))}
            {visibleMembers.length === 0 && (
              <tr>
                <td className="roster-empty-row" colSpan={3}>
                  <strong>{t('No people match this view')}</strong>
                  <span>{t('Try another name or role.')}</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="groups-studio">
        <div className="groups-studio__heading">
          <div>
            <p className="eyebrow">{t('Smaller circles')}</p>
            <h3>{t('Groups')}</h3>
            <p>{t('Organize rostered students for focused activities.')}</p>
          </div>
          <span>{groups.length}</span>
        </div>
        <div className="knowledge-create group-create">
          <label htmlFor="new-group-name">
            {t('Group name')}
            <input
              id="new-group-name"
              onChange={(event) => setGroupName(event.target.value)}
              placeholder={t('e.g. Studio A')}
              value={groupName}
            />
          </label>
          <button
            disabled={!groupName.trim()}
            onClick={() =>
              void window.tro
                .createKnowledgeGroup({
                  clientId: randomUUID(),
                  name: groupName.trim(),
                  spaceId: space.id,
                })
                .then(() => {
                  setGroupName('');
                  return loadGroups();
                })
                .catch((cause: unknown) =>
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : t('Could not create that group.'),
                  ),
                )
            }
            type="button"
          >
            {t('Create group')}
          </button>
        </div>
        <ul className="group-list">
          {groups.map((group) => (
            <li key={group.id}>
              <span className="group-list__mark" aria-hidden="true">
                {group.name.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{group.name}</strong>
                <span>
                  {group.participantCount} {t('participants')}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
