import {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  globalShortcut,
  Menu,
  nativeImage,
  protocol,
  safeStorage,
  screen,
  shell,
  systemPreferences,
  Tray,
  type OpenDialogOptions,
} from 'electron';
import path from 'node:path';

import { AgentActivityService } from './main/agent/agent-activity-service';
import { createCuaDriverToolDefinitions } from './main/agent/cua-driver-agent-tools';
import { createCuaSemanticToolDefinitions } from './main/agent/cua-semantic-agent-tools';
import {
  TaskExecutionCoordinator,
} from './main/agent/execution-coordinator';
import {
  defaultRuntimeToolDefinitions,
  RuntimeToolRegistry,
  type InteractionToolInput,
} from './main/agent/runtime-tool-registry';
import { TaskRuntime } from './main/agent/task-runtime';
import { createWorkspaceRuntimeToolAdapters } from './main/agent/workspace-runtime-tool-adapters';
import { LocalAgentRuntime } from './main/agent-runtime/agent-runtime-adapter';
import { EncryptedAgentStateStore } from './main/agent-runtime/encrypted-agent-state-store';
import { FileAnalyticsIdentityStore } from './main/analytics/analytics-identity-store';
import { AnalyticsService } from './main/analytics/analytics-service';
import { TROCODE_EXECUTABLE_NAME, TROCODE_IS_TEST_APP } from './main/app-identity';
import { ApplicationSurfaceVerifier } from './main/application/application-surface-verifier';
import { DesktopApplicationLauncher } from './main/application/desktop-application-launcher';
import { TaskApplicationService } from './main/application/task-application-service';
import { EncryptedAuthSessionStore } from './main/auth/auth-session-store';
import { GoogleAuthService } from './main/auth/google-auth-service';
import { LocalOAuthBrowserFlow } from './main/auth/local-oauth-browser-flow';
import {
  configureMacOSDock,
  keepWindowAliveForBackgroundVoice,
  registerBackgroundTrayActivation,
} from './main/background-app-lifecycle';
import { UsageBudgetService } from './main/budget/usage-budget-service';
import {
  CoachRuntime,
  createAuthenticatedCoachDecisionClient,
} from './main/coach/coach-runtime';
import { AssignmentCheckController } from './main/companion/assignment-check-controller';
import { ClassroomPetService } from './main/companion/classroom-pet-service';
import { CompanionCustomizationService } from './main/companion/companion-customization-service';
import { CompanionHoverTracker } from './main/companion/companion-hover-tracker';
import {
  isAuthenticatedCompanionSession,
  toCompanionInteraction,
} from './main/companion/companion-interaction';
import {
  clampCompanionPosition,
  getVirtualDisplayBounds,
  interpolateCompanionWanderPosition,
  placeCompanionAtRest,
  placeCompanionWanderTarget,
  placeGuidanceCallout,
  placeGuidanceTargetMarker,
  placeVoiceIsland,
  shouldUseCompanionOverlay,
  type Point,
  type Rectangle,
} from './main/companion/companion-position';
import {
  CompanionResponseController,
  selectCompanionOverlayMode,
} from './main/companion/companion-response-controller';
import { broadcastCompanionState } from './main/companion/companion-state-broadcast';
import { CursorBuddyController } from './main/companion/cursor-buddy-controller';
import { placeCursorBuddyCallout } from './main/companion/cursor-buddy-geometry';
import {
  registerGlobalNumberedChoiceShortcuts,
  type GlobalNumberedChoiceShortcuts,
} from './main/companion/global-numbered-choice-shortcuts';
import { registerGlobalWorkCheckShortcut } from './main/companion/global-work-check-shortcut';
import { TaskPetService } from './main/companion/task-pet-service';
import { ConnectorClient } from './main/connectors/connector-client';
import { ComputerPermissionCoordinator } from './main/cua/computer-permission-coordinator';
import { CuaService } from './main/cua/cua-service';
import { createRustDesktopEngineClient } from './main/engine/rust-desktop-engine-client';
import { CompositeTaskHistoryStore } from './main/history/composite-task-history-store';
import { LegacyHostedTaskHistoryStore } from './main/history/legacy-hosted-task-history-store';
import { TaskHistoryService } from './main/history/task-history-service';
import { ImageEvidencePolicy } from './main/inference/image-evidence-policy';
import { registerIpcHandlers } from './main/ipc/register-ipc';
import { ActivityContextService } from './main/knowledge/activity-context-service';
import { ActivityProgressReporter } from './main/knowledge/activity-progress-reporter';
import { createActivityToolAdapters } from './main/knowledge/activity-tool-adapters';
import { ActivityWorkspacePreparationService } from './main/knowledge/activity-workspace-preparation-service';
import {
  classroomToolDefinitions,
  createClassroomToolAdapters,
} from './main/knowledge/classroom-agent-tools';
import { ClassroomBroadcastDraftService } from './main/knowledge/classroom-broadcast-draft-service';
import { ClassroomBroadcastService } from './main/knowledge/classroom-broadcast-service';
import { ClassroomDirectiveService } from './main/knowledge/classroom-directive-service';
import { ClassroomGuidanceCoordinator } from './main/knowledge/classroom-guidance-coordinator';
import { canObserveClassroomExplanation } from './main/knowledge/classroom-guidance-policy';
import { ClassroomSessionService } from './main/knowledge/classroom-session-service';
import { FileSelectionService } from './main/knowledge/file-selection-service';
import { KnowledgeSpaceClient } from './main/knowledge/knowledge-space-client';
import { KnowledgeUploadOrchestrator } from './main/knowledge/knowledge-upload-service';
import { TeacherClassroomContextService } from './main/knowledge/teacher-classroom-context-service';
import { WorkCheckContextService } from './main/knowledge/work-check-context-service';
import {
  MembershipService,
  membershipRequiredForBuild,
} from './main/membership/membership-service';
import { OrganizationClient } from './main/organization/organization-client';
import {
  AppPreferencesService,
  FileAppPreferencesStore,
} from './main/preferences/app-preferences-service';
import { DesktopObservationGuard } from './main/presentation/desktop-observation-guard';
import {
  ElectronPresentationPresenter,
  startCompletionNarration,
  type CompanionResponsePresentationOptions,
} from './main/presentation/electron-presentation-presenter';
import { PresentationCoordinator } from './main/presentation/presentation-coordinator';
import { registerScreenRecordingHost } from './main/screen-recording-registration';
import {
  initializeSingleInstance,
  isolateDevelopmentInstance,
} from './main/single-instance';
import { systemPermissionSettingsUrl } from './main/system-permission-settings';
import { AppUpdateService } from './main/update/app-update-service';
import { CompanionNarrationService } from './main/voice/companion-narration-service';
import { DictationService } from './main/voice/dictation-service';
import { ElevenLabsTtsService } from './main/voice/elevenlabs-tts-service';
import {
  registerGlobalVoiceModeToggleShortcut,
  registerGlobalVoiceShortcut,
} from './main/voice/global-voice-shortcut';
import {
  MACOS_VOICE_SHORTCUT_HELPER_NAME,
  watchMacOSGlobalVoiceShortcut,
} from './main/voice/macos-voice-shortcut-watcher';
import { createSystemAudioDuckingService } from './main/voice/system-audio-ducking-service';
import { EncryptedVoiceCredentialStore } from './main/voice/voice-credential-store';
import {
  createVoiceModeTrayImage,
  synchronizeVoiceModeTray,
  voiceModeTrayVisual,
} from './main/voice/voice-mode-tray';
import { VoiceService } from './main/voice/voice-service';
import { watchWindowsGlobalVoiceShortcut } from './main/voice/windows-voice-shortcut-watcher';
import { WorkspaceSelectionService } from './main/workspace/workspace-selection-service';
import { EncryptedWorkspaceSelectionStore } from './main/workspace/workspace-selection-store';
import {
  AgentActivityUpdateSchema,
  CompanionGuidanceSchema,
  CompanionGuidanceVisualSchema,
  CompanionHoverSchema,
  CursorBuddySnapshotSchema,
  CompanionPetNudgeSchema,
  CompanionResponseCardSchema,
  TaskUpdateSchema,
  TROCODE_AUDIO_SCHEME,
  TROCODE_COMPANION_SCHEME,
  type AuthUser,
  type CompanionGuidance,
  type CompanionAppearance,
  type CompanionInteraction,
  type CompanionPetNudge,
  type CompanionPetNudgeDraft,
  type CompanionResponseActionRequest,
  type CompanionResponseCard,
  type CompanionSpeech,
  type CompanionState,
  type CompanionVoiceActivity,
  type CursorBuddySnapshot,
  type PendingInteraction,
  type TaskSnapshot,
  type VoiceMode,
} from './shared/contracts';
import { IPC_CHANNELS } from './shared/desktop-api';
import { WorkCheckActionSchema } from './shared/work-check-contracts';
// This allows TypeScript to pick up the magic constants that's auto-generated by Forge's Webpack
// plugin that tells the Electron app where to look for the Webpack-bundled app code (depending on
// whether you're running in development or production).
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require('electron-squirrel-startup')) {
  app.quit();
}

app.setName(TROCODE_EXECUTABLE_NAME);
protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
    scheme: TROCODE_AUDIO_SCHEME,
  },
  {
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
    scheme: TROCODE_COMPANION_SCHEME,
  },
]);
isolateDevelopmentInstance(app, TROCODE_IS_TEST_APP);

const hasSingleInstanceLock = initializeSingleInstance(app, () => {
  if (isShuttingDown) return;

  const window = mainWindow;
  if (window && !window.isDestroyed()) {
    revealWindow(window);
    return;
  }

  if (app.isReady()) {
    createWindow();
    createCompanionWindow();
    createCursorBuddyWindow();
  }
});

let analyticsService: AnalyticsService | null = null;
const agentActivityService = new AgentActivityService();
const companionResponseController = new CompanionResponseController();
const desktopApplicationLauncher = new DesktopApplicationLauncher({
  openPath: (target) => shell.openPath(target),
});
const oauthBrowserFlow = new LocalOAuthBrowserFlow({
  openExternal: async (url) => shell.openExternal(url, { activate: true }),
});
const trocodeApiBaseUrl =
  process.env.TROCODE_API_BASE_URL?.trim() ||
  process.env.TRO_API_BASE_URL?.trim() ||
  '';
