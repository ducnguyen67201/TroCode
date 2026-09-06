import type * as React from 'react';

import type {
  AppLanguage,
  AuthUser,
  KnowledgeSpaceSummary,
  OrganizationSummary,
  TaskEvent,
} from '../../shared/contracts';
import {
  type ActiveView,
  organizationSettingsAvailable,
} from '../app-navigation';
import { BrandMark } from '../BrandMark';
import { SidebarClassWorkspaceSwitcher } from '../SidebarClassWorkspaceSwitcher';
import { SidebarPlanTitle } from '../SidebarPlanTitle';
import type { SpaceDetailTab } from '../SpaceDetailPage';

import { NavigationIcon } from './NavigationIcon';

interface AppSidebarProps {
  isSidebarCollapsed: boolean;
  t: (
    message: string,
    replacements?: Readonly<Record<string, string | number>>,
  ) => string;
  setIsSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  appLanguageDraft: AppLanguage;
  classroomRole: 'unassigned' | 'teacher' | 'student';
  selectedClassSpace: KnowledgeSpaceSummary | null;
  displayedPlan: 'free' | 'basic' | 'pro' | 'max';
  usagePercent: number | null;
  setSelectedClassSpace: React.Dispatch<
    React.SetStateAction<KnowledgeSpaceSummary | null>
  >;
  setSelectedClassSpaceTab: React.Dispatch<
    React.SetStateAction<SpaceDetailTab>
  >;
  setActiveView: React.Dispatch<React.SetStateAction<ActiveView>>;
  classSpaces: KnowledgeSpaceSummary[];
  isSubmitting: boolean;
  resetTask: () => Promise<void>;
  activeView: ActiveView;
  classroomAccessAvailable: boolean;
  historyTaskCount: number;
  hasLiveTask: boolean;
  events: TaskEvent[];
  organization: OrganizationSummary | null;
  settingsOpen: boolean;
  setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  settingsTriggerRef: React.RefObject<HTMLButtonElement | null>;
  currentUser: AuthUser;
  isSigningOut: boolean;
  onSignOut: () => void;
}

