import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';

import {
  ActivateMembershipRequestSchema,
  ActivateCompanionCandidateRequestSchema,
  ActivateSavedCompanionRequestSchema,
  AgentActivityUpdateSchema,
  BeginDictationRequestSchema,
  BeginDictationResultSchema,
  CancelDictationRequestSchema,
  CursorBuddySnapshotSchema,
  CompanionResponseActionRequestSchema,
  CompanionSpeechPlaybackReportSchema,
  CompanionStateSchema,
  CompanionVoiceActivitySchema,
  CommitDictationRequestSchema,
  DictationCommitResultSchema,
  GenerateCompanionImageRequestSchema,
  ConnectConnectorRequestSchema,
  ConnectorAttemptRequestSchema,
  DisconnectConnectorRequestSchema,
  GetUsageBudgetRequestSchema,
  RecordVoiceTranscriptRequestSchema,
  RespondToInteractionRequestSchema,
  ResolveComputerPermissionRequestSchema,
  SetVoiceAudioDuckingRequestSchema,
  SystemPermissionSchema,
  TaskUpdateSchema,
  TranscribeVoiceSegmentRequestSchema,
  UpdateAppPreferencesRequestSchema,
  VoiceDiagnosticSchema,
  type AuthUser,
  type CursorBuddySnapshot,
  type CompanionState,
  type CompanionResponseActionRequest,
  type CompanionVoiceActivity,
  type CompanionSpeechPlaybackReport,
  type RecordVoiceTranscriptRequest,
  type SystemPermission,
  type UsageBudgetSnapshot,
  CreateKnowledgeSpaceRequestSchema,
  KnowledgeSpaceIdRequestSchema,
  SelectKnowledgeFilesRequestSchema,
  UploadKnowledgeSelectionRequestSchema,
  CreateKnowledgeRunRequestSchema,
  SetKnowledgeRunStateRequestSchema,
  KnowledgeAttemptIdRequestSchema,
  AcknowledgeKnowledgeAttemptRequestSchema,
  GetKnowledgeDashboardRequestSchema,
  PrepareActivityStarterRequestSchema,
  SubmitKnowledgeSelectionRequestSchema,
  CreateKnowledgeGroupRequestSchema,
  AddKnowledgeSpaceMembersRequestSchema,
  CreateKnowledgeInviteRequestSchema,
  RedeemKnowledgeInviteRequestSchema,
  RequestKnowledgeAttemptHelpSchema,
  AddOrganizationMemberRequestSchema,
  CancelOrganizationMemberRequestSchema,
  ClassroomDirectiveNoticeSchema,
  ClassroomSessionProjectionSchema,
  CreateClassroomDirectiveRequestSchema,
  CreateKnowledgeRoomCodeRequestSchema,
  DismissClassroomDirectiveRequestSchema,
  JoinClassroomSessionRequestSchema,
  KnowledgeAttemptMutationRequestSchema,
  OpenClassroomDirectiveRequestSchema,
  ResolveKnowledgeAttemptHelpRequestSchema,
  ReviewKnowledgeAttemptRequestSchema,
  RevokeKnowledgeRoomCodeRequestSchema,
  SetClassroomLinkConsentRequestSchema,
  ListOrganizationMembersRequestSchema,
  UpdateOrganizationRequestSchema,
} from '../../shared/contracts';
import { IPC_CHANNELS } from '../../shared/desktop-api';
import type { AgentActivityService } from '../agent/agent-activity-service';
import type { TaskRuntime } from '../agent/task-runtime';
import type { TaskApplicationService } from '../application/task-application-service';
import type { GoogleAuthService } from '../auth/google-auth-service';
import type { UsageBudgetService } from '../budget/usage-budget-service';
import type { CompanionCustomizationService } from '../companion/companion-customization-service';
import type { ConnectorClient } from '../connectors/connector-client';
import type { ComputerPermissionCoordinator } from '../cua/computer-permission-coordinator';
import type { CuaService } from '../cua/cua-service';
import type { TaskHistoryService } from '../history/task-history-service';
import type { ActivityProgressReporter } from '../knowledge/activity-progress-reporter';
import type { ActivityWorkspacePreparationService } from '../knowledge/activity-workspace-preparation-service';
import type { ClassroomDirectiveService } from '../knowledge/classroom-directive-service';
import type { ClassroomSessionService } from '../knowledge/classroom-session-service';
import type { FileSelectionService } from '../knowledge/file-selection-service';
import type { KnowledgeSpaceClient } from '../knowledge/knowledge-space-client';
import type { KnowledgeUploadOrchestrator } from '../knowledge/knowledge-upload-service';
import type { MembershipService } from '../membership/membership-service';
import type { OrganizationClient } from '../organization/organization-client';
import type { AppPreferencesService } from '../preferences/app-preferences-service';
import type { AppUpdateService } from '../update/app-update-service';
import type { DictationService } from '../voice/dictation-service';
import type { SystemAudioDuckingService } from '../voice/system-audio-ducking-service';
import type { VoiceService } from '../voice/voice-service';
import type { WorkspaceSelectionService } from '../workspace/workspace-selection-service';

