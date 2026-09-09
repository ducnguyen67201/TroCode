import { useCallback, useEffect, useState, type ReactNode } from 'react';

import type {
  AddKnowledgeSpaceMembersResult,
  AppLanguage,
  KnowledgeGroup,
  KnowledgeSourceList,
  KnowledgeSpaceMember,
  KnowledgeSpaceSummary,
} from '../shared/contracts';
import { randomUUID } from '../shared/renderer-uuid';

import { ActivityEditorPage } from './ActivityEditorPage';
import { translate } from './app-language';
import {
  canManageClassPeople,
  parseClassMemberEmails,
  rolesAvailableToMemberManager,
} from './class-workspace';
import { ClassSessionsPanel } from './ClassSessionsPanel';
import { SpacePeoplePanel } from './features/knowledge/SpacePeoplePanel';
import { SpaceLibrary } from './SpaceLibrary';

export type SpaceDetailTab = 'library' | 'activities' | 'sessions' | 'people';

export function SpaceDetailPage({
  lessonPanels,
  onTeacherSessionSelect,
  teacherSessionId,
  appLanguage,
  initialTab = 'library',
  onJoined,
  onBack,
  space,
}: {
  lessonPanels?: ReactNode;
  onTeacherSessionSelect?: (
    spaceId: string,
    sessionId: string | null,
  ) => Promise<void>;
  teacherSessionId?: string | null;
  appLanguage: AppLanguage;
  initialTab?: SpaceDetailTab;
  onJoined?: (attemptId: string) => void;
  onBack: () => void;
  space: KnowledgeSpaceSummary;
}) {
  const canFacilitate = canManageClassPeople(space.role);
  const [tab, setTab] = useState<SpaceDetailTab>(
    !canFacilitate && (initialTab === 'people' || initialTab === 'activities')
      ? 'sessions'
      : initialTab,
  );
  const [sources, setSources] = useState<KnowledgeSourceList['items']>([]);
  const [sourcesLoading, setSourcesLoading] = useState(
    () => typeof window !== 'undefined',
  );
  const [groups, setGroups] = useState<KnowledgeGroup[]>([]);
  const [members, setMembers] = useState<KnowledgeSpaceMember[]>([]);
  const [memberEmails, setMemberEmails] = useState('');
  const [memberRole, setMemberRole] = useState<'facilitator' | 'participant'>(
    'participant',
  );
  const [memberResult, setMemberResult] =
    useState<AddKnowledgeSpaceMembersResult | null>(null);
  const [addingMembers, setAddingMembers] = useState(false);
  const [rosterQuery, setRosterQuery] = useState('');
  const [rosterRole, setRosterRole] = useState<'all' | 'teacher' | 'student'>(
    'all',
  );
  const [groupName, setGroupName] = useState('');
  const [sessionRefreshToken, setSessionRefreshToken] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const t = useCallback(
    (
      message: string,
      replacements: Readonly<Record<string, string | number>> = {},
    ) => translate(appLanguage, message, replacements),
    [appLanguage],
  );
  const availableMemberRoles = rolesAvailableToMemberManager(space.role);
  const studentCount = members.filter(
    (member) => member.role === 'participant',
  ).length;
  const teacherCount = members.length - studentCount;
  const normalizedRosterQuery = rosterQuery.trim().toLocaleLowerCase();
  const visibleMembers = members.filter((member) => {
    const roleMatches =
      rosterRole === 'all' ||
      (rosterRole === 'student' && member.role === 'participant') ||
      (rosterRole === 'teacher' && member.role !== 'participant');
    const queryMatches =
      !normalizedRosterQuery ||
      member.name.toLocaleLowerCase().includes(normalizedRosterQuery) ||
      member.email.toLocaleLowerCase().includes(normalizedRosterQuery) ||
      member.userId.toLocaleLowerCase().includes(normalizedRosterQuery);
    return roleMatches && queryMatches;
  });

  const loadSources = useCallback(
    () =>
      window.tro
        .listKnowledgeSources(space.id)
        .then((value) => setSources(value.items))
        .catch((cause: unknown) =>
          setError(
            cause instanceof Error
              ? cause.message
              : t('Materials are unavailable.'),
          ),
        )
        .finally(() => setSourcesLoading(false)),
    [space.id, t],
  );
  const loadGroups = useCallback(
    () =>
      window.tro
        .listKnowledgeGroups(space.id)
        .then((value) => setGroups(value.items))
        .catch((cause: unknown) =>
          setError(
            cause instanceof Error
              ? cause.message
              : t('Groups are unavailable.'),
          ),
        ),
    [space.id, t],
  );
  const loadMembers = useCallback(
    () =>
      window.tro
        .listKnowledgeMembers(space.id)
        .then((value) => setMembers(value.items))
        .catch((cause: unknown) =>
          setError(
            cause instanceof Error
              ? cause.message
              : t('People are unavailable.'),
          ),
        ),
    [space.id, t],
  );

  useEffect(() => {
    void loadSources();
    if (canFacilitate) {
      void loadGroups();
      void loadMembers();
    }
  }, [canFacilitate, loadGroups, loadMembers, loadSources]);

  const parsedMemberEmails = parseClassMemberEmails(memberEmails);

  const addMembers = async () => {
    if (
      parsedMemberEmails.invalid.length ||
      parsedMemberEmails.emails.length === 0 ||
      parsedMemberEmails.emails.length > 500
    ) {
      return;
    }
    setAddingMembers(true);
    setError(null);
    try {
      const result = await window.tro.addKnowledgeSpaceMembers({
        clientId: randomUUID(),
        emails: parsedMemberEmails.emails,
        role: memberRole,
        spaceId: space.id,
      });
      setMemberResult(result);
      if (result.addedEmails.length) setMemberEmails('');
      await loadMembers();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t('Could not add those people.'),
      );
    } finally {
      setAddingMembers(false);
    }
  };

  const tabs: SpaceDetailTab[] = canFacilitate
    ? ['library', 'activities', 'sessions', 'people']
    : ['library', 'sessions'];

  return (
    <section className="knowledge-page knowledge-page--class-detail">
      <div className="space-detail-toolbar">
        <button className="back-link" onClick={onBack} type="button">
          <span aria-hidden="true">←</span> {t('Classes')}
        </button>
      </div>
      <header className="class-workspace-identity">
        <span className="class-workspace-identity__mark" aria-hidden="true">
          {space.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="class-workspace-identity__copy">
          <p className="eyebrow">{t('Class workspace')}</p>
          <h1>{space.name}</h1>
          <p>
            {canFacilitate
              ? space.description ||
                t('Materials, activities, and people for this class.')
              : t('Materials and activities shared with this class.')}
          </p>
        </div>
        <span className="class-workspace-identity__role">
          <i aria-hidden="true" />
          {t(canFacilitate ? 'Teaching' : 'Learning')}
        </span>
      </header>
      <div
        aria-label={t('Class workspace sections')}
        className="space-tabs"
        role="tablist"
      >
        {tabs.map((value, index) => (
          <button
            aria-controls={`space-panel-${space.id}-${value}`}
            aria-selected={tab === value}
            id={`space-tab-${space.id}-${value}`}
            key={value}
            onClick={() => setTab(value)}
            onKeyDown={(event) => {
              let nextIndex = index;
              if (event.key === 'ArrowRight')
                nextIndex = (index + 1) % tabs.length;
              else if (event.key === 'ArrowLeft') {
                nextIndex = (index - 1 + tabs.length) % tabs.length;
              } else if (event.key === 'Home') nextIndex = 0;
              else if (event.key === 'End') nextIndex = tabs.length - 1;
              else return;
              event.preventDefault();
              const nextTab = tabs[nextIndex];
              if (!nextTab) return;
              setTab(nextTab);
              const buttons =
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                );
              buttons?.[nextIndex]?.focus();
            }}
            role="tab"
            tabIndex={tab === value ? 0 : -1}
            type="button"
          >
            {t(
              value === 'library'
                ? 'Materials'
                : value === 'activities'
                  ? 'Activities'
                  : value === 'sessions'
                    ? 'Sessions'
                    : 'People',
            )}
          </button>
        ))}
      </div>
      {lessonPanels}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {tab === 'library' && (
        <div
          aria-labelledby={`space-tab-${space.id}-library`}
          id={`space-panel-${space.id}-library`}
          role="tabpanel"
          tabIndex={0}
        >
          <SpaceLibrary
            appLanguage={appLanguage}
            loading={sourcesLoading}
            onChanged={() => {
              setSourcesLoading(true);
              void loadSources();
            }}
            readOnly={!canFacilitate}
            sources={sources}
            spaceId={space.id}
          />
        </div>
      )}

      {tab === 'activities' &&
        (canFacilitate ? (
          <div
            aria-labelledby={`space-tab-${space.id}-activities`}
            id={`space-panel-${space.id}-activities`}
            role="tabpanel"
            tabIndex={0}
          >
            <ActivityEditorPage
              key={space.id}
              appLanguage={appLanguage}
              onPublished={() => {
                setSessionRefreshToken((current) => current + 1);
                setTab('sessions');
              }}
              sources={sources}
              spaceId={space.id}
            />
          </div>
        ) : null)}

      {tab === 'sessions' && (
        <div
          aria-labelledby={`space-tab-${space.id}-sessions`}
          id={`space-panel-${space.id}-sessions`}
          role="tabpanel"
          tabIndex={0}
        >
          <ClassSessionsPanel
            onTeacherSessionSelect={onTeacherSessionSelect}
            teacherSessionId={teacherSessionId}
            appLanguage={appLanguage}
            canFacilitate={canFacilitate}
            onJoined={onJoined}
            refreshToken={sessionRefreshToken}
            spaceId={space.id}
          />
        </div>
      )}

      {tab === 'people' && canFacilitate && (
        <SpacePeoplePanel
          space={space}
          t={t}
          members={members}
          teacherCount={teacherCount}
          studentCount={studentCount}
          parsedMemberEmails={parsedMemberEmails}
          setMemberEmails={setMemberEmails}
          memberEmails={memberEmails}
          setMemberRole={setMemberRole}
          memberRole={memberRole}
          availableMemberRoles={availableMemberRoles}
          addingMembers={addingMembers}
          addMembers={addMembers}
          memberResult={memberResult}
          setRosterQuery={setRosterQuery}
          rosterQuery={rosterQuery}
          setRosterRole={setRosterRole}
          rosterRole={rosterRole}
          visibleMembers={visibleMembers}
          groups={groups}
          setGroupName={setGroupName}
          groupName={groupName}
          loadGroups={loadGroups}
          setError={setError}
        />
      )}
    </section>
  );
}