export function AppSidebar({
  isSidebarCollapsed,
  t,
  setIsSidebarCollapsed,
  appLanguageDraft,
  classroomRole,
  selectedClassSpace,
  displayedPlan,
  usagePercent,
  setSelectedClassSpace,
  setSelectedClassSpaceTab,
  setActiveView,
  classSpaces,
  isSubmitting,
  resetTask,
  activeView,
  classroomAccessAvailable,
  historyTaskCount,
  hasLiveTask,
  events,
  organization,
  settingsOpen,
  setSettingsOpen,
  settingsTriggerRef,
  currentUser,
  isSigningOut,
  onSignOut,
}: AppSidebarProps) {
  return (
    <aside className="sidebar" id="primary-sidebar">
      <div className="sidebar-chrome">
        <button
          aria-controls="primary-sidebar"
          aria-expanded={!isSidebarCollapsed}
          aria-label={t(
            isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar',
          )}
          className="sidebar-toggle"
          onClick={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
          title={t(isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar')}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <rect height="16" rx="2" width="18" x="3" y="4" />
            <path d="M9 4v16" />
          </svg>
        </button>
      </div>

      <div className="brand">
        <BrandMark />
        <div className="brand-copy">
          <SidebarPlanTitle
            appLanguage={appLanguageDraft}
            classroomRole={classroomRole}
            currentSpace={selectedClassSpace}
            plan={displayedPlan}
          />
          <span>
            {usagePercent === null
              ? t('Desktop agent')
              : t('Weekly usage · {percent}% left', {
                  percent: usagePercent,
                })}
          </span>
        </div>
      </div>

      <SidebarClassWorkspaceSwitcher
        appLanguage={appLanguageDraft}
        classroomRole={classroomRole}
        currentSpace={selectedClassSpace}
        onManageMembers={(space) => {
          setSelectedClassSpace(space);
          setSelectedClassSpaceTab('people');
          setActiveView('spaces');
        }}
        onOpen={(space) => {
          setSelectedClassSpace(space);
          setSelectedClassSpaceTab('library');
          setActiveView('spaces');
        }}
        onOpenAll={() => {
          setSelectedClassSpace(null);
          setSelectedClassSpaceTab('library');
          setActiveView('spaces');
        }}
        spaces={classSpaces}
      />

      <button
        aria-label={t('New task')}
        className="new-task-button"
        disabled={isSubmitting}
        onClick={() => {
          setActiveView('agent');
          void resetTask();
        }}
        title={isSidebarCollapsed ? t('New task') : undefined}
        type="button"
      >
        <span aria-hidden="true">＋</span>
        <span className="sidebar-item-label">{t('New task')}</span>
      </button>

      <nav aria-label={t('Workspace')}>
        <span className="nav-label">{t('Workspace')}</span>
        <button
          aria-label={t('Agent')}
          aria-current={activeView === 'agent' ? 'page' : undefined}
          className={`nav-item ${
            activeView === 'agent' ? 'nav-item--active' : ''
          }`}
          onClick={() => setActiveView('agent')}
          title={isSidebarCollapsed ? t('Agent') : undefined}
          type="button"
        >
          <NavigationIcon name="agent" />
          <span className="sidebar-item-label">{t('Agent')}</span>
        </button>
        {classroomAccessAvailable && (
          <>
            <button
              aria-label={t('Classwork')}
              aria-current={activeView === 'assigned' ? 'page' : undefined}
              className={`nav-item ${
                activeView === 'assigned' ? 'nav-item--active' : ''
              }`}
              onClick={() => setActiveView('assigned')}
              title={isSidebarCollapsed ? t('Classwork') : undefined}
              type="button"
            >
              <NavigationIcon name="assigned" />
              <span className="sidebar-item-label">{t('Classwork')}</span>
            </button>
          </>
        )}
        <button
          aria-label={t('History')}
          aria-current={activeView === 'history' ? 'page' : undefined}
          className={`nav-item ${
            activeView === 'history' ? 'nav-item--active' : ''
          }`}
          onClick={() => setActiveView('history')}
          title={isSidebarCollapsed ? t('History') : undefined}
          type="button"
        >
          <NavigationIcon name="history" />
          <span className="sidebar-item-label">{t('History')}</span>
          <span className="nav-count">{historyTaskCount}</span>
        </button>
        <button
          aria-label={t('Insights')}
          aria-current={activeView === 'insights' ? 'page' : undefined}
          className={`nav-item ${
            activeView === 'insights' ? 'nav-item--active' : ''
          }`}
          onClick={() => setActiveView('insights')}
          title={isSidebarCollapsed ? t('Insights') : undefined}
          type="button"
        >
          <NavigationIcon name="insights" />
          <span className="sidebar-item-label">{t('Insights')}</span>
        </button>
      </nav>

      {hasLiveTask && (
        <nav aria-label={t('Observe')}>
          <span className="nav-label">{t('Observe')}</span>
          <button
            aria-label={t('Current task')}
            className="nav-item"
            onClick={() => {
              setActiveView('agent');
              window.setTimeout(
                () =>
                  document
                    .getElementById('activity')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                0,
              );
            }}
            title={isSidebarCollapsed ? t('Current task') : undefined}
            type="button"
          >
            <NavigationIcon name="activity" />
            <span className="sidebar-item-label">{t('Current task')}</span>
            <span className="nav-count">{events.length}</span>
          </button>
        </nav>
      )}

      <div className="sidebar-bottom">
        <nav aria-label={t('Settings')}>
          {organizationSettingsAvailable(organization) && (
            <button
              aria-label={t('Organization settings')}
              aria-current={activeView === 'organization' ? 'page' : undefined}
              className={`nav-item ${
                activeView === 'organization' ? 'nav-item--active' : ''
              }`}
              onClick={() => setActiveView('organization')}
              title={
                isSidebarCollapsed ? t('Organization settings') : undefined
              }
              type="button"
            >
              <NavigationIcon name="organization" />
              <span className="sidebar-item-label">
                {t('Organization settings')}
              </span>
            </button>
          )}
          <button
            aria-label={t('Settings')}
            aria-expanded={settingsOpen}
            aria-haspopup="dialog"
            className={`nav-item ${settingsOpen ? 'nav-item--active' : ''}`}
            onClick={() => setSettingsOpen(true)}
            ref={settingsTriggerRef}
            title={isSidebarCollapsed ? t('Settings') : undefined}
            type="button"
          >
            <NavigationIcon name="settings" />
            <span className="sidebar-item-label">{t('Settings')}</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <span className="safety-indicator" aria-hidden="true" />
          <div>
            <strong>{t('Scoped execution')}</strong>
            <span>{t('Permissions and workspace bounds enforced')}</span>
          </div>
        </div>

        <div className="sidebar-account" title={currentUser.email}>
          <span className="account-avatar" aria-hidden="true">
            {currentUser.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="sidebar-account__identity">
            <strong>{currentUser.name}</strong>
            <span>{currentUser.email}</span>
          </span>
          <button
            aria-label={isSigningOut ? t('Signing out…') : t('Sign out')}
            className="sidebar-account__sign-out"
            disabled={isSigningOut}
            onClick={onSignOut}
            title={isSigningOut ? t('Signing out…') : t('Sign out')}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M10 5H6.5A2.5 2.5 0 0 0 4 7.5v9A2.5 2.5 0 0 0 6.5 19H10" />
              <path d="M14.5 8.5 18 12l-3.5 3.5M18 12H9" />
            </svg>
            <span>{isSigningOut ? t('Signing out…') : t('Sign out')}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
