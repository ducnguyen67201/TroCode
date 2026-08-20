import {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  globalShortcut,
  Menu,
  nativeImage,
  protocol,
  screen,
  shell,
  Tray,
  type OpenDialogOptions,
} from 'electron';
import path from 'node:path';

import type { ActionPreview } from './main/agent/action-preview-policy';
import { AgentActivityService } from './main/agent/agent-activity-service';
import { AgentRuntimeFactory } from './main/agent/agent-runtime-factory';
import { approvalObservationMatches } from './main/agent/approval-observation';
import { createCuaSemanticToolDefinitions } from './main/agent/cua-semantic-agent-tools';
import {
  DesktopObservationSchema,
  type DesktopCommand,
  type DesktopObservation,
} from './main/agent/execution-contracts';
import {
  TaskExecutionCoordinator,
  type DesktopPresentation,
  type GuidancePresentationHandle,
} from './main/agent/execution-coordinator';
import {
  registerGlobalGuidanceShortcuts,
  type GlobalGuidanceShortcuts,
} from './main/agent/global-guidance-shortcuts';
import { registerGlobalTaskCancelShortcut } from './main/agent/global-task-cancel-shortcut';
import { OpenAIAgentsRuntime } from './main/agent/openai-agents-runtime';
import {
  defaultRuntimeToolDefinitions,
  RuntimeToolRegistry,
} from './main/agent/runtime-tool-registry';
import { TaskRuntime } from './main/agent/task-runtime';
import { requestsGuidedWalkthrough } from './main/agent/walkthrough-policy';
import { FileAnalyticsIdentityStore } from './main/analytics/analytics-identity-store';
import { AnalyticsService } from './main/analytics/analytics-service';
import { TaskApplicationService } from './main/application/task-application-service';
import { EncryptedAuthSessionStore } from './main/auth/auth-session-store';
import { GoogleAuthService } from './main/auth/google-auth-service';
import { LocalOAuthBrowserFlow } from './main/auth/local-oauth-browser-flow';
import { keepWindowAliveForBackgroundVoice } from './main/background-app-lifecycle';
import { UsageBudgetService } from './main/budget/usage-budget-service';
import {
  isAuthenticatedCompanionSession,
  toCompanionInteraction,
} from './main/companion/companion-interaction';
import {
  getVirtualDisplayBounds,
  interpolateCompanionPosition,
  placeCompanionForBrowserNavigation,
  placeCompanionNearCursor,
  placeGuidanceCallout,
  placeGuidanceTargetMarker,
  placeVoiceIsland,
  resolveDesktopCaptureBounds,
  shouldUseCompanionOverlay,
  type Point,
  type Rectangle,
} from './main/companion/companion-position';
import {
  CompanionResponseController,
  selectCompanionOverlayMode,
} from './main/companion/companion-response-controller';
import {
  registerGlobalNumberedChoiceShortcuts,
  type GlobalNumberedChoiceShortcuts,
} from './main/companion/global-numbered-choice-shortcuts';
import { CuaService } from './main/cua/cua-service';
import { TaskHistoryService } from './main/history/task-history-service';
import { PostgresTaskHistoryStore } from './main/history/task-history-store';
import { resizeObservationForModel } from './main/inference/image-evidence';
import { registerIpcHandlers } from './main/ipc/register-ipc';
import { ActivityContextService } from './main/knowledge/activity-context-service';
import { ActivityProgressReporter } from './main/knowledge/activity-progress-reporter';
import { createActivityToolAdapters } from './main/knowledge/activity-tool-adapters';
import { ActivityWorkspacePreparationService } from './main/knowledge/activity-workspace-preparation-service';
import { FileSelectionService } from './main/knowledge/file-selection-service';
import { KnowledgeSpaceClient } from './main/knowledge/knowledge-space-client';
import { KnowledgeUploadOrchestrator } from './main/knowledge/knowledge-upload-service';
import { EncryptedMembershipActivationStore } from './main/membership/membership-activation-store';
import {
  MembershipService,
  membershipRequiredForBuild,
} from './main/membership/membership-service';
import {
  AppPreferencesService,
  FileAppPreferencesStore,
} from './main/preferences/app-preferences-service';
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
import { ElevenLabsTtsService } from './main/voice/elevenlabs-tts-service';
import { registerGlobalVoiceShortcut } from './main/voice/global-voice-shortcut';
import {
  MACOS_VOICE_SHORTCUT_HELPER_NAME,
  watchMacOSGlobalVoiceShortcut,
} from './main/voice/macos-voice-shortcut-watcher';
import { createSystemAudioDuckingService } from './main/voice/system-audio-ducking-service';
import { EncryptedVoiceCredentialStore } from './main/voice/voice-credential-store';
import { VoiceService } from './main/voice/voice-service';
import { watchWindowsGlobalVoiceShortcut } from './main/voice/windows-voice-shortcut-watcher';
import { WorkspaceSelectionService } from './main/workspace/workspace-selection-service';
import {
  AgentActivityUpdateSchema,
  CompanionGuidanceSchema,
  CompanionGuidanceVisualSchema,
  CompanionResponseCardSchema,
  TaskUpdateSchema,
  TROCODE_AUDIO_SCHEME,
  type AuthUser,
  type CompanionGuidance,
  type CompanionInteraction,
  type CompanionResponseActionRequest,
  type CompanionResponseCard,
  type CompanionSpeech,
  type CompanionState,
  type CompanionVoiceActivity,
  type PendingInteraction,
  type TaskSnapshot,
} from './shared/contracts';
import { IPC_CHANNELS } from './shared/desktop-api';
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