import { registerActivityAuthoringIpc } from './register-activity-authoring-ipc';
import {
  registerClassroomBroadcastIpc,
  type ClassroomBroadcastFeatures,
} from './register-classroom-broadcast-ipc';

interface IpcServices {
  classroomBroadcastFeatures?: ClassroomBroadcastFeatures;
  agentActivityService: AgentActivityService;
  appUpdateService: Pick<
    AppUpdateService,
    'checkForUpdates' | 'getStatus' | 'onStatusChange' | 'restartAndInstall'
  >;
  appPreferencesService: AppPreferencesService;
  authService: GoogleAuthService;
  companionCustomizationService: Pick<
    CompanionCustomizationService,
    | 'activateCandidate'
    | 'activateSaved'
    | 'generate'
    | 'getStatus'
    | 'useDefault'
  >;
  cancelActiveTasks(): Promise<void> | void;
  cuaService: CuaService;
  dictationService: Pick<DictationService, 'begin' | 'cancel' | 'commit'>;
  connectorClient: ConnectorClient;
  computerPermissionCoordinator: Pick<
    ComputerPermissionCoordinator,
    'continueWithout' | 'openSettings' | 'refresh'
  >;
  getCompanionInteractionWindow(): BrowserWindow | null;
  getCursorBuddySnapshot(): CursorBuddySnapshot;
  getCursorBuddyWindow(): BrowserWindow | null;
  handleCompanionResponseAction(
    request: CompanionResponseActionRequest,
  ): Promise<void> | void;
  membershipService: MembershipService;
  organizationClient: OrganizationClient;
  onAuthSignedIn?(user: AuthUser): Promise<void> | void;
  onAuthSignedOut?(): Promise<void> | void;
  onUsageBudgetSnapshot?(snapshot: UsageBudgetSnapshot): void;
  openSystemPermissionSettings(
    permission: SystemPermission,
  ): Promise<unknown> | unknown;
  recordVoiceTranscript(
    input: RecordVoiceTranscriptRequest,
  ): Promise<void> | void;
  reportCompanionSpeechPlayback(
    report: CompanionSpeechPlaybackReport,
  ): Promise<void> | void;
  requestScreenRecordingAccess(): Promise<unknown> | unknown;
  revealMainWindow(): void;
  taskRuntime: TaskRuntime;
  taskApplicationService: TaskApplicationService;
  taskHistoryService: TaskHistoryService;
  systemAudioDuckingService: Pick<SystemAudioDuckingService, 'setActive'>;
  updateCompanionState(state: CompanionState): void;
  updateCompanionVoiceActivity(activity: CompanionVoiceActivity | null): void;
  voiceService: VoiceService;
  usageBudgetService: UsageBudgetService;
  workspaceSelectionService: WorkspaceSelectionService;
  fileSelectionService: FileSelectionService;
  knowledgeSpaceClient: KnowledgeSpaceClient;
  knowledgeUploadOrchestrator: KnowledgeUploadOrchestrator;
  activityProgressReporter: Pick<ActivityProgressReporter, 'clear'>;
  activityWorkspacePreparationService: Pick<
    ActivityWorkspacePreparationService,
    'prepare'
  >;
  classroomDirectiveService: Pick<
    ClassroomDirectiveService,
    'dismiss' | 'onNotice' | 'open'
  >;
  classroomSessionService: Pick<
    ClassroomSessionService,
    | 'clear'
    | 'get'
    | 'join'
    | 'leave'
    | 'onChange'
    | 'restore'
    | 'setAutoOpenConsent'
  >;
}

async function assertAuthorizedSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow,
  authService: GoogleAuthService,
): Promise<AuthUser> {
  assertTrustedSender(event, mainWindow);
  return authService.assertSignedIn();
}

async function assertMembershipAuthorizedSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow,
  services: Pick<IpcServices, 'authService' | 'membershipService'>,
): Promise<void> {
  const user = await assertAuthorizedSender(
    event,
    mainWindow,
    services.authService,
  );
  await services.membershipService.assertActive(user);
}

function isTrustedWindowSender(
  event: IpcMainInvokeEvent,
  window: BrowserWindow | null,
): boolean {
  return Boolean(
    window &&
    !window.isDestroyed() &&
    event.sender.id === window.webContents.id &&
    event.senderFrame === window.webContents.mainFrame,
  );
}

function assertTrustedInteractionSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow,
  services: Pick<IpcServices, 'getCompanionInteractionWindow'>,
): void {
  if (
    !isTrustedWindowSender(event, mainWindow) &&
    !isTrustedWindowSender(event, services.getCompanionInteractionWindow())
  ) {
    throw new Error('Rejected IPC call from an untrusted renderer.');
  }
}

function assertTrustedCompanionSender(
  event: IpcMainInvokeEvent,
  services: Pick<IpcServices, 'getCompanionInteractionWindow'>,
): void {
  if (!isTrustedWindowSender(event, services.getCompanionInteractionWindow())) {
    throw new Error('Rejected IPC call from an untrusted renderer.');
  }
}

function assertTrustedCursorBuddySender(
  event: IpcMainInvokeEvent,
  services: Pick<IpcServices, 'getCursorBuddyWindow'>,
): void {
  if (!isTrustedWindowSender(event, services.getCursorBuddyWindow())) {
    throw new Error('Rejected IPC call from an untrusted renderer.');
  }
}

async function assertMembershipAuthorizedInteractionSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow,
  services: Pick<
    IpcServices,
    'authService' | 'getCompanionInteractionWindow' | 'membershipService'
  >,
): Promise<void> {
  assertTrustedInteractionSender(event, mainWindow, services);
  const user = await services.authService.assertSignedIn();
  await services.membershipService.assertActive(user);
}

function assertTrustedSender(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow,
): void {
  if (
    event.sender.id !== mainWindow.webContents.id ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error('Rejected IPC call from an untrusted renderer.');
  }
}