const repositoryRoot = path.resolve(__dirname, '../..');
const rustDesktopEngine = createRustDesktopEngineClient({
  enginePath: process.env.TROCODE_DESKTOP_ENGINE_PATH?.trim() || undefined,
  isPackaged: app.isPackaged,
  repositoryRoot,
  resourcesPath: process.resourcesPath,
});
const authSessionStore = new EncryptedAuthSessionStore();
const authService = new GoogleAuthService({
  apiBaseUrl: trocodeApiBaseUrl,
  browserFlow: oauthBrowserFlow,
  clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
  rustEngine: rustDesktopEngine,
  sessionStore: authSessionStore,
});
const localAgentStateStore = new EncryptedAgentStateStore();
const taskHistoryService = new TaskHistoryService({
  onError: (error) => {
    console.error('[task-history] durable persistence failed.', error);
  },
  store: new CompositeTaskHistoryStore(
    localAgentStateStore,
    new LegacyHostedTaskHistoryStore(trocodeApiBaseUrl, () => authService.getAccessToken()),
  ),
});
const usageBudgetService = new UsageBudgetService(
  trocodeApiBaseUrl,
  () => authService.getAccessToken(),
);
const membershipService = new MembershipService({
  accessTokenProvider: () => authService.getAccessToken(),
  apiBaseUrl: trocodeApiBaseUrl,
  required: membershipRequiredForBuild({
    apiBaseUrl: trocodeApiBaseUrl,
    isPackaged: app.isPackaged,
  }),
});
const knowledgeSpaceClient = new KnowledgeSpaceClient(
  trocodeApiBaseUrl,
  () => authService.getAccessToken(),
);
const organizationClient = new OrganizationClient(
  trocodeApiBaseUrl,
  () => authService.getAccessToken(),
);
const connectorClient = new ConnectorClient(
  trocodeApiBaseUrl,
  () => authService.getAccessToken(),
  (url) => shell.openExternal(url, { activate: true }),
);
const teacherClassroomContextService = new TeacherClassroomContextService(
  knowledgeSpaceClient,
  async () => (await authService.assertSignedIn()).id,
);
const classroomBroadcastDraftService = new ClassroomBroadcastDraftService({
  state: localAgentStateStore,
  context: teacherClassroomContextService,
  client: knowledgeSpaceClient,
  owner: async () => (await authService.assertSignedIn()).id,
});
const activityContextService = new ActivityContextService(knowledgeSpaceClient);
const workCheckContextService = new WorkCheckContextService(knowledgeSpaceClient);
const activityProgressReporter = new ActivityProgressReporter(knowledgeSpaceClient, Date.now, (taskId, state) => {
  taskRuntime.updateWorkSessionSync(taskId, state);
});
const classroomSessionService = new ClassroomSessionService(knowledgeSpaceClient);
const classroomDirectiveService = new ClassroomDirectiveService({
  client: knowledgeSpaceClient,
  sessionService: classroomSessionService,
  openExternal: async (url) => shell.openExternal(url, { activate: true }),
});
classroomDirectiveService.start();
const classroomBroadcastService = new ClassroomBroadcastService({
  client: knowledgeSpaceClient,
  sessionService: classroomSessionService,
  openExternal: async (url) => shell.openExternal(url, { activate: true }),
});
classroomBroadcastService.start();
const reportActivityProgress = (value: unknown): void => {
  void activityProgressReporter.report(TaskUpdateSchema.parse(value));
};
const imageEvidencePolicy = new ImageEvidencePolicy({
  create: (data) => nativeImage.createFromBuffer(data),
});
const cuaService = new CuaService({
  imageEvidencePolicy,
  onPerformanceMetric: (metric) => {
    void analyticsService?.trackCuaPerformance(metric);
  },
});
const dictationService = new DictationService({ cua: cuaService });
const runtimeToolRegistry = new RuntimeToolRegistry([
  ...defaultRuntimeToolDefinitions(),
  ...classroomToolDefinitions(),
  ...createCuaSemanticToolDefinitions({
    browserPrepareAvailable: () =>
      cuaService.semanticCapabilities().browserPrepare,
    semanticAvailable: () => cuaService.supportsSemanticFastPath(),
  }),
]);
let cuaDriverToolsRegistered = false;
const taskRuntime = new TaskRuntime();
taskRuntime.on('task-update', taskHistoryService.recordTaskUpdate);
taskRuntime.on('task-update', reportActivityProgress);
const appPreferencesService = new AppPreferencesService(
  new FileAppPreferencesStore(
    path.join(app.getPath('userData'), 'app-preferences.json'),
  ),
);
const classroomPetService = new ClassroomPetService({
  sessionService: classroomSessionService,
  preferencesService: appPreferencesService,
  canPresent: canPresentClassroomPetNudge,
  present: showClassroomPetNudge,
  dismiss: hideClassroomPetNudge,
});
const taskPetService = new TaskPetService({
  preferencesService: appPreferencesService,
  canPresent: canPresentTaskPetNudge,
  present: showTaskPetNudge,
  dismiss: hideTaskPetNudge,
});
const workspaceSelectionService = new WorkspaceSelectionService(
  {
    pickDirectory: async () => {
      const options: OpenDialogOptions = {
        properties: ['openDirectory'],
        title: 'Select a Workspace folder',
      };
      const window = mainWindow;
      const result = window && !window.isDestroyed()
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
  },
  undefined,
  new EncryptedWorkspaceSelectionStore(),
);
const fileSelectionService = new FileSelectionService({
  pick: async (selectionKind) => {
    const options: OpenDialogOptions = selectionKind === 'folder'
      ? { properties: ['openDirectory'], title: 'Select a Knowledge Space folder snapshot' }
      : {
          properties: ['openFile', 'multiSelections'],
          title: 'Select Knowledge Space files',
          filters: [{
            name: 'Supported content',
            extensions: [
              'txt', 'md', 'markdown', 'pdf', 'c', 'cc', 'cpp', 'cs', 'css',
              'csv', 'go', 'h', 'hpp', 'html', 'ini', 'java', 'js', 'json',
              'jsx', 'kt', 'mjs', 'py', 'rb', 'rs', 'sh', 'sql', 'toml',
              'ts', 'tsx', 'xml', 'yaml', 'yml',
            ],
          }],
        };
    const window = mainWindow;
    const result = window && !window.isDestroyed()
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  },
});
const knowledgeUploadOrchestrator = new KnowledgeUploadOrchestrator(
  fileSelectionService,
  knowledgeSpaceClient,
);
const activityWorkspacePreparationService = new ActivityWorkspacePreparationService(
  knowledgeSpaceClient,
  workspaceSelectionService,
);
const systemAudioDuckingService = createSystemAudioDuckingService();
const voiceCredentialStore = new EncryptedVoiceCredentialStore();
const voiceService = new VoiceService({
  accessTokenProvider: () => authService.getAccessToken(),
  apiBaseUrl: trocodeApiBaseUrl,
  credentialStore: voiceCredentialStore,
  preferencesService: appPreferencesService,
  rustEngine: rustDesktopEngine,
});
const elevenLabsTtsService = new ElevenLabsTtsService({
  accessTokenProvider: () => authService.getAccessToken(),
  apiBaseUrl: trocodeApiBaseUrl,
});
const companionNarrationService = new CompanionNarrationService({
  publish: publishCompanionSpeech,
  ttsService: elevenLabsTtsService,
});
const cursorBuddyController = new CursorBuddyController({
  animationSettings: () =>
    process.platform === 'darwin' || process.platform === 'win32'
      ? systemPreferences.getAnimationSettings()
      : { prefersReducedMotion: false, shouldRenderRichAnimation: true },
  calloutSize: { height: 160, width: 320 },
  canPresent: () => auxiliaryWindowsEnabled && !activeCompanionInteraction,
  canShowThinking: () =>
    auxiliaryWindowsEnabled &&
    !activeCompanionInteraction &&
    !activeCompanionGuidance &&
    !activeCompanionResponse,
  clearTimer: clearTimeout,
  cursorSize: { height: 44, width: 44 },
  getDisplayBounds: (point) => screen.getDisplayNearestPoint(point).bounds,
  getUserCursor: () => screen.getCursorScreenPoint(),
  hideCallout: hideGuidanceCallout,
  hideHighlight: hideGuidanceTargetMarker,
  log: (event, metadata) => console.info(`[cursor-buddy] ${event}`, metadata),
  moveCallout: moveCursorBuddyCallout,
  now: Date.now,
  publishSnapshot: publishCursorBuddySnapshot,
  setCursorPosition: applyCursorBuddyScreenPosition,
  setTimer: setTimeout,
  showCallout: showCursorBuddyCallout,
  showHighlight: showGuidanceTargetMarker,
  speak: (text, signal, taskId) =>
    companionNarrationService.begin(text, signal, taskId),
  toRendererPosition: toCursorBuddyRendererPosition,
});
const executionCoordinator = new TaskExecutionCoordinator({
  additionalToolAdapters: [
    ...createActivityToolAdapters(knowledgeSpaceClient),
    ...createClassroomToolAdapters(
      teacherClassroomContextService,
      classroomBroadcastDraftService,
    ),
    ...createWorkspaceRuntimeToolAdapters(),
    {
      id: 'task.interaction',
      execute: async (invocation, context) => {
        const input = invocation.input as InteractionToolInput;
        const answer = await requestLocalInteraction(context.taskId, input);
        return {
          status: 'confirmed' as const,
          summary: 'The user answered the clarification.',
          data: { answer },
        };
      },
    },
  ],
  applicationSurfaceVerifier: new ApplicationSurfaceVerifier({
    queryVisibleApplicationSurfaces: (application, signal) =>
      cuaService.queryVisibleApplicationSurfaces(application, signal),
  }),
  cua: cuaService,
  openApplication: (application) =>
    desktopApplicationLauncher.launch(application),
  onDesktopControlChange: updateDesktopControlIndicator,
  openExternal: async (url) => shell.openExternal(url, { activate: true }),
  prepareDesktopObservation,
});
const observeForCoach = async (taskId: string, signal: AbortSignal) => {
  const cleanup = await prepareDesktopObservation();
  try {
    return await cuaService.observe(taskId, signal);
  } finally {
    await cleanup();
  }
};
const coachDecisionClient = createAuthenticatedCoachDecisionClient({
  accessTokenProvider: async () => {
    const token = await authService.getAccessToken();
    if (!token) throw new Error('Sign in before starting Tro Coach.');
    return token;
  },
  apiBaseUrl: trocodeApiBaseUrl,
});
const coachRuntime: CoachRuntime = new CoachRuntime({
  ...coachDecisionClient,
  workChecks: workCheckContextService,
  onWorkCheck: (taskId, result) => { taskRuntime.updateWorkCheck(taskId, result); },
  startObservationSession: (taskId, signal) =>
    cuaService.startTaskSession(taskId, signal),
  releaseObservationSession: (taskId) => {
    void cuaService.endTaskSession(taskId).catch((error: unknown) => {
      console.error('[coach] CUA session cleanup failed.', error);
    });
  },
  observe: observeForCoach,
  explanation: {
    screenPermitted: async () => {
      const status = await cuaService.getStatus();
      return canObserveClassroomExplanation(status);
    },
    beforeRound: (taskId, signal) =>
      classroomGuidanceCoordinator.beforeRound(taskId, signal),
    consume: (taskId, kind, requestId) =>
      classroomGuidanceCoordinator.consume(taskId, kind, requestId),
    awaitContinuation: (taskId, text, signal) =>
      classroomGuidanceCoordinator.awaitContinuation(taskId, text, signal),
    observe: async (taskId, signal) => {
      const cleanup = await prepareDesktopObservation();
      try {
        return (
          (await cuaService.observeCurrentSurface(taskId, {}, signal)) ??
          (await cuaService.observe(taskId, signal))
        );
      } finally {
        await cleanup();
      }
    },
  },
  onProgress: (taskId, progress) => {
    taskRuntime.updateCoachProgress(taskId, progress);
  },
  onStatus: (taskId, phase, summary) => {
    taskRuntime.applyCoachStatus(taskId, phase, summary);
    classroomGuidanceCoordinator.onStatus(taskId, phase, summary);
    agentActivityService.publish(taskId, { kind: 'status', summary });
  },
  onTerminal: (taskId, terminal) => {
    taskRuntime.complete(taskId, terminal);
    void classroomGuidanceCoordinator.onTerminal(taskId, terminal);
    agentActivityService.publish(taskId, {
      kind: terminal.status === 'completed' ? 'run_completed' : 'run_failed',
      summary: terminal.finalOutput ?? terminal.message,
    });
    taskApplicationService.finish(taskId);
  },
  presenter: cursorBuddyController,
});
const localAgentRuntime = new LocalAgentRuntime({
  accessTokenProvider: async () => {
    const token = await authService.getAccessToken();
    if (!token) throw new Error('Sign in before starting the local agent.');
    return token;
  },
  apiBaseUrl: trocodeApiBaseUrl,
  coordinator: executionCoordinator,
  isPackaged: app.isPackaged,
  repositoryRoot,
  resourcesPath: process.resourcesPath,
  state: localAgentStateStore,
  tools: runtimeToolRegistry,
  onEvent: (message) => {
    taskRuntime.applyRuntimeEvent(
      message.threadId,
      message.event,
      message.summary,
      message.data,
    );
    if (message.event === 'assistant_delta') {
      agentActivityService.publish(message.threadId, {
        kind: 'text_delta',
        textDelta: message.summary,
      });
    } else if (message.event === 'tool_requested' || message.event === 'tool_started') {
      agentActivityService.publish(message.threadId, {
        kind: 'tool_started',
        summary: message.summary,
        tool: {
          name: typeof message.data?.toolId === 'string' ? message.data.toolId : 'local_tool',
          status: 'running',
        },
      });
    } else if (message.event === 'tool_completed' || message.event === 'tool_failed' || message.event === 'tool_unknown') {
      agentActivityService.publish(message.threadId, {
        kind: 'tool_completed',
        summary: message.summary,
        tool: {
          name: typeof message.data?.toolId === 'string' ? message.data.toolId : 'local_tool',
          status: message.event === 'tool_completed' ? 'completed' : 'failed',
        },
      });
    } else {
      agentActivityService.publish(message.threadId, {
        kind: message.event === 'lifecycle' ? 'run_started' : 'status',
        summary: message.summary,
      });
    }
  },
  onTerminal: (terminal) => {
    taskRuntime.complete(terminal.threadId, terminal);
    agentActivityService.publish(terminal.threadId, {
      kind: terminal.status === 'completed' ? 'run_completed' : 'run_failed',
      summary: terminal.finalOutput ?? terminal.message,
    });
    taskApplicationService.finish(terminal.threadId);
  },
});
const taskApplicationService: TaskApplicationService = new TaskApplicationService(
  taskRuntime,
  {
    activityContextService,
    workChecks: workCheckContextService,
    activityProgressReporter,
    classroomSessionService,
    coachRuntime,
  teacherClassroomContext: teacherClassroomContextService,
  broadcastDrafts: classroomBroadcastDraftService,
  onTaskCancelled: (taskId) =>
    classroomGuidanceCoordinator.onTaskCancelled(taskId),
    currentOwnerId: async () => (await authService.assertSignedIn()).id,
    localRuntime: localAgentRuntime,
    state: localAgentStateStore,
    workspaceSelectionService,
  });
const assignmentCheckController = new AssignmentCheckController({
  language: async () => (await appPreferencesService.get()).appLanguage,
  owner: async () => (await authService.assertSignedIn()).id,
  session: classroomSessionService, client: knowledgeSpaceClient, tasks: taskApplicationService,
  workspaces: workspaceSelectionService, files: fileSelectionService,
  uploads: knowledgeUploadOrchestrator,
  present: (card) => { companionResponseController.setCard(card); showCompanionResponseCard(card); },
  dismiss: () => clearCompanionResponse(),
});
let unregisterWorkCheckShortcut: (() => void) | null = null;
let workCheckBindingKey: string | null = null;
function synchronizeWorkCheckShortcut(): void {
  const session = classroomSessionService.get();
  const eligible = auxiliaryWindowsEnabled && session?.role === 'student' && !session.leftAt && session.run.state === 'open' && ['assigned','in_progress','blocked'].includes(session.attemptState);
  if (!eligible) {
    unregisterWorkCheckShortcut?.();
    unregisterWorkCheckShortcut = null;
    workCheckBindingKey = null;
    if (!session || session.leftAt || session.run.state !== 'open' || !auxiliaryWindowsEnabled) {
      assignmentCheckController.clear();
      if (activeCompanionResponse?.workCheck) clearCompanionResponse();
    }
    return;
  }
  const key = `${session.attemptId}:${session.activityVersionId}`;
  const changed = key !== workCheckBindingKey;
  if (changed) {
    assignmentCheckController.clear();
    workCheckBindingKey = key;
  }
  let shortcutMessage: string | undefined;
  if (!unregisterWorkCheckShortcut) {
    unregisterWorkCheckShortcut = registerGlobalWorkCheckShortcut({
      registry: globalShortcut,
      check: () => assignmentCheckController.check(),
      unavailable: () => { shortcutMessage = 'Check shortcut unavailable. Use Check my work here.'; },
    });
  }
  if (changed || shortcutMessage) void assignmentCheckController.show(shortcutMessage);
}
classroomSessionService.onChange(() => synchronizeWorkCheckShortcut());
taskRuntime.on('task-update', (value: unknown) => {assignmentCheckController.update(TaskUpdateSchema.parse(value).snapshot);});
const classroomGuidanceCoordinator: ClassroomGuidanceCoordinator = new ClassroomGuidanceCoordinator({
  broadcasts: classroomBroadcastService,
  client: knowledgeSpaceClient,
  tasks: taskApplicationService,
  activity: activityContextService,
  store: localAgentStateStore,
  owner: async () => (await authService.assertSignedIn()).id,
  screenPermitted: async () => {
    const status = await cuaService.getStatus();
    return canObserveClassroomExplanation(status);
  },
  language: async () => (await appPreferencesService.get()).appLanguage,
  onExplanationText: (taskId, text) => {
    taskRuntime.appendCoachExplanation(taskId, text);
  },
});
classroomGuidanceCoordinator.start();
const computerPermissionCoordinator = new ComputerPermissionCoordinator({
  connectIfPermitted: () => cuaService.connectIfPermitted(),
  getStatus: () => cuaService.getStatus(),
  openSystemPermissionSettings: async (permission) =>
    shell.openExternal(systemPermissionSettingsUrl(permission), {
      activate: true,
    }),
});
const presentationCoordinator = new PresentationCoordinator(
  new ElectronPresentationPresenter(
    updateCompanionState,
    () => {
      if (mainWindow && !mainWindow.isDestroyed()) revealWindow(mainWindow);
    },
    resetCompanionPresentation,
    showCompanionInteraction,
    clearCompanionInteraction,
    shouldUseBackgroundCompanion,
    presentCompanionResponse,
  ),
);
const appUpdateService = new AppUpdateService({
  architecture: process.arch,
  currentVersion: app.getVersion(),
  isPackaged: app.isPackaged,
  managedByMicrosoftStore: () => process.windowsStore === true,
  platform: process.platform,
  prepareToInstall: prepareForUpdateInstall,
  repository: 'ducnguyen67201/TroCode',
  updater: autoUpdater,
  updatesEnabled: !TROCODE_IS_TEST_APP,
});
const COMPANION_SIZE = { height: 112, width: 112 } as const;
const COMPANION_WANDER_DURATION_MS = 3_200;
const COMPANION_WANDER_MIN_PAUSE_MS = 9_000;
const COMPANION_WANDER_PAUSE_RANGE_MS = 7_000;
const CURSOR_BUDDY_SIZE = { height: 44, width: 44 } as const;
const GUIDANCE_CALLOUT_SIZE = { height: 196, width: 380 } as const;
const CURSOR_BUDDY_COACH_CALLOUT_SIZE = { height: 160, width: 320 } as const;
const CURSOR_BUDDY_HOOK_CALLOUT_SIZE = { height: 106, width: 260 } as const;
const CURSOR_BUDDY_THINKING_CALLOUT_SIZE = { height: 94, width: 250 } as const;
const PET_NUDGE_CALLOUT_SIZE = { height: 92, width: 300 } as const;
const GUIDANCE_TARGET_MARKER_SIZE = { height: 76, width: 76 } as const;
const RESPONSE_CALLOUT_SIZE = { height: 360, width: 420 } as const;
const CLARIFICATION_CALLOUT_SIZE = { height: 286, width: 396 } as const;
const VOICE_ISLAND_SIZE = { height: 76, width: 420 } as const;
const VOICE_ISLAND_TOP_GAP = 10;
const CONTROL_INDICATOR_MIN_VISIBLE_MS = 400;
const CONTROL_INDICATOR_HIDE_SETTLE_MS = 80;
const DESKTOP_OBSERVATION_SETTLE_MS = 120;
const SHUTDOWN_GRACE_PERIOD_MS = 2_000;
const MAX_TRACKED_PRESENTATION_TASKS = 128;

interface CompanionWander {
  from: Point;
  startedAt: number;
  to: Point;
}

interface CompanionMotionActivity {
  nextFrameDelayMs: number | null;
}

let mainWindow: BrowserWindow | null = null;
let companionWindow: BrowserWindow | null = null;
let cursorBuddyWindow: BrowserWindow | null = null;
let desktopControlIndicatorWindow: BrowserWindow | null = null;
let guidanceWindow: BrowserWindow | null = null;
let guidanceTargetWindow: BrowserWindow | null = null;
let voiceIslandWindow: BrowserWindow | null = null;
let companionState: CompanionState = 'idle';
let activeCompanionVoiceActivity: CompanionVoiceActivity | null = null;
const activeDesktopControlTasks = new Set<string>();
const desktopControlStartedAt = new Map<string, number>();
let companionMovementTimer: ReturnType<typeof setTimeout> | null = null;
let companionWanderTimer: ReturnType<typeof setTimeout> | null = null;
let companionWander: CompanionWander | null = null;
let companionUserPosition: Point | null = null;
let activeGuidanceTargetBounds: Rectangle | null = null;
let activeCompanionGuidance: CompanionGuidance | null = null;
let activeCompanionInteraction: CompanionInteraction | null = null;
let activeCompanionPetNudge: CompanionPetNudge | null = null;
let activeCompanionPetNudgeOwner: 'classroom' | 'task' | null = null;
let activeCompanionResponse: CompanionResponseCard | null = null;
let activeCompanionSpeech: CompanionSpeech | null = null;
let activeCompanionAppearance: CompanionAppearance = { kind: 'default' };
let lastCompanionPosition: Point | null = null;
let lastCursorBuddySnapshot: CursorBuddySnapshot | null = null;
let forcedExitTimer: ReturnType<typeof setTimeout> | null = null;
let shutdownPromise: Promise<void> | null = null;
let unregisterAppPreferencesChange: (() => void) | null = null;
let unregisterIpcHandlers: (() => void) | null = null;
let unregisterGlobalVoiceModeToggleShortcut: (() => void) | null = null;
let unregisterGlobalVoiceShortcut: (() => void) | null = null;
let globalNumberedChoiceShortcuts: GlobalNumberedChoiceShortcuts | null = null;
let removeMainWindowCloseBehavior: (() => void) | null = null;
let backgroundTray: Tray | null = null;
let backgroundTrayVoiceMode: VoiceMode = 'dictation';
let isShuttingDown = false;
let auxiliaryWindowsEnabled = false;
let companionPetEnabled = true;
let activeCompanionHover = false;
let desktopObservationGuard: DesktopObservationGuard | null = null;
const knownPresentationTaskIds = new Set<string>();
const backgroundPresentationTaskIds = new Set<string>();
let backgroundCompletionNarration: AbortController | null = null;

function prepareDesktopObservation(): Promise<() => Promise<void>> {
  desktopObservationGuard ??= new DesktopObservationGuard({
    settle: () => new Promise((resolve) => {
      setTimeout(resolve, DESKTOP_OBSERVATION_SETTLE_MS);
    }),
    surfaces: [
      { getWindow: () => mainWindow, shouldRestore: () => false },
      {
        getWindow: () => voiceIslandWindow,
        shouldRestore: () =>
          auxiliaryWindowsEnabled && activeCompanionVoiceActivity !== null,
      },
      {
        getWindow: () => companionWindow,
        shouldRestore: () => auxiliaryWindowsEnabled && companionPetEnabled,
      },
      {
        getWindow: () => cursorBuddyWindow,
        shouldRestore: () => auxiliaryWindowsEnabled,
      },
      {
        getWindow: () => guidanceWindow,
        shouldRestore: () =>
          cursorBuddyController.hasActiveGuidance &&
          activeCompanionGuidance !== null,
        restoreIdentity: () => cursorBuddyController.activeSessionTaskId,
      },
      {
        getWindow: () => guidanceTargetWindow,
        shouldRestore: () =>
          cursorBuddyController.hasActiveGuidance &&
          activeGuidanceTargetBounds !== null,
        restoreIdentity: () => cursorBuddyController.activeSessionTaskId,
      },
      {
        getWindow: () => desktopControlIndicatorWindow,
        shouldRestore: () =>
          auxiliaryWindowsEnabled && activeDesktopControlTasks.size > 0,
      },
    ],
  });
  return desktopObservationGuard.prepare();
}

const companionCustomizationService = new CompanionCustomizationService({
  accessTokenProvider: () => authService.getAccessToken(),
  apiBaseUrl: trocodeApiBaseUrl,
  nativeImage,
  publish: (appearance) => {
    activeCompanionAppearance = appearance;
    sendCompanionAppearance();
  },
  safeStorage,
  userDataPath: app.getPath('userData'),
});
const companionHoverTracker = new CompanionHoverTracker({
  getCompanionBounds: () => {
    if (!companionWindow || companionWindow.isDestroyed()) return null;
    return { ...getCurrentCompanionScreenPosition(), ...COMPANION_SIZE };
  },
  getCursorPoint: () => screen.getCursorScreenPoint(),
  isEligible: () =>
    auxiliaryWindowsEnabled &&
    companionPetEnabled &&
    companionState === 'idle' &&
    Boolean(
      companionWindow &&
        !companionWindow.isDestroyed() &&
        companionWindow.isVisible(),
    ),
  onEnter: pauseCompanionWanderingForHover,
  onLeave: scheduleCompanionWander,
  platform: process.platform,
  publish: updateCompanionHover,
  sessionType: process.env.XDG_SESSION_TYPE,
});

function stopCompanionMovement(): void {
  if (companionMovementTimer) clearTimeout(companionMovementTimer);
  if (companionWanderTimer) clearTimeout(companionWanderTimer);
  companionMovementTimer = null;
  companionWanderTimer = null;
  companionWander = null;
  lastCompanionPosition = null;
}

function stopCursorBuddyFollowing(): void {
  cursorBuddyController.stop();
  lastCursorBuddySnapshot = null;
}

function sendCompanionState(): void {
  broadcastCompanionState(companionState, [companionWindow]);
}

function sendCompanionHover(): void {
  if (!companionWindow || companionWindow.isDestroyed()) return;
  companionWindow.webContents.send(
    IPC_CHANNELS.companionHoverChanged,
    CompanionHoverSchema.parse(activeCompanionHover),
  );
}

function updateCompanionHover(hovered: boolean): void {
  activeCompanionHover = CompanionHoverSchema.parse(hovered);
  sendCompanionHover();
}

function interruptPetNudges(): void {
  classroomPetService.interrupt();
  taskPetService.interrupt();
}

function sendCompanionAppearance(): void {
  if (!companionWindow || companionWindow.isDestroyed()) return;
  companionWindow.webContents.send(
    IPC_CHANNELS.companionAppearanceChanged,
    activeCompanionAppearance,
  );
}

function updateCompanionState(state: CompanionState): void {
  if (state !== 'idle') interruptPetNudges();
  if (state !== 'idle') pauseCompanionWandering();
  companionState = state;
  cursorBuddyController.handleWorkState(
    state,
    activeCompanionVoiceActivity?.appLanguage ?? 'en',
  );
  sendCompanionState();
  companionHoverTracker.synchronizeEligibility();
  if (state === 'idle') scheduleCompanionWander();
}

function sendCompanionVoiceActivity(): void {
  if (!voiceIslandWindow || voiceIslandWindow.isDestroyed()) return;
  voiceIslandWindow.webContents.send(
    IPC_CHANNELS.companionVoiceActivityChanged,
    activeCompanionVoiceActivity,
  );
}

function updateCompanionVoiceActivity(
  activity: CompanionVoiceActivity | null,
): void {
  if (activity) interruptPetNudges();
  activeCompanionVoiceActivity = activity;
  cursorBuddyController.handleActivity(activity);
  if (
    !activity ||
    (activity.phase !== 'processing' && activity.phase !== 'committing')
  ) {
    cursorBuddyController.handleWorkState(
      companionState,
      activity?.appLanguage ?? 'en',
    );
  }
  presentationCoordinator.handleVoiceActivity(activity);
  if (!auxiliaryWindowsEnabled) return;
  if (!activity) {
    if (voiceIslandWindow && !voiceIslandWindow.isDestroyed()) {
      sendCompanionVoiceActivity();
      voiceIslandWindow.hide();
    }
    return;
  }
  if (!voiceIslandWindow || voiceIslandWindow.isDestroyed()) {
    createVoiceIslandWindow();
    return;
  }

  sendCompanionVoiceActivity();
  positionVoiceIsland();
  voiceIslandWindow.showInactive();
}

function boundsEqual(left: Rectangle, right: Rectangle): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

function pointEqual(left: Point | null, right: Point): boolean {
  return left?.x === right.x && left.y === right.y;
}

function getCompanionOverlayBounds(): Rectangle {
  return getVirtualDisplayBounds(
    screen.getAllDisplays().map((display) => display.bounds),
  );
}

async function updateDesktopControlIndicator(
  taskId: string,
  active: boolean,
): Promise<void> {
  if (active) {
    activeDesktopControlTasks.add(taskId);
    desktopControlStartedAt.set(taskId, Date.now());
    createDesktopControlIndicatorWindow();
    if (
      desktopControlIndicatorWindow &&
      !desktopControlIndicatorWindow.isDestroyed()
    ) {
      desktopControlIndicatorWindow.setBounds(getCompanionOverlayBounds(), false);
      desktopControlIndicatorWindow.showInactive();
      sendCompanionGuidanceVisual();
    }
    return;
  }

  const startedAt = desktopControlStartedAt.get(taskId);
  const remainingVisibleMs = startedAt
    ? Math.max(0, CONTROL_INDICATOR_MIN_VISIBLE_MS - (Date.now() - startedAt))
    : 0;
  if (remainingVisibleMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, remainingVisibleMs));
  }
  desktopControlStartedAt.delete(taskId);
  activeDesktopControlTasks.delete(taskId);
  if (activeDesktopControlTasks.size > 0) return;
  if (
    desktopControlIndicatorWindow &&
    !desktopControlIndicatorWindow.isDestroyed()
  ) {
    desktopControlIndicatorWindow.hide();
  }
  await new Promise<void>((resolve) =>
    setTimeout(resolve, CONTROL_INDICATOR_HIDE_SETTLE_MS),
  );
}

