import { invoke } from '@tauri-apps/api/core';
import { listen, type Event } from '@tauri-apps/api/event';

import type {
  AgentActivityUpdate,
  AppUpdateStatus,
  CompanionGuidance,
  CompanionGuidanceVisual,
  CompanionInteraction,
  CompanionPosition,
  CompanionResponseCard,
  CompanionSpeech,
  CompanionState,
  CompanionVoiceActivity,
  TaskUpdate,
  VoiceShortcutEvent,
} from '../shared/contracts';
import type { CompanionApi, DesktopApi } from '../shared/desktop-api';

function command<T>(name: string, request?: unknown): Promise<T> {
  return invoke<T>(name, request === undefined ? undefined : { request });
}

function subscribe<T>(eventName: string, listener: (payload: T) => void): () => void {
  let active = true;
  let dispose: (() => void) | undefined;
  void listen<T>(eventName, (event: Event<T>) => {
    if (active) listener(event.payload);
  }).then((unlisten) => {
    if (active) dispose = unlisten;
    else unlisten();
  });
  return () => {
    active = false;
    dispose?.();
  };
}

const desktop: DesktopApi = {
  activateMembership: (request) => command('activate_membership', request),
  cancelTask: (taskId) => command('cancel_task', { taskId }),
  checkForAppUpdates: () => command('check_for_app_updates'),
  configureVoice: (request) => command('configure_voice', request),
  connectComputer: () => command('connect_computer'),
  transcribeVoiceSegment: (request) => command('transcribe_voice_segment', request),
  decideApproval: (request) => command('decide_approval', request),
  getAppPreferences: () => command('get_app_preferences'),
  getAppUpdateStatus: () => command('get_app_update_status'),
  getComputerStatus: () => command('get_computer_status'),
  getMembershipStatus: () => command('get_membership_status'),
  getUsageBudget: (taskId) => command('get_usage_budget', taskId ? { taskId } : undefined),
  getTaskHistory: () => command('get_task_history'),
  getAuthStatus: () => command('get_auth_status'),
  getVoiceStatus: () => command('get_voice_status'),
  getWorkspaceRuntimeAvailability: () => command('get_workspace_runtime_availability'),
  getKnowledgeCapabilities: () => command('get_knowledge_capabilities'),
  listKnowledgeSpaces: () => command('list_knowledge_spaces'),
  createKnowledgeSpace: (request) => command('create_knowledge_space', request),
  getKnowledgeSpace: (spaceId) => command('get_knowledge_space', { spaceId }),
  listKnowledgeSources: (spaceId) => command('list_knowledge_sources', { spaceId }),
  selectKnowledgeFiles: (request) => command('select_knowledge_files', request),
  uploadKnowledgeSelection: (request) => command('upload_knowledge_selection', request),
  saveKnowledgeActivity: (request) => command('save_knowledge_activity', request),
  publishKnowledgeActivity: (request) => command('publish_knowledge_activity', request),
  createKnowledgeRun: (request) => command('create_knowledge_run', request),
  setKnowledgeRunState: (request) => command('set_knowledge_run_state', request),
  listAssignedActivities: () => command('list_assigned_activities'),
  getHostedAttempt: (attemptId) => command('get_hosted_attempt', { attemptId }),
  acknowledgeHostedAttempt: (request) => command('acknowledge_hosted_attempt', request),
  getKnowledgeDashboard: (request) => command('get_knowledge_dashboard', request),
  prepareActivityStarter: (request) => command('prepare_activity_starter', request),
  submitKnowledgeSelection: (request) => command('submit_knowledge_selection', request),
  listKnowledgeGroups: (spaceId) => command('list_knowledge_groups', { spaceId }),
  createKnowledgeGroup: (request) => command('create_knowledge_group', request),
  createKnowledgeInvite: (request) => command('create_knowledge_invite', request),
  redeemKnowledgeInvite: (request) => command('redeem_knowledge_invite', request),
  requestKnowledgeAttemptHelp: (request) => command('request_knowledge_attempt_help', request),
  onTaskUpdate: (listener) => subscribe<TaskUpdate>('task:update', listener),
  onTaskComposerFocusRequested: (listener) =>
    subscribe<string>('task:composer-focus-requested', listener),
  onAgentActivity: (listener) => subscribe<AgentActivityUpdate>('agent:activity', listener),
  onAppUpdateStatusChanged: (listener) =>
    subscribe<AppUpdateStatus>('update:status-changed', listener),
  onVoiceShortcut: (listener) => subscribe<VoiceShortcutEvent>('voice:shortcut', listener),
  openSystemPermissionSettings: (permission) =>
    command<void>('open_system_permission_settings', { permission }),
  recordVoiceTranscript: (request) => command<void>('record_voice_transcript', request),
  reportVoiceDiagnostic: (request) => command<void>('report_voice_diagnostic', request),
  restartAndInstallAppUpdate: () => command<void>('restart_and_install_app_update'),
  respondToInteraction: (request) => command('respond_to_interaction', request),
  setCompanionState: (state) => command<void>('set_companion_state', state),
  setCompanionVoiceActivity: (activity) =>
    command<void>('set_companion_voice_activity', activity),
  setVoiceAudioDucking: (request) => command<void>('set_voice_audio_ducking', request),
  startTask: (taskId) => command('start_task', { taskId }),
  signInWithGoogle: () => command('sign_in_with_google'),
  signOutGoogle: () => command('sign_out_google'),
  selectWorkspace: () => command('select_workspace'),
  steerTask: (request) => command('steer_task', request),
  submitTask: (request) => command('submit_task', request),
  updateAppPreferences: (request) => command('update_app_preferences', request),
};

const companion: CompanionApi = {
  decideApproval: (request) => command('decide_approval', request),
  onGuidanceChange: (listener) =>
    subscribe<CompanionGuidance | null>('companion:guidance-changed', listener),
  onGuidanceVisualChange: (listener) =>
    subscribe<CompanionGuidanceVisual | null>('companion:guidance-visual-changed', listener),
  onInteractionChange: (listener) =>
    subscribe<CompanionInteraction | null>('companion:interaction-changed', listener),
  onPositionChange: (listener) =>
    subscribe<CompanionPosition>('companion:position-changed', listener),
  onResponseChange: (listener) =>
    subscribe<CompanionResponseCard | null>('companion:response-changed', listener),
  onSpeechChange: (listener) =>
    subscribe<CompanionSpeech | null>('companion:speech-changed', listener),
  onStateChange: (listener) => subscribe<CompanionState>('companion:state-changed', listener),
  onVoiceActivityChange: (listener) =>
    subscribe<CompanionVoiceActivity | null>('companion:voice-activity-changed', listener),
  reportSpeechPlayback: (request) =>
    command<void>('companion_report_speech_playback', request),
  performResponseAction: (request) => command<void>('companion_response_action', request),
  respondToInteraction: (request) => command('respond_to_interaction', request),
  revealMainWindow: () => command<void>('companion_reveal_main_window'),
};

Object.defineProperty(window, 'tro', { configurable: false, value: desktop });
Object.defineProperty(window, 'troCompanion', { configurable: false, value: companion });
