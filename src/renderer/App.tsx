import { useCallback, useRef, useState } from 'react';

import type { AuthUser } from '../shared/contracts';

import { AppSidebar } from './app/AppSidebar';
import { AppWorkspace } from './app/AppWorkspace';
import { translate } from './app-language';
import { type ActiveView } from './app-navigation';
import { hasAssignedClassroomRole } from './class-workspace';
import { useMembershipActivation } from './features/account/use-membership-activation';
import { useMembershipStatus } from './features/account/use-membership-status';
import { useOrganization } from './features/account/use-organization';
import { useClassSpaces } from './features/classroom/use-class-spaces';
import { useTeacherSelection } from './features/classroom/use-teacher-selection';
import { useCompanionCustomization } from './features/companion/use-companion-customization';
import { useAppPreferences } from './features/settings/use-app-preferences';
import { useAppUpdates } from './features/settings/use-app-updates';
import { useSystemPermissions } from './features/settings/use-system-permissions';
import { taskView } from './features/tasks/task-view';
import { useTaskCommands } from './features/tasks/use-task-commands';
import { useTaskSession } from './features/tasks/use-task-session';
import { useTransientTaskError } from './features/tasks/use-transient-task-error';
import { useWorkspaceSelection } from './features/tasks/use-workspace-selection';
import { useVoiceAvailability } from './features/voice/use-voice-availability';
import { useVoiceFeedback } from './features/voice/use-voice-feedback';
import { useVoiceModeSelection } from './features/voice/use-voice-mode-selection';
import { useVoiceTurnRouting } from './features/voice/use-voice-turn-routing';
import { isPrimaryLanguageSetupComplete } from './language-options';
import { appEntryGate } from './membership';
import { MembershipGate } from './MembershipGate';
import { PermissionOnboarding } from './PermissionOnboarding';
import type { SpaceDetailTab } from './SpaceDetailPage';
import { isTaskTerminal } from './task-execution';
import { accountPlan, remainingUsagePercent } from './usage-presentation';
import { usePushToTalk } from './use-push-to-talk';

import './classroom-broadcast.css';