function sendCompanionPosition(position: Point): void {
  if (!companionWindow || companionWindow.isDestroyed()) return;
  if (pointEqual(lastCompanionPosition, position)) return;

  lastCompanionPosition = position;
  companionWindow.webContents.send(
    IPC_CHANNELS.companionPositionChanged,
    position,
  );
}

function resetCompanionPresentation(): void {
  dismissCompanionGuidance();
  positionCompanion();
  scheduleCompanionWander();
}

function hideGuidanceTargetMarker(): void {
  activeGuidanceTargetBounds = null;
  sendCompanionGuidanceVisual();
  if (guidanceTargetWindow && !guidanceTargetWindow.isDestroyed()) {
    guidanceTargetWindow.hide();
  }
}

function sendCompanionGuidanceVisual(companionPosition?: Point): void {
  if (
    !desktopControlIndicatorWindow ||
    desktopControlIndicatorWindow.isDestroyed()
  ) {
    return;
  }
  if (!activeGuidanceTargetBounds) {
    desktopControlIndicatorWindow.webContents.send(
      IPC_CHANNELS.companionGuidanceVisualChanged,
      null,
    );
    return;
  }

  const overlay = getCompanionOverlayBounds();
  const position = companionPosition ?? getCurrentCompanionScreenPosition();
  const visual = CompanionGuidanceVisualSchema.parse({
    companion: {
      x: Math.max(
        0,
        Math.round(position.x - overlay.x + COMPANION_SIZE.width / 2),
      ),
      y: Math.max(
        0,
        Math.round(position.y - overlay.y + COMPANION_SIZE.height / 2),
      ),
    },
    moving: false,
    target: {
      height: activeGuidanceTargetBounds.height,
      width: activeGuidanceTargetBounds.width,
      x: Math.max(
        0,
        Math.round(activeGuidanceTargetBounds.x - overlay.x),
      ),
      y: Math.max(
        0,
        Math.round(activeGuidanceTargetBounds.y - overlay.y),
      ),
    },
  });
  desktopControlIndicatorWindow.webContents.send(
    IPC_CHANNELS.companionGuidanceVisualChanged,
    visual,
  );
}