app.setName('Tro');
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
]);
isolateDevelopmentInstance(app);

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
    createGuidanceWindow();
    createVoiceIslandWindow();
  }
});

const taskRuntime = new TaskRuntime();
let analyticsService: AnalyticsService | null = null;
const agentActivityService = new AgentActivityService();
const companionResponseController = new CompanionResponseController();
const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';
const taskHistoryService = new TaskHistoryService({
  onError: (error) => {
    console.error('[task-history] PostgreSQL persistence failed.', error);
  },
  store: databaseUrl ? new PostgresTaskHistoryStore(databaseUrl) : null,
});
taskRuntime.on('task-update', taskHistoryService.recordTaskUpdate);
const oauthBrowserFlow = new LocalOAuthBrowserFlow({
  openExternal: async (url) => shell.openExternal(url, { activate: true }),
});
const trocodeApiBaseUrl =
  process.env.TROCODE_API_BASE_URL?.trim() ||
  process.env.TRO_API_BASE_URL?.trim() ||
  '';
const authSessionStore = new EncryptedAuthSessionStore();
const authService = new GoogleAuthService({
  apiBaseUrl: trocodeApiBaseUrl,
  browserFlow: oauthBrowserFlow,
  clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
  clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  sessionStore: authSessionStore,
});
const usageBudgetService = new UsageBudgetService(
  trocodeApiBaseUrl,
  () => authService.getAccessToken(),
);
const membershipService = new MembershipService({
  accessTokenProvider: () => authService.getAccessToken(),
  apiBaseUrl: trocodeApiBaseUrl,
  publicKey: process.env.TROCODE_MEMBERSHIP_PUBLIC_KEY,
  required: membershipRequiredForBuild({
    apiBaseUrl: trocodeApiBaseUrl,
    isPackaged: app.isPackaged,
  }),
  store: new EncryptedMembershipActivationStore(),
});
const knowledgeSpaceClient = new KnowledgeSpaceClient(
  trocodeApiBaseUrl,
  () => authService.getAccessToken(),
);
const activityContextService = new ActivityContextService(knowledgeSpaceClient);
const activityProgressReporter = new ActivityProgressReporter(knowledgeSpaceClient);
const reportActivityProgress = (value: unknown): void => {
  void activityProgressReporter.report(TaskUpdateSchema.parse(value));
};
taskRuntime.on('task-update', reportActivityProgress);
const cuaService = new CuaService({
  onPerformanceMetric: (metric) => {
    void analyticsService?.trackCuaPerformance(metric);
  },
});
const runtimeToolRegistry = new RuntimeToolRegistry([
  ...defaultRuntimeToolDefinitions(),
  ...createCuaSemanticToolDefinitions({
    browserPrepareAvailable: () =>
      cuaService.semanticCapabilities().browserPrepare,
    semanticAvailable: () => cuaService.supportsSemanticFastPath(),
  }),
]);
const appPreferencesService = new AppPreferencesService(
  new FileAppPreferencesStore(
    path.join(app.getPath('userData'), 'app-preferences.json'),
  ),
);
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
});
const elevenLabsTtsService = new ElevenLabsTtsService({
  accessTokenProvider: () => authService.getAccessToken(),
  apiBaseUrl: trocodeApiBaseUrl,
});
const companionNarrationService = new CompanionNarrationService({
  publish: publishCompanionSpeech,
  ttsService: elevenLabsTtsService,
});
const agentRuntime = new OpenAIAgentsRuntime({
  accessTokenProvider: () => authService.getAccessToken(),
  apiBaseUrl: trocodeApiBaseUrl,
  responseLanguageProvider: async () => {
    try {
      const preferences = await appPreferencesService.get();
      return preferences.primaryLanguage ?? preferences.appLanguage;
    } catch {
      return 'en';
    }
  },
});
const agentRuntimeFactory = new AgentRuntimeFactory({
  openaiAgents: agentRuntime,
});
const executionCoordinator = new TaskExecutionCoordinator({
  actionPreviewLanguage: async () => {
    try {
      const preferences = await appPreferencesService.get();
      return preferences.primaryLanguage === 'vi' ||
        preferences.appLanguage === 'vi'
        ? 'vi'
        : 'en';
    } catch {
      return 'en';
    }
  },
  additionalToolAdapters: createActivityToolAdapters(knowledgeSpaceClient),
  agentRuntimeFactory,
  approvalObservationMatches: (approved, current, command) =>
    approvalObservationMatches(approved, current, command, (data) => {
      const image = nativeImage.createFromBuffer(data);
      const { height, width } = image.getSize();
      if (image.isEmpty() || height <= 0 || width <= 0) return undefined;
      return { height, pixels: image.toBitmap(), width };
    }),
  cua: cuaService,
  dismissPresentation: dismissCompanionGuidance,
  onGuidancePlaybackChange: (_taskId, paused) =>
    updateGuidancePlaybackState(paused),
  onActivity: (taskId, activity) =>
    agentActivityService.publish(taskId, activity),
  onDesktopControlChange: updateDesktopControlIndicator,
  onGuidanceWaitEnd: deactivateGlobalGuidanceShortcuts,
  onGuidanceWaitStart: activateGlobalGuidanceShortcuts,
  runtime: taskRuntime,
  toolRegistry: runtimeToolRegistry,
  openExternal: async (url) => shell.openExternal(url, { activate: true }),
  prepareDesktop: async () => {
    const window = mainWindow;
    if (window && !window.isDestroyed() && window.isVisible()) window.hide();

    const restoreCompanion = Boolean(
      companionWindow &&
        !companionWindow.isDestroyed() &&
        companionWindow.isVisible(),
    );
    if (restoreCompanion) companionWindow?.hide();
    if (guidanceWindow && !guidanceWindow.isDestroyed()) guidanceWindow.hide();
    hideGuidanceTargetMarker();
    const restoreControlIndicator = Boolean(
      desktopControlIndicatorWindow &&
        !desktopControlIndicatorWindow.isDestroyed() &&
        desktopControlIndicatorWindow.isVisible(),
    );
    if (restoreControlIndicator) desktopControlIndicatorWindow?.hide();
    await new Promise<void>((resolve) => setTimeout(resolve, 120));

    return () => {
      if (
        restoreCompanion &&
        companionWindow &&
        !companionWindow.isDestroyed()
      ) {
        companionWindow.showInactive();
      }
      if (
        restoreControlIndicator &&
        activeDesktopControlTasks.size > 0 &&
        desktopControlIndicatorWindow &&
        !desktopControlIndicatorWindow.isDestroyed()
      ) {
        desktopControlIndicatorWindow.showInactive();
      }
    };
  },
  prepareObservation: (observation) =>
    resizeObservationForModel(
      attachDesktopCaptureOrigin(observation),
      {
        create: (data) => nativeImage.createFromBuffer(data),
      },
    ),
  presentAction: presentCompanionAction,
  presentActionPreview: presentCompanionActionPreview,
});
const taskApplicationService = new TaskApplicationService(
  taskRuntime,
  executionCoordinator,
  {
    activityContextService,
    activityProgressReporter,
    appPreferencesService,
    workspaceSelectionService,
  },
);
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
});
const COMPANION_SIZE = { height: 44, width: 44 } as const;
const COMPANION_GAP = 8;
const COMPANION_GLIDE_DURATION_MS = 360;
const COMPANION_FOLLOW_INTERVAL_MS = 16;
const GUIDANCE_CALLOUT_SIZE = { height: 176, width: 380 } as const;
const GUIDANCE_TARGET_MARKER_SIZE = { height: 76, width: 76 } as const;
const RESPONSE_CALLOUT_SIZE = { height: 360, width: 420 } as const;
const CLARIFICATION_CALLOUT_SIZE = { height: 286, width: 396 } as const;
const APPROVAL_CALLOUT_SIZE = { height: 448, width: 432 } as const;
const VOICE_ISLAND_SIZE = { height: 76, width: 420 } as const;
const VOICE_ISLAND_TOP_GAP = 10;
const CONTROL_INDICATOR_MIN_VISIBLE_MS = 400;
const CONTROL_INDICATOR_HIDE_SETTLE_MS = 80;
const SHUTDOWN_GRACE_PERIOD_MS = 2_000;
const MAX_TRACKED_PRESENTATION_TASKS = 128;

