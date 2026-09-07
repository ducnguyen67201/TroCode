import type * as React from 'react';

import type {
  AppLanguage,
  AppUpdateStatus,
  KnowledgeSpaceSummary,
  OrganizationSummary,
  SubmitTaskRequest,
  TaskEvent,
  TaskHistory,
  TaskSnapshot,
  TeacherClassroomSelection,
} from '../../shared/contracts';
import { type ActiveView, navigationTitle } from '../app-navigation';
import { AppUpdateButton } from '../AppUpdateButton';
import { ClassroomSessionBar } from '../ClassroomSessionBar';
import { ClassroomWorkspaceLayout } from '../ClassroomWorkspaceLayout';
import { ClassroomLessonDraftPanel } from '../features/classroom/ClassroomLessonDraftPanel';
import { ClassroomLessonPanel } from '../features/classroom/ClassroomLessonPanel';
import { TaskContextPanel } from '../features/tasks/TaskContextPanel';
import { TaskWorkspace } from '../features/tasks/TaskWorkspace';
import { HistoryPage } from '../HistoryPage';
import { InsightsPage } from '../InsightsPage';
import { KnowledgeHubPage } from '../KnowledgeHubPage';
import { OrganizationPage } from '../OrganizationPage';
import type { SpaceDetailTab } from '../SpaceDetailPage';
import { isTaskCancellable } from '../task-execution';

import { AppSettings } from './AppSettings';

interface AppWorkspaceProps {
  activeView: ActiveView;
  appLanguageDraft: AppLanguage;
  taskPhase: string;
  t: (
    message: string,
    replacements?: Readonly<Record<string, string | number>>,
  ) => string;
  historyTaskCount: number;
  snapshot: TaskSnapshot | null;
  isStoppingTask: boolean;
  stopTask: () => Promise<void>;
  isUpdatingApp: boolean;
  restartAndInstallAppUpdate: () => Promise<void>;
  appUpdateStatus: AppUpdateStatus | null;
  classroomAccessAvailable: boolean;
  launchKnowledgeActivity: (request: SubmitTaskRequest) => Promise<void>;
  setClassroomAttemptFocus: React.Dispatch<
    React.SetStateAction<string | null>
  >;
  setActiveView: React.Dispatch<React.SetStateAction<ActiveView>>;
  teacherSelectionPending: boolean;
  teacherSelection: TeacherClassroomSelection | null;
  selectTeacherSession: (
    spaceId: string,
    sessionId: string | null,
  ) => Promise<void>;
  classSpacesError: string | null;
  classSpacesLoading: boolean;
  classroomRole: 'unassigned' | 'teacher' | 'student';
  classSpaces: KnowledgeSpaceSummary[];
  classroomAttemptFocus: string | null;
  refreshClassSpaces: () => Promise<void>;
  setSelectedClassSpace: React.Dispatch<
    React.SetStateAction<KnowledgeSpaceSummary | null>
  >;
  setSelectedClassSpaceTab: React.Dispatch<
    React.SetStateAction<SpaceDetailTab>
  >;
  selectedClassSpace: KnowledgeSpaceSummary | null;
  selectedClassSpaceTab: SpaceDetailTab;
  sessionEvents: TaskEvent[];
  hasLiveTask: boolean;
  resetTask: () => Promise<void>;
  taskPersistence: TaskHistory['persistence'];
  sessionTaskSnapshots: TaskSnapshot[];
  organizationError: string | null;
  isLoadingOrganization: boolean;
  setOrganization: React.Dispatch<
    React.SetStateAction<{
      capacity: {
        assignedSeats: number;
        maxSeats: number;
        remainingSeats: number;
        state: 'available' | 'full';
      };
      homeBanner: { imageDataUrl: string } | null;
      id: string;
      name: string;
      plan: 'free' | 'basic' | 'pro' | 'max';
      role: 'organizer' | 'member';
    } | null>
  >;
  refreshOrganization: () => Promise<OrganizationSummary | null>;
  organization: OrganizationSummary | null;
  settingsOpen: boolean;
  taskProps: React.ComponentProps<typeof TaskWorkspace>;
  contextProps: React.ComponentProps<typeof TaskContextPanel>;
  settingsProps: React.ComponentProps<typeof AppSettings>;
}