function showGuidanceTargetMarker(
  target: Point,
  region?: Rectangle,
): boolean {
  if (!prepareGuidanceTargetMarker(target, region)) return false;
  guidanceTargetWindow?.showInactive();
  return true;
}

function prepareGuidanceTargetMarker(
  target: Point,
  region?: Rectangle,
): boolean {
  if (!auxiliaryWindowsEnabled) return false;
  if (!guidanceTargetWindow || guidanceTargetWindow.isDestroyed()) {
    createGuidanceTargetWindow();
  }
  if (!guidanceTargetWindow || guidanceTargetWindow.isDestroyed()) return false;

  const display = screen.getDisplayNearestPoint(target);
  activeGuidanceTargetBounds = placeGuidanceTargetMarker(
    target,
    region,
    display.bounds,
  );
  guidanceTargetWindow.hide();
  guidanceTargetWindow.setBounds(activeGuidanceTargetBounds, false);
  sendCompanionGuidanceVisual();
  return true;
}

function sendCompanionGuidance(): void {
  if (!guidanceWindow || guidanceWindow.isDestroyed()) return;
  guidanceWindow.webContents.send(
    IPC_CHANNELS.companionGuidanceChanged,
    activeCompanionGuidance,
  );
}

function sendCompanionInteraction(): void {
  if (!guidanceWindow || guidanceWindow.isDestroyed()) return;
  guidanceWindow.webContents.send(
    IPC_CHANNELS.companionInteractionChanged,
    activeCompanionInteraction,
  );
}

function sendCompanionPetNudge(): void {
  if (guidanceWindow && !guidanceWindow.isDestroyed()) {
    guidanceWindow.webContents.send(
      IPC_CHANNELS.companionPetNudgeChanged,
      activeCompanionPetNudge,
    );
  }
  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.webContents.send(
      IPC_CHANNELS.companionPetNudgeChanged,
      activeCompanionPetNudge,
    );
  }
}

function sendCompanionResponse(): void {
  if (!guidanceWindow || guidanceWindow.isDestroyed()) return;
  guidanceWindow.webContents.send(
    IPC_CHANNELS.companionResponseChanged,
    activeCompanionResponse,
  );
}

function sendCompanionSpeech(): void {
  if (!guidanceWindow || guidanceWindow.isDestroyed()) return;
  guidanceWindow.webContents.send(
    IPC_CHANNELS.companionSpeechChanged,
    activeCompanionSpeech,
  );
}

function publishCompanionSpeech(speech: CompanionSpeech | null): void {
  activeCompanionSpeech = speech;
  sendCompanionSpeech();
}

function stopGuidanceSpeech(): void {
  companionNarrationService.cancelCurrent();
}

function registerCompanionAudioProtocol(): void {
  protocol.handle(TROCODE_AUDIO_SCHEME, (request) =>
    companionNarrationService.handleRequest(request),
  );
}

function registerCompanionImageProtocol(): void {
  protocol.handle(TROCODE_COMPANION_SCHEME, (request) =>
    companionCustomizationService.handleRequest(request),
  );
}

function setGuidanceWindowInteractive(interactive: boolean): void {
  if (!guidanceWindow || guidanceWindow.isDestroyed()) return;
  guidanceWindow.setFocusable(interactive);
  guidanceWindow.setIgnoreMouseEvents(!interactive, { forward: true });
}

function currentCompanionOverlayMode() {
  return selectCompanionOverlayMode({
    activity: companionState === 'idle' ? null : companionState,
    guidance: activeCompanionGuidance,
    interaction: activeCompanionInteraction,
    petNudge: activeCompanionPetNudge,
    response: activeCompanionResponse,
  });
}

function canPresentClassroomPetNudge(): boolean {
  return (
    auxiliaryWindowsEnabled &&
    companionPetEnabled &&
    companionState === 'idle' &&
    !activeCompanionPetNudge &&
    selectCompanionOverlayMode({
      guidance: activeCompanionGuidance,
      interaction: activeCompanionInteraction,
      response: activeCompanionResponse,
    }) === 'hidden'
  );
}

function canPresentTaskPetNudge(): boolean {
  return (
    auxiliaryWindowsEnabled &&
    companionPetEnabled &&
    (companionState === 'processing' || companionState === 'working') &&
    !activeCompanionPetNudge &&
    selectCompanionOverlayMode({
      guidance: activeCompanionGuidance,
      interaction: activeCompanionInteraction,
      response: activeCompanionResponse,
    }) === 'hidden'
  );
}

function showCompanionPetNudge(
  draft: CompanionPetNudgeDraft,
  owner: 'classroom' | 'task',
): boolean {
  const canPresent = owner === 'classroom'
    ? canPresentClassroomPetNudge()
    : canPresentTaskPetNudge();
  if (!canPresent) return false;
  if (!guidanceWindow || guidanceWindow.isDestroyed()) createGuidanceWindow();
  if (!guidanceWindow || guidanceWindow.isDestroyed()) return false;

  const target = getCurrentCompanionScreenPosition();
  const display = screen.getDisplayNearestPoint(target);
  const position = placeGuidanceCallout(
    target,
    display.workArea,
    PET_NUDGE_CALLOUT_SIZE,
    COMPANION_SIZE,
  );
  const parsed = CompanionPetNudgeSchema.safeParse({
    ...draft,
    side: position.x < target.x ? 'left' : 'right',
  });
  if (!parsed.success) return false;

  activeCompanionPetNudge = parsed.data;
  activeCompanionPetNudgeOwner = owner;
  globalNumberedChoiceShortcuts?.deactivate();
  setGuidanceWindowInteractive(false);
  guidanceWindow.setBounds({ ...position, ...PET_NUDGE_CALLOUT_SIZE }, false);
  sendCompanionPetNudge();
  guidanceWindow.showInactive();
  return true;
}

function showClassroomPetNudge(draft: CompanionPetNudgeDraft): boolean {
  return showCompanionPetNudge(draft, 'classroom');
}

function showTaskPetNudge(draft: CompanionPetNudgeDraft): boolean {
  return showCompanionPetNudge(draft, 'task');
}

function hideCompanionPetNudge(
  id: string | undefined,
  owner: 'classroom' | 'task',
): void {
  if (
    !activeCompanionPetNudge ||
    activeCompanionPetNudgeOwner !== owner ||
    (id && activeCompanionPetNudge.id !== id)
  ) {
    return;
  }
  activeCompanionPetNudge = null;
  activeCompanionPetNudgeOwner = null;
  sendCompanionPetNudge();
  if (
    currentCompanionOverlayMode() === 'hidden' &&
    guidanceWindow &&
    !guidanceWindow.isDestroyed()
  ) {
    globalNumberedChoiceShortcuts?.deactivate();
    setGuidanceWindowInteractive(false);
    guidanceWindow.hide();
  }
}

function hideClassroomPetNudge(id?: string): void {
  hideCompanionPetNudge(id, 'classroom');
}

function hideTaskPetNudge(id?: string): void {
  hideCompanionPetNudge(id, 'task');
}

function showCompanionResponseCard(
  response: CompanionResponseCard | null = companionResponseController.current,
): boolean {
  if (!auxiliaryWindowsEnabled || !response) return false;
  interruptPetNudges();
  if (!guidanceWindow || guidanceWindow.isDestroyed()) createGuidanceWindow();
  if (!guidanceWindow || guidanceWindow.isDestroyed()) return false;

  const target = getCurrentCompanionScreenPosition();
  const display = screen.getDisplayNearestPoint(target);
  const position = placeGuidanceCallout(
    target,
    display.workArea,
    RESPONSE_CALLOUT_SIZE,
    COMPANION_SIZE,
  );
  activeCompanionResponse = CompanionResponseCardSchema.parse({
    ...response,
    side: position.x < target.x ? 'left' : 'right',
  });
  sendCompanionResponse();

  if (currentCompanionOverlayMode() !== 'response') return true;
  if (activeCompanionGuidance?.kind !== 'action_preview') {
    hideGuidanceTargetMarker();
  }
  guidanceWindow.setBounds({ ...position, ...RESPONSE_CALLOUT_SIZE }, false);
  setGuidanceWindowInteractive(response.phase === 'completed');
  if (response.phase === 'completed') {
    activateGlobalCompanionResponseShortcuts(activeCompanionResponse);
  } else {
    globalNumberedChoiceShortcuts?.deactivate();
  }
  guidanceWindow.showInactive();
  return true;
}

function latestTaskAnswer(task: TaskSnapshot): string | null {
  for (let index = task.messages.length - 1; index >= 0; index -= 1) {
    const message = task.messages[index];
    if (message?.role === 'assistant' && message.kind === 'answer') {
      const answer = message.text.trim();
      return answer ? answer.slice(0, 240) : null;
    }
  }
  return null;
}

function showWalkthroughRecap(task: TaskSnapshot): boolean {
  const message = latestTaskAnswer(task);
  if (
    !auxiliaryWindowsEnabled ||
    !message ||
    activeCompanionInteraction
  ) {
    return false;
  }
  interruptPetNudges();
  if (!guidanceWindow || guidanceWindow.isDestroyed()) createGuidanceWindow();
  if (!guidanceWindow || guidanceWindow.isDestroyed()) return false;

  hideGuidanceTargetMarker();
  activeCompanionResponse = null;
  sendCompanionResponse();
  const target = getCurrentCompanionScreenPosition();
  const display = screen.getDisplayNearestPoint(target);
  const position = placeGuidanceCallout(
    target,
    display.workArea,
    GUIDANCE_CALLOUT_SIZE,
    COMPANION_SIZE,
  );
  activeCompanionGuidance = CompanionGuidanceSchema.parse({
    kind: 'result',
    message,
    playback: 'playing',
    side: position.x < target.x ? 'left' : 'right',
  });
  globalNumberedChoiceShortcuts?.deactivate();
  guidanceWindow.setBounds({ ...position, ...GUIDANCE_CALLOUT_SIZE }, false);
  setGuidanceWindowInteractive(false);
  sendCompanionGuidance();
  guidanceWindow.showInactive();
  return true;
}

function clearCompanionResponse(): void {
  assignmentCheckController.dismiss();
  const response = companionResponseController.current;
  if (response) {
    companionResponseController.dismiss(response.cardId, response.taskId);
  }
  activeCompanionResponse = null;
  sendCompanionResponse();
  if (
    !activeCompanionInteraction &&
    !activeCompanionGuidance &&
    !activeCompanionPetNudge &&
    guidanceWindow &&
    !guidanceWindow.isDestroyed()
  ) {
    globalNumberedChoiceShortcuts?.deactivate();
    setGuidanceWindowInteractive(false);
    guidanceWindow.hide();
  }
}

function syncCompanionResponse(
  response: CompanionResponseCard | null,
): void {
  if (response) {
    showCompanionResponseCard(response);
    return;
  }
  activeCompanionResponse = null;
  sendCompanionResponse();
  if (
    !activeCompanionInteraction &&
    !activeCompanionGuidance &&
    !activeCompanionPetNudge &&
    guidanceWindow &&
    !guidanceWindow.isDestroyed()
  ) {
    globalNumberedChoiceShortcuts?.deactivate();
    setGuidanceWindowInteractive(false);
    guidanceWindow.hide();
  }
}

function clearCompanionInteraction(taskId?: string): void {
  if (
    !activeCompanionInteraction ||
    (taskId && activeCompanionInteraction.taskId !== taskId)
  ) {
    return;
  }

  activeCompanionInteraction = null;
  sendCompanionInteraction();
  stopGuidanceSpeech();
  if (activeCompanionGuidance) {
    globalNumberedChoiceShortcuts?.deactivate();
    setGuidanceWindowInteractive(false);
  } else if (activeCompanionResponse) {
    showCompanionResponseCard(activeCompanionResponse);
  } else if (activeCompanionPetNudge) {
    return;
  } else if (guidanceWindow && !guidanceWindow.isDestroyed()) {
    globalNumberedChoiceShortcuts?.deactivate();
    setGuidanceWindowInteractive(false);
    guidanceWindow.hide();
  }
}

function showCompanionInteraction(interaction: PendingInteraction): void {
  if (!auxiliaryWindowsEnabled) return;
  if (activeCompanionInteraction?.id === interaction.id) return;

  interruptPetNudges();
  cancelBackgroundCompletionPresentation();
  cursorBuddyController.cancelGuidance();
  dismissCompanionGuidance();
  if (!guidanceWindow || guidanceWindow.isDestroyed()) createGuidanceWindow();
  if (!guidanceWindow || guidanceWindow.isDestroyed()) {
    if (mainWindow && !mainWindow.isDestroyed()) revealWindow(mainWindow);
    return;
  }

  const target = getCurrentCompanionScreenPosition();
  const display = screen.getDisplayNearestPoint(target);
  const size = CLARIFICATION_CALLOUT_SIZE;
  const position = placeGuidanceCallout(
    target,
    display.workArea,
    size,
    COMPANION_SIZE,
  );
  try {
    activeCompanionInteraction = toCompanionInteraction(
      interaction,
      position.x < target.x ? 'left' : 'right',
    );
  } catch (error) {
    console.error('[companion] Could not present pending interaction.', error);
    if (mainWindow && !mainWindow.isDestroyed()) revealWindow(mainWindow);
    return;
  }
  guidanceWindow.setBounds({ ...position, ...size }, false);
  setGuidanceWindowInteractive(true);
  activateGlobalCompanionInteractionShortcuts(activeCompanionInteraction);
  sendCompanionInteraction();
  guidanceWindow.showInactive();
}