interface CompanionGlide {
  abortListener: () => void;
  from: Point;
  reject: (error: Error) => void;
  resolve: () => void;
  signal: AbortSignal;
  startedAt: number;
  to: Point;
}

let mainWindow: BrowserWindow | null = null;
let companionWindow: BrowserWindow | null = null;
let desktopControlIndicatorWindow: BrowserWindow | null = null;
let guidanceWindow: BrowserWindow | null = null;
let guidanceTargetWindow: BrowserWindow | null = null;
let voiceIslandWindow: BrowserWindow | null = null;
let companionState: CompanionState = 'idle';
let activeCompanionVoiceActivity: CompanionVoiceActivity | null = null;
const activeDesktopControlTasks = new Set<string>();
const desktopControlStartedAt = new Map<string, number>();
let companionFollowTimer: ReturnType<typeof setInterval> | null = null;
let companionGlide: CompanionGlide | null = null;
let companionPinnedPosition: Point | null = null;
let activeGuidanceTargetBounds: Rectangle | null = null;
let activeCompanionGuidance: CompanionGuidance | null = null;
let activeCompanionInteraction: CompanionInteraction | null = null;
let activeCompanionResponse: CompanionResponseCard | null = null;
let activeCompanionSpeech: CompanionSpeech | null = null;
let companionGuidancePreviousState: CompanionState | null = null;
let guidancePlaybackPaused = false;
let lastCompanionPosition: Point | null = null;
let forcedExitTimer: ReturnType<typeof setTimeout> | null = null;
let shutdownPromise: Promise<void> | null = null;
let unregisterIpcHandlers: (() => void) | null = null;
let unregisterGlobalTaskCancelShortcut: (() => void) | null = null;
let unregisterGlobalVoiceShortcut: (() => void) | null = null;
let globalGuidanceShortcuts: GlobalGuidanceShortcuts | null = null;
let globalNumberedChoiceShortcuts: GlobalNumberedChoiceShortcuts | null = null;
let removeMainWindowCloseBehavior: (() => void) | null = null;
let backgroundTray: Tray | null = null;
let isShuttingDown = false;
let auxiliaryWindowsEnabled = false;
const knownPresentationTaskIds = new Set<string>();
const backgroundPresentationTaskIds = new Set<string>();
let backgroundCompletionNarration: AbortController | null = null;