export function AppWorkspace({
  activeView,
  appLanguageDraft,
  taskPhase,
  t,
  historyTaskCount,
  snapshot,
  isStoppingTask,
  stopTask,
  isUpdatingApp,
  restartAndInstallAppUpdate,
  appUpdateStatus,
  classroomAccessAvailable,
  launchKnowledgeActivity,
  setClassroomAttemptFocus,
  setActiveView,
  teacherSelectionPending,
  teacherSelection,
  selectTeacherSession,
  classSpacesError,
  classSpacesLoading,
  classroomRole,
  classSpaces,
  classroomAttemptFocus,
  refreshClassSpaces,
  setSelectedClassSpace,
  setSelectedClassSpaceTab,
  selectedClassSpace,
  selectedClassSpaceTab,
  sessionEvents,
  hasLiveTask,
  resetTask,
  taskPersistence,
  sessionTaskSnapshots,
  organizationError,
  isLoadingOrganization,
  setOrganization,
  refreshOrganization,
  organization,
  settingsOpen,
  taskProps,
  contextProps,
  settingsProps,
}: AppWorkspaceProps) {
  return (
    <main className="workspace">
      <header className="topbar">
        <div className="topbar-title">
          <span className="topbar-kicker">
            {navigationTitle(activeView, appLanguageDraft).kicker}
          </span>
          <strong>
            {activeView === 'agent'
              ? taskPhase
              : activeView === 'history'
                ? t(
                    historyTaskCount === 1
                      ? '{count} finished task'
                      : '{count} finished tasks',
                    { count: historyTaskCount },
                  )
                : navigationTitle(activeView, appLanguageDraft).title}
          </strong>
        </div>
        <div className="topbar-actions">
          {isTaskCancellable(snapshot) && (
            <button
              className="stop-task-button"
              disabled={isStoppingTask}
              onClick={() => void stopTask()}
              type="button"
            >
              {isStoppingTask ? t('Stopping…') : t('Stop task')}{' '}
              <kbd>Esc</kbd>
            </button>
          )}
          <AppUpdateButton
            appLanguage={appLanguageDraft}
            isUpdating={isUpdatingApp}
            onRestartAndInstall={() => void restartAndInstallAppUpdate()}
            status={appUpdateStatus}
          />
        </div>
      </header>

      {teacherSelectionPending && (
        <p role="status">
          {appLanguageDraft === 'vi'
            ? 'Đang xác minh phiên học…'
            : 'Verifying classroom session…'}
        </p>
      )}
      {teacherSelection && (
        <p className="eyebrow">
          {teacherSelection.binding.spaceName} ·{' '}
          {teacherSelection.binding.sessionTitle}
        </p>
      )}
      <ClassroomLessonDraftPanel appLanguage={appLanguageDraft} />

      <ClassroomWorkspaceLayout
        enabled={activeView === 'spaces' || activeView === 'assigned'}
        appLanguage={appLanguageDraft}
        sidebar={
          <>
            {classroomAccessAvailable && <ClassroomLessonPanel appLanguage={appLanguageDraft} />}
            {classroomAccessAvailable && (
              <ClassroomSessionBar
                appLanguage={appLanguageDraft}
                onLaunch={launchKnowledgeActivity}
                onOpenClasswork={(attemptId) => {
                  setClassroomAttemptFocus(attemptId);
                  setActiveView('assigned');
                }}
              />
            )}

          </>
        }
      >
        {classroomAccessAvailable &&
        (activeView === 'spaces' || activeView === 'assigned') ? (
          <KnowledgeHubPage
            onTeacherSessionSelect={selectTeacherSession}
            teacherSessionId={teacherSelection?.binding.sessionId ?? null}
            appLanguage={appLanguageDraft}
            classroomError={classSpacesError}
            classroomLoading={classSpacesLoading}
            classroomRole={classroomRole}
            classSpaces={classSpaces}
            focusAttemptId={
              activeView === 'assigned' ? classroomAttemptFocus : null
            }
            mode={activeView}
            onAttemptFocusCleared={() => setClassroomAttemptFocus(null)}
            onLaunch={launchKnowledgeActivity}
            onRefreshClassSpaces={refreshClassSpaces}
            onSelectSpace={(space) => {
              setSelectedClassSpace(space);
              setSelectedClassSpaceTab('library');
            }}
            space={selectedClassSpace}
            spaceInitialTab={selectedClassSpaceTab}
          />
        ) : activeView === 'history' ? (
          <HistoryPage
            appLanguage={appLanguageDraft}
            events={sessionEvents}
            hasLiveTask={hasLiveTask}
            onOpenAgent={() => {
              setActiveView('agent');
              if (!hasLiveTask) void resetTask();
            }}
            persistence={taskPersistence}
            tasks={sessionTaskSnapshots}
          />
        ) : activeView === 'insights' ? (
          <InsightsPage
            appLanguage={appLanguageDraft}
            events={sessionEvents}
            persistence={taskPersistence}
            tasks={sessionTaskSnapshots}
          />
        ) : activeView === 'organization' ? (
          <OrganizationPage
            appLanguage={appLanguageDraft}
            error={organizationError}
            isLoading={isLoadingOrganization}
            onOpenClasses={
              classroomAccessAvailable
                ? () => {
                    setSelectedClassSpace(null);
                    setSelectedClassSpaceTab('library');
                    setActiveView('spaces');
                  }
                : undefined
            }
            onOrganizationChange={setOrganization}
            onRefresh={refreshOrganization}
            organization={organization}
          />
        ) : (
          <div className="content-grid" id="task">
            <TaskWorkspace {...taskProps} />

            <TaskContextPanel {...contextProps} />
          </div>
        )}
      </ClassroomWorkspaceLayout>
      {settingsOpen && <AppSettings {...settingsProps} />}
    </main>
  );
}