function hideGuidanceCallout(): void {
  const hadGuidance = Boolean(activeCompanionGuidance);
  if (hadGuidance) hideGuidanceTargetMarker();
  if (!activeCompanionInteraction && hadGuidance) stopGuidanceSpeech();
  activeCompanionGuidance = null;
  sendCompanionGuidance();
  if (activeCompanionInteraction) return;
  if (activeCompanionResponse) {
    showCompanionResponseCard(activeCompanionResponse);
  } else if (activeCompanionPetNudge) {
    return;
  } else if (guidanceWindow && !guidanceWindow.isDestroyed()) {
    globalNumberedChoiceShortcuts?.deactivate();
    setGuidanceWindowInteractive(false);
    guidanceWindow.hide();
  }
}

function dismissCompanionGuidance(): void {
  hideGuidanceCallout();
}

function showCursorBuddyCallout(
  guidance: CompanionGuidance,
  anchor: Point,
  side: 'left' | 'right',
): boolean {
  if (
    !auxiliaryWindowsEnabled ||
    activeCompanionInteraction
  ) {
    return false;
  }
  interruptPetNudges();
  if (!guidanceWindow || guidanceWindow.isDestroyed()) {
    createGuidanceWindow();
  }
  if (!guidanceWindow || guidanceWindow.isDestroyed()) return false;

  const display = screen.getDisplayNearestPoint(anchor);
  const calloutSize = cursorBuddyCalloutSize(guidance);
  const position = placeCursorBuddyCallout(
    anchor,
    display.bounds,
    calloutSize,
    CURSOR_BUDDY_SIZE,
    side,
  );
  activeCompanionGuidance = CompanionGuidanceSchema.parse({ ...guidance, side });
  globalNumberedChoiceShortcuts?.deactivate();
  guidanceWindow.setBounds({ ...position, ...calloutSize }, false);
  setGuidanceWindowInteractive(false);
  sendCompanionGuidance();
  guidanceWindow.showInactive();
  return true;
}

function moveCursorBuddyCallout(
  anchor: Point,
  side: 'left' | 'right',
): void {
  if (!guidanceWindow || guidanceWindow.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(anchor);
  const calloutSize = cursorBuddyCalloutSize(activeCompanionGuidance);
  guidanceWindow.setBounds(
    {
      ...placeCursorBuddyCallout(
        anchor,
        display.bounds,
        calloutSize,
        CURSOR_BUDDY_SIZE,
        side,
      ),
      ...calloutSize,
    },
    false,
  );
}

function cursorBuddyCalloutSize(guidance: CompanionGuidance | null) {
  if (guidance?.kind === 'thinking') {
    return CURSOR_BUDDY_THINKING_CALLOUT_SIZE;
  }
  if (
    guidance?.coach &&
    guidance.phase === 'presenting' &&
    guidance.message === guidance.coach.hook
  ) {
    return CURSOR_BUDDY_HOOK_CALLOUT_SIZE;
  }
  return CURSOR_BUDDY_COACH_CALLOUT_SIZE;
}

async function identifyAnalyticsUser(user: AuthUser): Promise<void> {
  taskHistoryService.setCurrentOwner(user.id);
  await prepareLocalAgentRuntime();
  await analyticsService?.identifyUser({
    email: user.email,
    loginMethod: 'oauth',
    name: user.name,
    userId: user.id,
  });
}

async function prepareLocalAgentRuntime(): Promise<void> {
  await localAgentRuntime.initialize();
  if (!cuaDriverToolsRegistered) {
    const cuaCatalog = await cuaService.discoverToolCatalog().catch((error: unknown) => {
      console.error('[local-agent-runtime] CUA tool discovery failed.', error);
      return null;
    });
    if (cuaCatalog) {
      const definitions = createCuaDriverToolDefinitions(cuaCatalog);
      const admission = runtimeToolRegistry.inspectRegistration(definitions);
      const sdkValidation = await localAgentRuntime.validateToolCatalog(
        admission.accepted.map((definition) => ({
          toolId: definition.id,
          modelName: definition.modelName,
          description: definition.description,
          inputSchema: definition.parameters,
          operations: [...definition.operations],
          driverCatalogDigest: definition.driverCatalogDigest ?? null,
        })),
        cuaCatalog.driverCatalogDigest,
      );
      const sdkRejectedNames = new Set(
        sdkValidation.rejected.map((rejection) => rejection.modelName),
      );
      const acceptedDefinitions = admission.accepted.filter(
        (definition) => !sdkRejectedNames.has(definition.modelName),
      );
      const registrationFailures = [
        ...admission.rejected,
        ...sdkValidation.rejected,
      ].map((rejection) => {
        const definition = definitions.find(
          (candidate) => candidate.id === rejection.toolId,
        );
        return {
          name: definition?.operations[0] ?? rejection.modelName,
          message: rejection.message,
        };
      });
      cuaService.reportToolCatalogRegistrationFailures(registrationFailures);
      for (const rejection of admission.rejected) {
        console.warn(
          '[local-agent-runtime] CUA tool registration quarantined.',
          JSON.stringify(rejection),
        );
      }
      for (const rejection of sdkValidation.rejected) {
        console.warn(
          '[local-agent-runtime] CUA tool SDK validation quarantined.',
          JSON.stringify(rejection),
        );
      }
      if (cuaService.cuaToolCatalogReport()?.state !== 'unavailable') {
        runtimeToolRegistry.register(acceptedDefinitions);
      }
      cuaDriverToolsRegistered = true;
    }
  }
  await classroomGuidanceCoordinator.restore().catch(() => undefined);
  await taskApplicationService.restoreLocalTasks().catch((error: unknown) => {
    console.error('[local-agent-runtime] active task restoration failed.', error);
    return 0;
  });
}

async function requestLocalInteraction(
  taskId: string,
  input: { choices?: string[]; prompt: string },
): Promise<string> {
  const waiting = taskRuntime.requestInput({
    choices: input.choices?.map((label, index) => ({
      id: `choice-${index + 1}`,
      label,
    })),
    prompt: input.prompt,
    taskId,
  });
  const interactionId = waiting.pendingInteraction?.id;
  if (!interactionId) throw new Error('Could not create the clarification request.');

  return new Promise<string>((resolve, reject) => {
    const finish = (answer?: string, error?: Error): void => {
      clearTimeout(timer);
      taskRuntime.off('task-update', onUpdate);
      if (error) reject(error);
      else if (answer) resolve(answer);
      else reject(new Error('The clarification ended without an answer.'));
    };
    const onUpdate = (value: unknown): void => {
      const parsed = TaskUpdateSchema.safeParse(value);
      if (!parsed.success || parsed.data.snapshot.taskId !== taskId) return;
      const snapshot = parsed.data.snapshot;
      if (snapshot.pendingInteraction?.id === interactionId) return;
      const answer = [...snapshot.messages]
        .reverse()
        .find((message) => message.role === 'user' && message.kind === 'answer');
      finish(answer?.text);
    };
    const timer = setTimeout(
      () => finish(undefined, new Error('The clarification request expired.')),
      30 * 60_000,
    );
    taskRuntime.on('task-update', onUpdate);
  });
}

function enableAuthenticatedAuxiliaryWindows(): void {
  if (isShuttingDown) return;
  auxiliaryWindowsEnabled = true;
  taskPetService.start();
  createCompanionWindow();
  createCursorBuddyWindow();
  cursorBuddyController.start();
  companionHoverTracker.synchronizeEligibility();
  ensureGlobalVoiceShortcut();
}

function synchronizeCompanionPetPreference(enabled: boolean): void {
  companionPetEnabled = enabled;
  companionHoverTracker.synchronizeEligibility();
  if (!auxiliaryWindowsEnabled) return;

  if (enabled) {
    createCompanionWindow();
    return;
  }

  interruptPetNudges();
  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.destroy();
  } else {
    stopCompanionMovement();
  }
}

function disableAuthenticatedAuxiliaryWindows(): void {
  unregisterWorkCheckShortcut?.(); unregisterWorkCheckShortcut = null;
  assignmentCheckController.clear();
  interruptPetNudges();
  taskPetService.stop();
  auxiliaryWindowsEnabled = false;
  companionHoverTracker.synchronizeEligibility();
  cancelBackgroundCompletionPresentation();
  companionState = 'idle';
  activeCompanionVoiceActivity = null;
  clearCompanionInteraction();
  dismissCompanionGuidance();
  clearCompanionResponse();
  stopGuidanceSpeech();
  stopCompanionMovement();
  stopCursorBuddyFollowing();
  unregisterGlobalVoiceModeToggleShortcut?.();
  unregisterGlobalVoiceModeToggleShortcut = null;
  unregisterGlobalVoiceShortcut?.();
  unregisterGlobalVoiceShortcut = null;
  globalNumberedChoiceShortcuts?.deactivate();
  activeDesktopControlTasks.clear();
  desktopControlStartedAt.clear();

  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.destroy();
  }
  if (cursorBuddyWindow && !cursorBuddyWindow.isDestroyed()) {
    cursorBuddyWindow.destroy();
  }
  if (
    desktopControlIndicatorWindow &&
    !desktopControlIndicatorWindow.isDestroyed()
  ) {
    desktopControlIndicatorWindow.destroy();
  }
  if (guidanceWindow && !guidanceWindow.isDestroyed()) {
    guidanceWindow.destroy();
  }
  if (guidanceTargetWindow && !guidanceTargetWindow.isDestroyed()) {
    guidanceTargetWindow.destroy();
  }
  if (voiceIslandWindow && !voiceIslandWindow.isDestroyed()) {
    voiceIslandWindow.destroy();
  }
}

function finishShutdown(exitCode: number): void {
  if (forcedExitTimer) clearTimeout(forcedExitTimer);
  forcedExitTimer = null;
  app.exit(exitCode);
}

function prepareApplicationShutdown(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;

  isShuttingDown = true;
  auxiliaryWindowsEnabled = false;
  cancelBackgroundCompletionPresentation();
  stopCompanionMovement();
  stopCursorBuddyFollowing();
  unregisterAppPreferencesChange?.();
  unregisterAppPreferencesChange = null;
  unregisterGlobalVoiceModeToggleShortcut?.();
  unregisterGlobalVoiceModeToggleShortcut = null;
  unregisterGlobalVoiceShortcut?.();
  unregisterGlobalVoiceShortcut = null;
  unregisterWorkCheckShortcut?.(); unregisterWorkCheckShortcut = null;
  assignmentCheckController.clear();
  globalNumberedChoiceShortcuts?.dispose();
  globalNumberedChoiceShortcuts = null;
  companionNarrationService.shutdown();
  computerPermissionCoordinator.dispose();
  protocol.unhandle(TROCODE_AUDIO_SCHEME);
  backgroundTray?.destroy();
  backgroundTray = null;
  oauthBrowserFlow.shutdown();
  unregisterIpcHandlers?.();
  unregisterIpcHandlers = null;
  taskRuntime.off('task-update', trackTaskAnalytics);
  agentActivityService.off('activity', trackAgentActivityAnalytics);
  agentActivityService.off('activity', coordinateCompanionResponseActivity);
  taskRuntime.off('task-update', coordinateTaskPresentation);
  taskRuntime.off('task-update', reportActivityProgress);
  fileSelectionService.clear();
  activityProgressReporter.clear();
  classroomPetService.stop();
  taskPetService.stop();
  companionHoverTracker.stop();
  classroomDirectiveService.stop();
  classroomBroadcastService.stop();
  const classroomGuidanceShutdown = classroomGuidanceCoordinator.shutdown();
  teacherClassroomContextService.clear();
  classroomSessionService.clear();

  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  if (companionWindow && !companionWindow.isDestroyed()) companionWindow.hide();
  if (cursorBuddyWindow && !cursorBuddyWindow.isDestroyed()) {
    cursorBuddyWindow.hide();
  }
  activeDesktopControlTasks.clear();
  desktopControlStartedAt.clear();
  if (
    desktopControlIndicatorWindow &&
    !desktopControlIndicatorWindow.isDestroyed()
  ) {
    desktopControlIndicatorWindow.hide();
  }
  if (guidanceWindow && !guidanceWindow.isDestroyed()) guidanceWindow.hide();
  hideGuidanceTargetMarker();
  if (voiceIslandWindow && !voiceIslandWindow.isDestroyed()) {
    voiceIslandWindow.hide();
  }

  const analyticsShutdown = analyticsService?.shutdown() ?? Promise.resolve();
  const systemAudioShutdown = systemAudioDuckingService.setActive(false);
  const executionShutdown = executionCoordinator.shutdown().finally(async () => {
    await dictationService.shutdown();
    await Promise.allSettled([
      cuaService.shutdown(),
      coachRuntime.shutdown(),
      localAgentRuntime.shutdown(),
      rustDesktopEngine.stop(),
      taskHistoryService.shutdown(),
    ]);
  });
  shutdownPromise = Promise.allSettled([
    executionShutdown,
    classroomGuidanceShutdown,
    analyticsShutdown,
    systemAudioShutdown,
  ]).then(() => undefined);
  return shutdownPromise;
}

async function prepareForUpdateInstall(): Promise<void> {
  const applicationShutdown = prepareApplicationShutdown();
  await new Promise<void>((resolve) => {
    const graceTimer = setTimeout(resolve, SHUTDOWN_GRACE_PERIOD_MS);
    graceTimer.unref?.();
    void applicationShutdown.finally(() => {
      clearTimeout(graceTimer);
      resolve();
    });
  });
}

function beginShutdown(exitCode = 0): void {
  if (isShuttingDown) return;
  const applicationShutdown = prepareApplicationShutdown();

  forcedExitTimer = setTimeout(
    () => finishShutdown(exitCode),
    SHUTDOWN_GRACE_PERIOD_MS,
  );
  forcedExitTimer.unref?.();

  void applicationShutdown.finally(() => finishShutdown(exitCode));
}

function trackTaskAnalytics(value: unknown): void {
  void analyticsService?.trackTaskUpdate(value);
}

function trackAgentActivityAnalytics(value: unknown): void {
  void analyticsService?.trackAgentActivity(value);
}