function stopCompanionFollowing(): void {
  if (companionFollowTimer) clearInterval(companionFollowTimer);
  companionFollowTimer = null;
  cancelCompanionGlide(isShuttingDown ? createAbortError() : undefined);
  companionPinnedPosition = null;
  lastCompanionPosition = null;
}

function sendCompanionState(): void {
  if (!companionWindow || companionWindow.isDestroyed()) return;
  companionWindow.webContents.send(
    IPC_CHANNELS.companionStateChanged,
    companionState,
  );
}

function updateCompanionState(state: CompanionState): void {
  companionState = state;
  sendCompanionState();
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
  activeCompanionVoiceActivity = activity;
  presentationCoordinator.handleVoiceActivity(activity);
  if (!auxiliaryWindowsEnabled) return;
  if (!voiceIslandWindow || voiceIslandWindow.isDestroyed()) return;

  sendCompanionVoiceActivity();
  if (!activity) {
    voiceIslandWindow.hide();
    return;
  }

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

function attachDesktopCaptureOrigin(
  observation: DesktopObservation,
): DesktopObservation {
  const coordinateSpace = observation.coordinateSpace;
  if (
    !coordinateSpace ||
    (coordinateSpace.screenX !== undefined &&
      coordinateSpace.screenY !== undefined)
  ) {
    return observation;
  }

  const displays = screen.getAllDisplays().map((display) => display.bounds);
  const captureBounds = resolveDesktopCaptureBounds(
    {
      height: coordinateSpace.screenHeight,
      width: coordinateSpace.screenWidth,
    },
    displays,
    screen.getPrimaryDisplay().bounds,
  );
  if (!captureBounds) return observation;

  return DesktopObservationSchema.parse({
    ...observation,
    coordinateSpace: {
      ...coordinateSpace,
      screenX: coordinateSpace.screenX ?? captureBounds.x,
      screenY: coordinateSpace.screenY ?? captureBounds.y,
    },
  });
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

function createAbortError(): Error {
  const error = new Error('Companion movement was cancelled.');
  error.name = 'AbortError';
  return error;
}

function settleCompanionGlide(error?: Error): void {
  const glide = companionGlide;
  if (!glide) return;

  companionGlide = null;
  glide.signal.removeEventListener('abort', glide.abortListener);
  if (error) {
    companionPinnedPosition = null;
    glide.reject(error);
    return;
  }

  companionPinnedPosition = glide.to;
  sendCompanionGuidanceVisual(glide.to);
  glide.resolve();
}

function cancelCompanionGlide(error?: Error): void {
  settleCompanionGlide(error);
}

function resetCompanionPresentation(): void {
  cancelCompanionGlide();
  companionPinnedPosition = null;
  dismissCompanionGuidance();
  positionCompanion();
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
    moving: Boolean(companionGlide),
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
  guidanceTargetWindow.setBounds(activeGuidanceTargetBounds, false);
  guidanceTargetWindow.showInactive();
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
    response: activeCompanionResponse,
  });
}

