import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import type {
  TeacherClassroomSelection,
  AgentActivityUpdate,
  AppLanguage,
  AppPreferences,
  AppUpdateStatus,
  AuthUser,
  ClassroomAccountRole,
  CompanionVoiceActivity,
  CompanionCustomizationStatus,
  CuaStatus,
  ExecutionProfile,
  GoalSpec,
  GenerateCompanionImageRequest,
  KnowledgeSpaceSummary,
  MembershipStatus,
  OrganizationSummary,
  PendingInteraction,
  PrimaryLanguage,
  TaskEvent,
  TaskHistory,
  TaskSnapshot,
  UsageBudgetSnapshot,
  VoiceStatus,
  WorkspaceRuntimeAvailability,
  WorkspaceSelection,
  SubmitTaskRequest,
  VoiceMode,
} from '../shared/contracts';
import { VOICE_TRANSCRIPTION_MODEL } from '../shared/contracts';

import './classroom-broadcast.css';

import { acceptAgentActivity } from './agent-activity-projection';
import { appLanguageLabel, translate } from './app-language';
import {
  navigationTitle,
  organizationSettingsAvailable,
  type ActiveView,
} from './app-navigation';
import { AppUpdateButton } from './AppUpdateButton';
import { BrandMark } from './BrandMark';
import { hasAssignedClassroomRole } from './class-workspace';
import { sameClassroomVoiceDestination } from './classroom-voice-binding';
import { ClassroomBroadcastPreview } from './ClassroomBroadcastPreview';
import { ClassroomExplanationPanel } from './ClassroomExplanationPanel';
import { ClassroomSessionBar } from './ClassroomSessionBar';
import type { CompanionCustomizationBusy } from './CompanionCustomizationCard';
import { HistoryPage } from './HistoryPage';
import { InsightsPage } from './InsightsPage';
import { KnowledgeHubPage } from './KnowledgeHubPage';
import {
  isPrimaryLanguageSetupComplete,
  primaryLanguageLabel,
} from './language-options';
import { appEntryGate, membershipAllowsAccess } from './membership';
import { MembershipGate } from './MembershipGate';
import { OrganizationPage } from './OrganizationPage';
import {
  createPermissionChecklist,
  inspectMicrophonePermission,
  requestScreenRecordingPermission,
  shouldConnectAfterPermissionRefresh,
  type PermissionState,
} from './permission-onboarding';
import { PermissionOnboarding } from './PermissionOnboarding';
import { SettingsPage } from './SettingsPage';
import { SidebarClassWorkspaceSwitcher } from './SidebarClassWorkspaceSwitcher';
import { SidebarPlanTitle } from './SidebarPlanTitle';
import type { SpaceDetailTab } from './SpaceDetailPage';
import {
  computerPermissionWaitPresentation,
  isTaskCancellable,
  isTaskSteerable,
  isTaskTerminal,
  shouldAutoStartTask,
  shouldStopTaskForEscape,
} from './task-execution';
import {
  INITIAL_TRANSIENT_CURSOR_ERROR_STATE,
  scheduleTransientCursorErrorDismissal,
  transientCursorErrorReducer,
} from './transient-cursor-error';
import {
  accountPlan,
  planTitle,
  remainingUsagePercent,
} from './usage-presentation';
import {
  shouldMuteSystemAudioForVoice,
  usePushToTalk,
  type VoiceAttemptDecision,
  type VoiceCommitDisposition,
  type VoiceInputStatus,
  type VoiceTurnContext,
  type VoiceTurnEndReason,
} from './use-push-to-talk';
import {
  applyDictationTranscript,
  captureVoiceDraftSnapshot,
  type VoiceDraftSnapshot,
} from './voice-draft';
import {
  shouldRetainVoiceTerminalActivity,
  voiceTaskScreenContext,
  voiceTurnRoute,
  type VoiceTerminalDisposition,
} from './voice-route';
import {
  isVoiceModeToggleShortcut,
  nextVoiceMode,
  VoiceModeControl,
} from './VoiceModeControl';

const EXAMPLE_TASKS = [
  'Open YouTube for me',
  'Show me how to organize my Downloads folder',
  'Research three note-taking apps and compare them',
  'Fix the failing tests in my project',
] as const;

const EMPTY_COMPUTER_STATUS: CuaStatus = {
  state: 'disconnected',
  available: false,
  platform: 'unsupported',
  summary: 'Checking the computer-use runtime…',
  nextActions: [],
};

const EMPTY_VOICE_STATUS: VoiceStatus = {
  state: 'not_configured',
  provider: 'openai',
  model: VOICE_TRANSCRIPTION_MODEL,
  summary: 'Checking OpenAI GPT Transcribe…',
};

function appendUniqueEvent(
  currentEvents: TaskEvent[],
  event: TaskEvent,
): TaskEvent[] {
  return currentEvents.some(
    (currentEvent) => currentEvent.eventId === event.eventId,
  )
    ? currentEvents
    : [...currentEvents, event];
}

function mergeTaskSnapshots(
  currentSnapshots: Record<string, TaskSnapshot>,
  incomingSnapshots: readonly TaskSnapshot[],
): Record<string, TaskSnapshot> {
  const mergedSnapshots = { ...currentSnapshots };
  for (const snapshot of incomingSnapshots) {
    const current = mergedSnapshots[snapshot.taskId];
    if (!current || current.updatedAt < snapshot.updatedAt) {
      mergedSnapshots[snapshot.taskId] = snapshot;
    }
  }
  return mergedSnapshots;
}

function mergeTaskEvents(
  currentEvents: readonly TaskEvent[],
  incomingEvents: readonly TaskEvent[],
): TaskEvent[] {
  const eventIds = new Set(currentEvents.map((event) => event.eventId));
  const mergedEvents = [...currentEvents];
  for (const event of incomingEvents) {
    if (eventIds.has(event.eventId)) continue;
    eventIds.add(event.eventId);
    mergedEvents.push(event);
  }
  return mergedEvents.sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
}

function NavigationIcon({
  name,
}: {
  name:
    | 'activity'
    | 'agent'
    | 'assigned'
    | 'history'
    | 'insights'
    | 'organization'
    | 'settings';
}) {
  if (name === 'agent') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 3 4.5 7.2v9.6L12 21l7.5-4.2V7.2L12 3Z" />
        <path d="M8.5 12h7M12 8.5v7" />
      </svg>
    );
  }

  if (name === 'insights') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    );
  }

  if (name === 'history') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4.5 6.5h10M4.5 12h7M4.5 17.5h5" />
        <path d="M18.5 10v4.5l2.5 1.5" />
        <circle cx="18.5" cy="14.5" r="4" />
      </svg>
    );
  }

  if (name === 'assigned') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M6 3h12v18H6z" />
        <path d="m9 12 2 2 4-5M9 7h6" />
      </svg>
    );
  }

  if (name === 'organization') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 19v-2.2A3.8 3.8 0 0 1 7.3 13h3.4a3.8 3.8 0 0 1 3.8 3.8V19" />
        <path d="M16 10.5a2.5 2.5 0 1 0 0-5M16.5 13.5a3.5 3.5 0 0 1 4 3.5v2" />
      </svg>
    );
  }

  if (name === 'settings') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7.4 7.4 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L14.5 3h-5L9 6.1a8 8 0 0 0-1.7 1L5 6.1 3 9.5 5 11a7.4 7.4 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.7 1l.4 3.1h5l.4-3.1a8 8 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5a7.4 7.4 0 0 0 .1-1Z" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 12h4l2-6 4 12 2-6h4" />
    </svg>
  );
}

function formatLabel(value: string, appLanguage: AppLanguage = 'en'): string {
  return translate(appLanguage, value.replaceAll('_', ' '));
}

function voiceStatusMessage(
  status: VoiceInputStatus,
  appLanguage: AppLanguage,
  mode: VoiceMode | null,
): string {
  switch (status) {
    case 'listening':
      return translate(
        appLanguage,
        mode === 'task'
          ? 'Giving Tro a task… Release to transcribe, then press Escape to cancel.'
          : 'Dictating… Release to insert text without sending.',
      );
    case 'processing':
      return translate(appLanguage, 'Finishing transcript…');
    case 'committing':
      return translate(
        appLanguage,
        mode === 'task' ? 'Sending voice task…' : 'Inserting dictated text…',
      );
    case 'requesting_permission':
      return translate(appLanguage, 'Waiting for microphone access…');
    case 'unavailable':
      return translate(
        appLanguage,
        'Voice recognition is unavailable. Type your request instead.',
      );
    case 'idle': {
      return translate(appLanguage, 'Voice ready.');
    }
  }
}

function ComputerConnection({
  appLanguage,
  isConnecting,
  onConnect,
  ready,
  status,
}: {
  appLanguage: AppLanguage;
  isConnecting: boolean;
  onConnect: () => void;
  ready: boolean;
  status: CuaStatus;
}) {
  const t = (message: string) => translate(appLanguage, message);
  return (
    <section className="computer-card" aria-labelledby="computer-heading">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">{t('Optional tool')}</p>
          <h2 id="computer-heading">{t('Computer use')}</h2>
        </div>
        <span
          className={`status-dot status-dot--${ready ? 'ready' : 'disconnected'}`}
        >
          {ready ? t('Connected') : t('Not connected')}
        </span>
      </div>
      <p>
        {ready
          ? t(
              'Ready when the agent needs to inspect or operate an application.',
            )
          : t(
              'Text tasks work now. Connect only when you want the agent to use visible applications.',
            )}
      </p>
      {!ready && (
        <button
          className="secondary-button"
          disabled={isConnecting}
          onClick={onConnect}
          type="button"
        >
          {isConnecting ? t('Connecting…') : t('Connect computer')}
        </button>
      )}
      {status.state === 'error' && <p className="metadata">{status.summary}</p>}
    </section>
  );
}