function coordinateCompanionResponseActivity(value: unknown): void {
  const activity = AgentActivityUpdateSchema.parse(value);
  try { if (taskRuntime.getSnapshot(activity.taskId).goal?.activity?.purpose === 'check') return; } catch { /* Non-task activity. */ }
  if (activity.kind === 'run_started') {
    cancelBackgroundCompletionPresentation();
    if (activeCompanionGuidance?.kind === 'result') {
      dismissCompanionGuidance();
    }
    syncCompanionResponse(
      companionResponseController.startRun(activity.taskId),
    );
    return;
  }
  if (activity.kind === 'text_delta' && activity.textDelta) {
    syncCompanionResponse(
      companionResponseController.appendTextDelta(
        activity.taskId,
        activity.textDelta,
      ),
    );
    return;
  }
  if (activity.kind === 'run_failed') {
    syncCompanionResponse(
      companionResponseController.failRun(activity.taskId),
    );
  }
}

function coordinateTaskPresentation(value: unknown): void {
  if (TaskUpdateSchema.parse(value).snapshot.goal?.activity?.purpose === 'check') return;
  const update = TaskUpdateSchema.parse(value);
  taskPetService.handleTaskUpdate(update);
  if (!knownPresentationTaskIds.has(update.snapshot.taskId)) {
    cancelBackgroundCompletionPresentation();
    syncCompanionResponse(
      companionResponseController.startRun(update.snapshot.taskId),
    );
    knownPresentationTaskIds.add(update.snapshot.taskId);
    if (update.snapshot.goal?.schemaVersion === 11 && update.snapshot.goal.route === 'coach') {
      cursorBuddyController.beginSession(update.snapshot.taskId);
    }
    while (knownPresentationTaskIds.size > MAX_TRACKED_PRESENTATION_TASKS) {
      const oldestTaskId = knownPresentationTaskIds.values().next().value as
        string
        | undefined;
      if (!oldestTaskId) break;
      knownPresentationTaskIds.delete(oldestTaskId);
      backgroundPresentationTaskIds.delete(oldestTaskId);
    }
    const window = mainWindow;
    if (
      auxiliaryWindowsEnabled &&
      (!window ||
        window.isDestroyed() ||
        !window.isVisible() ||
        !window.isFocused())
    ) {
      backgroundPresentationTaskIds.add(update.snapshot.taskId);
    }
  }

  if (update.snapshot.phase === 'completed') {
    cursorBuddyController.finishSession(update.snapshot.taskId);
    syncCompanionResponse(
      update.snapshot.goal?.schemaVersion === 11 && update.snapshot.goal.route === 'coach'
        ? companionResponseController.cancelRun(update.snapshot.taskId)
        : companionResponseController.complete(update.snapshot),
    );
  } else if (update.snapshot.phase === 'failed') {
    cursorBuddyController.finishSession(update.snapshot.taskId);
    syncCompanionResponse(
      companionResponseController.failRun(update.snapshot.taskId),
    );
  } else if (update.snapshot.phase === 'cancelled') {
    cursorBuddyController.finishSession(update.snapshot.taskId);
    syncCompanionResponse(
      companionResponseController.cancelRun(update.snapshot.taskId),
    );
  }

  presentationCoordinator.handleTaskUpdate(update);
}

function shouldUseBackgroundCompanion(task: TaskSnapshot): boolean {
  if (!auxiliaryWindowsEnabled) return false;
  if (!backgroundPresentationTaskIds.has(task.taskId)) return false;
  const window = mainWindow;
  return (
    !window ||
    window.isDestroyed() ||
    !window.isVisible() ||
    !window.isFocused()
  );
}

function presentCompanionResponse(
  task: TaskSnapshot,
  options: CompanionResponsePresentationOptions,
): boolean {
  cancelBackgroundCompletionPresentation();
  if (options.surface === 'walkthrough_recap') {
    const narration = latestTaskAnswer(task);
    if (!narration) return false;
    const recapVisible = showWalkthroughRecap(task);
    if (!options.narrate) return recapVisible;

    const started = startCompletionNarration({
      mode: options.mode,
      narration,
      narrationService: companionNarrationService,
      onError: (error) => {
        console.warn('[voice:tts] walkthrough recap narration failed', {
          reason: error instanceof Error ? error.message : String(error),
          taskId: task.taskId,
        });
      },
      ...(options.onFailure ? { onFailure: options.onFailure } : {}),
      showCallout: () => showWalkthroughRecap(task),
      taskId: task.taskId,
    });
    if (!started) return recapVisible;

    backgroundCompletionNarration = started.controller;
    void started.completion.finally(() => {
      if (backgroundCompletionNarration === started.controller) {
        backgroundCompletionNarration = null;
      }
    });
    return recapVisible;
  }

  const response = companionResponseController.complete(task);
  if (!response) return false;
  const responseVisible = showCompanionResponseCard(response);
  if (!options.narrate) return responseVisible;

  const started = startCompletionNarration({
    mode: options.mode,
    narration: response.message,
    narrationService: companionNarrationService,
    onError: (error) => {
      console.warn('[voice:tts] completion narration failed', {
        reason: error instanceof Error ? error.message : String(error),
        taskId: task.taskId,
      });
    },
    ...(options.onFailure ? { onFailure: options.onFailure } : {}),
    showCallout: () => showCompanionResponseCard(response),
    taskId: task.taskId,
  });
  if (!started) return responseVisible;

  backgroundCompletionNarration = started.controller;
  void started.completion.finally(() => {
    if (backgroundCompletionNarration === started.controller) {
      backgroundCompletionNarration = null;
    }
  });
  return responseVisible;
}

function cancelBackgroundCompletionPresentation(): void {
  backgroundCompletionNarration?.abort();
  backgroundCompletionNarration = null;
}

function narrateCompanionResponse(response: CompanionResponseCard): boolean {
  cancelBackgroundCompletionPresentation();
  const started = startCompletionNarration({
    mode: 'foreground',
    narration: response.message,
    narrationService: companionNarrationService,
    onError: (error) => {
      console.warn('[voice:tts] response narration failed', {
        reason: error instanceof Error ? error.message : String(error),
        taskId: response.taskId,
      });
    },
    showCallout: () => showCompanionResponseCard(response),
    taskId: response.taskId,
  });
  if (!started) return false;
  backgroundCompletionNarration = started.controller;
  void started.completion.finally(() => {
    if (backgroundCompletionNarration === started.controller) {
      backgroundCompletionNarration = null;
    }
  });
  return true;
}

function handleCompanionResponseAction(
  request: CompanionResponseActionRequest,
): void | Promise<void> {
  const response = companionResponseController.current;
  if (
    !response ||
    response.cardId !== request.cardId ||
    response.taskId !== request.taskId
  ) {
    throw new Error('That companion response is no longer active.');
  }
  if (WorkCheckActionSchema.safeParse(request.action).success) {
    if (!auxiliaryWindowsEnabled) throw new Error('Sign in to check an assignment.');
    return assignmentCheckController.action(request);
  }
  if (response.workCheck && request.action !== 'dismiss') throw new Error('Use an assignment check action.');
  globalNumberedChoiceShortcuts?.deactivate(
    companionResponseShortcutScope(response),
  );

  switch (request.action) {
    case 'dismiss':
      if (response.workCheck) assignmentCheckController.dismiss();
      cancelBackgroundCompletionPresentation();
      syncCompanionResponse(
        companionResponseController.dismiss(request.cardId, request.taskId),
      );
      return;
    case 'open_task':
      if (mainWindow && !mainWindow.isDestroyed()) revealWindow(mainWindow);
      return;
    case 'ask_follow_up':
      if (mainWindow && !mainWindow.isDestroyed()) {
        revealWindow(mainWindow);
        mainWindow.webContents.send(
          IPC_CHANNELS.taskComposerFocusRequested,
          response.taskId,
        );
      }
      return;
    case 'read_aloud':
      if (response.phase !== 'completed' || !narrateCompanionResponse(response)) {
        throw new Error('That response is not ready to read aloud.');
      }
      return;
    case 'stop_reading':
      cancelBackgroundCompletionPresentation();
  }
}

function configureMicrophonePermissions(trustedWindow: BrowserWindow): void {
  const rendererSession = trustedWindow.webContents.session;

  rendererSession.setPermissionCheckHandler(
    (webContents, permission, _requestingOrigin, details) =>
      webContents?.id === trustedWindow.webContents.id &&
      permission === 'media' &&
      details.isMainFrame &&
      details.mediaType === 'audio',
  );

  rendererSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const mediaTypes =
        permission === 'media' && 'mediaTypes' in details
          ? details.mediaTypes
          : undefined;
      const isTrustedAudioRequest =
        webContents.id === trustedWindow.webContents.id &&
        details.isMainFrame &&
        mediaTypes?.length === 1 &&
        mediaTypes[0] === 'audio';

      callback(isTrustedAudioRequest);
    },
  );
}

function runtimeAppIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'trocode-app-icon.png')
    : path.join(app.getAppPath(), 'src', 'assets', 'trocode-app-icon.png');
}

function revealWindow(window: BrowserWindow): void {
  cancelBackgroundCompletionPresentation();
  if (window.isMinimized()) window.restore();
  window.show();
  window.moveTop();
  window.focus();
}

function ensureGlobalVoiceShortcut(): void {
  synchronizeWorkCheckShortcut();
  if (!auxiliaryWindowsEnabled) return;

  if (!unregisterGlobalVoiceModeToggleShortcut) {
    unregisterGlobalVoiceModeToggleShortcut =
      registerGlobalVoiceModeToggleShortcut({
        getTarget: () => mainWindow,
        platform: process.platform,
        registry: globalShortcut,
      });
  }

  if (unregisterGlobalVoiceShortcut) return;

  unregisterGlobalVoiceShortcut = registerGlobalVoiceShortcut({
    getTarget: () => mainWindow,
    platform: process.platform,
    registry: globalShortcut,
    watchForMacOSShortcut:
      process.platform === 'darwin'
        ? (listener) =>
            watchMacOSGlobalVoiceShortcut({
              executablePath: macOSVoiceShortcutHelperPath(),
              onEvent: listener,
            })
        : undefined,
    watchForWindowsShortcut:
      process.platform === 'win32'
        ? (listener) =>
            watchWindowsGlobalVoiceShortcut({
              onEvent: (event) => {
                console.info('[voice] Windows global shortcut event.', event);
                listener(event);
              },
            })
        : undefined,
  });
}

function companionInteractionShortcutScope(
  interaction: CompanionInteraction,
): string {
  return `interaction:${interaction.taskId}:${interaction.id}`;
}

function companionResponseShortcutScope(response: CompanionResponseCard): string {
  return `response:${response.taskId}:${response.cardId}`;
}

function handleGlobalNumberedCompanionSelection(
  scopeId: string,
  selection: number,
): void {
  const interaction = activeCompanionInteraction;
  if (
    interaction?.kind === 'clarification' &&
    companionInteractionShortcutScope(interaction) === scopeId
  ) {
    const choice = interaction.choices?.[selection - 1];
    if (!choice) return;
    taskApplicationService.respond({
      interactionId: interaction.id,
      kind: 'answer',
      taskId: interaction.taskId,
      text: choice.label,
    });
    return;
  }

  const response = activeCompanionResponse;
  if (response?.workCheck) return;
  if (
    response?.phase !== 'completed' ||
    companionResponseShortcutScope(response) !== scopeId
  ) {
    return;
  }
  const action = (
    [
      'dismiss',
      'open_task',
      'ask_follow_up',
      activeCompanionSpeech ? 'stop_reading' : 'read_aloud',
    ] as const
  )[selection - 1];
  if (!action) return;
  handleCompanionResponseAction({
    action,
    cardId: response.cardId,
    taskId: response.taskId,
  });
}

function ensureGlobalNumberedChoiceShortcuts(): GlobalNumberedChoiceShortcuts {
  globalNumberedChoiceShortcuts ??= registerGlobalNumberedChoiceShortcuts({
    registry: globalShortcut,
    select: handleGlobalNumberedCompanionSelection,
  });
  return globalNumberedChoiceShortcuts;
}

function activateGlobalCompanionResponseShortcuts(
  response: CompanionResponseCard,
): void {
  if (
    response.workCheck ||
    !auxiliaryWindowsEnabled ||
    response.phase !== 'completed' ||
    guidanceWindow?.isFocused()
  ) {
    globalNumberedChoiceShortcuts?.deactivate();
    return;
  }
  ensureGlobalNumberedChoiceShortcuts().activate(
    companionResponseShortcutScope(response),
    4,
  );
}

function activateGlobalCompanionInteractionShortcuts(
  interaction: CompanionInteraction,
): void {
  if (
    !auxiliaryWindowsEnabled ||
    interaction.kind !== 'clarification' ||
    !interaction.choices?.length ||
    guidanceWindow?.isFocused()
  ) {
    globalNumberedChoiceShortcuts?.deactivate();
    return;
  }
  ensureGlobalNumberedChoiceShortcuts().activate(
    companionInteractionShortcutScope(interaction),
    interaction.choices.length,
  );
}

function syncGlobalNumberedChoiceShortcuts(): void {
  if (activeCompanionInteraction) {
    activateGlobalCompanionInteractionShortcuts(activeCompanionInteraction);
    return;
  }
  if (
    activeCompanionResponse &&
    currentCompanionOverlayMode() === 'response'
  ) {
    activateGlobalCompanionResponseShortcuts(activeCompanionResponse);
    return;
  }
  globalNumberedChoiceShortcuts?.deactivate();
}

function macOSVoiceShortcutHelperPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, MACOS_VOICE_SHORTCUT_HELPER_NAME)
    : path.join(
        app.getAppPath(),
        '.generated-native',
        MACOS_VOICE_SHORTCUT_HELPER_NAME,
      );
}

function ensureBackgroundTray(): void {
  if (backgroundTray) return;

  const trayIcon = createVoiceModeTrayImage(
    nativeImage,
    backgroundTrayVoiceMode,
  );
  backgroundTray = new Tray(trayIcon);
  backgroundTray.setToolTip(
    voiceModeTrayVisual(backgroundTrayVoiceMode).tooltip,
  );
  const revealMainWindow = (): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      revealWindow(mainWindow);
      return;
    }
    createWindow();
  };
  const backgroundMenu = Menu.buildFromTemplate([
    {
      click: revealMainWindow,
      label: 'Show Tro',
    },
    { type: 'separator' },
    {
      click: () => beginShutdown(),
      label: 'Quit Tro',
    },
  ]);
  registerBackgroundTrayActivation(backgroundTray, backgroundMenu, {
    platform: process.platform,
    reveal: revealMainWindow,
  });
}