function showCompanionResponseCard(
  response: CompanionResponseCard | null = companionResponseController.current,
): boolean {
  if (!auxiliaryWindowsEnabled || !response) return false;
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
  const response = companionResponseController.current;
  if (response) {
    companionResponseController.dismiss(response.cardId, response.taskId);
  }
  activeCompanionResponse = null;
  sendCompanionResponse();
  if (
    !activeCompanionInteraction &&
    !activeCompanionGuidance &&
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
  } else if (guidanceWindow && !guidanceWindow.isDestroyed()) {
    globalNumberedChoiceShortcuts?.deactivate();
    setGuidanceWindowInteractive(false);
    guidanceWindow.hide();
  }
}

function showCompanionInteraction(interaction: PendingInteraction): void {
  if (!auxiliaryWindowsEnabled) return;
  if (activeCompanionInteraction?.id === interaction.id) return;

  cancelBackgroundCompletionPresentation();
  dismissCompanionGuidance();
  if (!guidanceWindow || guidanceWindow.isDestroyed()) createGuidanceWindow();
  if (!guidanceWindow || guidanceWindow.isDestroyed()) {
    if (mainWindow && !mainWindow.isDestroyed()) revealWindow(mainWindow);
    return;
  }

  const target = getCurrentCompanionScreenPosition();
  const display = screen.getDisplayNearestPoint(target);
  const size =
    interaction.kind === 'approval'
      ? APPROVAL_CALLOUT_SIZE
      : CLARIFICATION_CALLOUT_SIZE;
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
  } else if (guidanceWindow && !guidanceWindow.isDestroyed()) {
    globalNumberedChoiceShortcuts?.deactivate();
    setGuidanceWindowInteractive(false);
    guidanceWindow.hide();
  }
}

function dismissCompanionGuidance(): void {
  hideGuidanceCallout();
  if (
    companionGuidancePreviousState !== null &&
    companionState === 'guiding'
  ) {
    updateCompanionState(companionGuidancePreviousState);
  }
  companionGuidancePreviousState = null;
}

function updateGuidancePlaybackState(paused: boolean): void {
  guidancePlaybackPaused = paused;
  if (!activeCompanionGuidance) return;
  activeCompanionGuidance = CompanionGuidanceSchema.parse({
    ...activeCompanionGuidance,
    playback: paused ? 'paused' : 'playing',
  });
  sendCompanionGuidance();
}

function showGuidanceCallout(
  target: Point,
  presentation: DesktopPresentation,
): boolean {
  if (
    !auxiliaryWindowsEnabled ||
    activeCompanionInteraction ||
    !presentation.message
  ) {
    return false;
  }
  if (!guidanceWindow || guidanceWindow.isDestroyed()) {
    createGuidanceWindow();
  }
  if (!guidanceWindow || guidanceWindow.isDestroyed()) return false;

  const display = screen.getDisplayNearestPoint(target);
  const position = placeGuidanceCallout(
    target,
    display.bounds,
    GUIDANCE_CALLOUT_SIZE,
    COMPANION_SIZE,
  );
  activeCompanionGuidance = CompanionGuidanceSchema.parse({
    kind: presentation.kind ?? 'guidance',
    ...(presentation.language ? { language: presentation.language } : {}),
    message: presentation.message,
    playback: guidancePlaybackPaused ? 'paused' : 'playing',
    ...(presentation.shortcuts ? { shortcuts: presentation.shortcuts } : {}),
    side: position.x < target.x ? 'left' : 'right',
    ...(presentation.target
      ? { target: presentation.target.slice(0, 80) }
      : {}),
  });
  globalNumberedChoiceShortcuts?.deactivate();
  guidanceWindow.setBounds({ ...position, ...GUIDANCE_CALLOUT_SIZE }, false);
  setGuidanceWindowInteractive(false);
  sendCompanionGuidance();
  guidanceWindow.showInactive();
  return true;
}

function companionTargetForCommand(
  command: DesktopCommand,
  presentation?: DesktopPresentation,
): Point | null {
  if (command.kind === 'open_url') {
    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    return placeCompanionForBrowserNavigation(
      display.workArea,
      COMPANION_SIZE,
      COMPANION_GAP,
    );
  }

  if (
    command.kind !== 'click' &&
    command.kind !== 'point' &&
    command.kind !== 'scroll'
  ) {
    return null;
  }
  const pointerPosition = presentation?.screenPoint ?? {
    x: command.x,
    y: command.y,
  };
  const display = screen.getDisplayNearestPoint(pointerPosition);
  return placeCompanionNearCursor(
    pointerPosition,
    display.bounds,
    COMPANION_SIZE,
    COMPANION_GAP,
  );
}