function LiveTaskRail({
  activities,
  activity,
  appLanguage,
  autoStartFailed,
  canStart,
  goal,
  isStarting,
  lastEvent,
  onRetry,
  phase,
  progress,
  request,
  streamingDraft,
}: {
  activities: readonly AgentActivityUpdate[];
  activity: AgentActivityUpdate | null;
  appLanguage: AppLanguage;
  autoStartFailed: boolean;
  canStart: boolean;
  goal: GoalSpec | null;
  isStarting: boolean;
  lastEvent: TaskEvent | null;
  onRetry: () => void;
  phase: TaskSnapshot['phase'];
  progress: TaskSnapshot['progress'];
  request: string;
  streamingDraft: string;
}) {
  const t = (message: string) => translate(appLanguage, message);
  const completedToolCalls = progress?.completed ?? 0;
  const progressLabel = progress
    ? translate(
        appLanguage,
        progress.completed === 1 ? '{count} tool call' : '{count} tool calls',
        { count: progress.completed },
      )
    : t('Not started');
  const taskTitle = goal?.originalRequest ?? request;
  const showProgress = completedToolCalls > 0;
  const activityText =
    activity?.kind === 'text_delta'
      ? streamingDraft.slice(-500)
      : (activity?.summary ?? lastEvent?.summary);
  const announceActivity =
    activity?.kind === 'tool_started' || activity?.kind === 'tool_completed';
  const visibleActivities = activities
    .filter((item) => item.kind !== 'text_delta')
    .slice(-50);

  return (
    <section
      aria-labelledby="live-task-heading"
      className={`live-task-rail live-task-rail--${phase}`}
    >
      <div className="live-task-rail__signal" aria-hidden="true">
        <span />
      </div>
      <div className="live-task-rail__body">
        <div className="live-task-rail__header">
          <div>
            <p aria-live="polite" className="eyebrow">
              {t('Live task')} · {formatLabel(phase, appLanguage)}
            </p>
            <h2 id="live-task-heading">{taskTitle}</h2>
          </div>
          {showProgress && (
            <div
              aria-label={`${t('Progress')} ${progressLabel}`}
              className="live-task-rail__progress"
            >
              <span>{progressLabel}</span>
            </div>
          )}
        </div>

        <div className="live-task-rail__summary">
          <span>
            {goal
              ? goal.executionProfile === 'workspace'
                ? t('Workspace agent')
                : t('Everyday agent')
              : t('Understanding request')}
          </span>
          <span aria-hidden="true">·</span>
          <span>
            {goal ? t('Tools selected at runtime') : t('Preparing task')}
          </span>
        </div>

        {activityText && !['ready', 'blocked'].includes(phase) && (
          <p
            aria-live={announceActivity ? 'polite' : 'off'}
            className="live-task-rail__activity"
          >
            {activityText}
          </p>
        )}

        {visibleActivities.length > 0 && (
          <details className="agent-activity-list">
            <summary>{t('Activity')}</summary>
            <ol>
              {visibleActivities.map((item) => (
                <li key={`${item.taskId}-${item.sequence}`}>
                  <span>{item.summary}</span>
                  {item.kind === 'plan_updated' && item.plan && (
                    <ul>
                      {item.plan.map((step, index) => (
                        <li key={`${item.sequence}-${index}`}>
                          <span>{step.status}</span> {step.step}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </details>
        )}

        {goal && (
          <details className="live-task-details">
            <summary>{t('Task details')}</summary>
            <div className="live-task-details__content">
              {goal.activity && (
                  <div className="activity-context-chip">
                    <span>{goal.activity.space.name}</span>
                    <strong>{goal.activity.activity.title}</strong>
                  </div>
                )}
              <div>
                <span className="field-label">{t('Execution')}</span>
                <p>
                  {t(
                    'Tro executes the requested goal within the selected workspace and available capabilities. It pauses only when it needs clarification, an operating-system permission, or account authorization.',
                  )}
                </p>
              </div>
              <div>
                <span className="field-label">{t('Success looks like')}</span>
                <p>
                  {t(
                    'A useful assistant answer or an evidence-backed tool result.',
                  )}
                </p>
              </div>
            </div>
          </details>
        )}

        {phase === 'blocked' && lastEvent && (
          <div className="live-task-blocked" role="alert">
            <strong>{t('Why Tro stopped')}</strong>
            <p>{lastEvent.summary}</p>
            {lastEvent.nextActions[0] && (
              <span>{lastEvent.nextActions[0]}</span>
            )}
          </div>
        )}

        {phase === 'ready' && (
          <div className="live-task-rail__start">
            <p aria-live="polite">
              {!canStart
                ? t('Waiting for the OpenAI agent provider before starting.')
                : autoStartFailed
                  ? t('Tro could not start automatically. You can try again.')
                  : isStarting
                    ? t(
                        'Starting automatically… Press Escape while Tro is focused to stop.',
                      )
                    : t(
                        'Ready. Starting automatically… Press Escape while Tro is focused to stop.',
                      )}
            </p>
            {autoStartFailed && (
              <button
                className="primary-button"
                disabled={!canStart || isStarting}
                onClick={onRetry}
                type="button"
              >
                {isStarting ? t('Starting…') : t('Try again')}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function TerminalOutcome({
  appLanguage,
  onViewHistory,
  snapshot,
}: {
  appLanguage: AppLanguage;
  onViewHistory: () => void;
  snapshot: TaskSnapshot;
}) {
  const t = (message: string) => translate(appLanguage, message);
  const heading =
    snapshot.phase === 'completed'
      ? t('Outcome reached')
      : snapshot.phase === 'cancelled'
        ? t('Task stopped safely')
        : t('Task needs attention');

  return (
    <section
      aria-labelledby="terminal-heading"
      className={`terminal-outcome terminal-outcome--${snapshot.phase}`}
    >
      <span className="terminal-outcome__mark" aria-hidden="true">
        {snapshot.phase === 'completed'
          ? '✓'
          : snapshot.phase === 'cancelled'
            ? '–'
            : '!'}
      </span>
      <div>
        <p className="eyebrow">{formatLabel(snapshot.phase, appLanguage)}</p>
        <h2 id="terminal-heading">{heading}</h2>
        <p>
          {snapshot.lastEvent?.summary ??
            t(
              'The task finished. Its conversation and activity are available in History.',
            )}
        </p>
      </div>
      <button
        className="terminal-outcome__link"
        onClick={onViewHistory}
        type="button"
      >
        {t('View task trail')} <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}

function ActivityList({
  appLanguage,
  events,
}: {
  appLanguage: AppLanguage;
  events: TaskEvent[];
}) {
  if (events.length === 0) {
    return (
      <p className="empty-activity">
        {translate(appLanguage, 'Task events will appear here.')}
      </p>
    );
  }

  return (
    <ol className="activity-list">
      {events.map((event) => (
        <li key={event.eventId}>
          <span
            className={`activity-marker activity-marker--${event.status}`}
          />
          <div>
            <strong>{formatLabel(event.phase, appLanguage)}</strong>
            <p>{event.summary}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Conversation({
  appLanguage,
  snapshot,
}: {
  appLanguage: AppLanguage;
  snapshot: TaskSnapshot;
}) {
  const t = (message: string) => translate(appLanguage, message);
  return (
    <section
      className="conversation-card"
      aria-labelledby="conversation-heading"
    >
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">{t('Same task')}</p>
          <h2 id="conversation-heading">{t('Conversation')}</h2>
        </div>
        <span className="event-count">{snapshot.messages.length}</span>
      </div>
      <ol aria-live="polite" className="message-list">
        {snapshot.messages.map((message) => (
          <li
            className={`message message--${message.role}`}
            key={message.messageId}
          >
            <span>{message.role === 'user' ? t('You') : 'Tro'}</span>
            <p>{message.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PendingInteractionCard({
  appLanguage,
  interaction,
  isSending,
  onAnswerChoice,
}: {
  appLanguage: AppLanguage;
  interaction: PendingInteraction;
  isSending: boolean;
  onAnswerChoice: (answer: string, choiceId: string) => void;
}) {
  const t = (message: string) => translate(appLanguage, message);
  return (
    <section
      aria-live="polite"
      aria-labelledby="interaction-heading"
      className="interaction-card interaction-card--clarification"
    >
      <p className="eyebrow">{t('Tro needs your input')}</p>
      <h2 id="interaction-heading">{interaction.prompt}</h2>
      {interaction.choices && (
        <div className="interaction-choices">
          {interaction.choices.map((choice) => (
            <button
              disabled={isSending}
              key={choice.id}
              onClick={() => onAnswerChoice(choice.label, choice.id)}
              type="button"
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}
      <p>
        {t(
          'Answer below by voice or text. Your response will continue this task.',
        )}
      </p>
    </section>
  );
}

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
  const [knowledgeSpacesEnabled, setKnowledgeSpacesEnabled] = useState(false);
  const [classroomRole, setClassroomRole] =
    useState<ClassroomAccountRole>('unassigned');
  const [classSpaces, setClassSpaces] = useState<KnowledgeSpaceSummary[]>([]);
  const [classSpacesLoading, setClassSpacesLoading] = useState(false);
  const [classSpacesError, setClassSpacesError] = useState<string | null>(null);
  const [selectedClassSpace, setSelectedClassSpace] =
    useState<KnowledgeSpaceSummary | null>(null);
  const [teacherSelection, setTeacherSelection] =
    useState<TeacherClassroomSelection | null>(null);
  const [teacherSelectionPending, setTeacherSelectionPending] = useState(false);
  const teacherSelectionRef = useRef<TeacherClassroomSelection | null>(null);
  const teacherSelectionPendingRef = useRef(false);
  const teacherSelectionGenerationRef = useRef(0);
  const teacherTaskBindingsRef = useRef(new Map<string, string | null>());
  const teacherVoiceBindingsRef = useRef(
    new Map<
      string,
      {
        selectionId: string | null;
        taskId: string | null;
        interactionId: string | null;
      }
    >(),
  );
  useEffect(() => {
    ++teacherSelectionGenerationRef.current;
    const selected = teacherSelectionRef.current;
    if (selected && selected.binding.spaceId !== selectedClassSpace?.id) {
      teacherSelectionRef.current = null;
      setTeacherSelection(null);
      void window.tro
        .clearTeacherClassroom({ selectionId: selected.selectionId })
        .catch(() => undefined);
    }
  }, [selectedClassSpace?.id]);
  const selectTeacherSession = useCallback(
    async (spaceId: string, sessionId: string | null) => {
      if (!window.tro.selectTeacherClassroom) return;
      if (!sessionId) {
        const selected = teacherSelectionRef.current;
        teacherSelectionRef.current = null;
        setTeacherSelection(null);
        if (selected)
          await window.tro.clearTeacherClassroom({
            selectionId: selected.selectionId,
          });
        return;
      }
      const generation = teacherSelectionGenerationRef.current;
      teacherSelectionPendingRef.current = true;
      setTeacherSelectionPending(true);
      try {
        const selected = await window.tro.selectTeacherClassroom({
          spaceId,
          sessionId,
        });
        if (generation !== teacherSelectionGenerationRef.current) {
          await window.tro.clearTeacherClassroom({
            selectionId: selected.selectionId,
          });
          return;
        }
        teacherSelectionRef.current = selected;
        setTeacherSelection(selected);
      } finally {
        teacherSelectionPendingRef.current = false;
        setTeacherSelectionPending(false);
      }
    },
    [],
  );
  const [selectedClassSpaceTab, setSelectedClassSpaceTab] =
    useState<SpaceDetailTab>('library');
  const [classroomAttemptFocus, setClassroomAttemptFocus] = useState<
    string | null
  >(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [input, setInput] = useState('');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [selectedVoiceMode, setSelectedVoiceMode] =
    useState<VoiceMode>('dictation');
  const [voiceDestination, setVoiceDestination] = useState<
    CompanionVoiceActivity['destination']
  >({ kind: 'tro_composer', label: 'Tro composer' });
  const [voiceActivityOverride, setVoiceActivityOverride] =
    useState<CompanionVoiceActivity | null>(null);
  const [snapshot, setSnapshot] = useState<TaskSnapshot | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [agentActivity, setAgentActivity] =
    useState<AgentActivityUpdate | null>(null);
  const [agentActivities, setAgentActivities] = useState<AgentActivityUpdate[]>(
    [],
  );
  const [streamingDraft, setStreamingDraft] = useState('');
  const [sessionEvents, setSessionEvents] = useState<TaskEvent[]>([]);
  const [sessionSnapshots, setSessionSnapshots] = useState<
    Record<string, TaskSnapshot>
  >({});
  const [taskPersistence, setTaskPersistence] = useState<
    TaskHistory['persistence']
  >({
    mode: 'session_only',
    summary: 'Loading saved task history…',
  });
  const [computerStatus, setComputerStatus] = useState<CuaStatus>(
    EMPTY_COMPUTER_STATUS,
  );
  const [voiceProviderStatus, setVoiceProviderStatus] =
    useState<VoiceStatus>(EMPTY_VOICE_STATUS);
  const [appPreferences, setAppPreferences] = useState<AppPreferences | null>(
    null,
  );
  const [appUpdateStatus, setAppUpdateStatus] =
    useState<AppUpdateStatus | null>(null);
  const [appUpdateError, setAppUpdateError] = useState<string | null>(null);
  const [usageBudget, setUsageBudget] = useState<UsageBudgetSnapshot | null>(
    null,
  );
  const [isUpdatingApp, setIsUpdatingApp] = useState(false);
  const [languageDraft, setLanguageDraft] = useState<PrimaryLanguage>('en');
  const [appLanguageDraft, setAppLanguageDraft] = useState<AppLanguage>('en');
  const [classroomPetEnabledDraft, setClassroomPetEnabledDraft] =
    useState(true);
  const [executionProfile, setExecutionProfile] =
    useState<ExecutionProfile>('everyday');
  const [workspaceRuntime, setWorkspaceRuntime] =
    useState<WorkspaceRuntimeAvailability | null>(null);
  const [workspaceSelection, setWorkspaceSelection] =
    useState<WorkspaceSelection | null>(null);
  const [isSelectingWorkspace, setIsSelectingWorkspace] = useState(false);
  const [
    muteSystemAudioWhileSpeakingDraft,
    setMuteSystemAudioWhileSpeakingDraft,
  ] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [preferencesLoadError, setPreferencesLoadError] = useState<
    string | null
  >(null);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaveMessage, setSettingsSaveMessage] = useState<string | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isStoppingTask, setIsStoppingTask] = useState(false);
  const [isCheckingPermissions, setIsCheckingPermissions] = useState(true);
  const [isRequestingPermissions, setIsRequestingPermissions] = useState(false);
  const [computerStatusLoaded, setComputerStatusLoaded] = useState(false);
  const [microphonePermission, setMicrophonePermission] =
    useState<PermissionState>('checking');
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [membershipStatus, setMembershipStatus] =
    useState<MembershipStatus | null>(null);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [companionStatus, setCompanionStatus] =
    useState<CompanionCustomizationStatus | null>(null);
  const [companionError, setCompanionError] = useState<string | null>(null);
  const [companionBusy, setCompanionBusy] =
    useState<CompanionCustomizationBusy>(null);
  const [organization, setOrganization] = useState<OrganizationSummary | null>(
    null,
  );
  const [organizationError, setOrganizationError] = useState<string | null>(
    null,
  );
  const [isLoadingOrganization, setIsLoadingOrganization] = useState(false);
  const [isCheckingMembership, setIsCheckingMembership] = useState(true);
  const [isActivatingMembership, setIsActivatingMembership] = useState(false);
  const [isContinuingFree, setIsContinuingFree] = useState(false);
  const [autoStartFailedTaskId, setAutoStartFailedTaskId] = useState<
    string | null
  >(null);
  const [transientCursorError, dispatchTransientCursorError] = useReducer(
    transientCursorErrorReducer,
    INITIAL_TRANSIENT_CURSOR_ERROR_STATE,
  );
  const error = transientCursorError.message;
  const activeTaskIdRef = useRef<string | null>(null);
  const latestSnapshotRef = useRef<TaskSnapshot | null>(null);
  const taskRequestRef = useRef<HTMLTextAreaElement | null>(null);
  const preparedGlobalDictationsRef = useRef(new Set<string>());
  const voiceDraftSnapshotsRef = useRef(new Map<string, VoiceDraftSnapshot>());
  const voiceDestinationsRef = useRef(
    new Map<string, CompanionVoiceActivity['destination']>(),
  );
  const latestVoiceTranscriptRef = useRef('');
  const voiceActivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const voiceModeSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const autoStartAttemptedTaskIdsRef = useRef(new Set<string>());
  const isSendingRef = useRef(false);
  const isStoppingTaskRef = useRef(false);
  const permissionRefreshIdRef = useRef(0);
  const membershipRefreshIdRef = useRef(0);
  const companionRefreshIdRef = useRef(0);
  const companionActionInFlightRef = useRef(false);
  const organizationRefreshIdRef = useRef(0);
  const classSpacesRefreshIdRef = useRef(0);
  const knowledgeCapabilitiesRefreshIdRef = useRef(0);
  const openOrganizationAfterActivationRef = useRef(false);
  const t = useCallback(
    (
      message: string,
      replacements?: Readonly<Record<string, string | number>>,
    ) => translate(appLanguageDraft, message, replacements),
    [appLanguageDraft],
  );
  const displayedPlan = accountPlan(usageBudget?.plan, membershipStatus?.plan);
  const usagePercent = remainingUsagePercent(usageBudget);
  const languageSetupComplete = isPrimaryLanguageSetupComplete(
    appPreferences,
    preferencesLoaded,
  );
  const entryGate = appEntryGate({
    languageSetupComplete,
    membershipStatus,
  });
  const membershipAccessAllowed = entryGate !== 'membership';
  const classroomAccessAvailable =
    knowledgeSpacesEnabled && hasAssignedClassroomRole(classroomRole);

  useEffect(() => {
    if (!membershipAccessAllowed) {
      teacherSelectionRef.current = null;
      setTeacherSelection(null);
      return;
    }
    if (!window.tro.onTeacherClassroomChanged) return;
    let active = true;
    let changed = false;
    const apply = (next: TeacherClassroomSelection | null) => {
      if (active) {
        teacherSelectionRef.current = next;
        setTeacherSelection(next);
      }
    };
    const stop = window.tro.onTeacherClassroomChanged((next) => {
      changed = true;
      apply(next);
    });
    void window.tro
      .getTeacherClassroom()
      .then((next) => {
        if (!changed) apply(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      stop();
    };
  }, [currentUser.id, membershipAccessAllowed]);

  const clearError = useCallback(() => {
    dispatchTransientCursorError({ type: 'cleared' });
  }, []);

  const reportError = useCallback((message: string) => {
    dispatchTransientCursorError({ type: 'reported', message });
  }, []);

  const refreshClassSpaces = useCallback(async (): Promise<void> => {
    if (!membershipAccessAllowed) return;
    const refreshId = classSpacesRefreshIdRef.current + 1;
    classSpacesRefreshIdRef.current = refreshId;
    setClassSpacesLoading(true);
    try {
      const result = await window.tro.listKnowledgeSpaces();
      if (classSpacesRefreshIdRef.current !== refreshId) return;
      setClassroomRole(result.classroomRole);
      setClassSpaces(result.items);
      if (!hasAssignedClassroomRole(result.classroomRole)) {
        setActiveView((currentView) =>
          currentView === 'spaces' || currentView === 'assigned'
            ? 'agent'
            : currentView,
        );
      }
      setSelectedClassSpace((currentSpace) =>
        hasAssignedClassroomRole(result.classroomRole) && currentSpace
          ? (result.items.find((space) => space.id === currentSpace.id) ?? null)
          : null,
      );
      setClassSpacesError(null);
    } catch (cause) {
      if (classSpacesRefreshIdRef.current !== refreshId) return;
      setClassSpacesError(
        cause instanceof Error
          ? cause.message
          : 'Class workspaces are unavailable.',
      );
    } finally {
      if (classSpacesRefreshIdRef.current === refreshId) {
        setClassSpacesLoading(false);
      }
    }
  }, [membershipAccessAllowed]);

  const refreshKnowledgeCapabilities = useCallback(async (): Promise<void> => {
    if (!membershipAccessAllowed) return;
    const refreshId = ++knowledgeCapabilitiesRefreshIdRef.current;
    const clearClassroomAccess = (): void => {
      classSpacesRefreshIdRef.current += 1;
      setClassroomRole('unassigned');
      setClassSpaces([]);
      setSelectedClassSpace(null);
      setActiveView((currentView) =>
        currentView === 'spaces' || currentView === 'assigned'
          ? 'agent'
          : currentView,
      );
    };

    try {
      const capabilities = await window.tro.getKnowledgeCapabilities();
      if (knowledgeCapabilitiesRefreshIdRef.current !== refreshId) return;
      const enabled = capabilities.knowledgeSpaces.enabled;
      setKnowledgeSpacesEnabled(enabled);
      if (enabled) {
        await refreshClassSpaces();
      } else {
        clearClassroomAccess();
      }
    } catch {
      if (knowledgeCapabilitiesRefreshIdRef.current !== refreshId) return;
      setKnowledgeSpacesEnabled(false);
      clearClassroomAccess();
    }
  }, [membershipAccessAllowed, refreshClassSpaces]);

  const recordSnapshot = useCallback((nextSnapshot: TaskSnapshot | null) => {
    latestSnapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
    if (!nextSnapshot) {
      autoStartAttemptedTaskIdsRef.current.clear();
      setAutoStartFailedTaskId(null);
      return;
    }

    setSessionSnapshots((currentSnapshots) => ({
      ...currentSnapshots,
      [nextSnapshot.taskId]: nextSnapshot,
    }));
    const lastEvent = nextSnapshot.lastEvent;
    if (lastEvent) {
      setSessionEvents((currentEvents) =>
        appendUniqueEvent(currentEvents, lastEvent),
      );
    }
  }, []);

  useEffect(() => {
    if (!transientCursorError.visible) return;

    return scheduleTransientCursorErrorDismissal(
      transientCursorError.revision,
      (revision) => {
        dispatchTransientCursorError({ type: 'dismissed', revision });
      },
    );
  }, [transientCursorError]);

  const refreshPermissions = useCallback(async () => {
    const refreshId = permissionRefreshIdRef.current + 1;
    permissionRefreshIdRef.current = refreshId;
    setIsCheckingPermissions(true);

    try {
      const [observedComputerStatus, nextMicrophonePermission] =
        await Promise.all([
          window.tro.getComputerStatus(),
          inspectMicrophonePermission(),
        ]);
      if (permissionRefreshIdRef.current !== refreshId) return;

      const nextComputerStatus = shouldConnectAfterPermissionRefresh(
        observedComputerStatus,
      )
        ? await window.tro.connectComputer()
        : observedComputerStatus;
      if (permissionRefreshIdRef.current !== refreshId) return;

      setComputerStatus(nextComputerStatus);
      setComputerStatusLoaded(true);
      setMicrophonePermission(nextMicrophonePermission);
      setPermissionError(null);
    } catch (statusError) {
      if (permissionRefreshIdRef.current !== refreshId) return;
      setComputerStatusLoaded(true);
      setPermissionError(
        statusError instanceof Error
          ? statusError.message
          : 'Tro could not check system permissions.',
      );
    } finally {
      if (permissionRefreshIdRef.current === refreshId) {
        setIsCheckingPermissions(false);
      }
    }
  }, []);

  useEffect(() => {
    const activitySequences = new Map<string, number>();
    const unsubscribeAgentActivity = window.tro.onAgentActivity((activity) => {
      const activeTaskId = activeTaskIdRef.current;
      if (!acceptAgentActivity(activity, activeTaskId, activitySequences))
        return;
      if (activity.kind === 'run_started') setStreamingDraft('');
      if (activity.kind === 'run_started') setAgentActivities([]);
      if (activity.kind === 'text_delta' && activity.textDelta) {
        setStreamingDraft((current) =>
          `${current}${activity.textDelta}`.slice(-8_000),
        );
      }
      setAgentActivity(activity);
      setAgentActivities((current) => [...current, activity].slice(-100));
    });
    const unsubscribeTaskUpdates = window.tro.onTaskUpdate((update) => {
      const activeTaskId = activeTaskIdRef.current;
      if (activeTaskId && activeTaskId !== update.snapshot.taskId) return;

      activeTaskIdRef.current = update.snapshot.taskId;
      recordSnapshot(update.snapshot);
      setEvents((currentEvents) =>
        appendUniqueEvent(currentEvents, update.event),
      );
      void window.tro
        .getUsageBudget(update.snapshot.taskId)
        .then(setUsageBudget)
        .catch(() => undefined);
    });
    const unsubscribeTaskComposerFocus =
      window.tro.onTaskComposerFocusRequested((taskId) => {
        if (latestSnapshotRef.current?.taskId !== taskId) return;
        setActiveView('agent');
        window.requestAnimationFrame(() => {
          taskRequestRef.current?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
          taskRequestRef.current?.focus();
        });
      });
    const unsubscribeAppUpdates = window.tro.onAppUpdateStatusChanged(
      (status) => {
        setAppUpdateStatus(status);
        setAppUpdateError(null);
      },
    );

    void window.tro
      .getAppUpdateStatus()
      .then((status) => {
        setAppUpdateStatus(status);
        setAppUpdateError(null);
      })
      .catch((updateStatusError: unknown) => {
        setAppUpdateError(
          updateStatusError instanceof Error
            ? updateStatusError.message
            : 'Tro could not inspect application updates.',
        );
      });

    void window.tro
      .getUsageBudget()
      .then(setUsageBudget)
      .catch(() => undefined);

    void window.tro
      .getTaskHistory()
      .then((history) => {
        setSessionSnapshots((currentSnapshots) =>
          mergeTaskSnapshots(currentSnapshots, history.snapshots),
        );
        setSessionEvents((currentEvents) =>
          mergeTaskEvents(currentEvents, history.events),
        );
        setTaskPersistence(history.persistence);
      })
      .catch(() => {
        setTaskPersistence({
          mode: 'session_only',
          summary:
            'Saved history could not be loaded; this session is temporary.',
        });
      });

    void window.tro
      .getVoiceStatus()
      .then((status) => {
        setVoiceProviderStatus(status);
      })
      .catch((statusError: unknown) => {
        reportError(
          statusError instanceof Error
            ? statusError.message
            : 'Could not inspect the OpenAI voice connection.',
        );
      });

    void window.tro
      .getAppPreferences()
      .then((preferences) => {
        setAppPreferences(preferences);
        setAppLanguageDraft(preferences.appLanguage);
        setClassroomPetEnabledDraft(preferences.classroomPetEnabled);
        setMuteSystemAudioWhileSpeakingDraft(
          preferences.muteSystemAudioWhileSpeaking,
        );
        setSelectedVoiceMode(preferences.voiceMode);
        if (preferences.primaryLanguage) {
          setLanguageDraft(preferences.primaryLanguage);
        }
        setPreferencesLoadError(null);
      })
      .catch((preferencesError: unknown) => {
        setPreferencesLoadError(
          preferencesError instanceof Error
            ? preferencesError.message
            : 'Tro could not load your language preference.',
        );
      })
      .finally(() => setPreferencesLoaded(true));

    void window.tro
      .getWorkspaceRuntimeAvailability()
      .then(setWorkspaceRuntime)
      .catch((workspaceError: unknown) => {
        setWorkspaceRuntime({
          available: false,
          runtimeVersion: null,
          summary:
            workspaceError instanceof Error
              ? workspaceError.message
              : 'Workspace mode is temporarily unavailable.',
        });
      });

    return () => {
      unsubscribeAgentActivity();
      unsubscribeTaskUpdates();
      unsubscribeTaskComposerFocus();
      unsubscribeAppUpdates();
    };
  }, [recordSnapshot, reportError]);

  useEffect(() => {
    if (!membershipAccessAllowed) {
      setKnowledgeSpacesEnabled(false);
      setClassroomRole('unassigned');
      setClassSpaces([]);
      setSelectedClassSpace(null);
      setClassSpacesLoading(false);
      setClassSpacesError(null);
      setActiveView((currentView) =>
        currentView === 'spaces' || currentView === 'assigned'
          ? 'agent'
          : currentView,
      );
      return;
    }

    let active = true;
    queueMicrotask(() => {
      if (active) void refreshKnowledgeCapabilities();
    });
    const refreshOnFocus = (): void => {
      void refreshKnowledgeCapabilities();
    };
    const refreshOnVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        void refreshKnowledgeCapabilities();
      }
    };

    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnVisibility);
    return () => {
      active = false;
      knowledgeCapabilitiesRefreshIdRef.current += 1;
      classSpacesRefreshIdRef.current += 1;
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnVisibility);
    };
  }, [currentUser.id, membershipAccessAllowed, refreshKnowledgeCapabilities]);

  useEffect(() => {
    document.documentElement.lang = appLanguageDraft;
  }, [appLanguageDraft]);

  useEffect(() => {
    if (!membershipAccessAllowed) return;

    const handleWindowFocus = (): void => {
      queueMicrotask(() => void refreshPermissions());
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') void refreshPermissions();
    };

    queueMicrotask(() => void refreshPermissions());
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      permissionRefreshIdRef.current += 1;
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [membershipAccessAllowed, refreshPermissions]);

  const pendingInteraction = snapshot?.pendingInteraction ?? null;
  const permissionWait =
    snapshot?.lifecycle?.waitingOn?.kind === 'permission'
      ? snapshot.lifecycle.waitingOn
      : null;
  const permissionPresentation = permissionWait
    ? computerPermissionWaitPresentation(permissionWait.requiredPermissions)
    : null;
  const pendingClarification =
    pendingInteraction?.kind === 'clarification' ? pendingInteraction : null;
  const isSteering = isTaskSteerable(snapshot);

  const canSubmit =
    input.trim().length >= (pendingClarification || isSteering ? 1 : 2) &&
    !isSubmitting &&
    (pendingClarification ||
      isSteering ||
      executionProfile === 'everyday' ||
      Boolean(workspaceRuntime?.available && workspaceSelection));
  const taskPhase = useMemo(
    () =>
      snapshot
        ? formatLabel(snapshot.phase, appLanguageDraft)
        : t('No active task'),
    [appLanguageDraft, snapshot, t],
  );
  const isTerminalTask = isTaskTerminal(snapshot);
  const hasLiveTask = snapshot !== null && !isTerminalTask;
  const sessionTaskSnapshots = Object.values(sessionSnapshots);
  const historyTaskCount = sessionTaskSnapshots.filter((task) =>
    isTaskTerminal(task),
  ).length;
  const hero = pendingInteraction
    ? {
        state: 'interaction',
        eyebrow: t('Your move'),
        heading: t('A clarification is waiting.'),
        description: t(
          'Answer the question below so Tro can continue toward the goal.',
        ),
      }
    : hasLiveTask
      ? {
          state: 'active',
          eyebrow: t('In motion'),
          heading: t('Keep the outcome in view.'),
          description: t(
            'Follow the live signal, steer the next safe step, or stop the task at any time.',
          ),
        }
      : isTerminalTask
        ? {
            state: 'terminal',
            eyebrow: t('Outcome recorded'),
            heading: t('What should we do next?'),
            description: t(
              'The finished task is now in your session trail. Start another outcome whenever you are ready.',
            ),
          }
        : {
            state: 'empty',
            eyebrow: t('Outcome first'),
            heading: t('What should we accomplish?'),
            description: t(
              'Describe the finish line. Tro will choose the appropriate tools and verify the result.',
            ),
          };
  const organizationHomeBanner =
    !pendingInteraction && !hasLiveTask
      ? (organization?.homeBanner ?? null)
      : null;
  const permissionChecklist = useMemo(
    () =>
      createPermissionChecklist(
        computerStatus,
        microphonePermission,
        computerStatusLoaded,
      ),
    [computerStatus, computerStatusLoaded, microphonePermission],
  );
  const agentReady = voiceProviderStatus.state === 'ready';
  const selectedTaskRuntimeReady = agentReady;
  const voiceReady = agentReady && microphonePermission !== 'unavailable';
  const desktopReady =
    computerStatus.state === 'ready' && computerStatus.available;

  const refreshMembership = useCallback(async () => {
    const refreshId = membershipRefreshIdRef.current + 1;
    membershipRefreshIdRef.current = refreshId;
    setIsCheckingMembership(true);
    setMembershipError(null);
    try {
      const nextStatus = await window.tro.getMembershipStatus();
      if (membershipRefreshIdRef.current !== refreshId) return;
      setMembershipStatus(nextStatus);
    } catch (membershipStatusError) {
      if (membershipRefreshIdRef.current !== refreshId) return;
      setMembershipStatus(null);
      setMembershipError(
        membershipStatusError instanceof Error
          ? membershipStatusError.message
          : 'Tro could not check your membership.',
      );
    } finally {
      if (membershipRefreshIdRef.current === refreshId) {
        setIsCheckingMembership(false);
      }
    }
  }, []);

  const refreshCompanionCustomization = useCallback(async () => {
    const refreshId = companionRefreshIdRef.current + 1;
    companionRefreshIdRef.current = refreshId;
    setCompanionBusy('loading');
    setCompanionError(null);
    try {
      const nextStatus = await window.tro.getCompanionCustomizationStatus();
      if (companionRefreshIdRef.current !== refreshId) return;
      setCompanionStatus(nextStatus);
    } catch (statusError) {
      if (companionRefreshIdRef.current !== refreshId) return;
      setCompanionStatus(null);
      setCompanionError(
        statusError instanceof Error
          ? statusError.message
          : 'Tro could not load companion settings.',
      );
    } finally {
      if (companionRefreshIdRef.current === refreshId) {
        setCompanionBusy(null);
      }
    }
  }, []);

  const refreshOrganization =
    useCallback(async (): Promise<OrganizationSummary | null> => {
      const refreshId = organizationRefreshIdRef.current + 1;
      organizationRefreshIdRef.current = refreshId;
      setIsLoadingOrganization(true);
      setOrganizationError(null);
      try {
        const response = await window.tro.getOrganization();
        if (organizationRefreshIdRef.current !== refreshId) return null;
        setOrganization(response.organization);
        if (openOrganizationAfterActivationRef.current) {
          openOrganizationAfterActivationRef.current = false;
          if (organizationSettingsAvailable(response.organization)) {
            setActiveView('organization');
          }
        }
        return response.organization;
      } catch (organizationStatusError) {
        if (organizationRefreshIdRef.current !== refreshId) return null;
        setOrganizationError(
          organizationStatusError instanceof Error
            ? organizationStatusError.message
            : 'Tro could not load this organization.',
        );
        openOrganizationAfterActivationRef.current = false;
        return null;
      } finally {
        if (organizationRefreshIdRef.current === refreshId) {
          setIsLoadingOrganization(false);
        }
      }
    }, []);
  useEffect(() => {
    const handleWindowFocus = (): void => {
      void refreshMembership();
    };
    queueMicrotask(() => void refreshMembership());
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      membershipRefreshIdRef.current += 1;
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [refreshMembership]);

  useEffect(() => {
    if (!membershipAllowsAccess(membershipStatus)) {
      organizationRefreshIdRef.current += 1;
      openOrganizationAfterActivationRef.current = false;
      queueMicrotask(() => {
        setOrganization(null);
        setOrganizationError(null);
        setIsLoadingOrganization(false);
      });
      return;
    }

    const handleWindowFocus = (): void => {
      void refreshOrganization();
    };
    queueMicrotask(() => void refreshOrganization());
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      organizationRefreshIdRef.current += 1;
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [currentUser.id, membershipStatus, refreshOrganization]);

  useEffect(() => {
    if (
      activeView !== 'organization' ||
      !membershipAllowsAccess(membershipStatus)
    ) {
      return;
    }
    queueMicrotask(() => void refreshOrganization());
  }, [activeView, membershipStatus, refreshOrganization]);

  useEffect(() => {
    if (
      activeView === 'organization' &&
      !isLoadingOrganization &&
      !organizationSettingsAvailable(organization)
    ) {
      queueMicrotask(() => setActiveView('agent'));
    }
  }, [activeView, isLoadingOrganization, organization]);

  useEffect(() => {
    if (membershipStatus?.state !== 'active' || !membershipStatus.expiresAt) {
      return;
    }

    const remainingMs = Date.parse(membershipStatus.expiresAt) - Date.now();
    if (remainingMs <= 0) {
      queueMicrotask(() => void refreshMembership());
      return;
    }

    const expiryTimer = setTimeout(
      () => void refreshMembership(),
      Math.min(remainingMs, 2_147_483_647),
    );
    return () => clearTimeout(expiryTimer);
  }, [membershipStatus, refreshMembership]);

  useEffect(() => {
    if (!settingsOpen || membershipStatus?.state !== 'active') {
      return;
    }

    queueMicrotask(() => void refreshCompanionCustomization());
  }, [membershipStatus?.state, refreshCompanionCustomization, settingsOpen]);

  const activateMembership = useCallback(
    async (code: string) => {
      setIsActivatingMembership(true);
      setMembershipError(null);
      try {
        setMembershipStatus(await window.tro.activateMembership({ code }));
        void refreshCompanionCustomization();
        openOrganizationAfterActivationRef.current = true;
        await refreshOrganization();
      } catch (activationError) {
        setMembershipError(
          activationError instanceof Error
            ? activationError.message
            : 'Tro could not activate this membership code.',
        );
      } finally {
        setIsActivatingMembership(false);
      }
    },
    [refreshCompanionCustomization, refreshOrganization],
  );

  const continueWithFree = useCallback(async () => {
    setIsContinuingFree(true);
    setMembershipError(null);
    try {
      setMembershipStatus(await window.tro.continueWithFree());
      void refreshCompanionCustomization();
    } catch (continueError) {
      setMembershipError(
        continueError instanceof Error
          ? continueError.message
          : 'Tro could not start the Free plan.',
      );
    } finally {
      setIsContinuingFree(false);
    }
  }, [refreshCompanionCustomization]);

  const generateCompanion = useCallback(
    async (request: GenerateCompanionImageRequest): Promise<boolean> => {
      if (companionActionInFlightRef.current) return false;
      companionActionInFlightRef.current = true;
      companionRefreshIdRef.current += 1;
      setCompanionBusy('generating');
      setCompanionError(null);
      try {
        setCompanionStatus(await window.tro.generateCompanionImage(request));
        return true;
      } catch (generationError) {
        setCompanionError(
          generationError instanceof Error
            ? generationError.message
            : 'Tro could not generate this companion.',
        );
        try {
          setCompanionStatus(
            await window.tro.getCompanionCustomizationStatus(),
          );
        } catch {
          // Keep the generation error when quota refresh is unavailable.
        }
        return false;
      } finally {
        companionActionInFlightRef.current = false;
        setCompanionBusy(null);
      }
    },
    [],
  );

  const activateCompanion = useCallback(async (candidateId: string) => {
    if (companionActionInFlightRef.current) return;
    companionActionInFlightRef.current = true;
    companionRefreshIdRef.current += 1;
    setCompanionBusy('activating');
    setCompanionError(null);
    try {
      setCompanionStatus(
        await window.tro.activateCompanionCandidate({ candidateId }),
      );
    } catch (activationError) {
      setCompanionError(
        activationError instanceof Error
          ? activationError.message
          : 'Tro could not activate this companion.',
      );
      try {
        setCompanionStatus(await window.tro.getCompanionCustomizationStatus());
      } catch {
        // Preserve the activation error when refreshing an expired candidate fails.
      }
    } finally {
      companionActionInFlightRef.current = false;
      setCompanionBusy(null);
    }
  }, []);

  const activateSavedCompanion = useCallback(async (companionId: string) => {
    if (companionActionInFlightRef.current) return;
    companionActionInFlightRef.current = true;
    companionRefreshIdRef.current += 1;
    setCompanionBusy('selecting');
    setCompanionError(null);
    try {
      setCompanionStatus(
        await window.tro.activateSavedCompanion({ companionId }),
      );
    } catch (activationError) {
      setCompanionError(
        activationError instanceof Error
          ? activationError.message
          : 'Tro could not activate this saved companion.',
      );
      try {
        setCompanionStatus(await window.tro.getCompanionCustomizationStatus());
      } catch {
        // Preserve the activation error when the saved library cannot refresh.
      }
    } finally {
      companionActionInFlightRef.current = false;
      setCompanionBusy(null);
    }
  }, []);

  const useDefaultCompanion = useCallback(async () => {
    if (companionActionInFlightRef.current) return;
    companionActionInFlightRef.current = true;
    companionRefreshIdRef.current += 1;
    setCompanionBusy('resetting');
    setCompanionError(null);
    try {
      setCompanionStatus(await window.tro.useDefaultCompanion());
    } catch (resetError) {
      setCompanionError(
        resetError instanceof Error
          ? resetError.message
          : 'Tro could not restore the default companion.',
      );
    } finally {
      companionActionInFlightRef.current = false;
      setCompanionBusy(null);
    }
  }, []);

  const saveSettings = useCallback(async () => {
    setIsSavingPreferences(true);
    setSettingsError(null);
    setSettingsSaveMessage(null);
    try {
      const preferences = await window.tro.updateAppPreferences({
        appLanguage: appLanguageDraft,
        classroomPetEnabled: classroomPetEnabledDraft,
        muteSystemAudioWhileSpeaking: muteSystemAudioWhileSpeakingDraft,
        primaryLanguage: languageDraft,
        voiceMode: selectedVoiceMode,
      });
      setAppPreferences(preferences);
      setSettingsSaveMessage(
        translate(
          appLanguageDraft,
          'App controls will use {appLanguage}; new voice turns will use {spokenLanguage}.',
          {
            appLanguage: appLanguageLabel(appLanguageDraft),
            spokenLanguage: primaryLanguageLabel(
              languageDraft,
              appLanguageDraft,
            ),
          },
        ),
      );
    } catch (saveError) {
      setSettingsError(
        saveError instanceof Error
          ? saveError.message
          : 'Tro could not save your language preference.',
      );
    } finally {
      setIsSavingPreferences(false);
    }
  }, [
    appLanguageDraft,
    classroomPetEnabledDraft,
    languageDraft,
    muteSystemAudioWhileSpeakingDraft,
    selectedVoiceMode,
  ]);

  const chooseWorkspace = useCallback(async () => {
    if (!workspaceRuntime?.available || isSelectingWorkspace) return;

    setIsSelectingWorkspace(true);
    clearError();
    try {
      const selection = await window.tro.selectWorkspace();
      if (!selection) return;
      setWorkspaceSelection(selection);
      setExecutionProfile('workspace');
    } catch (selectionError) {
      reportError(
        selectionError instanceof Error
          ? selectionError.message
          : 'Tro could not select that workspace.',
      );
    } finally {
      setIsSelectingWorkspace(false);
    }
  }, [
    clearError,
    isSelectingWorkspace,
    reportError,
    workspaceRuntime?.available,
  ]);

  const checkForAppUpdates = useCallback(async () => {
    setIsUpdatingApp(true);
    setAppUpdateError(null);
    try {
      setAppUpdateStatus(await window.tro.checkForAppUpdates());
    } catch (updateError) {
      setAppUpdateError(
        updateError instanceof Error
          ? updateError.message
          : 'Tro could not check for updates.',
      );
    } finally {
      setIsUpdatingApp(false);
    }
  }, []);

  const restartAndInstallAppUpdate = useCallback(async () => {
    setIsUpdatingApp(true);
    setAppUpdateError(null);
    try {
      await window.tro.restartAndInstallAppUpdate();
    } catch (updateError) {
      setAppUpdateError(
        updateError instanceof Error
          ? updateError.message
          : 'Tro could not restart to install the update.',
      );
      setIsUpdatingApp(false);
    }
  }, []);

  const sendInput = useCallback(
    async (
      requestText = input,
      options: { screenContext?: 'auto' | 'required' | 'disabled';
        teacherClassroomSelectionId?: string | null;
      } = {},
    ): Promise<boolean> => {
      const normalizedRequest = requestText.trim();
      const minimumLength = pendingClarification || isSteering ? 1 : 2;
      if (
        normalizedRequest.length < minimumLength ||
        isSubmitting ||
        isSendingRef.current
      ) {
        return false;
      }

      isSendingRef.current = true;
      clearError();
      setIsSubmitting(true);

      try {
        if (teacherSelectionPendingRef.current)
          throw new Error('Wait for the teacher session selection to finish.');
        const teacherToken =
          options.teacherClassroomSelectionId === undefined
            ? (teacherSelectionRef.current?.selectionId ?? null)
            : options.teacherClassroomSelectionId;
        if (teacherToken !== (teacherSelectionRef.current?.selectionId ?? null))
          throw new Error(
            'The selected class changed. Your transcript is still in the composer.',
          );
        if (teacherToken) {
          const verified = await window.tro.getTeacherClassroom();
          if (verified?.selectionId !== teacherToken)
            throw new Error('Select the live class again before sending.');
        }
        const sameDestination =
          (snapshot
            ? (teacherTaskBindingsRef.current.get(snapshot.taskId) ?? null)
            : null) === teacherToken;
        let nextSnapshot: TaskSnapshot;
        if (pendingClarification && snapshot && sameDestination) {
          nextSnapshot = await window.tro.respondToInteraction({
            taskId: snapshot.taskId,
            interactionId: pendingClarification.id,
            kind: 'answer',
            text: normalizedRequest,
          });
        } else if (isSteering && snapshot && sameDestination) {
          nextSnapshot = await window.tro.steerTask({
            taskId: snapshot.taskId,
            instruction: normalizedRequest,
          });
        } else {
          if (snapshot && !isTaskTerminal(snapshot)) {
            recordSnapshot(await window.tro.cancelTask(snapshot.taskId));
          }
          activeTaskIdRef.current = null;
          setEvents([]);
          setAgentActivities([]);
          setAgentActivity(null);
          setStreamingDraft('');
          recordSnapshot(null);
          nextSnapshot = await window.tro.submitTask({
            teacherClassroomSelectionId: teacherToken,
            activityAttemptId: null,
            activityIntent: 'work',
            executionProfile,
            requestedMode: 'auto',
            screenContext: options.screenContext ?? 'auto',
            text: normalizedRequest,
            workspaceSelectionId:
              executionProfile === 'workspace'
                ? (workspaceSelection?.selectionId ?? null)
                : null,
          });
        }

        teacherTaskBindingsRef.current.set(nextSnapshot.taskId, teacherToken);
        activeTaskIdRef.current = nextSnapshot.taskId;
        recordSnapshot(nextSnapshot);
        setInput('');
        return true;
      } catch (submitError) {
        reportError(
          submitError instanceof Error
            ? submitError.message
            : 'The task could not accept that input.',
        );
        return false;
      } finally {
        isSendingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [
      clearError,
      executionProfile,
      input,
      isSteering,
      isSubmitting,
      pendingClarification,
      recordSnapshot,
      reportError,
      snapshot,
      workspaceSelection,
    ],
  );

  const launchKnowledgeActivity = useCallback(
    async (request: SubmitTaskRequest) => {
      if (isSubmitting || isSendingRef.current) return;

      isSendingRef.current = true;
      clearError();
      setIsSubmitting(true);
      try {
        const activeSnapshot = latestSnapshotRef.current;
        if (activeSnapshot && !isTaskTerminal(activeSnapshot)) {
          recordSnapshot(await window.tro.cancelTask(activeSnapshot.taskId));
        }

        activeTaskIdRef.current = null;
        setEvents([]);
        setAgentActivities([]);
        setAgentActivity(null);
        setStreamingDraft('');
        recordSnapshot(null);

        const nextSnapshot = await window.tro.submitTask(request);
        activeTaskIdRef.current = nextSnapshot.taskId;
        recordSnapshot(nextSnapshot);
        setActiveView('agent');
      } catch (launchError) {
        reportError(
          launchError instanceof Error
            ? launchError.message
            : 'The Activity could not be started.',
        );
        throw launchError;
      } finally {
        isSendingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [clearError, isSubmitting, recordSnapshot, reportError],
  );

  const resetTask = useCallback(async () => {
    if (isSendingRef.current) return;

    isSendingRef.current = true;
    setIsSubmitting(true);
    const activeSnapshot = snapshot;

    try {
      if (activeSnapshot && !isTaskTerminal(activeSnapshot)) {
        recordSnapshot(await window.tro.cancelTask(activeSnapshot.taskId));
      }

      activeTaskIdRef.current = null;
      setInput('');
      recordSnapshot(null);
      setEvents([]);
      clearError();
    } catch (cancelError) {
      reportError(
        cancelError instanceof Error
          ? cancelError.message
          : 'The current task could not be cancelled.',
      );
    } finally {
      isSendingRef.current = false;
      setIsSubmitting(false);
    }
  }, [clearError, recordSnapshot, reportError, snapshot]);

  const showVoiceTerminalActivity = useCallback(
    (
      activity: CompanionVoiceActivity,
      durationMs: number,
      disposition: VoiceTerminalDisposition = 'feedback',
    ): void => {
      if (voiceActivityTimerRef.current) {
        clearTimeout(voiceActivityTimerRef.current);
      }
      if (
        !shouldRetainVoiceTerminalActivity({
          disposition,
          mode: activity.mode,
        })
      ) {
        setVoiceActivityOverride(null);
        voiceActivityTimerRef.current = null;
        return;
      }
      setVoiceActivityOverride(activity);
      voiceActivityTimerRef.current = setTimeout(() => {
        setVoiceActivityOverride(null);
        voiceActivityTimerRef.current = null;
      }, durationMs);
    },
    [],
  );

  const recordVoiceOutcome = useCallback(
    (
      context: VoiceTurnContext,
      transcript: string,
      destination: CompanionVoiceActivity['destination']['kind'],
      disposition:
        | 'delivery_unverified'
        | 'draft_updated'
        | 'inserted'
        | 'not_inserted'
        | 'task_submitted',
    ): void => {
      void window.tro
        .recordVoiceTranscript({
          characterCount: transcript.length,
          destination,
          disposition,
          mode: context.mode,
        })
        .catch(() => undefined);
    },
    [],
  );

  const keepVoiceRecoveryDraft = useCallback((transcript: string): void => {
    setInput(
      (current) =>
        applyDictationTranscript(
          captureVoiceDraftSnapshot(current, null, null, false),
          transcript,
        ).value,
    );
  }, []);

  const handleVoiceAttemptStart = useCallback(
    async (context: VoiceTurnContext): Promise<VoiceAttemptDecision> => {
      clearError();
      latestVoiceTranscriptRef.current = '';
      setVoiceTranscript('');
      setVoiceActivityOverride(null);
      if (voiceActivityTimerRef.current) {
        clearTimeout(voiceActivityTimerRef.current);
        voiceActivityTimerRef.current = null;
      }

      const route = voiceTurnRoute(context);
      if (route === 'task') {
        if (teacherSelectionPendingRef.current) {
          reportError('Wait for the class session to finish loading.');
          return {
            accepted: false,
            destination: { kind: 'task', label: t('Tro task') },
          };
        }
        const current = latestSnapshotRef.current;
        teacherVoiceBindingsRef.current.set(context.turnId, {
          selectionId: teacherSelectionRef.current?.selectionId ?? null,
          taskId: current?.taskId ?? null,
          interactionId: current?.pendingInteraction?.id ?? null,
        });
        const destination = { kind: 'task' as const, label: t('Tro task') };
        voiceDestinationsRef.current.set(context.turnId, destination);
        setVoiceDestination(destination);
        return { accepted: true, destination };
      }

      if (route === 'local_dictation') {
        const textarea = taskRequestRef.current;
        const snapshot = captureVoiceDraftSnapshot(
          input,
          textarea?.selectionStart ?? null,
          textarea?.selectionEnd ?? null,
          Boolean(textarea && document.activeElement === textarea),
        );
        const destination = {
          kind: 'tro_composer' as const,
          label: t('Tro composer'),
        };
        voiceDraftSnapshotsRef.current.set(context.turnId, snapshot);
        voiceDestinationsRef.current.set(context.turnId, destination);
        setVoiceDestination(destination);
        return { accepted: true, destination };
      }

      try {
        const result = await window.tro.beginDictation({
          turnId: context.turnId,
        });
        if (result.status !== 'ready') {
          const destination = {
            kind: 'application' as const,
            label: t('Current application'),
          };
          voiceDestinationsRef.current.set(context.turnId, destination);
          setVoiceDestination(destination);
          reportError(result.summary);
          showVoiceTerminalActivity(
            {
              appLanguage: appLanguageDraft,
              destination,
              message: result.summary.slice(0, 240),
              mode: 'dictation',
              phase: 'error',
              transcript: '',
            },
            2_500,
          );
          return { accepted: false, destination };
        }
        const destination = {
          kind: 'application' as const,
          label: result.targetApplication,
        };
        preparedGlobalDictationsRef.current.add(context.turnId);
        voiceDestinationsRef.current.set(context.turnId, destination);
        setVoiceDestination(destination);
        return { accepted: true, destination };
      } catch (preflightError) {
        const message =
          preflightError instanceof Error
            ? preflightError.message
            : 'Tro could not prepare system-wide dictation.';
        const destination = {
          kind: 'application' as const,
          label: t('Current application'),
        };
        voiceDestinationsRef.current.set(context.turnId, destination);
        setVoiceDestination(destination);
        reportError(message);
        showVoiceTerminalActivity(
          {
            appLanguage: appLanguageDraft,
            destination,
            message: message.slice(0, 240),
            mode: 'dictation',
            phase: 'error',
            transcript: '',
          },
          2_500,
        );
        return { accepted: false, destination };
      }
    },
    [
      appLanguageDraft,
      clearError,
      input,
      reportError,
      showVoiceTerminalActivity,
      t,
    ],
  );

  const handleVoiceTranscriptChange = useCallback(
    (context: VoiceTurnContext, transcript: string): void => {
      latestVoiceTranscriptRef.current = transcript;
      setVoiceTranscript(transcript);
      const route = voiceTurnRoute(context);
      if (route === 'task') {
        setInput(transcript);
        return;
      }
      if (route === 'local_dictation') {
        const snapshot = voiceDraftSnapshotsRef.current.get(context.turnId);
        if (snapshot)
          setInput(applyDictationTranscript(snapshot, transcript).value);
      }
    },
    [],
  );

  const handleVoiceTranscriptReady = useCallback(
    async (
      context: VoiceTurnContext,
      transcript: string,
    ): Promise<VoiceCommitDisposition> => {
      const destination =
        voiceDestinationsRef.current.get(context.turnId) ?? voiceDestination;
      const route = voiceTurnRoute(context);
      if (route === 'task') {
        const frozen = teacherVoiceBindingsRef.current.get(context.turnId);
        const current = latestSnapshotRef.current;
        if (
          !sameClassroomVoiceDestination(frozen, {
            selectionId: teacherSelectionRef.current?.selectionId ?? null,
            taskId: current?.taskId ?? null,
            interactionId: current?.pendingInteraction?.id ?? null,
          })
        ) {
          setInput(transcript);
          throw new Error(
            'The task or class changed while you were speaking. Review the transcript and send again.',
          );
        }
        if (!(await sendInput(transcript, {
            teacherClassroomSelectionId: frozen!.selectionId,
            screenContext: voiceTaskScreenContext(context),
        }))) {
          throw new Error('The task could not accept that voice input.');
        }
        recordVoiceOutcome(context, transcript, 'task', 'task_submitted');
        showVoiceTerminalActivity(
          {
            appLanguage: appLanguageDraft,
            destination,
            mode: 'task',
            phase: 'complete',
            transcript,
          },
          12_000,
          'task_submitted',
        );
        return 'task_submitted';
      }

      if (route === 'local_dictation') {
        const draft = voiceDraftSnapshotsRef.current.get(context.turnId);
        if (!draft) throw new Error('The Tro draft is no longer available.');
        const result = applyDictationTranscript(draft, transcript);
        setInput(result.value);
        recordVoiceOutcome(
          context,
          transcript,
          'tro_composer',
          'draft_updated',
        );
        window.requestAnimationFrame(() => {
          const textarea = taskRequestRef.current;
          if (!textarea) return;
          textarea.focus({ preventScroll: true });
          textarea.setSelectionRange(result.caret, result.caret);
        });
        showVoiceTerminalActivity(
          {
            appLanguage: appLanguageDraft,
            destination,
            message: t('Dictation added to your Tro draft.'),
            mode: 'dictation',
            phase: 'complete',
            transcript: '',
          },
          800,
        );
        return 'completed';
      }

      preparedGlobalDictationsRef.current.delete(context.turnId);
      try {
        const result = await window.tro.commitDictation({
          text: transcript,
          turnId: context.turnId,
        });
        recordVoiceOutcome(
          context,
          transcript,
          'application',
          result.disposition,
        );
        if (result.disposition === 'inserted') {
          latestVoiceTranscriptRef.current = '';
          setVoiceTranscript('');
          showVoiceTerminalActivity(
            {
              appLanguage: appLanguageDraft,
              destination,
              message: t('Dictation inserted.'),
              mode: 'dictation',
              phase: 'complete',
              transcript: '',
            },
            800,
          );
          return 'completed';
        }
        keepVoiceRecoveryDraft(transcript);
        const message = t('Text kept in your Tro draft. {summary}', {
          summary: result.summary,
        }).slice(0, 240);
        reportError(message);
        showVoiceTerminalActivity(
          {
            appLanguage: appLanguageDraft,
            destination,
            message,
            mode: 'dictation',
            phase: 'error',
            transcript: '',
          },
          3_000,
        );
      } catch {
        void window.tro
          .cancelDictation({ turnId: context.turnId })
          .catch(() => undefined);
        keepVoiceRecoveryDraft(transcript);
        recordVoiceOutcome(
          context,
          transcript,
          'application',
          'delivery_unverified',
        );
        const message = t(
          'Insertion could not be verified. Text kept in your Tro draft.',
        );
        reportError(message);
        showVoiceTerminalActivity(
          {
            appLanguage: appLanguageDraft,
            destination,
            message,
            mode: 'dictation',
            phase: 'error',
            transcript: '',
          },
          3_000,
        );
      }
      return 'completed';
    },
    [
      appLanguageDraft,
      keepVoiceRecoveryDraft,
      recordVoiceOutcome,
      reportError,
      sendInput,
      showVoiceTerminalActivity,
      t,
      voiceDestination,
    ],
  );

  const handleVoiceTurnEnd = useCallback(
    (context: VoiceTurnContext, reason: VoiceTurnEndReason): void => {
      const draft = voiceDraftSnapshotsRef.current.get(context.turnId);
      if (draft && reason !== 'completed') setInput(draft.value);
      voiceDraftSnapshotsRef.current.delete(context.turnId);

      if (
        context.activation === 'global_hold' &&
        context.mode === 'dictation' &&
        reason !== 'completed'
      ) {
        preparedGlobalDictationsRef.current.delete(context.turnId);
        void window.tro
          .cancelDictation({ turnId: context.turnId })
          .catch(() => undefined);
      }

      const destination = voiceDestinationsRef.current.get(context.turnId);
      teacherVoiceBindingsRef.current.delete(context.turnId);
      voiceDestinationsRef.current.delete(context.turnId);
      if (
        destination &&
        (reason === 'no_speech' ||
          reason === 'partial_failure' ||
          reason === 'failed')
      ) {
        const message =
          reason === 'partial_failure'
            ? t('The draft was restored because part of the recording failed.')
            : reason === 'no_speech'
              ? t('No speech was detected. The draft was left unchanged.')
              : t('Voice input could not be completed.');
        showVoiceTerminalActivity(
          {
            appLanguage: appLanguageDraft,
            destination,
            message,
            mode: context.mode,
            phase: 'error',
            transcript:
              reason === 'partial_failure'
                ? latestVoiceTranscriptRef.current
                : '',
          },
          2_500,
        );
      }
    },
    [appLanguageDraft, showVoiceTerminalActivity, t],
  );

  const selectVoiceMode = useCallback(
    (nextMode: VoiceMode): void => {
      if (nextMode === selectedVoiceMode) return;

      setSelectedVoiceMode(nextMode);
      if (!appPreferences) return;

      const nextPreferences: AppPreferences = {
        ...appPreferences,
        voiceMode: nextMode,
      };
      setAppPreferences(nextPreferences);
      if (!nextPreferences.primaryLanguage) return;

      const request = {
        ...nextPreferences,
        primaryLanguage: nextPreferences.primaryLanguage,
      };
      voiceModeSaveQueueRef.current = voiceModeSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const saved = await window.tro.updateAppPreferences(request);
          setAppPreferences((current) =>
            current?.voiceMode === nextMode ? saved : current,
          );
        })
        .catch((saveError: unknown) => {
          reportError(
            saveError instanceof Error
              ? saveError.message
              : 'Tro could not save the voice mode.',
          );
        });
    },
    [appPreferences, reportError, selectedVoiceMode],
  );

  const {
    isHolding: isVoiceShortcutHeld,
    mode: voiceMode,
    platform: voicePlatform,
    status: voiceStatus,
  } = usePushToTalk({
    disabled:
      !voiceReady ||
      !membershipAccessAllowed ||
      isSubmitting,
    enabled: voiceReady && languageSetupComplete && membershipAccessAllowed,
    onAttemptStart: handleVoiceAttemptStart,
    onError: reportError,
    onTranscriptChange: handleVoiceTranscriptChange,
    onTranscriptReady: handleVoiceTranscriptReady,
    onTurnEnd: handleVoiceTurnEnd,
    selectedMode: selectedVoiceMode,
  });
  const voiceModeLocked =
    voiceStatus !== 'idle' && voiceStatus !== 'unavailable';

  useEffect(
    () =>
      window.tro.onVoiceModeToggleRequested(() => {
        if (voiceModeLocked) return;

        const nextMode = nextVoiceMode(selectedVoiceMode);
        selectVoiceMode(nextMode);
        showVoiceTerminalActivity(
          {
            appLanguage: appLanguageDraft,
            destination:
              nextMode === 'task'
                ? { kind: 'task', label: t('Tro task') }
                : { kind: 'tro_composer', label: t('Tro composer') },
            mode: nextMode,
            phase: 'mode_selected',
            transcript: '',
          },
          1_200,
        );
      }),
    [
      appLanguageDraft,
      selectVoiceMode,
      selectedVoiceMode,
      showVoiceTerminalActivity,
      t,
      voiceModeLocked,
    ],
  );

  useEffect(() => {
    const handleVoiceModeToggle = (event: KeyboardEvent): void => {
      if (
        event.repeat ||
        voiceModeLocked ||
        !isVoiceModeToggleShortcut(event, voicePlatform)
      ) {
        return;
      }
      event.preventDefault();
      selectVoiceMode(nextVoiceMode(selectedVoiceMode));
    };

    window.addEventListener('keydown', handleVoiceModeToggle);
    return () => window.removeEventListener('keydown', handleVoiceModeToggle);
  }, [selectVoiceMode, selectedVoiceMode, voiceModeLocked, voicePlatform]);
  const shouldMuteSystemAudio = shouldMuteSystemAudioForVoice(
    appPreferences?.muteSystemAudioWhileSpeaking ?? false,
    isVoiceShortcutHeld,
  );

  useEffect(() => {
    void window.tro
      .setVoiceAudioDucking({ active: shouldMuteSystemAudio })
      .catch((duckingError: unknown) => {
        reportError(
          duckingError instanceof Error
            ? duckingError.message
            : 'Tro could not change the system audio mute state.',
        );
      });
  }, [reportError, shouldMuteSystemAudio]);

  useEffect(
    () => () => {
      void window.tro
        .setVoiceAudioDucking({ active: false })
        .catch((duckingError: unknown) => {
          console.error(
            '[voice] Could not restore system audio during cleanup.',
            duckingError,
          );
        });
    },
    [],
  );
  useEffect(() => {
    const voiceActive =
      voiceStatus === 'requesting_permission' ||
      voiceStatus === 'listening' ||
      voiceStatus === 'processing' ||
      voiceStatus === 'committing';
    const activity =
      voiceActivityOverride ??
      (voiceActive && voiceMode
        ? {
            appLanguage: appLanguageDraft,
            destination: voiceDestination,
            mode: voiceMode,
            phase: voiceStatus,
            transcript: voiceTranscript,
          }
        : null);
    void window.tro.setCompanionVoiceActivity(activity);
  }, [
    appLanguageDraft,
    voiceActivityOverride,
    voiceDestination,
    voiceMode,
    voiceStatus,
    voiceTranscript,
  ]);

  useEffect(
    () => () => {
      if (voiceActivityTimerRef.current) {
        clearTimeout(voiceActivityTimerRef.current);
      }
      void window.tro.setCompanionVoiceActivity(null);
    },
    [],
  );

  const enablePermissions = useCallback(async () => {
    setPermissionError(null);
    setIsRequestingPermissions(true);

    try {
      try {
        const preferences = await window.tro.updateAppPreferences({
          appLanguage: appLanguageDraft,
          classroomPetEnabled: classroomPetEnabledDraft,
          muteSystemAudioWhileSpeaking: muteSystemAudioWhileSpeakingDraft,
          primaryLanguage: languageDraft,
          voiceMode: selectedVoiceMode,
        });
        setAppPreferences(preferences);
        setPreferencesLoadError(null);
      } catch (saveError) {
        setPermissionError(
          saveError instanceof Error
            ? saveError.message
            : 'Tro could not save your language preference.',
        );
        return;
      }
    } finally {
      setIsRequestingPermissions(false);
    }
  }, [
    appLanguageDraft,
    classroomPetEnabledDraft,
    languageDraft,
    muteSystemAudioWhileSpeakingDraft,
    selectedVoiceMode,
  ]);

  const openScreenRecordingSettings = useCallback(async () => {
    setPermissionError(null);
    setIsRequestingPermissions(true);
    try {
      setComputerStatus(await requestScreenRecordingPermission(window.tro));
      setComputerStatusLoaded(true);
    } catch (settingsError) {
      setPermissionError(
        settingsError instanceof Error
          ? settingsError.message
          : 'Tro could not request Screen Recording permission.',
      );
    } finally {
      setIsRequestingPermissions(false);
    }
  }, []);

  const startTask = useCallback(
    async (taskId: string) => {
      const activeSnapshot = latestSnapshotRef.current;
      if (
        activeSnapshot?.taskId !== taskId ||
        activeSnapshot.phase !== 'ready' ||
        isSendingRef.current
      )
        return;

      isSendingRef.current = true;
      clearError();
      setAutoStartFailedTaskId(null);
      setIsSubmitting(true);
      try {
        const startedSnapshot = await window.tro.startTask(taskId);
        const latestSnapshot = latestSnapshotRef.current;
        if (
          latestSnapshot?.taskId === taskId &&
          !isTaskTerminal(latestSnapshot)
        ) {
          recordSnapshot(startedSnapshot);
        }
      } catch (startError) {
        const latestSnapshot = latestSnapshotRef.current;
        if (
          latestSnapshot?.taskId === taskId &&
          latestSnapshot.phase === 'ready'
        ) {
          setAutoStartFailedTaskId(taskId);
          reportError(
            startError instanceof Error
              ? startError.message
              : 'The task could not start.',
          );
        }
      } finally {
        isSendingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [clearError, recordSnapshot, reportError],
  );

  const stopTask = useCallback(async () => {
    const activeSnapshot = latestSnapshotRef.current;
    if (
      !activeSnapshot ||
      !isTaskCancellable(activeSnapshot) ||
      isStoppingTaskRef.current
    )
      return;

    isStoppingTaskRef.current = true;
    clearError();
    setIsStoppingTask(true);
    try {
      const cancelledSnapshot = await window.tro.cancelTask(
        activeSnapshot.taskId,
      );
      if (activeTaskIdRef.current === activeSnapshot.taskId) {
        recordSnapshot(cancelledSnapshot);
      }
    } catch (cancelError) {
      reportError(
        cancelError instanceof Error
          ? cancelError.message
          : 'The current task could not be cancelled.',
      );
    } finally {
      isStoppingTaskRef.current = false;
      setIsStoppingTask(false);
    }
  }, [clearError, recordSnapshot, reportError]);

  useEffect(() => {
    if (
      !snapshot ||
      !shouldAutoStartTask(snapshot, {
        agentReady: selectedTaskRuntimeReady,
        isBusy: isSubmitting,
      }) ||
      autoStartAttemptedTaskIdsRef.current.has(snapshot.taskId)
    ) {
      return;
    }

    autoStartAttemptedTaskIdsRef.current.add(snapshot.taskId);
    const taskId = snapshot.taskId;
    queueMicrotask(() => void startTask(taskId));
  }, [isSubmitting, selectedTaskRuntimeReady, snapshot, startTask]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (
        !shouldStopTaskForEscape(event, latestSnapshotRef.current, {
          documentHasFocus: document.hasFocus(),
          modalOpen:
            settingsOpen ||
            Boolean(latestSnapshotRef.current?.pendingInteraction),
        })
      )
        return;

      event.preventDefault();
      event.stopPropagation();
      const active = latestSnapshotRef.current;
      if (!active) return;
      isStoppingTaskRef.current = true;
      setIsStoppingTask(true);
      void window.tro
        .cancelTask(active.taskId, 'focused_escape')
        .then(recordSnapshot)
        .catch((error: unknown) =>
          reportError(
            error instanceof Error
              ? error.message
              : 'The current task could not be cancelled.',
          ),
        )
        .finally(() => {
          isStoppingTaskRef.current = false;
          setIsStoppingTask(false);
        });
    };

    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [recordSnapshot, reportError, settingsOpen]);

  if (entryGate === 'membership') {
    return (
      <MembershipGate
        appLanguage={appLanguageDraft}
        error={membershipError}
        isActivating={isActivatingMembership}
        isChecking={isCheckingMembership}
        isContinuingFree={isContinuingFree}
        isSigningOut={isSigningOut}
        onActivate={(code) => void activateMembership(code)}
        onContinueFree={() => void continueWithFree()}
        onRefresh={() => void refreshMembership()}
        onSignOut={onSignOut}
        status={membershipStatus}
      />
    );
  }

  if (entryGate === 'permissions') {
    return (
      <PermissionOnboarding
        appLanguage={appLanguageDraft}
        checklist={permissionChecklist}
        computerStatus={computerStatus}
        error={permissionError ?? preferencesLoadError}
        isChecking={isCheckingPermissions}
        isLanguageLoading={!preferencesLoaded}
        isRequesting={isRequestingPermissions}
        onLanguageChange={setLanguageDraft}
        onEnable={() => void enablePermissions()}
        onOpenScreenRecordingSettings={() => void openScreenRecordingSettings()}
        onRefresh={() => void refreshPermissions()}
        primaryLanguage={languageDraft}
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
            title={t(
              isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar',
            )}
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
                aria-current={
                  activeView === 'organization' ? 'page' : undefined
                }
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
        <ClassroomBroadcastPreview
          appLanguage={appLanguageDraft}
          taskId={snapshot?.taskId ?? null}
        />
        {classroomAccessAvailable && (
          <ClassroomExplanationPanel
            appLanguage={appLanguageDraft}
            onOpenClasswork={(attemptId) => {
              setClassroomAttemptFocus(attemptId);
              setActiveView('assigned');
            }}
          />
        )}

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
            <section className="task-column">
              <section
                className={`agent-stage agent-stage--${hero.state} ${
                  organizationHomeBanner
                    ? 'agent-stage--organization-banner'
                    : ''
                }`}
              >
                {organizationHomeBanner ? (
                  <img
                    alt={t('Announcement from {organization}', {
                      organization:
                        organization?.name ?? t('your organization'),
                    })}
                    className="agent-stage__organization-banner"
                    src={organizationHomeBanner.imageDataUrl}
                  />
                ) : (
                  <>
                    <div className={`hero-copy hero-copy--${hero.state}`}>
                      <p className="eyebrow">{hero.eyebrow}</p>
                      <h1>{hero.heading}</h1>
                      <p>{hero.description}</p>
                    </div>

                    <div className="agent-stage__map" aria-hidden="true">
                      <div className="agent-stage__orbit agent-stage__orbit--outer" />
                      <div className="agent-stage__orbit agent-stage__orbit--inner" />
                      <span className="agent-stage__node agent-stage__node--scope">
                        {t('Outcome first')}
                      </span>
                      <span className="agent-stage__node agent-stage__node--act">
                        {t('Act')}
                      </span>
                      <span className="agent-stage__node agent-stage__node--verify">
                        {t('Success looks like')}
                      </span>
                      <span className="agent-stage__core">
                        <BrandMark className="agent-stage__mark" />
                        <i />
                      </span>
                    </div>
                  </>
                )}
              </section>

              <form
                className={`task-composer ${hasLiveTask || pendingInteraction ? 'task-composer--compact' : ''}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendInput();
                }}
              >
                <label htmlFor="task-request">
                  {pendingClarification
                    ? t('Answer Tro to continue this task')
                    : isSteering
                      ? t('Steer the active task')
                      : t('Describe the outcome')}
                </label>
                <div
                  className={`voice-status voice-status--${voiceStatus} voice-status--${voiceMode ?? selectedVoiceMode}`}
                >
                  <span aria-live="polite" className="voice-status__message">
                    <span className="voice-indicator" aria-hidden="true" />
                    <span>
                      {voiceStatusMessage(
                        voiceStatus,
                        appLanguageDraft,
                        voiceMode,
                      )}
                    </span>
                  </span>
                  <VoiceModeControl
                    appLanguage={appLanguageDraft}
                    disabled={voiceModeLocked}
                    mode={selectedVoiceMode}
                    onChange={selectVoiceMode}
                    platform={voicePlatform}
                  />
                </div>
                <textarea
                  id="task-request"
                  ref={taskRequestRef}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={
                    pendingClarification
                      ? t(
                          'Type, dictate, or use Ask Tro to answer…',
                        )
                      : isSteering
                        ? t('Type, dictate, or give Tro a voice task…')
                        : t(
                            'Type a task, or use Write my words to add text without sending…',
                          )
                  }
                  rows={hasLiveTask || pendingInteraction ? 2 : 4}
                  value={input}
                />
                {!pendingClarification && !isSteering && (
                  <div
                    aria-label={t('Execution mode')}
                    className="execution-profile-picker"
                    role="group"
                  >
                    <button
                      aria-pressed={executionProfile === 'everyday'}
                      onClick={() => setExecutionProfile('everyday')}
                      type="button"
                    >
                      <strong>{t('Everyday')}</strong>
                      <span>
                        {t('Apps, research, and routine desktop work')}
                      </span>
                    </button>
                    {workspaceRuntime?.available && (
                      <button
                        aria-pressed={executionProfile === 'workspace'}
                        disabled={isSelectingWorkspace}
                        onClick={() => {
                          if (
                            workspaceSelection &&
                            executionProfile !== 'workspace'
                          ) {
                            setExecutionProfile('workspace');
                          } else {
                            void chooseWorkspace();
                          }
                        }}
                        type="button"
                      >
                        <strong>
                          {isSelectingWorkspace
                            ? t('Choosing…')
                            : t('Workspace')}
                        </strong>
                        <span>
                          {workspaceSelection
                            ? workspaceSelection.displayName
                            : t('Choose a trusted project folder')}
                        </span>
                      </button>
                    )}
                    {workspaceRuntime && !workspaceRuntime.available && (
                      <p className="execution-profile-picker__unavailable">
                        {workspaceRuntime.summary}
                      </p>
                    )}
                  </div>
                )}
                <div className="composer-footer">
                  <span>
                    {pendingClarification
                      ? t('This answer stays attached to the current task.')
                      : isSteering
                        ? t('Steering is reviewed at the next safe boundary.')
                        : t(
                            'Tro will carry out this goal within the selected scope and pause only for clarification, system permission, or account access.',
                          )}
                  </span>
                  <button
                    className="primary-button"
                    disabled={!canSubmit}
                    type="submit"
                  >
                    {isSubmitting
                      ? t('Sending…')
                      : pendingClarification
                        ? t('Send answer')
                        : isSteering
                          ? t('Send steering')
                          : t('Start task')}
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              </form>

              {!snapshot && (
                <div className="examples" aria-label={t('Example tasks')}>
                  {EXAMPLE_TASKS.map((example) => (
                    <button
                      key={example}
                      onClick={() => setInput(example)}
                      type="button"
                    >
                      {t(example)}
                    </button>
                  ))}
                </div>
              )}

              {hasLiveTask && snapshot && (
                <LiveTaskRail
                  activities={agentActivities.filter(
                    (item) => item.taskId === snapshot.taskId,
                  )}
                  activity={
                    agentActivity?.taskId === snapshot.taskId
                      ? agentActivity
                      : null
                  }
                  appLanguage={appLanguageDraft}
                  autoStartFailed={autoStartFailedTaskId === snapshot.taskId}
                  canStart={selectedTaskRuntimeReady}
                  goal={snapshot.goal}
                  isStarting={isSubmitting}
                  lastEvent={snapshot.lastEvent}
                  onRetry={() => void startTask(snapshot.taskId)}
                  phase={snapshot.phase}
                  progress={snapshot.progress}
                  request={snapshot.request}
                  streamingDraft={streamingDraft}
                />
              )}

              {error && (
                <div className="error-banner" role="alert">
                  <strong>{t('Something needs attention')}</strong>
                  <span>{error}</span>
                </div>
              )}

              {pendingInteraction && (
                <PendingInteractionCard
                  appLanguage={appLanguageDraft}
                  interaction={pendingInteraction}
                  isSending={isSubmitting}
                  onAnswerChoice={(answer) => void sendInput(answer)}
                />
              )}

              {permissionWait && permissionPresentation && snapshot && (
                <section className="pending-interaction" aria-live="polite">
                  <div>
                    <strong>{t(permissionPresentation.title)}</strong>
                    <p>{t(permissionPresentation.body)}</p>
                  </div>
                  <div className="pending-interaction__actions">
                    <button
                      className="primary-button"
                      onClick={() =>
                        void window.tro.resolveComputerPermission({
                          taskId: snapshot.taskId,
                          action: 'open_system_settings',
                        })
                      }
                      type="button"
                    >
                      {t('Open System Settings')}
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() =>
                        void window.tro.resolveComputerPermission({
                          taskId: snapshot.taskId,
                          action: 'continue_without_computer',
                        })
                      }
                      type="button"
                    >
                      {t('Continue without computer')}
                    </button>
                  </div>
                </section>
              )}

              {hasLiveTask && snapshot && (
                <Conversation
                  appLanguage={appLanguageDraft}
                  snapshot={snapshot}
                />
              )}
              {isTerminalTask && snapshot && (
                <TerminalOutcome
                  appLanguage={appLanguageDraft}
                  onViewHistory={() => setActiveView('history')}
                  snapshot={snapshot}
                />
              )}
            </section>

            <aside className="context-column">
              <section
                className="usage-overview"
                aria-labelledby="usage-overview-heading"
              >
                <div className="usage-overview__heading">
                  <div>
                    <p className="eyebrow">{t('Plan & weekly usage')}</p>
                    <h2 id="usage-overview-heading">
                      {planTitle(displayedPlan)}
                    </h2>
                  </div>
                  <strong className="usage-overview__percent">
                    {usagePercent === null
                      ? '—'
                      : t('{percent}% left', { percent: usagePercent })}
                  </strong>
                </div>
                {usagePercent === null ? (
                  <p className="usage-overview__detail">
                    {t('Usage details unavailable')}
                  </p>
                ) : (
                  <>
                    <div
                      aria-label={t('Weekly usage')}
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={usagePercent}
                      aria-valuetext={t('{percent}% left', {
                        percent: usagePercent,
                      })}
                      className="usage-overview__progress"
                      role="progressbar"
                    >
                      <span style={{ width: `${usagePercent}%` }} />
                    </div>
                    <p className="usage-overview__detail">
                      {t('{remaining} of {limit} messages left', {
                        limit: usageBudget?.messages.limit ?? 0,
                        remaining: usageBudget?.messages.remaining ?? 0,
                      })}
                    </p>
                  </>
                )}
              </section>
              <section
                className="context-overview"
                aria-labelledby="session-overview-heading"
              >
                <p className="eyebrow">{t('Current app session')}</p>
                <div className="context-overview__metric">
                  <strong>{historyTaskCount}</strong>
                  <span>
                    {t(
                      historyTaskCount === 1
                        ? '{count} finished task'
                        : '{count} finished tasks',
                      { count: historyTaskCount },
                    ).replace(`${historyTaskCount} `, '')}
                  </span>
                </div>
                <h2 id="session-overview-heading">{taskPhase}</h2>
                <div className="context-overview__guardrails">
                  <span>{t('Goal-scoped execution')}</span>
                  <span>{t('OS permissions enforced')}</span>
                  <span>{t('Tools selected at runtime')}</span>
                </div>
              </section>
              <ComputerConnection
                appLanguage={appLanguageDraft}
                isConnecting={isRequestingPermissions}
                onConnect={() => void openScreenRecordingSettings()}
                ready={desktopReady}
                status={computerStatus}
              />
              {hasLiveTask && (
                <section
                  className="activity-card"
                  id="activity"
                  aria-labelledby="activity-heading"
                >
                  <div className="section-heading-row">
                    <div>
                      <p className="eyebrow">{t('Live lifecycle')}</p>
                      <h2 id="activity-heading">{t('Task activity')}</h2>
                    </div>
                    <span className="event-count">{events.length}</span>
                  </div>
                  <ActivityList
                    appLanguage={appLanguageDraft}
                    events={events}
                  />
                </section>
              )}
            </aside>
          </div>
        )}
        {settingsOpen && (
          <SettingsPage
            appLanguage={appLanguageDraft}
            appUpdateError={appUpdateError}
            appUpdateStatus={appUpdateStatus}
            classroomPetEnabled={classroomPetEnabledDraft}
            companionBusy={companionBusy}
            companionError={companionError}
            companionStatus={companionStatus}
            error={settingsError}
            hasChanges={
              appPreferences?.appLanguage !== appLanguageDraft ||
              appPreferences?.classroomPetEnabled !==
                classroomPetEnabledDraft ||
              appPreferences?.muteSystemAudioWhileSpeaking !==
                muteSystemAudioWhileSpeakingDraft ||
              appPreferences?.primaryLanguage !== languageDraft
            }
            isSaving={isSavingPreferences}
            isActivatingMembership={isActivatingMembership}
            isUpdatingApp={isUpdatingApp}
            membershipError={membershipError}
            membershipStatus={membershipStatus}
            onActivateCompanion={activateCompanion}
            onActivateSavedCompanion={activateSavedCompanion}
            organization={organization}
            organizationError={organizationError}
            isLoadingOrganization={isLoadingOrganization}
            onAppLanguageChange={(language) => {
              setAppLanguageDraft(language);
              setSettingsError(null);
              setSettingsSaveMessage(null);
            }}
            onCheckForUpdates={() => void checkForAppUpdates()}
            onClassroomPetEnabledChange={(enabled) => {
              setClassroomPetEnabledDraft(enabled);
              setSettingsError(null);
              setSettingsSaveMessage(null);
            }}
            onGenerateCompanion={generateCompanion}
            onLanguageChange={(language) => {
              setLanguageDraft(language);
              setSettingsError(null);
              setSettingsSaveMessage(null);
            }}
            onActivateMembership={(code) => void activateMembership(code)}
            onClose={closeSettings}
            onMuteSystemAudioWhileSpeakingChange={(enabled) => {
              setMuteSystemAudioWhileSpeakingDraft(enabled);
              setSettingsError(null);
              setSettingsSaveMessage(null);
            }}
            onOpenOrganization={() => {
              closeSettings();
              setActiveView('organization');
            }}
            onRefreshOrganization={() => void refreshOrganization()}
            onRestartAndInstall={() => void restartAndInstallAppUpdate()}
            onSave={() => void saveSettings()}
            onUseDefaultCompanion={useDefaultCompanion}
            primaryLanguage={languageDraft}
            saveMessage={settingsSaveMessage}
            muteSystemAudioWhileSpeaking={muteSystemAudioWhileSpeakingDraft}
            systemAudioMuteSupported={voicePlatform === 'macos'}
          />
        )}
      </main>
    </div>
  );
}