export function registerIpcHandlers(
  mainWindow: BrowserWindow,
  services: IpcServices,
): () => void {
  const channels = [
    IPC_CHANNELS.activateMembership,
    IPC_CHANNELS.beginDictation,
    IPC_CHANNELS.cancelDictation,
    IPC_CHANNELS.checkForAppUpdates,
    IPC_CHANNELS.cancelTask,
    IPC_CHANNELS.configureVoice,
    IPC_CHANNELS.commitDictation,
    IPC_CHANNELS.connectComputer,
    IPC_CHANNELS.connectConnector,
    IPC_CHANNELS.disconnectConnector,
    IPC_CHANNELS.companionReportSpeechPlayback,
    IPC_CHANNELS.companionActivateCandidate,
    IPC_CHANNELS.companionCustomizationStatus,
    IPC_CHANNELS.companionGenerateImage,
    IPC_CHANNELS.companionResponseAction,
    IPC_CHANNELS.companionRevealMainWindow,
    IPC_CHANNELS.companionUseDefault,
    IPC_CHANNELS.transcribeVoiceSegment,
    IPC_CHANNELS.getAppPreferences,
    IPC_CHANNELS.getAppUpdateStatus,
    IPC_CHANNELS.getComputerStatus,
    IPC_CHANNELS.getCursorBuddySnapshot,
    IPC_CHANNELS.getConnectorAttempt,
    IPC_CHANNELS.listConnectors,
    IPC_CHANNELS.getAuthStatus,
    IPC_CHANNELS.getMembershipStatus,
    IPC_CHANNELS.getOrganization,
    IPC_CHANNELS.updateOrganization,
    IPC_CHANNELS.listOrganizationMembers,
    IPC_CHANNELS.addOrganizationMember,
    IPC_CHANNELS.cancelOrganizationMember,
    IPC_CHANNELS.getUsageBudget,
    IPC_CHANNELS.getTaskHistory,
    IPC_CHANNELS.getVoiceStatus,
    IPC_CHANNELS.getWorkspaceRuntimeAvailability,
    IPC_CHANNELS.openSystemPermissionSettings,
    IPC_CHANNELS.resolveComputerPermission,
    IPC_CHANNELS.recordVoiceTranscript,
    IPC_CHANNELS.respondToInteraction,
    IPC_CHANNELS.reportVoiceDiagnostic,
    IPC_CHANNELS.restartAndInstallAppUpdate,
    IPC_CHANNELS.setCompanionState,
    IPC_CHANNELS.setCompanionVoiceActivity,
    IPC_CHANNELS.setVoiceAudioDucking,
    IPC_CHANNELS.startTask,
    IPC_CHANNELS.signInWithGoogle,
    IPC_CHANNELS.signOutGoogle,
    IPC_CHANNELS.steerTask,
    IPC_CHANNELS.submitTask,
    IPC_CHANNELS.selectWorkspace,
    IPC_CHANNELS.updateAppPreferences,
    IPC_CHANNELS.getKnowledgeCapabilities,
    IPC_CHANNELS.listKnowledgeSpaces,
    IPC_CHANNELS.createKnowledgeSpace,
    IPC_CHANNELS.getKnowledgeSpace,
    IPC_CHANNELS.listKnowledgeSources,
    IPC_CHANNELS.selectKnowledgeFiles,
    IPC_CHANNELS.uploadKnowledgeSelection,
    IPC_CHANNELS.prepareKnowledgeActivity,
    IPC_CHANNELS.saveKnowledgeActivity,
    IPC_CHANNELS.publishKnowledgeActivity,
    IPC_CHANNELS.listPublishedKnowledgeActivities,
    IPC_CHANNELS.listKnowledgeClassSessions,
    IPC_CHANNELS.createKnowledgeClassSession,
    IPC_CHANNELS.createKnowledgeRun,
    IPC_CHANNELS.setKnowledgeRunState,
    IPC_CHANNELS.listAssignedActivities,
    IPC_CHANNELS.getHostedAttempt,
    IPC_CHANNELS.acknowledgeHostedAttempt,
    IPC_CHANNELS.getKnowledgeDashboard,
    IPC_CHANNELS.prepareActivityStarter,
    IPC_CHANNELS.submitKnowledgeSelection,
    IPC_CHANNELS.listKnowledgeGroups,
    IPC_CHANNELS.createKnowledgeGroup,
    IPC_CHANNELS.listKnowledgeMembers,
    IPC_CHANNELS.addKnowledgeSpaceMembers,
    IPC_CHANNELS.createKnowledgeInvite,
    IPC_CHANNELS.redeemKnowledgeInvite,
    IPC_CHANNELS.requestKnowledgeAttemptHelp,
    IPC_CHANNELS.createKnowledgeRoomCode,
    IPC_CHANNELS.revokeKnowledgeRoomCode,
    IPC_CHANNELS.joinKnowledgeRoom,
    IPC_CHANNELS.restoreClassroomSession,
    IPC_CHANNELS.getClassroomSession,
    IPC_CHANNELS.leaveClassroomSession,
    IPC_CHANNELS.setClassroomLinkConsent,
    IPC_CHANNELS.createClassroomDirective,
    IPC_CHANNELS.openClassroomDirective,
    IPC_CHANNELS.dismissClassroomDirective,
    IPC_CHANNELS.readyKnowledgeAttempt,
    IPC_CHANNELS.reviewKnowledgeAttempt,
    IPC_CHANNELS.resolveKnowledgeAttemptHelp,
  ];

  for (const channel of channels) ipcMain.removeHandler(channel);

  ipcMain.handle(IPC_CHANNELS.getAppUpdateStatus, (event) => {
    assertTrustedSender(event, mainWindow);
    return services.appUpdateService.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.checkForAppUpdates, (event) => {
    assertTrustedSender(event, mainWindow);
    return services.appUpdateService.checkForUpdates();
  });

  ipcMain.handle(IPC_CHANNELS.restartAndInstallAppUpdate, async (event) => {
    assertTrustedSender(event, mainWindow);
    await services.appUpdateService.restartAndInstall();
  });

  ipcMain.handle(IPC_CHANNELS.getAuthStatus, (event) => {
    assertTrustedSender(event, mainWindow);
    return services.authService.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.signInWithGoogle, async (event) => {
    assertTrustedSender(event, mainWindow);
    const status = await services.authService.signIn();
    if (status.user) {
      services.revealMainWindow();
      try {
        const setup = services.onAuthSignedIn?.(status.user);
        if (setup) {
          void setup.catch((error: unknown) => {
            console.error('[auth] Post-sign-in setup failed.', error);
          });
        }
      } catch (error) {
        console.error('[auth] Post-sign-in setup failed.', error);
      }
    }
    return status;
  });

  ipcMain.handle(IPC_CHANNELS.signOutGoogle, async (event) => {
    assertTrustedSender(event, mainWindow);
    await services.cancelActiveTasks();
    const status = await services.authService.signOut();
    services.fileSelectionService?.clear();
    services.activityProgressReporter?.clear();
    services.classroomBroadcastFeatures?.context.clear();
    await services.classroomBroadcastFeatures?.guidance.invalidate();
    services.classroomSessionService.clear();
    await services.onAuthSignedOut?.();
    return status;
  });

  ipcMain.handle(IPC_CHANNELS.getMembershipStatus, async (event) => {
    const user = await assertAuthorizedSender(
      event,
      mainWindow,
      services.authService,
    );
    return services.membershipService.getStatus(user);
  });

  ipcMain.handle(
    IPC_CHANNELS.activateMembership,
    async (event, input: unknown) => {
      const user = await assertAuthorizedSender(
        event,
        mainWindow,
        services.authService,
      );
      const request = ActivateMembershipRequestSchema.parse(input);
      return services.membershipService.activate(user, request.code);
    },
  );

  ipcMain.handle(IPC_CHANNELS.continueWithFree, async (event) => {
    const user = await assertAuthorizedSender(
      event,
      mainWindow,
      services.authService,
    );
    return services.membershipService.continueWithFree(user);
  });

  ipcMain.handle(IPC_CHANNELS.getOrganization, async (event) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    return services.organizationClient.getCurrent();
  });

  ipcMain.handle(IPC_CHANNELS.listConnectors, async (event) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    return services.connectorClient.list();
  });

  ipcMain.handle(IPC_CHANNELS.connectConnector, async (event, input: unknown) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    const request = ConnectConnectorRequestSchema.parse(input);
    return services.connectorClient.connect(request.catalogKey);
  });

  ipcMain.handle(IPC_CHANNELS.getConnectorAttempt, async (event, input: unknown) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    const request = ConnectorAttemptRequestSchema.parse(input);
    return services.connectorClient.attempt(request.attemptId);
  });

  ipcMain.handle(IPC_CHANNELS.disconnectConnector, async (event, input: unknown) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    const request = DisconnectConnectorRequestSchema.parse(input);
    return services.connectorClient.disconnect(request.connectionId);
  });

  ipcMain.handle(
    IPC_CHANNELS.updateOrganization,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      return services.organizationClient.update(
        UpdateOrganizationRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.listOrganizationMembers,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      return services.organizationClient.listMembers(
        ListOrganizationMembersRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.addOrganizationMember,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      return services.organizationClient.addMember(
        AddOrganizationMemberRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.cancelOrganizationMember,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = CancelOrganizationMemberRequestSchema.parse(input);
      return services.organizationClient.cancelMember(request.memberId);
    },
  );

  ipcMain.handle(IPC_CHANNELS.getAppPreferences, async (event) => {
    await assertAuthorizedSender(event, mainWindow, services.authService);
    return services.appPreferencesService.get();
  });

  ipcMain.handle(IPC_CHANNELS.companionCustomizationStatus, async (event) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    return services.companionCustomizationService.getStatus();
  });

  ipcMain.handle(
    IPC_CHANNELS.companionGenerateImage,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      return services.companionCustomizationService.generate(
        GenerateCompanionImageRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.companionActivateCandidate,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      return services.companionCustomizationService.activateCandidate(
        ActivateCompanionCandidateRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.companionActivateSaved,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      return services.companionCustomizationService.activateSaved(
        ActivateSavedCompanionRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(IPC_CHANNELS.companionUseDefault, async (event) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    return services.companionCustomizationService.useDefault();
  });

  ipcMain.handle(IPC_CHANNELS.getKnowledgeCapabilities, async (event) => {
    await assertAuthorizedSender(event, mainWindow, services.authService);
    return services.knowledgeSpaceClient.capabilities();
  });

  ipcMain.handle(IPC_CHANNELS.listKnowledgeSpaces, async (event) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    return services.knowledgeSpaceClient.listSpaces();
  });

  ipcMain.handle(
    IPC_CHANNELS.createKnowledgeSpace,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      return services.knowledgeSpaceClient.createSpace(
        CreateKnowledgeSpaceRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.getKnowledgeSpace,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = KnowledgeSpaceIdRequestSchema.parse(input);
      return services.knowledgeSpaceClient.getSpace(request.spaceId);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.listKnowledgeSources,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = KnowledgeSpaceIdRequestSchema.parse(input);
      return services.knowledgeSpaceClient.listSources(request.spaceId);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.selectKnowledgeFiles,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      return services.fileSelectionService.select(
        SelectKnowledgeFilesRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.uploadKnowledgeSelection,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = UploadKnowledgeSelectionRequestSchema.parse(input);
      return services.knowledgeUploadOrchestrator.upload(
        request.spaceId,
        request.selectionId,
      );
    },
  );

  registerActivityAuthoringIpc(
    services.knowledgeSpaceClient,
    (event) => assertMembershipAuthorizedSender(event, mainWindow, services),
  );

  ipcMain.handle(
    IPC_CHANNELS.createKnowledgeRun,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      return services.knowledgeSpaceClient.createRun(
        CreateKnowledgeRunRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.setKnowledgeRunState,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = SetKnowledgeRunStateRequestSchema.parse(input);
      return services.knowledgeSpaceClient.setRunState(
        request.spaceId,
        request.runId,
        request.state,
      );
    },
  );

  ipcMain.handle(IPC_CHANNELS.listAssignedActivities, async (event) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    return services.knowledgeSpaceClient.listAssigned();
  });

  ipcMain.handle(
    IPC_CHANNELS.getHostedAttempt,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = KnowledgeAttemptIdRequestSchema.parse(input);
      return services.knowledgeSpaceClient.getAttempt(request.attemptId);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.acknowledgeHostedAttempt,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = AcknowledgeKnowledgeAttemptRequestSchema.parse(input);
      await services.knowledgeSpaceClient.acknowledgeAttempt(
        request.attemptId,
        request.policyVersion,
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.getKnowledgeDashboard,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = GetKnowledgeDashboardRequestSchema.parse(input);
      return services.knowledgeSpaceClient.dashboard(
        request.spaceId,
        request.runId,
        request.sinceSequence,
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.prepareActivityStarter,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = PrepareActivityStarterRequestSchema.parse(input);
      return services.activityWorkspacePreparationService.prepare(
        request.attemptId,
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.submitKnowledgeSelection,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = SubmitKnowledgeSelectionRequestSchema.parse(input);
      return services.knowledgeUploadOrchestrator.submit(
        request.attemptId,
        request.selectionId,
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.listKnowledgeGroups,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = KnowledgeSpaceIdRequestSchema.parse(input);
      return services.knowledgeSpaceClient.listGroups(request.spaceId);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.createKnowledgeGroup,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      return services.knowledgeSpaceClient.createGroup(
        CreateKnowledgeGroupRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.listKnowledgeMembers,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = KnowledgeSpaceIdRequestSchema.parse(input);
      return services.knowledgeSpaceClient.listMembers(request.spaceId);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.addKnowledgeSpaceMembers,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      return services.knowledgeSpaceClient.addMembers(
        AddKnowledgeSpaceMembersRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.createKnowledgeInvite,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      return services.knowledgeSpaceClient.createInvite(
        CreateKnowledgeInviteRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.redeemKnowledgeInvite,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = RedeemKnowledgeInviteRequestSchema.parse(input);
      return services.knowledgeSpaceClient.redeemInvite(request.code);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.requestKnowledgeAttemptHelp,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = RequestKnowledgeAttemptHelpSchema.parse(input);
      await services.knowledgeSpaceClient.requestHelp(
        request.attemptId,
        request.clientId,
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.createKnowledgeRoomCode,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      return services.knowledgeSpaceClient.createRoomCode(
        CreateKnowledgeRoomCodeRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.revokeKnowledgeRoomCode,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      return services.knowledgeSpaceClient.revokeRoomCode(
        RevokeKnowledgeRoomCodeRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.joinKnowledgeRoom,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      return services.classroomSessionService.join(
        JoinClassroomSessionRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(IPC_CHANNELS.restoreClassroomSession, async (event) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    return services.classroomSessionService.restore();
  });

  ipcMain.handle(IPC_CHANNELS.getClassroomSession, async (event) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    return services.classroomSessionService.get();
  });

  ipcMain.handle(
    IPC_CHANNELS.leaveClassroomSession,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = KnowledgeAttemptMutationRequestSchema.parse(input);
      const current = services.classroomSessionService.get();
      if (!current || current.attemptId !== request.attemptId)
        throw new Error('The requested class session is not active.');
      await services.classroomSessionService.leave();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.setClassroomLinkConsent,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = SetClassroomLinkConsentRequestSchema.parse(input);
      return services.classroomSessionService.setAutoOpenConsent(
        request.consent,
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.createClassroomDirective,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      return services.knowledgeSpaceClient.createDirective(
        CreateClassroomDirectiveRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.openClassroomDirective,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = OpenClassroomDirectiveRequestSchema.parse(input);
      await services.classroomDirectiveService.open(request.directive);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.dismissClassroomDirective,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = DismissClassroomDirectiveRequestSchema.parse(input);
      services.classroomDirectiveService.dismiss(request.directiveId);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.readyKnowledgeAttempt,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = KnowledgeAttemptMutationRequestSchema.parse(input);
      return services.knowledgeSpaceClient.readyAttempt(
        request.attemptId,
        request.clientId,
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.reviewKnowledgeAttempt,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      return services.knowledgeSpaceClient.reviewAttempt(
        ReviewKnowledgeAttemptRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.resolveKnowledgeAttemptHelp,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      return services.knowledgeSpaceClient.resolveHelp(
        ResolveKnowledgeAttemptHelpRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.getWorkspaceRuntimeAvailability,
    async (event) => {
      await assertAuthorizedSender(event, mainWindow, services.authService);
      return services.workspaceSelectionService.availability();
    },
  );

  ipcMain.handle(IPC_CHANNELS.selectWorkspace, async (event) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    return services.workspaceSelectionService.select();
  });

  ipcMain.handle(IPC_CHANNELS.getTaskHistory, async (event) => {
    const user = await assertAuthorizedSender(
      event,
      mainWindow,
      services.authService,
    );
    return services.taskHistoryService.load(user.id);
  });

  ipcMain.handle(IPC_CHANNELS.getUsageBudget, async (event, input: unknown) => {
    await assertAuthorizedSender(event, mainWindow, services.authService);
    const request = GetUsageBudgetRequestSchema.parse(input ?? {});
    const snapshot = await services.usageBudgetService.get(request.taskId);
    services.onUsageBudgetSnapshot?.(snapshot);
    return snapshot;
  });

  ipcMain.handle(
    IPC_CHANNELS.updateAppPreferences,
    async (event, input: unknown) => {
      await assertAuthorizedSender(event, mainWindow, services.authService);
      return services.appPreferencesService.update(
        UpdateAppPreferencesRequestSchema.parse(input),
      );
    },
  );

  ipcMain.handle(IPC_CHANNELS.submitTask, async (event, input: unknown) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    return services.taskApplicationService.submitAndStart(input);
  });

  ipcMain.handle(IPC_CHANNELS.cancelTask, async (event, input: unknown) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    return services.taskApplicationService.cancel(input);
  });

  ipcMain.handle(IPC_CHANNELS.startTask, async (event, input: unknown) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    return services.taskApplicationService.start(input);
  });

  ipcMain.handle(
    IPC_CHANNELS.respondToInteraction,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedInteractionSender(
        event,
        mainWindow,
        services,
      );
      const request = RespondToInteractionRequestSchema.parse(input);
      return services.taskApplicationService.respond(request);
    },
  );

  ipcMain.handle(IPC_CHANNELS.companionRevealMainWindow, async (event) => {
    assertTrustedCompanionSender(event, services);
    await services.authService.assertSignedIn();
    services.revealMainWindow();
  });

  ipcMain.handle(IPC_CHANNELS.getCursorBuddySnapshot, async (event) => {
    assertTrustedCursorBuddySender(event, services);
    await services.authService.assertSignedIn();
    return CursorBuddySnapshotSchema.parse(services.getCursorBuddySnapshot());
  });

  ipcMain.handle(
    IPC_CHANNELS.companionResponseAction,
    async (event, input: unknown) => {
      assertTrustedCompanionSender(event, services);
      await services.authService.assertSignedIn();
      const request = CompanionResponseActionRequestSchema.parse(input);
      await services.handleCompanionResponseAction(request);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.companionReportSpeechPlayback,
    async (event, input: unknown) => {
      assertTrustedCompanionSender(event, services);
      const report = CompanionSpeechPlaybackReportSchema.parse(input);
      await services.reportCompanionSpeechPlayback(report);
    },
  );

  ipcMain.handle(IPC_CHANNELS.steerTask, async (event, input: unknown) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    return services.taskApplicationService.steer(input);
  });

  ipcMain.handle(IPC_CHANNELS.getComputerStatus, async (event) => {
    await assertAuthorizedSender(event, mainWindow, services.authService);
    return services.cuaService.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.connectComputer, async (event) => {
    await assertAuthorizedSender(event, mainWindow, services.authService);
    let status = await services.cuaService.connect();
    if (
      status.platform === 'darwin' &&
      status.permissions?.screenRecording === false
    ) {
      try {
        await services.requestScreenRecordingAccess();
        status = await services.cuaService.getStatus();
      } catch (error) {
        console.warn(
          'Tro could not start its Screen Recording registration stream.',
          error,
        );
        // Opening the privacy pane is still useful if Chromium cannot enumerate
        // sources, for example after a previous denial.
      }
      if (
        status.platform === 'darwin' &&
        status.permissions?.screenRecording === false
      ) {
        await services.openSystemPermissionSettings('screen_recording');
      }
    }
    return status;
  });

  ipcMain.handle(
    IPC_CHANNELS.openSystemPermissionSettings,
    async (event, input: unknown) => {
      await assertAuthorizedSender(event, mainWindow, services.authService);
      await services.openSystemPermissionSettings(
        SystemPermissionSchema.parse(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.resolveComputerPermission,
    async (event, input: unknown) => {
      await assertAuthorizedSender(event, mainWindow, services.authService);
      const request = ResolveComputerPermissionRequestSchema.parse(input);
      if (request.action === 'open_system_settings') {
        await services.computerPermissionCoordinator.openSettings(
          request.taskId,
        );
      } else if (request.action === 'continue_without_computer') {
        await services.computerPermissionCoordinator.continueWithout(
          request.taskId,
        );
      } else {
        await services.computerPermissionCoordinator.refresh();
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.getVoiceStatus, async (event) => {
    await assertAuthorizedSender(event, mainWindow, services.authService);
    return services.voiceService.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.beginDictation, async (event, input: unknown) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    const request = BeginDictationRequestSchema.parse(input);
    return BeginDictationResultSchema.parse(
      await services.dictationService.begin(request.turnId),
    );
  });

  ipcMain.handle(
    IPC_CHANNELS.commitDictation,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = CommitDictationRequestSchema.parse(input);
      return DictationCommitResultSchema.parse(
        await services.dictationService.commit(request.turnId, request.text),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.cancelDictation,
    async (event, input: unknown) => {
      assertTrustedSender(event, mainWindow);
      const request = CancelDictationRequestSchema.parse(input);
      await services.dictationService.cancel(request.turnId);
    },
  );

  ipcMain.handle(IPC_CHANNELS.configureVoice, async (event, input: unknown) => {
    await assertMembershipAuthorizedSender(event, mainWindow, services);
    return services.voiceService.configure(input);
  });

  ipcMain.handle(
    IPC_CHANNELS.recordVoiceTranscript,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = RecordVoiceTranscriptRequestSchema.parse(input);
      await services.recordVoiceTranscript(request);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.transcribeVoiceSegment,
    async (event, input: unknown) => {
      await assertMembershipAuthorizedSender(event, mainWindow, services);
      const request = TranscribeVoiceSegmentRequestSchema.parse(input);
      return services.voiceService.transcribeSegment(request);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.setVoiceAudioDucking,
    async (event, input: unknown) => {
      assertTrustedSender(event, mainWindow);
      const request = SetVoiceAudioDuckingRequestSchema.parse(input);
      if (request.active) {
        await assertMembershipAuthorizedSender(event, mainWindow, services);
      }
      await services.systemAudioDuckingService.setActive(request.active);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.reportVoiceDiagnostic,
    (event, input: unknown) => {
      assertTrustedSender(event, mainWindow);
      const diagnostic = VoiceDiagnosticSchema.parse(input);
      console.error('[voice] GPT Transcribe transcription failed.', diagnostic);
    },
  );

  ipcMain.handle(IPC_CHANNELS.setCompanionState, (event, input: unknown) => {
    assertTrustedSender(event, mainWindow);
    services.updateCompanionState(CompanionStateSchema.parse(input));
  });

  ipcMain.handle(
    IPC_CHANNELS.setCompanionVoiceActivity,
    (event, input: unknown) => {
      assertTrustedSender(event, mainWindow);
      services.updateCompanionVoiceActivity(
        CompanionVoiceActivitySchema.nullable().parse(input),
      );
    },
  );

  const forwardTaskUpdate = (value: unknown): void => {
    if (mainWindow.isDestroyed()) return;
    const taskUpdate = TaskUpdateSchema.parse(value);
    mainWindow.webContents.send(IPC_CHANNELS.taskUpdate, taskUpdate);
  };

  services.taskRuntime.on('task-update', forwardTaskUpdate);
  const forwardAgentActivity = (value: unknown): void => {
    if (mainWindow.isDestroyed()) return;
    const activity = AgentActivityUpdateSchema.parse(value);
    mainWindow.webContents.send(IPC_CHANNELS.agentActivity, activity);
  };
  services.agentActivityService.on('activity', forwardAgentActivity);
  const stopClassroomBroadcastIpc = registerClassroomBroadcastIpc(
    mainWindow,
    services.classroomBroadcastFeatures,
    (event) => assertMembershipAuthorizedSender(event, mainWindow, services),
  );
  const stopForwardingClassroomSession =
    services.classroomSessionService.onChange((session) => {
      if (mainWindow.isDestroyed()) return;
      mainWindow.webContents.send(
        IPC_CHANNELS.classroomSessionChanged,
        ClassroomSessionProjectionSchema.nullable().parse(session),
      );
    });
  const stopForwardingClassroomDirective =
    services.classroomDirectiveService.onNotice((notice) => {
      if (mainWindow.isDestroyed()) return;
      mainWindow.webContents.send(
        IPC_CHANNELS.classroomDirectiveChanged,
        ClassroomDirectiveNoticeSchema.nullable().parse(notice),
      );
    });
  const stopForwardingAppUpdateStatus =
    services.appUpdateService.onStatusChange((status) => {
      if (mainWindow.isDestroyed()) return;
      mainWindow.webContents.send(IPC_CHANNELS.appUpdateStatusChanged, status);
    });

  return () => {
    stopClassroomBroadcastIpc();
    stopForwardingClassroomDirective();
    stopForwardingClassroomSession();
    stopForwardingAppUpdateStatus();
    services.agentActivityService.off('activity', forwardAgentActivity);
    services.taskRuntime.off('task-update', forwardTaskUpdate);
    for (const channel of channels) ipcMain.removeHandler(channel);
  };
}