function synchronizeBackgroundTrayVoiceMode(mode: VoiceMode): void {
  backgroundTrayVoiceMode = mode;
  if (!backgroundTray) return;
  synchronizeVoiceModeTray(backgroundTray, nativeImage, mode);
}

const createWindow = (): void => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    revealWindow(mainWindow);
    return;
  }

  const nextMainWindow = new BrowserWindow({
    autoHideMenuBar: process.platform === 'win32',
    backgroundColor: '#f3f3ef',
    height: 820,
    icon: runtimeAppIconPath(),
    minHeight: 680,
    minWidth: 960,
    show: false,
    title: TROCODE_EXECUTABLE_NAME,
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 16, y: 17 },
        }
      : process.platform === 'win32'
        ? {
            titleBarOverlay: {
              color: '#f1f0eb',
              height: 48,
              symbolColor: '#5d5e57',
            },
            titleBarStyle: 'hidden' as const,
          }
        : {}),
    width: 1280,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      sandbox: true,
      webSecurity: true,
    },
  });
  if (TROCODE_IS_TEST_APP) {
    nextMainWindow.on('page-title-updated', (event) => event.preventDefault());
  }
  mainWindow = nextMainWindow;
  configureMicrophonePermissions(nextMainWindow);
  removeMainWindowCloseBehavior?.();
  removeMainWindowCloseBehavior = keepWindowAliveForBackgroundVoice(
    nextMainWindow,
    {
      isShuttingDown: () => isShuttingDown,
      platform: process.platform,
    },
  );

  unregisterIpcHandlers?.();
  unregisterIpcHandlers = registerIpcHandlers(nextMainWindow, {
    activityProgressReporter,
    activityWorkspacePreparationService,
    agentActivityService,
    appPreferencesService,
    appUpdateService,
    authService,
    companionCustomizationService,
    cuaService,
    dictationService,
    connectorClient,
    classroomBroadcastFeatures: {
      context: teacherClassroomContextService,
      drafts: classroomBroadcastDraftService,
      broadcasts: classroomBroadcastService,
      guidance: classroomGuidanceCoordinator,
      client: knowledgeSpaceClient,
    },
    classroomDirectiveService,
    classroomSessionService,
    cancelActiveTasks: () => taskApplicationService.cancelActiveTasks(),
    computerPermissionCoordinator,
    fileSelectionService,
    getCompanionInteractionWindow: () => guidanceWindow,
    getCursorBuddySnapshot,
    getCursorBuddyWindow: () => cursorBuddyWindow,
    handleCompanionResponseAction,
    membershipService,
    organizationClient,
    knowledgeSpaceClient,
    knowledgeUploadOrchestrator,
    onAuthSignedIn: async (user) => {
      await classroomGuidanceCoordinator.restore();
      await companionCustomizationService.setCurrentOwner(user.id);
      await identifyAnalyticsUser(user);
      enableAuthenticatedAuxiliaryWindows();
    },
    onAuthSignedOut: async () => {
      teacherClassroomContextService.clear();
      await classroomGuidanceCoordinator.invalidate();
      await dictationService.shutdown();
      await companionCustomizationService.setCurrentOwner(null);
      disableAuthenticatedAuxiliaryWindows();
      taskHistoryService.setCurrentOwner(null);
      localAgentRuntime.clearCredential();
      await coachRuntime.shutdown();
      await localAgentRuntime.shutdown();
      await systemAudioDuckingService.setActive(false).catch((error: unknown) => {
        console.error('[voice] Could not restore system audio after sign-out.', error);
      });
      await analyticsService?.resetUser();
    },
    onUsageBudgetSnapshot: (snapshot) =>
      presentationCoordinator.handleBudgetSnapshot(snapshot),
    openSystemPermissionSettings: async (permission) =>
      shell.openExternal(systemPermissionSettingsUrl(permission), {
        activate: true,
      }),
    recordVoiceTranscript: async (input) => {
      await analyticsService?.trackVoiceTranscript(input);
    },
    reportCompanionSpeechPlayback: (report) =>
      companionNarrationService.report(report),
    requestScreenRecordingAccess: registerScreenRecordingHost,
    revealMainWindow: () => {
      if (mainWindow && !mainWindow.isDestroyed()) revealWindow(mainWindow);
    },
    systemAudioDuckingService,
    taskRuntime,
    taskApplicationService,
    taskHistoryService,
    updateCompanionState,
    updateCompanionVoiceActivity,
    voiceService,
    usageBudgetService,
    workspaceSelectionService,
  });

  if (!app.isPackaged) {
    nextMainWindow.webContents.on('console-message', (details) => {
      if (!details.message.startsWith('[voice:renderer]')) return;
      console.info(details.message);
    });
  }

  nextMainWindow.once('ready-to-show', () => nextMainWindow.show());

  nextMainWindow.on('closed', () => {
    removeMainWindowCloseBehavior?.();
    removeMainWindowCloseBehavior = null;
    mainWindow = null;
    unregisterIpcHandlers?.();
    unregisterIpcHandlers = null;
    void dictationService.shutdown().catch((error: unknown) => {
      console.error('[voice] Could not clear dictation after closing.', {
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    });
    void systemAudioDuckingService.setActive(false).catch((error: unknown) => {
      console.error('[voice] Could not restore system audio after closing.', error);
    });
  });

  nextMainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  nextMainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const entryUrl = new URL(MAIN_WINDOW_WEBPACK_ENTRY);
    const requestedUrl = new URL(navigationUrl);
    const isSameDevelopmentOrigin =
      !app.isPackaged && requestedUrl.origin === entryUrl.origin;
    const isPackagedApplication =
      app.isPackaged &&
      requestedUrl.protocol === 'file:' &&
      path.dirname(requestedUrl.pathname) === path.dirname(entryUrl.pathname);

    if (!isSameDevelopmentOrigin && !isPackagedApplication) {
      event.preventDefault();
    }
  });

  void nextMainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  if (!app.isPackaged && !TROCODE_IS_TEST_APP) nextMainWindow.webContents.openDevTools({ mode: 'detach' });
};

function publishCursorBuddySnapshot(snapshot: CursorBuddySnapshot): void {
  if (!cursorBuddyWindow || cursorBuddyWindow.isDestroyed()) return;
  const parsedSnapshot = CursorBuddySnapshotSchema.parse(snapshot);
  if (
    lastCursorBuddySnapshot?.phase === parsedSnapshot.phase &&
    lastCursorBuddySnapshot.busy === parsedSnapshot.busy &&
    pointEqual(lastCursorBuddySnapshot.position, parsedSnapshot.position)
  ) {
    return;
  }
  lastCursorBuddySnapshot = parsedSnapshot;
  cursorBuddyWindow.webContents.send(
    IPC_CHANNELS.cursorBuddySnapshotChanged,
    parsedSnapshot,
  );
}

function getCursorBuddySnapshot(): CursorBuddySnapshot {
  return CursorBuddySnapshotSchema.parse(cursorBuddyController.currentSnapshot);
}

function toCursorBuddyRendererPosition(position: Point): Point {
  if (!shouldUseCompanionOverlay(process.platform)) return position;
  const overlayBounds = getCompanionOverlayBounds();
  return {
    x: position.x - overlayBounds.x,
    y: position.y - overlayBounds.y,
  };
}

function applyCursorBuddyScreenPosition(position: Point): void {
  if (!cursorBuddyWindow || cursorBuddyWindow.isDestroyed()) return;

  if (!shouldUseCompanionOverlay(process.platform)) {
    const [currentX, currentY] = cursorBuddyWindow.getPosition();
    if (currentX !== position.x || currentY !== position.y) {
      cursorBuddyWindow.setPosition(position.x, position.y, false);
    }
    return;
  }

  const overlayBounds = getCompanionOverlayBounds();
  if (overlayBounds.width <= 0 || overlayBounds.height <= 0) return;

  if (!boundsEqual(cursorBuddyWindow.getBounds(), overlayBounds)) {
    cursorBuddyWindow.setBounds(overlayBounds, false);
    lastCursorBuddySnapshot = null;
  }
}

function getCurrentCompanionScreenPosition(): Point {
  if (!companionWindow || companionWindow.isDestroyed()) {
    return companionRestingPosition();
  }

  if (!shouldUseCompanionOverlay(process.platform)) {
    const [x = 0, y = 0] = companionWindow.getPosition();
    return { x, y };
  }

  const overlayBounds = getCompanionOverlayBounds();
  if (lastCompanionPosition) {
    return {
      x: overlayBounds.x + lastCompanionPosition.x,
      y: overlayBounds.y + lastCompanionPosition.y,
    };
  }

  return companionRestingPosition();
}

function companionRestingPosition(): Point {
  if (companionUserPosition) {
    const display = screen.getDisplayNearestPoint(companionUserPosition);
    companionUserPosition = clampCompanionPosition(
      companionUserPosition,
      display.workArea,
      COMPANION_SIZE,
    );
    return companionUserPosition;
  }

  const display =
    mainWindow && !mainWindow.isDestroyed()
      ? screen.getDisplayMatching(mainWindow.getBounds())
      : screen.getPrimaryDisplay();
  return placeCompanionAtRest(display.workArea, COMPANION_SIZE);
}

function applyCompanionScreenPosition(position: Point): void {
  if (!companionWindow || companionWindow.isDestroyed()) return;

  if (!shouldUseCompanionOverlay(process.platform)) {
    const [currentX, currentY] = companionWindow.getPosition();

    if (currentX !== position.x || currentY !== position.y) {
      companionWindow.setPosition(position.x, position.y, false);
    }
    sendCompanionGuidanceVisual(position);
    return;
  }

  const overlayBounds = getCompanionOverlayBounds();
  if (overlayBounds.width <= 0 || overlayBounds.height <= 0) return;

  const currentBounds = companionWindow.getBounds();
  if (!boundsEqual(currentBounds, overlayBounds)) {
    companionWindow.setBounds(overlayBounds, false);
    lastCompanionPosition = null;
  }

  sendCompanionPosition({
    x: position.x - overlayBounds.x,
    y: position.y - overlayBounds.y,
  });
  sendCompanionGuidanceVisual(position);
}

function positionCompanion(now = Date.now()): CompanionMotionActivity {
  if (!companionWindow || companionWindow.isDestroyed()) {
    return { nextFrameDelayMs: null };
  }

  const wander = companionWander;
  if (wander) {
    const progress =
      (now - wander.startedAt) / COMPANION_WANDER_DURATION_MS;
    applyCompanionScreenPosition(
      interpolateCompanionWanderPosition(wander.from, wander.to, progress),
    );
    if (progress >= 1) {
      companionWander = null;
      scheduleCompanionWander();
      return { nextFrameDelayMs: null };
    }
    return { nextFrameDelayMs: 32 };
  }

  applyCompanionScreenPosition(companionRestingPosition());
  return { nextFrameDelayMs: null };
}

function scheduleCompanionMovement(delayMs: number): void {
  if (!companionWindow || companionWindow.isDestroyed()) return;

  companionMovementTimer = setTimeout(runCompanionMovementLoop, delayMs);
}

function runCompanionMovementLoop(): void {
  companionMovementTimer = null;
  const activity = positionCompanion();
  if (activity.nextFrameDelayMs !== null) {
    scheduleCompanionMovement(activity.nextFrameDelayMs);
  }
}

function wakeCompanionMovement(): void {
  if (companionMovementTimer) clearTimeout(companionMovementTimer);
  companionMovementTimer = null;
  scheduleCompanionMovement(0);
}

function pauseCompanionWandering(): void {
  if (companionWanderTimer) clearTimeout(companionWanderTimer);
  companionWanderTimer = null;
  companionWander = null;
}

function pauseCompanionWanderingForHover(): void {
  if (companionMovementTimer) clearTimeout(companionMovementTimer);
  companionMovementTimer = null;
  pauseCompanionWandering();
}

function rememberCompanionUserPosition(bounds: Rectangle): void {
  if (companionState !== 'idle') return;

  if (companionMovementTimer) clearTimeout(companionMovementTimer);
  companionMovementTimer = null;
  pauseCompanionWandering();
  const display = screen.getDisplayMatching(bounds);
  companionUserPosition = clampCompanionPosition(
    { x: bounds.x, y: bounds.y },
    display.workArea,
    COMPANION_SIZE,
  );
}

function scheduleCompanionWander(): void {
  if (
    companionWanderTimer ||
    companionWander ||
    companionUserPosition ||
    activeCompanionHover ||
    companionState !== 'idle' ||
    !auxiliaryWindowsEnabled ||
    isShuttingDown ||
    !companionPetEnabled ||
    !companionWindow ||
    companionWindow.isDestroyed()
  ) {
    return;
  }

  const delayMs =
    COMPANION_WANDER_MIN_PAUSE_MS +
    Math.round(Math.random() * COMPANION_WANDER_PAUSE_RANGE_MS);
  companionWanderTimer = setTimeout(startCompanionWander, delayMs);
}

function startCompanionWander(): void {
  companionWanderTimer = null;
  if (
    companionUserPosition ||
    activeCompanionHover ||
    companionState !== 'idle' ||
    !auxiliaryWindowsEnabled ||
    isShuttingDown ||
    !companionPetEnabled ||
    !companionWindow ||
    companionWindow.isDestroyed()
  ) {
    scheduleCompanionWander();
    return;
  }

  const from = getCurrentCompanionScreenPosition();
  const display = screen.getDisplayNearestPoint(from);
  companionWander = {
    from,
    startedAt: Date.now(),
    to: placeCompanionWanderTarget(
      from,
      display.workArea,
      COMPANION_SIZE,
      Math.random(),
      Math.random(),
    ),
  };
  wakeCompanionMovement();
}