export function App({
  currentUser,
  isSigningOut,
  onSignOut,
}: {
  currentUser: AuthUser;
  isSigningOut: boolean;
  onSignOut: () => void;
}) {
  const [activeView, setActiveView] = useState<ActiveView>('agent');

  const [settingsOpen, setSettingsOpen] = useState(false);

  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);

  const closeSettings = useCallback((): void => {
    setSettingsOpen(false);
    window.requestAnimationFrame(() => settingsTriggerRef.current?.focus());
  }, []);

  const [selectedClassSpaceTab, setSelectedClassSpaceTab] =
    useState<SpaceDetailTab>('library');

  const [classroomAttemptFocus, setClassroomAttemptFocus] = useState<
    string | null
  >(null);

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const [input, setInput] = useState('');

  const [voiceTranscript, setVoiceTranscript] = useState('');

  const preferences = useAppPreferences();

  const session = useTaskSession({ setActiveView });

  const updates = useAppUpdates();

  const membership = useMembershipStatus();

  const companion = useCompanionCustomization({
    settingsOpen,
    membershipStatus: membership.membershipStatus,
  });

  const organizationState = useOrganization({
    setActiveView,
    membershipStatus: membership.membershipStatus,
    currentUser,
    activeView,
  });

  const activation = useMembershipActivation({
    setMembershipError: membership.setMembershipError,
    setMembershipStatus: membership.setMembershipStatus,
    refreshCompanionCustomization: companion.refreshCompanionCustomization,
    openOrganizationAfterActivationRef:
      organizationState.openOrganizationAfterActivationRef,
    refreshOrganization: organizationState.refreshOrganization,
  });

  const taskError = useTransientTaskError();

  const voiceAvailability = useVoiceAvailability({
    reportError: taskError.reportError,
  });

  const workspace = useWorkspaceSelection({
    clearError: taskError.clearError,
    reportError: taskError.reportError,
  });

  const t = useCallback(
    (
      message: string,
      replacements?: Readonly<Record<string, string | number>>,
    ) => translate(preferences.appLanguageDraft, message, replacements),
    [preferences.appLanguageDraft],
  );

  const displayedPlan = accountPlan(
    session.usageBudget?.plan,
    membership.membershipStatus?.plan,
  );

  const usagePercent = remainingUsagePercent(session.usageBudget);

  const languageSetupComplete = isPrimaryLanguageSetupComplete(
    preferences.appPreferences,
    preferences.preferencesLoaded,
  );

  const entryGate = appEntryGate({
    languageSetupComplete,
    membershipStatus: membership.membershipStatus,
  });

  const membershipAccessAllowed = entryGate !== 'membership';

  const classes = useClassSpaces({
    setActiveView,
    currentUserId: currentUser.id,
    membershipAccessAllowed,
  });
  const teacher = useTeacherSelection({
    selectedClassSpace: classes.selectedClassSpace,
    currentUserId: currentUser.id,
    membershipAccessAllowed,
  });

  const permissions = useSystemPermissions({
    membershipAccessAllowed,
    appLanguageDraft: preferences.appLanguageDraft,
    classroomPetEnabledDraft: preferences.classroomPetEnabledDraft,
    muteSystemAudioWhileSpeakingDraft:
      preferences.muteSystemAudioWhileSpeakingDraft,
    languageDraft: preferences.languageDraft,
    selectedVoiceMode: preferences.selectedVoiceMode,
    setAppPreferences: preferences.setAppPreferences,
    setPreferencesLoadError: preferences.setPreferencesLoadError,
  });

  const classroomAccessAvailable =
    classes.knowledgeSpacesEnabled &&
    hasAssignedClassroomRole(classes.classroomRole);
  const presentation = taskView(session.snapshot, preferences.appLanguageDraft);

  const agentReady = voiceAvailability.voiceProviderStatus.state === 'ready';

  const selectedTaskRuntimeReady = agentReady;

  const commands = useTaskCommands({
    input,
    pendingClarification: presentation.pendingClarification,
    isSteering: presentation.isSteering,
    clearError: taskError.clearError,
    teacherSelectionPendingRef: teacher.teacherSelectionPendingRef,
    teacherSelectionRef: teacher.teacherSelectionRef,
    snapshot: session.snapshot,
    teacherTaskBindingsRef: teacher.teacherTaskBindingsRef,
    recordSnapshot: session.recordSnapshot,
    activeTaskIdRef: session.activeTaskIdRef,
    setEvents: session.setEvents,
    setAgentActivities: session.setAgentActivities,
    setAgentActivity: session.setAgentActivity,
    setStreamingDraft: session.setStreamingDraft,
    executionProfile: workspace.executionProfile,
    workspaceSelection: workspace.workspaceSelection,
    setInput,
    reportError: taskError.reportError,
    latestSnapshotRef: session.latestSnapshotRef,
    setActiveView,
    setAutoStartFailedTaskId: session.setAutoStartFailedTaskId,
    selectedTaskRuntimeReady,
    autoStartAttemptedTaskIdsRef: session.autoStartAttemptedTaskIdsRef,
    settingsOpen,
  });

  const canSubmit =
    input.trim().length >=
      (presentation.pendingClarification || presentation.isSteering ? 1 : 2) &&
    !commands.isSubmitting &&
    (presentation.pendingClarification ||
      presentation.isSteering ||
      workspace.executionProfile === 'everyday' ||
      Boolean(
        workspace.workspaceRuntime?.available && workspace.workspaceSelection,
      ));

  const sessionTaskSnapshots = Object.values(session.sessionSnapshots);

  const historyTaskCount = sessionTaskSnapshots.filter((task) =>
    isTaskTerminal(task),
  ).length;

  const organizationHomeBanner =
    !presentation.pendingInteraction && !presentation.hasLiveTask
      ? (organizationState.organization?.homeBanner ?? null)
      : null;

  const voiceRouting = useVoiceTurnRouting({
    setInput,
    clearError: taskError.clearError,
    setVoiceTranscript,
    teacherSelectionPendingRef: teacher.teacherSelectionPendingRef,
    reportError: taskError.reportError,
    t,
    latestSnapshotRef: session.latestSnapshotRef,
    teacherVoiceBindingsRef: teacher.teacherVoiceBindingsRef,
    teacherSelectionRef: teacher.teacherSelectionRef,
    taskRequestRef: session.taskRequestRef,
    input,
    appLanguageDraft: preferences.appLanguageDraft,
    sendInput: commands.sendInput,
  });

  const voiceReady =
    agentReady && permissions.microphonePermission !== 'unavailable';

  const {
    isHolding: isVoiceShortcutHeld,
    mode: voiceMode,
    platform: voicePlatform,
    status: voiceStatus,
  } = usePushToTalk({
    disabled: !voiceReady || !membershipAccessAllowed || commands.isSubmitting,
    enabled: voiceReady && languageSetupComplete && membershipAccessAllowed,
    onAttemptStart: voiceRouting.handleVoiceAttemptStart,
    onError: taskError.reportError,
    onTranscriptChange: voiceRouting.handleVoiceTranscriptChange,
    onTranscriptReady: voiceRouting.handleVoiceTranscriptReady,
    onTurnEnd: voiceRouting.handleVoiceTurnEnd,
    selectedMode: preferences.selectedVoiceMode,
  });

  const voiceModeLocked =
    voiceStatus !== 'idle' && voiceStatus !== 'unavailable';

  const voiceSelection = useVoiceModeSelection({
    selectedVoiceMode: preferences.selectedVoiceMode,
    setSelectedVoiceMode: preferences.setSelectedVoiceMode,
    appPreferences: preferences.appPreferences,
    setAppPreferences: preferences.setAppPreferences,
    reportError: taskError.reportError,
    voiceModeLocked,
    showVoiceTerminalActivity: voiceRouting.showVoiceTerminalActivity,
    appLanguageDraft: preferences.appLanguageDraft,
    t,
    voicePlatform,
  });

  useVoiceFeedback({
    appPreferences: preferences.appPreferences,
    isVoiceShortcutHeld,
    reportError: taskError.reportError,
    voiceStatus,
    voiceActivityOverride: voiceRouting.voiceActivityOverride,
    voiceMode,
    appLanguageDraft: preferences.appLanguageDraft,
    voiceDestination: voiceRouting.voiceDestination,
    voiceTranscript,
  });

  if (entryGate === 'membership') {
    return (
      <MembershipGate
        appLanguage={preferences.appLanguageDraft}
        error={membership.membershipError}
        isActivating={activation.isActivatingMembership}
        isChecking={membership.isCheckingMembership}
        isContinuingFree={activation.isContinuingFree}
        isSigningOut={isSigningOut}
        onActivate={(code) => void activation.activateMembership(code)}
        onContinueFree={() => void activation.continueWithFree()}
        onRefresh={() => void membership.refreshMembership()}
        onSignOut={onSignOut}
        status={membership.membershipStatus}
      />
    );
  }

  if (entryGate === 'permissions') {
    return (
      <PermissionOnboarding
        appLanguage={preferences.appLanguageDraft}
        checklist={permissions.permissionChecklist}
        computerStatus={permissions.computerStatus}
        error={permissions.permissionError ?? preferences.preferencesLoadError}
        isChecking={permissions.isCheckingPermissions}
        isLanguageLoading={!preferences.preferencesLoaded}
        isRequesting={permissions.isRequestingPermissions}
        onLanguageChange={preferences.setLanguageDraft}
        onEnable={() => void permissions.enablePermissions()}
        onOpenScreenRecordingSettings={() =>
          void permissions.openScreenRecordingSettings()
        }
        onRefresh={() => void permissions.refreshPermissions()}
        primaryLanguage={preferences.languageDraft}
      />
    );
  }

  return (
    <div
      className={
        isSidebarCollapsed
          ? 'app-shell app-shell--sidebar-collapsed'
          : 'app-shell'
      }
    >
      <AppSidebar
        isSidebarCollapsed={isSidebarCollapsed}
        t={t}
        setIsSidebarCollapsed={setIsSidebarCollapsed}
        appLanguageDraft={preferences.appLanguageDraft}
        classroomRole={classes.classroomRole}
        selectedClassSpace={classes.selectedClassSpace}
        displayedPlan={displayedPlan}
        usagePercent={usagePercent}
        setSelectedClassSpace={classes.setSelectedClassSpace}
        setSelectedClassSpaceTab={setSelectedClassSpaceTab}
        setActiveView={setActiveView}
        classSpaces={classes.classSpaces}
        isSubmitting={commands.isSubmitting}
        resetTask={commands.resetTask}
        activeView={activeView}
        classroomAccessAvailable={classroomAccessAvailable}
        historyTaskCount={historyTaskCount}
        hasLiveTask={presentation.hasLiveTask}
        events={session.events}
        organization={organizationState.organization}
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        settingsTriggerRef={settingsTriggerRef}
        currentUser={currentUser}
        isSigningOut={isSigningOut}
        onSignOut={onSignOut}
      />

      <AppWorkspace
        activeView={activeView}
        appLanguageDraft={preferences.appLanguageDraft}
        taskPhase={presentation.taskPhase}
        t={t}
        historyTaskCount={historyTaskCount}
        snapshot={session.snapshot}
        isStoppingTask={commands.isStoppingTask}
        stopTask={commands.stopTask}
        isUpdatingApp={updates.isUpdatingApp}
        restartAndInstallAppUpdate={updates.restartAndInstallAppUpdate}
        appUpdateStatus={updates.appUpdateStatus}
        classroomAccessAvailable={classroomAccessAvailable}
        launchKnowledgeActivity={commands.launchKnowledgeActivity}
        setClassroomAttemptFocus={setClassroomAttemptFocus}
        setActiveView={setActiveView}
        teacherSelectionPending={teacher.teacherSelectionPending}
        teacherSelection={teacher.teacherSelection}
        selectTeacherSession={teacher.selectTeacherSession}
        classSpacesError={classes.classSpacesError}
        classSpacesLoading={classes.classSpacesLoading}
        classroomRole={classes.classroomRole}
        classSpaces={classes.classSpaces}
        classroomAttemptFocus={classroomAttemptFocus}
        refreshClassSpaces={classes.refreshClassSpaces}
        setSelectedClassSpace={classes.setSelectedClassSpace}
        setSelectedClassSpaceTab={setSelectedClassSpaceTab}
        selectedClassSpace={classes.selectedClassSpace}
        selectedClassSpaceTab={selectedClassSpaceTab}
        sessionEvents={session.sessionEvents}
        hasLiveTask={presentation.hasLiveTask}
        resetTask={commands.resetTask}
        taskPersistence={session.taskPersistence}
        sessionTaskSnapshots={sessionTaskSnapshots}
        organizationError={organizationState.organizationError}
        isLoadingOrganization={organizationState.isLoadingOrganization}
        setOrganization={organizationState.setOrganization}
        refreshOrganization={organizationState.refreshOrganization}
        organization={organizationState.organization}
        settingsOpen={settingsOpen}
        taskProps={{
          hero: presentation.hero,
          organizationHomeBanner: organizationHomeBanner,
          t: t,
          organization: organizationState.organization,
          hasLiveTask: presentation.hasLiveTask,
          pendingInteraction: presentation.pendingInteraction,
          sendInput: commands.sendInput,
          pendingClarification: presentation.pendingClarification,
          isSteering: presentation.isSteering,
          voiceStatus: voiceStatus,
          voiceMode: voiceMode,
          selectedVoiceMode: preferences.selectedVoiceMode,
          appLanguageDraft: preferences.appLanguageDraft,
          voiceModeLocked: voiceModeLocked,
          selectVoiceMode: voiceSelection.selectVoiceMode,
          voicePlatform: voicePlatform,
          taskRequestRef: session.taskRequestRef,
          setInput: setInput,
          input: input,
          executionProfile: workspace.executionProfile,
          setExecutionProfile: workspace.setExecutionProfile,
          workspaceRuntime: workspace.workspaceRuntime,
          isSelectingWorkspace: workspace.isSelectingWorkspace,
          workspaceSelection: workspace.workspaceSelection,
          chooseWorkspace: workspace.chooseWorkspace,
          canSubmit: canSubmit,
          isSubmitting: commands.isSubmitting,
          snapshot: session.snapshot,
          agentActivities: session.agentActivities,
          agentActivity: session.agentActivity,
          autoStartFailedTaskId: session.autoStartFailedTaskId,
          selectedTaskRuntimeReady: selectedTaskRuntimeReady,
          startTask: commands.startTask,
          streamingDraft: session.streamingDraft,
          error: taskError.error,
          permissionWait: presentation.permissionWait,
          permissionPresentation: presentation.permissionPresentation,
          isTerminalTask: presentation.isTerminalTask,
          setActiveView: setActiveView,
        }}
        contextProps={{
          t: t,
          displayedPlan: displayedPlan,
          usagePercent: usagePercent,
          usageBudget: session.usageBudget,
          historyTaskCount: historyTaskCount,
          taskPhase: presentation.taskPhase,
          appLanguageDraft: preferences.appLanguageDraft,
          isRequestingPermissions: permissions.isRequestingPermissions,
          openScreenRecordingSettings: permissions.openScreenRecordingSettings,
          desktopReady: permissions.desktopReady,
          computerStatus: permissions.computerStatus,
          hasLiveTask: presentation.hasLiveTask,
          events: session.events,
        }}
        settingsProps={{
          preferences,
          updates,
          membership,
          activation,
          companion,
          organizationState,
          voicePlatform,
          closeSettings,
          onOpenOrganization: () => {
            closeSettings();
            setActiveView('organization');
          },
        }}
      />
    </div>
  );
}