async function presentCompanionAction(
  command: DesktopCommand,
  signal: AbortSignal,
  presentation?: DesktopPresentation,
): Promise<GuidancePresentationHandle | void> {
  const isPointPresentation = command.kind === 'point';
  const isGuidancePoint =
    isPointPresentation && presentation?.kind !== 'action_preview';
  if (isPointPresentation) {
    showGuidanceTargetMarker(
      presentation?.screenPoint ?? { x: command.x, y: command.y },
      presentation?.screenRegion,
    );
  }
  const previousCompanionState = companionState;
  const to = companionTargetForCommand(command, presentation);
  if (!to || !companionWindow || companionWindow.isDestroyed()) {
    return;
  }
  if (command.kind === 'point') {
    console.info(
      '[companion] point.presentation',
      JSON.stringify({
        cuaScreenshotPoint: { x: command.x, y: command.y },
        overlayScreenPoint: presentation?.screenPoint ?? null,
        companionWindowPosition: to,
      }),
    );
  }
  if (signal.aborted) throw createAbortError();
  if (isGuidancePoint) {
    if (companionGuidancePreviousState === null) {
      companionGuidancePreviousState = previousCompanionState;
    }
    updateCompanionState('guiding');
  }

  const from = getCurrentCompanionScreenPosition();
  if (pointEqual(from, to)) {
    companionPinnedPosition = to;
    positionCompanion();
    if (isPointPresentation) {
      return showGuidancePresentation(command, presentation, signal);
    }
    return;
  }

  cancelCompanionGlide();
  await new Promise<void>((resolve, reject) => {
    const abortListener = (): void => settleCompanionGlide(createAbortError());
    companionGlide = {
      abortListener,
      from,
      reject,
      resolve,
      signal,
      startedAt: Date.now(),
      to,
    };
    signal.addEventListener('abort', abortListener, { once: true });
    positionCompanion();
  });

  if (isPointPresentation) {
    return showGuidancePresentation(command, presentation, signal);
  }
}

async function presentCompanionActionPreview(
  preview: ActionPreview,
  signal: AbortSignal,
): Promise<boolean> {
  const point = preview.screenPoint ?? screen.getCursorScreenPoint();
  const handle = await presentCompanionAction(
    { kind: 'point', x: point.x, y: point.y },
    signal,
    {
      kind: 'action_preview',
      language: preview.language,
      message: preview.message,
      screenPoint: point,
      screenRegion: preview.screenRegion ?? {
        x: point.x - 32,
        y: point.y - 24,
        width: 64,
        height: 48,
      },
      taskId: preview.taskId,
      ...(preview.target ? { target: preview.target } : {}),
    },
  );
  if (!handle) return false;
  await waitForActionPreviewDwell(preview.dwellMs, signal);
  return true;
}

function waitForActionPreviewDwell(
  dwellMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw createAbortError();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, dwellMs);
    const handleAbort = (): void => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

function showGuidancePresentation(
  command: Extract<DesktopCommand, { kind: 'point' }>,
  presentation: DesktopPresentation | undefined,
  signal: AbortSignal,
): GuidancePresentationHandle | undefined {
  if (presentation?.message) {
    const shown = showGuidanceCallout(
      presentation.screenPoint ?? { x: command.x, y: command.y },
      presentation,
    );
    if (shown) {
      const markerShown = showGuidanceTargetMarker(
        presentation.screenPoint ?? { x: command.x, y: command.y },
        presentation.screenRegion,
      );
      if (!markerShown) {
        hideGuidanceCallout();
        return undefined;
      }
      return companionNarrationService.begin(
        presentation.message,
        signal,
        presentation.taskId,
      );
    }
  }
  return undefined;
}

async function identifyAnalyticsUser(user: AuthUser): Promise<void> {
  taskHistoryService.setCurrentOwner(user.id);
  await analyticsService?.identifyUser({
    email: user.email,
    loginMethod: 'oauth',
    name: user.name,
    userId: user.id,
  });
}

function enableAuthenticatedAuxiliaryWindows(): void {
  if (isShuttingDown) return;
  auxiliaryWindowsEnabled = true;
  createCompanionWindow();
  createDesktopControlIndicatorWindow();
  createGuidanceWindow();
  createGuidanceTargetWindow();
  createVoiceIslandWindow();
  ensureGlobalVoiceShortcut();
}