function createDesktopControlIndicatorWindow(): void {
  if (!auxiliaryWindowsEnabled) return;
  if (
    desktopControlIndicatorWindow &&
    !desktopControlIndicatorWindow.isDestroyed()
  ) {
    return;
  }

  const bounds = getCompanionOverlayBounds();
  desktopControlIndicatorWindow = new BrowserWindow({
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    focusable: false,
    frame: false,
    hasShadow: false,
    height: bounds.height,
    resizable: false,
    show: false,
    skipTaskbar: true,
    transparent: true,
    width: bounds.width,
    x: bounds.x,
    y: bounds.y,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      sandbox: true,
      webSecurity: true,
    },
  });

  desktopControlIndicatorWindow.setAlwaysOnTop(true, 'screen-saver');
  desktopControlIndicatorWindow.setIgnoreMouseEvents(true, { forward: true });
  desktopControlIndicatorWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  desktopControlIndicatorWindow.webContents.setWindowOpenHandler(() => ({
    action: 'deny',
  }));
  desktopControlIndicatorWindow.webContents.on('did-finish-load', () => {
    sendCompanionGuidanceVisual();
  });
  desktopControlIndicatorWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  desktopControlIndicatorWindow.once('ready-to-show', () => {
    if (!auxiliaryWindowsEnabled || activeDesktopControlTasks.size === 0) return;
    desktopControlIndicatorWindow?.setBounds(getCompanionOverlayBounds(), false);
    desktopControlIndicatorWindow?.showInactive();
  });
  desktopControlIndicatorWindow.on('closed', () => {
    desktopControlIndicatorWindow = null;
  });

  const indicatorUrl = new URL(MAIN_WINDOW_WEBPACK_ENTRY);
  indicatorUrl.searchParams.set('mode', 'control-indicator');
  void desktopControlIndicatorWindow.loadURL(indicatorUrl.toString());
}

const createCursorBuddyWindow = (): void => {
  if (!auxiliaryWindowsEnabled) return;
  if (cursorBuddyWindow && !cursorBuddyWindow.isDestroyed()) return;

  const useOverlayTracking = shouldUseCompanionOverlay(process.platform);
  const cursorBuddyBounds = useOverlayTracking
    ? getCompanionOverlayBounds()
    : { ...CURSOR_BUDDY_SIZE, x: 0, y: 0 };

  cursorBuddyWindow = new BrowserWindow({
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    focusable: false,
    frame: false,
    hasShadow: false,
    height: cursorBuddyBounds.height,
    movable: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    transparent: true,
    width: cursorBuddyBounds.width,
    ...(useOverlayTracking
      ? { x: cursorBuddyBounds.x, y: cursorBuddyBounds.y }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      sandbox: true,
      webSecurity: true,
    },
  });

  cursorBuddyWindow.setAlwaysOnTop(true, 'screen-saver');
  cursorBuddyWindow.setIgnoreMouseEvents(true, { forward: true });
  cursorBuddyWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  cursorBuddyWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  cursorBuddyWindow.webContents.on('did-finish-load', () => {
    lastCursorBuddySnapshot = null;
    publishCursorBuddySnapshot(cursorBuddyController.currentSnapshot);
  });
  cursorBuddyWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  const cursorBuddyUrl = new URL(MAIN_WINDOW_WEBPACK_ENTRY);
  cursorBuddyUrl.searchParams.set('mode', 'cursor-buddy');
  cursorBuddyUrl.searchParams.set(
    'tracking',
    useOverlayTracking ? 'overlay' : 'native',
  );

  cursorBuddyWindow.once('ready-to-show', () => {
    if (!auxiliaryWindowsEnabled) return;
    cursorBuddyWindow?.showInactive();
    cursorBuddyController.start();
  });
  cursorBuddyWindow.on('closed', () => {
    cursorBuddyWindow = null;
    stopCursorBuddyFollowing();
  });

  void cursorBuddyWindow.loadURL(cursorBuddyUrl.toString());
};

const createCompanionWindow = (): void => {
  if (!auxiliaryWindowsEnabled || !companionPetEnabled) return;
  if (companionWindow && !companionWindow.isDestroyed()) return;

  const useOverlayCompanion = shouldUseCompanionOverlay(process.platform);
  const companionBounds = useOverlayCompanion
    ? getCompanionOverlayBounds()
    : { ...COMPANION_SIZE, x: 0, y: 0 };

  companionWindow = new BrowserWindow({
    acceptFirstMouse: !useOverlayCompanion,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    focusable: false,
    frame: false,
    hasShadow: false,
    height: companionBounds.height,
    movable: !useOverlayCompanion,
    resizable: false,
    show: false,
    skipTaskbar: true,
    transparent: true,
    width: companionBounds.width,
    ...(useOverlayCompanion
      ? { x: companionBounds.x, y: companionBounds.y }
      : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      sandbox: true,
      webSecurity: true,
    },
  });

  if (useOverlayCompanion) {
    companionWindow.setIgnoreMouseEvents(true, { forward: true });
  }
  companionWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  companionWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  companionWindow.webContents.on('did-finish-load', () => {
    sendCompanionState();
    sendCompanionAppearance();
    sendCompanionHover();
    sendCompanionPetNudge();
    lastCompanionPosition = null;
    positionCompanion();
    companionHoverTracker.synchronizeEligibility();
    scheduleCompanionWander();
  });
  companionWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  if (!useOverlayCompanion) {
    companionWindow.on('will-move', (_event, bounds) => {
      rememberCompanionUserPosition(bounds);
    });
  }

  const companionUrl = new URL(MAIN_WINDOW_WEBPACK_ENTRY);
  companionUrl.searchParams.set('mode', 'companion');
  companionUrl.searchParams.set(
    'tracking',
    useOverlayCompanion ? 'overlay' : 'native',
  );

  companionWindow.once('ready-to-show', () => {
    if (!auxiliaryWindowsEnabled || !companionPetEnabled) return;
    positionCompanion();
    companionWindow?.showInactive();
    companionHoverTracker.synchronizeEligibility();
    scheduleCompanionWander();
  });
  companionWindow.on('closed', () => {
    companionWindow = null;
    stopCompanionMovement();
    companionHoverTracker.synchronizeEligibility();
  });

  void companionWindow.loadURL(companionUrl.toString());
  positionCompanion();
};

function positionVoiceIsland(): void {
  if (!voiceIslandWindow || voiceIslandWindow.isDestroyed()) return;

  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  voiceIslandWindow.setBounds(
    {
      ...placeVoiceIsland(
        display.workArea,
        VOICE_ISLAND_SIZE,
        VOICE_ISLAND_TOP_GAP,
      ),
      ...VOICE_ISLAND_SIZE,
    },
    false,
  );
}

const createVoiceIslandWindow = (): void => {
  if (!auxiliaryWindowsEnabled) return;
  if (voiceIslandWindow && !voiceIslandWindow.isDestroyed()) return;

  voiceIslandWindow = new BrowserWindow({
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    focusable: false,
    frame: false,
    hasShadow: false,
    height: VOICE_ISLAND_SIZE.height,
    resizable: false,
    show: false,
    skipTaskbar: true,
    transparent: true,
    width: VOICE_ISLAND_SIZE.width,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      sandbox: true,
      webSecurity: true,
    },
  });

  voiceIslandWindow.setIgnoreMouseEvents(true, { forward: true });
  voiceIslandWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  voiceIslandWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  voiceIslandWindow.webContents.on('did-finish-load', () => {
    sendCompanionVoiceActivity();
  });
  voiceIslandWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  voiceIslandWindow.once('ready-to-show', () => {
    if (!auxiliaryWindowsEnabled || !activeCompanionVoiceActivity) return;
    positionVoiceIsland();
    voiceIslandWindow?.showInactive();
  });
  voiceIslandWindow.on('closed', () => {
    voiceIslandWindow = null;
  });

  const voiceIslandUrl = new URL(MAIN_WINDOW_WEBPACK_ENTRY);
  voiceIslandUrl.searchParams.set('mode', 'voice-island');
  void voiceIslandWindow.loadURL(voiceIslandUrl.toString());
};

const createGuidanceTargetWindow = (): void => {
  if (!auxiliaryWindowsEnabled) return;
  if (guidanceTargetWindow && !guidanceTargetWindow.isDestroyed()) return;

  guidanceTargetWindow = new BrowserWindow({
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    focusable: false,
    frame: false,
    hasShadow: false,
    height: GUIDANCE_TARGET_MARKER_SIZE.height,
    resizable: false,
    show: false,
    skipTaskbar: true,
    transparent: true,
    width: GUIDANCE_TARGET_MARKER_SIZE.width,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  guidanceTargetWindow.setIgnoreMouseEvents(true, { forward: true });
  guidanceTargetWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  guidanceTargetWindow.webContents.setWindowOpenHandler(() => ({
    action: 'deny',
  }));
  guidanceTargetWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  guidanceTargetWindow.on('closed', () => {
    activeGuidanceTargetBounds = null;
    sendCompanionGuidanceVisual();
    guidanceTargetWindow = null;
  });

  const markerUrl = new URL(MAIN_WINDOW_WEBPACK_ENTRY);
  markerUrl.searchParams.set('mode', 'target-marker');
  void guidanceTargetWindow.loadURL(markerUrl.toString());
};

const createGuidanceWindow = (): void => {
  if (!auxiliaryWindowsEnabled) return;
  if (guidanceWindow && !guidanceWindow.isDestroyed()) return;

  guidanceWindow = new BrowserWindow({
    acceptFirstMouse: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    focusable: false,
    frame: false,
    hasShadow: false,
    height: GUIDANCE_CALLOUT_SIZE.height,
    resizable: false,
    show: false,
    skipTaskbar: true,
    transparent: true,
    width: GUIDANCE_CALLOUT_SIZE.width,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      sandbox: true,
      webSecurity: true,
    },
  });

  guidanceWindow.setIgnoreMouseEvents(true, { forward: true });
  guidanceWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  guidanceWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  guidanceWindow.webContents.on('did-finish-load', () => {
    sendCompanionGuidance();
    sendCompanionInteraction();
    sendCompanionPetNudge();
    sendCompanionResponse();
    sendCompanionSpeech();
  });
  guidanceWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  guidanceWindow.on('focus', () => {
    globalNumberedChoiceShortcuts?.deactivate();
  });
  guidanceWindow.on('blur', syncGlobalNumberedChoiceShortcuts);
  guidanceWindow.on('closed', () => {
    const unresolvedInteraction = activeCompanionInteraction;
    interruptPetNudges();
    globalNumberedChoiceShortcuts?.deactivate();
    companionNarrationService.cancelCurrent();
    hideGuidanceTargetMarker();
    const response = companionResponseController.current;
    if (response) {
      companionResponseController.dismiss(response.cardId, response.taskId);
    }
    guidanceWindow = null;
    activeCompanionGuidance = null;
    activeCompanionInteraction = null;
    activeCompanionPetNudge = null;
    activeCompanionPetNudgeOwner = null;
    sendCompanionPetNudge();
    activeCompanionResponse = null;
    activeCompanionSpeech = null;
    if (
      auxiliaryWindowsEnabled &&
      unresolvedInteraction &&
      mainWindow &&
      !mainWindow.isDestroyed()
    ) {
      revealWindow(mainWindow);
    }
  });

  const guidanceUrl = new URL(MAIN_WINDOW_WEBPACK_ENTRY);
  guidanceUrl.searchParams.set('mode', 'guidance');
  void guidanceWindow.loadURL(guidanceUrl.toString());
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
if (hasSingleInstanceLock) {
  void app.whenReady().then(async () => {
    await configureMacOSDock(app, process.platform, runtimeAppIconPath());
    registerCompanionAudioProtocol();
    registerCompanionImageProtocol();
    appUpdateService.start();
    classroomPetService.start();
    taskPetService.start();
    companionHoverTracker.start();
    unregisterAppPreferencesChange = appPreferencesService.onChange(
      (preferences) => {
        synchronizeCompanionPetPreference(preferences.classroomPetEnabled);
        synchronizeBackgroundTrayVoiceMode(preferences.voiceMode);
      },
    );
    const initialPreferences = await appPreferencesService.get();
    synchronizeCompanionPetPreference(initialPreferences.classroomPetEnabled);
    synchronizeBackgroundTrayVoiceMode(initialPreferences.voiceMode);
    void appUpdateService.checkForUpdates();
    analyticsService = new AnalyticsService({
      appVersion: app.getVersion(),
      architecture: process.arch,
      environment:
        process.env.POSTHOG_ENVIRONMENT?.trim() ||
        (app.isPackaged ? 'production' : 'development'),
      host: process.env.POSTHOG_HOST,
      identityStore: new FileAnalyticsIdentityStore(
        path.join(app.getPath('userData'), 'analytics-identity.json'),
      ),
      platform: process.platform,
      projectToken: process.env.POSTHOG_PROJECT_TOKEN,
    });
    taskRuntime.on('task-update', trackTaskAnalytics);
    agentActivityService.on('activity', trackAgentActivityAnalytics);
    agentActivityService.on('activity', coordinateCompanionResponseActivity);
    taskRuntime.on('task-update', coordinateTaskPresentation);

    await Promise.all([
      analyticsService.start(),
      cuaService.connectIfPermitted(),
      rustDesktopEngine.start(),
      taskHistoryService.start(),
    ]);
    const authStatus = await authService.getStatus();
    await companionCustomizationService.setCurrentOwner(authStatus.user?.id ?? null);
    if (authStatus.user) await identifyAnalyticsUser(authStatus.user);
    auxiliaryWindowsEnabled = isAuthenticatedCompanionSession(authStatus);
    createWindow();
    if (auxiliaryWindowsEnabled) enableAuthenticatedAuxiliaryWindows();
    ensureBackgroundTray();
    app.on('browser-window-focus', () => {
      void computerPermissionCoordinator.refresh().catch((error: unknown) => {
        console.warn('[cua] Could not refresh a pending permission wait.', error);
      });
    });
  });

  app.on('window-all-closed', () => {
    // The renderer is Tro's background voice host. Explicit Quit remains
    // available from the application menu and tray.
  });

  app.on('activate', () => {
    if (isShuttingDown) return;
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    createWindow();
    createCompanionWindow();
    createCursorBuddyWindow();
  });

  const exitDevelopmentProcess = (): void => {
    beginShutdown();
  };

  process.on('SIGTERM', exitDevelopmentProcess);
  process.on('SIGINT', exitDevelopmentProcess);

  app.on('before-quit', (event) => {
    if (isShuttingDown) return;

    event.preventDefault();
    beginShutdown();
  });
}