function disableAuthenticatedAuxiliaryWindows(): void {
  auxiliaryWindowsEnabled = false;
  cancelBackgroundCompletionPresentation();
  companionState = 'idle';
  activeCompanionVoiceActivity = null;
  companionGuidancePreviousState = null;
  guidancePlaybackPaused = false;
  clearCompanionInteraction();
  dismissCompanionGuidance();
  clearCompanionResponse();
  stopGuidanceSpeech();
  stopCompanionFollowing();
  unregisterGlobalVoiceShortcut?.();
  unregisterGlobalVoiceShortcut = null;
  globalGuidanceShortcuts?.deactivate();
  globalNumberedChoiceShortcuts?.deactivate();
  activeDesktopControlTasks.clear();
  desktopControlStartedAt.clear();

  if (companionWindow && !companionWindow.isDestroyed()) {
    companionWindow.destroy();
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
  stopCompanionFollowing();
  unregisterGlobalTaskCancelShortcut?.();
  unregisterGlobalTaskCancelShortcut = null;
  unregisterGlobalVoiceShortcut?.();
  unregisterGlobalVoiceShortcut = null;
  globalGuidanceShortcuts?.dispose();
  globalGuidanceShortcuts = null;
  globalNumberedChoiceShortcuts?.dispose();
  globalNumberedChoiceShortcuts = null;
  companionNarrationService.shutdown();
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

  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  if (companionWindow && !companionWindow.isDestroyed()) companionWindow.hide();
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
  const executionShutdown = executionCoordinator.shutdown().finally(() =>
    Promise.allSettled([
      cuaService.shutdown(),
      taskHistoryService.shutdown(),
    ]),
  );
  shutdownPromise = Promise.allSettled([
    executionShutdown,
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
  const update = TaskUpdateSchema.parse(value);
  if (!knownPresentationTaskIds.has(update.snapshot.taskId)) {
    cancelBackgroundCompletionPresentation();
    syncCompanionResponse(
      companionResponseController.startRun(update.snapshot.taskId),
    );
    knownPresentationTaskIds.add(update.snapshot.taskId);
    while (knownPresentationTaskIds.size > MAX_TRACKED_PRESENTATION_TASKS) {
      const oldestTaskId = knownPresentationTaskIds.values().next().value as
        | string
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
    syncCompanionResponse(
      requestsGuidedWalkthrough(update.snapshot.request)
        ? companionResponseController.cancelRun(update.snapshot.taskId)
        : companionResponseController.complete(update.snapshot),
    );
  } else if (update.snapshot.phase === 'failed') {
    syncCompanionResponse(
      companionResponseController.failRun(update.snapshot.taskId),
    );
  } else if (update.snapshot.phase === 'cancelled') {
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
): void {
  const response = companionResponseController.current;
  if (
    !response ||
    response.cardId !== request.cardId ||
    response.taskId !== request.taskId
  ) {
    throw new Error('That companion response is no longer active.');
  }
  globalNumberedChoiceShortcuts?.deactivate(
    companionResponseShortcutScope(response),
  );

  switch (request.action) {
    case 'dismiss':
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

function configureDock(): void {
  const dock = app.dock;
  if (process.platform !== 'darwin' || !dock) return;

  void dock.show();
  dock.setIcon(runtimeAppIconPath());
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
  if (!auxiliaryWindowsEnabled || unregisterGlobalVoiceShortcut) return;

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

function ensureGlobalTaskCancelShortcut(): void {
  if (unregisterGlobalTaskCancelShortcut) return;

  unregisterGlobalTaskCancelShortcut = registerGlobalTaskCancelShortcut({
    cancelTask: (taskId) => {
      executionCoordinator.cancel({ taskId });
    },
    registry: globalShortcut,
    updates: taskRuntime,
  });
}

function ensureGlobalGuidanceShortcuts(): GlobalGuidanceShortcuts {
  globalGuidanceShortcuts ??= registerGlobalGuidanceShortcuts({
    back: (taskId) => executionCoordinator.previousGuidance(taskId),
    next: (taskId) => executionCoordinator.nextGuidance(taskId),
    pause: (taskId) => executionCoordinator.toggleGuidancePause(taskId),
    registry: globalShortcut,
  });
  return globalGuidanceShortcuts;
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

function activateGlobalGuidanceShortcuts(
  taskId: string,
): CompanionGuidance['shortcuts'] | undefined {
  if (!auxiliaryWindowsEnabled) return undefined;
  return ensureGlobalGuidanceShortcuts().activate(taskId);
}

function deactivateGlobalGuidanceShortcuts(taskId: string): void {
  globalGuidanceShortcuts?.deactivate(taskId);
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

  const trayIcon = nativeImage
    .createFromPath(runtimeAppIconPath())
    .resize({ height: 18, width: 18 });
  backgroundTray = new Tray(trayIcon);
  backgroundTray.setToolTip('Tro');
  backgroundTray.setContextMenu(
    Menu.buildFromTemplate([
      {
        click: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            revealWindow(mainWindow);
            return;
          }
          createWindow();
        },
        label: 'Show Tro',
      },
      { type: 'separator' },
      {
        click: () => beginShutdown(),
        label: 'Quit Tro',
      },
    ]),
  );
  backgroundTray.on('double-click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) revealWindow(mainWindow);
  });
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
    title: 'Tro',
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
  mainWindow = nextMainWindow;
  configureMicrophonePermissions(nextMainWindow);
  removeMainWindowCloseBehavior?.();
  removeMainWindowCloseBehavior = keepWindowAliveForBackgroundVoice(
    nextMainWindow,
    { isShuttingDown: () => isShuttingDown },
  );

  unregisterIpcHandlers?.();
  unregisterIpcHandlers = registerIpcHandlers(nextMainWindow, {
    activityProgressReporter,
    activityWorkspacePreparationService,
    agentActivityService,
    appPreferencesService,
    appUpdateService,
    authService,
    cuaService,
    executionCoordinator,
    fileSelectionService,
    getCompanionInteractionWindow: () => guidanceWindow,
    handleCompanionResponseAction,
    membershipService,
    knowledgeSpaceClient,
    knowledgeUploadOrchestrator,
    onAuthSignedIn: async (user) => {
      await identifyAnalyticsUser(user);
      enableAuthenticatedAuxiliaryWindows();
    },
    onAuthSignedOut: async () => {
      disableAuthenticatedAuxiliaryWindows();
      taskHistoryService.setCurrentOwner(null);
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

  if (!app.isPackaged) nextMainWindow.webContents.openDevTools({ mode: 'detach' });
};

function getCurrentCompanionScreenPosition(): Point {
  if (!companionWindow || companionWindow.isDestroyed()) {
    return { x: 0, y: 0 };
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

  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  return placeCompanionNearCursor(
    cursor,
    display.bounds,
    COMPANION_SIZE,
    COMPANION_GAP,
  );
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

function positionCompanion(): void {
  if (!companionWindow || companionWindow.isDestroyed()) return;

  const glide = companionGlide;
  if (glide) {
    const progress =
      (Date.now() - glide.startedAt) / COMPANION_GLIDE_DURATION_MS;
    const position = interpolateCompanionPosition(glide.from, glide.to, progress);
    applyCompanionScreenPosition(position);
    if (progress >= 1) settleCompanionGlide();
    return;
  }

  if (companionPinnedPosition) {
    applyCompanionScreenPosition(companionPinnedPosition);
    return;
  }

  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  applyCompanionScreenPosition(
    placeCompanionNearCursor(
      cursor,
      display.bounds,
      COMPANION_SIZE,
      COMPANION_GAP,
    ),
  );
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

const createCompanionWindow = (): void => {
  if (!auxiliaryWindowsEnabled) return;
  if (companionWindow && !companionWindow.isDestroyed()) return;

  const useOverlayCompanion = shouldUseCompanionOverlay(process.platform);
  const companionBounds = useOverlayCompanion
    ? getCompanionOverlayBounds()
    : { ...COMPANION_SIZE, x: 0, y: 0 };

  companionWindow = new BrowserWindow({
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    focusable: false,
    frame: false,
    hasShadow: false,
    height: companionBounds.height,
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

  companionWindow.setIgnoreMouseEvents(true, { forward: true });
  companionWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  companionWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  companionWindow.webContents.on('did-finish-load', () => {
    sendCompanionState();
    lastCompanionPosition = null;
    positionCompanion();
  });
  companionWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  const companionUrl = new URL(MAIN_WINDOW_WEBPACK_ENTRY);
  companionUrl.searchParams.set('mode', 'companion');
  companionUrl.searchParams.set(
    'tracking',
    useOverlayCompanion ? 'overlay' : 'native',
  );

  companionWindow.once('ready-to-show', () => {
    if (!auxiliaryWindowsEnabled) return;
    positionCompanion();
    companionWindow?.showInactive();
  });
  companionWindow.on('closed', () => {
    companionWindow = null;
    stopCompanionFollowing();
  });

  void companionWindow.loadURL(companionUrl.toString());
  positionCompanion();
  companionFollowTimer = setInterval(
    positionCompanion,
    COMPANION_FOLLOW_INTERVAL_MS,
  );
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
    configureDock();
    registerCompanionAudioProtocol();
    appUpdateService.start();
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
      taskHistoryService.start(),
    ]);
    const authStatus = await authService.getStatus();
    if (authStatus.user) await identifyAnalyticsUser(authStatus.user);
    auxiliaryWindowsEnabled = isAuthenticatedCompanionSession(authStatus);
    createWindow();
    if (auxiliaryWindowsEnabled) enableAuthenticatedAuxiliaryWindows();
    ensureBackgroundTray();
    ensureGlobalTaskCancelShortcut();
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
    createGuidanceWindow();
    createVoiceIslandWindow();
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
