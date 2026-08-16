import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import type {
  AppPreferences,
  AuthUser,
  CuaStatus,
  GoalSpec,
  MembershipStatus,
  PendingInteraction,
  PrimaryLanguage,
  TaskEvent,
  TaskHistory,
  TaskSnapshot,
  VoiceStatus,
} from '../shared/contracts';

import { BrandMark } from './BrandMark';
import { getCompanionState } from './companion-state';
import { HistoryPage } from './HistoryPage';
import { InsightsPage } from './InsightsPage';
import {
  isPrimaryLanguageSetupComplete,
  primaryLanguageLabel,
} from './language-options';
import { membershipAllowsAccess } from './membership';
import { MembershipGate } from './MembershipGate';
import {
  createPermissionChecklist,
  inspectMicrophonePermission,
  isPermissionSetupComplete,
  requestScreenRecordingPermission,
  shouldConnectAfterPermissionRefresh,
  type PermissionState,
} from './permission-onboarding';
import { PermissionOnboarding } from './PermissionOnboarding';
import {
  globalPushToTalkShortcutName,
  pushToTalkShortcutName,
  type PushToTalkPlatform,
} from './push-to-talk';
import { SettingsPage } from './SettingsPage';
import {
  approvalSafeguardMessage,
  isTaskCancellable,
  shouldAutoStartTask,
  shouldStopTaskForEscape,
} from './task-execution';
import {
  getCompanionErrorVisibility,
  INITIAL_TRANSIENT_CURSOR_ERROR_STATE,
  scheduleTransientCursorErrorDismissal,
  transientCursorErrorReducer,
} from './transient-cursor-error';
import {
  usePushToTalk,
  type VoiceInputStatus,
} from './use-push-to-talk';

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
  model: 'gpt-realtime-whisper',
  summary: 'Checking the OpenAI voice connection…',
};

const TERMINAL_PHASES = new Set(['completed', 'failed', 'cancelled']);
const STEERABLE_PHASES = new Set([
  'planning',
  'observing',
  'acting',
  'verifying',
  'paused',
  'blocked',
]);

type ActiveView = 'agent' | 'history' | 'insights' | 'settings';

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
  name: 'activity' | 'agent' | 'history' | 'insights' | 'settings';
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

function formatLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

function voiceStatusMessage(
  status: VoiceInputStatus,
  platform: PushToTalkPlatform,
): string {
  switch (status) {
    case 'connecting':
      return 'Connecting to OpenAI voice…';
    case 'listening':
      return 'Listening… Release the voice shortcut to send.';
    case 'processing':
      return 'Finishing transcript…';
    case 'requesting_permission':
      return 'Waiting for microphone access…';
    case 'unavailable':
      return 'Voice recognition is unavailable. Type your request instead.';
    case 'idle': {
      const globalShortcut = globalPushToTalkShortcutName(platform);
      if (globalShortcut) {
        if (platform === 'macos') {
          return `Voice ready. Hold ${globalShortcut} to talk from any app.`;
        }
        return `Voice ready. Hold ${pushToTalkShortcutName(platform)} to talk, or hold ${globalShortcut} globally.`;
      }
      return `Voice ready. Hold ${pushToTalkShortcutName(platform)} to talk.`;
    }
  }
}

function VoiceConnection({
  inputStatus,
  primaryLanguage,
  status,
}: {
  inputStatus: VoiceInputStatus;
  primaryLanguage: PrimaryLanguage;
  status: VoiceStatus;
}) {
  const configured = status.state === 'ready';
  const connected =
    configured && inputStatus !== 'connecting' && inputStatus !== 'unavailable';
  const connectionLabel = !configured
    ? 'Not configured'
    : inputStatus === 'connecting'
      ? 'Connecting'
      : connected
        ? 'Connected'
        : 'Not connected';

  return (
    <section className="computer-card" aria-labelledby="voice-heading">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Voice input</p>
          <h2 id="voice-heading">OpenAI Realtime</h2>
        </div>
        <span
          className={`status-dot status-dot--${connected ? 'ready' : 'disconnected'}`}
        >
          {connectionLabel}
        </span>
      </div>
      <p>
        {connected
          ? 'Realtime voice is ready. The microphone stays off until you hold the shortcut.'
          : status.summary}
      </p>
      <p className="metadata">
        Model {status.model} · {primaryLanguageLabel(primaryLanguage)}
      </p>
    </section>
  );
}

function VoiceShortcut({ platform }: { platform: PushToTalkPlatform }) {
  if (platform === 'unsupported') return null;

  const keys = platform === 'windows' ? ['Left Alt', 'Left Ctrl'] : ['⌘', '⌃'];

  return (
    <span
      className="voice-shortcut"
      aria-label={pushToTalkShortcutName(platform)}
    >
      <kbd>{keys[0]}</kbd>
      <span aria-hidden="true">+</span>
      <kbd>{keys[1]}</kbd>
    </span>
  );
}

function LiveTaskRail({
  autoStartFailed,
  canStart,
  goal,
  isStarting,
  lastEvent,
  onRetry,
  phase,
  progress,
  request,
}: {
  autoStartFailed: boolean;
  canStart: boolean;
  goal: GoalSpec | null;
  isStarting: boolean;
  lastEvent: TaskEvent | null;
  onRetry: () => void;
  phase: TaskSnapshot['phase'];
  progress: TaskSnapshot['progress'];
  request: string;
}) {
  const progressLabel = progress
    ? `${progress.currentStep} / ${progress.maxSteps}`
    : phase === 'interpreting'
      ? 'Scoping'
      : 'Not started';
  const progressPercentage = progress
    ? Math.min(
        100,
        Math.round((progress.currentStep / progress.maxSteps) * 100),
      )
    : 0;

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
            <p className="eyebrow">Live task · {formatLabel(phase)}</p>
            <h2 id="live-task-heading">{goal?.objective ?? request}</h2>
          </div>
          <div
            aria-label={`Progress ${progressLabel}`}
            className="live-task-rail__progress"
          >
            <span>{progressLabel}</span>
            <i aria-hidden="true">
              <span style={{ width: `${progressPercentage}%` }} />
            </i>
          </div>
        </div>

        <div className="live-task-rail__summary">
          <span>{goal ? formatLabel(goal.interactionMode) : 'Defining interaction'}</span>
          <span aria-hidden="true">·</span>
          <span>
            {goal
              ? `${goal.capabilities.length} ${goal.capabilities.length === 1 ? 'capability' : 'capabilities'} in scope`
              : 'Capability scope pending'}
          </span>
        </div>

        {goal && (
          <details className="live-task-details">
            <summary>Scope & safeguards</summary>
            <div className="live-task-details__content">
              <div>
                <span className="field-label">Capabilities</span>
                <div className="tag-list">
                  {goal.capabilities.map((capability) => (
                    <span className="tag" key={capability}>
                      {formatLabel(capability)}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <span className="field-label">Success looks like</span>
                <p>{goal.successCriteria[0]?.description}</p>
              </div>
              <div className="guardrail">
                <span aria-hidden="true">◆</span>
                <p>
                  {approvalSafeguardMessage(phase)} TroCode cannot expand its
                  own capability or resource scope.
                </p>
              </div>
            </div>
          </details>
        )}

        {phase === 'blocked' && lastEvent && (
          <div className="live-task-blocked" role="alert">
            <strong>Why TroCode stopped</strong>
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
                ? 'Waiting for OpenAI Realtime and the CUA Driver before starting.'
                : autoStartFailed
                  ? 'TroCode could not start automatically. You can try again.'
                  : isStarting
                    ? 'Starting automatically… Press Escape at any time to stop.'
                    : 'Ready. Starting automatically… Press Escape at any time to stop.'}
            </p>
            {autoStartFailed && (
              <button
                className="primary-button"
                disabled={!canStart || isStarting}
                onClick={onRetry}
                type="button"
              >
                {isStarting ? 'Starting…' : 'Try again'}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function TerminalOutcome({
  onViewHistory,
  snapshot,
}: {
  onViewHistory: () => void;
  snapshot: TaskSnapshot;
}) {
  const heading =
    snapshot.phase === 'completed'
      ? 'Outcome reached'
      : snapshot.phase === 'cancelled'
        ? 'Task stopped safely'
        : 'Task needs attention';

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
        <p className="eyebrow">{formatLabel(snapshot.phase)}</p>
        <h2 id="terminal-heading">{heading}</h2>
        <p>
          {snapshot.lastEvent?.summary ??
            'The task finished. Its conversation and activity are available in History.'}
        </p>
      </div>
      <button
        className="terminal-outcome__link"
        onClick={onViewHistory}
        type="button"
      >
        View task trail <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}

function ActivityList({ events }: { events: TaskEvent[] }) {
  if (events.length === 0) {
    return <p className="empty-activity">Task events will appear here.</p>;
  }

  return (
    <ol className="activity-list">
      {events.map((event) => (
        <li key={event.eventId}>
          <span className={`activity-marker activity-marker--${event.status}`} />
          <div>
            <strong>{formatLabel(event.phase)}</strong>
            <p>{event.summary}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Conversation({ snapshot }: { snapshot: TaskSnapshot }) {
  return (
    <section className="conversation-card" aria-labelledby="conversation-heading">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Same task</p>
          <h2 id="conversation-heading">Conversation</h2>
        </div>
        <span className="event-count">{snapshot.messages.length}</span>
      </div>
      <ol aria-live="polite" className="message-list">
        {snapshot.messages.map((message) => (
          <li
            className={`message message--${message.role}`}
            key={message.messageId}
          >
            <span>{message.role === 'user' ? 'You' : 'TroCode'}</span>
            <p>{message.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PendingInteractionCard({
  interaction,
  isSending,
  onAnswerChoice,
  onApproval,
}: {
  interaction: PendingInteraction;
  isSending: boolean;
  onAnswerChoice: (answer: string) => void;
  onApproval: (decision: 'approve' | 'deny') => void;
}) {
  if (interaction.kind === 'clarification') {
    return (
      <section
        aria-live="polite"
        aria-labelledby="interaction-heading"
        className="interaction-card interaction-card--clarification"
      >
        <p className="eyebrow">TroCode needs your input</p>
        <h2 id="interaction-heading">{interaction.prompt}</h2>
        {interaction.choices && (
          <div className="interaction-choices">
            {interaction.choices.map((choice) => (
              <button
                disabled={isSending}
                key={choice.id}
                onClick={() => onAnswerChoice(choice.label)}
                type="button"
              >
                {choice.label}
              </button>
            ))}
          </div>
        )}
        <p>Answer below by voice or text. Your response will continue this task.</p>
      </section>
    );
  }

  return (
    <section
      aria-live="assertive"
      aria-labelledby="interaction-heading"
      className="interaction-card interaction-card--approval"
    >
      <p className="eyebrow">Exact approval required</p>
      <h2 id="interaction-heading">{interaction.prompt}</h2>
      <p>{interaction.consequence}</p>
      <dl className="approval-details">
        <div>
          <dt>Action</dt>
          <dd>{formatLabel(interaction.action.action)}</dd>
        </div>
        <div>
          <dt>Description</dt>
          <dd>{interaction.action.description}</dd>
        </div>
        {interaction.action.target && (
          <div>
            <dt>Target</dt>
            <dd>{interaction.action.target}</dd>
          </div>
        )}
        {Object.entries(interaction.action.parameters ?? {}).map(
          ([key, value]) => (
            <div key={key}>
              <dt>{formatLabel(key)}</dt>
              <dd>{Array.isArray(value) ? value.join(', ') : value}</dd>
            </div>
          ),
        )}
      </dl>
      <p className="approval-note">
        Spoken or typed “yes” cannot approve this action. Use the button below.
      </p>
      <div className="approval-actions">
        <button
          className="secondary-button"
          disabled={isSending}
          onClick={() => onApproval('deny')}
          type="button"
        >
          Deny
        </button>
        <button
          className="primary-button"
          disabled={isSending}
          onClick={() => onApproval('approve')}
          type="button"
        >
          Approve exact action
        </button>
      </div>
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
  const [input, setInput] = useState('');
  const [snapshot, setSnapshot] = useState<TaskSnapshot | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
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
  const [appPreferences, setAppPreferences] =
    useState<AppPreferences | null>(null);
  const [languageDraft, setLanguageDraft] =
    useState<PrimaryLanguage>('en');
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
  const [isRequestingPermissions, setIsRequestingPermissions] =
    useState(false);
  const [computerStatusLoaded, setComputerStatusLoaded] = useState(false);
  const [microphonePermission, setMicrophonePermission] =
    useState<PermissionState>('checking');
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [membershipStatus, setMembershipStatus] =
    useState<MembershipStatus | null>(null);
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [isCheckingMembership, setIsCheckingMembership] = useState(true);
  const [isActivatingMembership, setIsActivatingMembership] = useState(false);
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
  const autoStartAttemptedTaskIdsRef = useRef(new Set<string>());
  const isSendingRef = useRef(false);
  const isStoppingTaskRef = useRef(false);
  const permissionRefreshIdRef = useRef(0);
  const membershipRefreshIdRef = useRef(0);
  const spokenInteractionIdRef = useRef<string | null>(null);

  const clearError = useCallback(() => {
    dispatchTransientCursorError({ type: 'cleared' });
  }, []);

  const reportError = useCallback((message: string) => {
    dispatchTransientCursorError({ type: 'reported', message });
  }, []);

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
          : 'TroCode could not check system permissions.',
      );
    } finally {
      if (permissionRefreshIdRef.current === refreshId) {
        setIsCheckingPermissions(false);
      }
    }
  }, []);

  useEffect(() => {
    const unsubscribe = window.tro.onTaskUpdate((update) => {
      const activeTaskId = activeTaskIdRef.current;
      if (activeTaskId && activeTaskId !== update.snapshot.taskId) return;

      activeTaskIdRef.current = update.snapshot.taskId;
      recordSnapshot(update.snapshot);
      setEvents((currentEvents) =>
        appendUniqueEvent(currentEvents, update.event),
      );
    });

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
          summary: 'Saved history could not be loaded; this session is temporary.',
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
        if (preferences.primaryLanguage) {
          setLanguageDraft(preferences.primaryLanguage);
        }
        setPreferencesLoadError(null);
      })
      .catch((preferencesError: unknown) => {
        setPreferencesLoadError(
          preferencesError instanceof Error
            ? preferencesError.message
            : 'TroCode could not load your language preference.',
        );
      })
      .finally(() => setPreferencesLoaded(true));

    return () => {
      unsubscribe();
    };
  }, [recordSnapshot, reportError]);

  useEffect(() => {
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
  }, [refreshPermissions]);

  const pendingInteraction = snapshot?.pendingInteraction ?? null;
  const pendingClarification =
    pendingInteraction?.kind === 'clarification' ? pendingInteraction : null;
  const isSteering = snapshot ? STEERABLE_PHASES.has(snapshot.phase) : false;

  useEffect(() => {
    if (!pendingInteraction) return;
    if (spokenInteractionIdRef.current === pendingInteraction.id) return;
    if (
      !('speechSynthesis' in window) ||
      typeof SpeechSynthesisUtterance === 'undefined'
    ) {
      return;
    }

    spokenInteractionIdRef.current = pendingInteraction.id;
    const text =
      pendingInteraction.kind === 'approval'
        ? `${pendingInteraction.prompt}. This needs exact approval in TroCode.`
        : pendingInteraction.prompt;
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [pendingInteraction]);

  const canSubmit =
    input.trim().length >= (pendingClarification || isSteering ? 1 : 2) &&
    !isSubmitting &&
    pendingInteraction?.kind !== 'approval';
  const taskPhase = useMemo(
    () => (snapshot ? formatLabel(snapshot.phase) : 'No active task'),
    [snapshot],
  );
  const isTerminalTask = snapshot
    ? TERMINAL_PHASES.has(snapshot.phase)
    : false;
  const hasLiveTask = snapshot !== null && !isTerminalTask;
  const sessionTaskSnapshots = Object.values(sessionSnapshots);
  const historyTaskCount = sessionTaskSnapshots.filter((task) =>
    TERMINAL_PHASES.has(task.phase),
  ).length;
  const hero = pendingInteraction
    ? {
        state: 'interaction',
        eyebrow: 'Your move',
        heading: 'A decision is waiting.',
        description:
          'Review the request below. TroCode will hold position until you answer or approve the exact action.',
      }
    : hasLiveTask
      ? {
          state: 'active',
          eyebrow: 'In motion',
          heading: 'Keep the outcome in view.',
          description:
            'Follow the live signal, steer the next safe step, or stop the task at any time.',
        }
      : isTerminalTask
        ? {
            state: 'terminal',
            eyebrow: 'Outcome recorded',
            heading: 'What should we do next?',
            description:
              'The finished task is now in your session trail. Start another outcome whenever you are ready.',
          }
        : {
            state: 'empty',
            eyebrow: 'Outcome first',
            heading: 'What should we accomplish?',
            description:
              'Describe the finish line. TroCode will define a bounded scope, choose its tools, and verify the result.',
          };
  const permissionChecklist = useMemo(
    () =>
      createPermissionChecklist(
        computerStatus,
        microphonePermission,
        computerStatusLoaded,
      ),
    [computerStatus, computerStatusLoaded, microphonePermission],
  );
  const permissionSetupComplete = isPermissionSetupComplete(
    permissionChecklist,
    computerStatus,
  );
  const languageSetupComplete =
    isPrimaryLanguageSetupComplete(appPreferences, preferencesLoaded);
  const membershipAccessAllowed = membershipAllowsAccess(membershipStatus);
  const executionReady =
    computerStatus.state === 'ready' &&
    computerStatus.available &&
    voiceProviderStatus.state === 'ready';

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
          : 'TroCode could not check your membership.',
      );
    } finally {
      if (membershipRefreshIdRef.current === refreshId) {
        setIsCheckingMembership(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!permissionSetupComplete || !languageSetupComplete) return;

    const handleWindowFocus = (): void => {
      void refreshMembership();
    };
    queueMicrotask(() => void refreshMembership());
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      membershipRefreshIdRef.current += 1;
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [languageSetupComplete, permissionSetupComplete, refreshMembership]);

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

  const activateMembership = useCallback(async (code: string) => {
    setIsActivatingMembership(true);
    setMembershipError(null);
    try {
      setMembershipStatus(await window.tro.activateMembership({ code }));
    } catch (activationError) {
      setMembershipError(
        activationError instanceof Error
          ? activationError.message
          : 'TroCode could not activate this membership code.',
      );
    } finally {
      setIsActivatingMembership(false);
    }
  }, []);

  const saveSettings = useCallback(async () => {
    setIsSavingPreferences(true);
    setSettingsError(null);
    setSettingsSaveMessage(null);
    try {
      const preferences = await window.tro.updateAppPreferences({
        primaryLanguage: languageDraft,
      });
      setAppPreferences(preferences);
      setSettingsSaveMessage(
        `${primaryLanguageLabel(languageDraft)} will be used for new voice turns.`,
      );
    } catch (saveError) {
      setSettingsError(
        saveError instanceof Error
          ? saveError.message
          : 'TroCode could not save your language preference.',
      );
    } finally {
      setIsSavingPreferences(false);
    }
  }, [languageDraft]);

  const sendInput = useCallback(
    async (requestText = input, source: 'typed' | 'voice' = 'typed') => {
      const normalizedRequest = requestText.trim();
      const minimumLength = pendingClarification || isSteering ? 1 : 2;
      if (
        normalizedRequest.length < minimumLength ||
        isSubmitting ||
        isSendingRef.current
      ) {
        return;
      }

      isSendingRef.current = true;
      clearError();
      setIsSubmitting(true);

      try {
        if (source === 'voice') {
          await window.tro.recordVoiceTranscript({ text: normalizedRequest });
        }

        let nextSnapshot: TaskSnapshot;
        if (pendingClarification && snapshot) {
          nextSnapshot = await window.tro.respondToInteraction({
            taskId: snapshot.taskId,
            interactionId: pendingClarification.id,
            kind: 'answer',
            text: normalizedRequest,
          });
        } else if (isSteering && snapshot) {
          nextSnapshot = await window.tro.steerTask({
            taskId: snapshot.taskId,
            instruction: normalizedRequest,
          });
        } else {
          if (snapshot && !TERMINAL_PHASES.has(snapshot.phase)) {
            recordSnapshot(await window.tro.cancelTask(snapshot.taskId));
          }
          activeTaskIdRef.current = null;
          setEvents([]);
          recordSnapshot(null);
          nextSnapshot = await window.tro.submitTask({
            text: normalizedRequest,
          });
        }

        activeTaskIdRef.current = nextSnapshot.taskId;
        recordSnapshot(nextSnapshot);
        setInput('');
      } catch (submitError) {
        reportError(
          submitError instanceof Error
            ? submitError.message
            : 'The task could not accept that input.',
        );
      } finally {
        isSendingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [
      clearError,
      input,
      isSteering,
      isSubmitting,
      pendingClarification,
      recordSnapshot,
      reportError,
      snapshot,
    ],
  );

  const decideApproval = useCallback(
    async (decision: 'approve' | 'deny') => {
      if (
        !snapshot ||
        snapshot.pendingInteraction?.kind !== 'approval' ||
        isSubmitting ||
        isSendingRef.current
      ) {
        return;
      }

      const approval = snapshot.pendingInteraction;
      isSendingRef.current = true;
      clearError();
      setIsSubmitting(true);

      try {
        recordSnapshot(
          await window.tro.decideApproval({
            taskId: snapshot.taskId,
            interactionId: approval.id,
            kind: 'approval',
            decision,
            actionDigest: approval.actionDigest,
          }),
        );
      } catch (approvalError) {
        reportError(
          approvalError instanceof Error
            ? approvalError.message
            : 'The approval decision could not be recorded.',
        );
      } finally {
        isSendingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [clearError, isSubmitting, recordSnapshot, reportError, snapshot],
  );

  const resetTask = useCallback(async () => {
    if (isSendingRef.current) return;

    isSendingRef.current = true;
    setIsSubmitting(true);
    const activeSnapshot = snapshot;

    try {
      if (
        activeSnapshot &&
        !TERMINAL_PHASES.has(activeSnapshot.phase)
      ) {
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

  const { platform: voicePlatform, status: voiceStatus } = usePushToTalk({
    disabled:
      !permissionSetupComplete ||
      !membershipAccessAllowed ||
      isSubmitting ||
      pendingInteraction?.kind === 'approval',
    enabled:
      permissionSetupComplete &&
      languageSetupComplete &&
      membershipAccessAllowed &&
      voiceProviderStatus.state === 'ready',
    onAttemptStart: clearError,
    onError: reportError,
    onTranscriptChange: setInput,
    onTranscriptSubmit: (transcript) => void sendInput(transcript, 'voice'),
  });
  const companionState = getCompanionState({
    hasError: getCompanionErrorVisibility({
      computerFailed: computerStatus.state === 'error',
      taskFailed: snapshot?.phase === 'failed',
      transientErrorVisible: transientCursorError.visible,
      voiceProviderFailed: voiceProviderStatus.state === 'error',
    }),
    isSending: isSubmitting,
    voiceStatus,
  });

  useEffect(() => {
    void window.tro.setCompanionState(companionState);
  }, [companionState]);

  const enablePermissions = useCallback(async () => {
    setPermissionError(null);
    setIsRequestingPermissions(true);
    const errors: string[] = [];

    try {
      try {
        const preferences = await window.tro.updateAppPreferences({
          primaryLanguage: languageDraft,
        });
        setAppPreferences(preferences);
        setPreferencesLoadError(null);
      } catch (saveError) {
        setPermissionError(
          saveError instanceof Error
            ? saveError.message
            : 'TroCode could not save your language preference.',
        );
        return;
      }

      if (permissionSetupComplete) return;

      if (!navigator.mediaDevices?.getUserMedia) {
        setMicrophonePermission('unavailable');
        errors.push('No microphone is available to TroCode.');
      } else {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              autoGainControl: true,
              echoCancellation: true,
              noiseSuppression: true,
            },
          });
          for (const track of stream.getTracks()) track.stop();
          setMicrophonePermission('granted');
        } catch (microphoneError) {
          const microphoneUnavailable =
            microphoneError instanceof DOMException &&
            microphoneError.name === 'NotFoundError';
          setMicrophonePermission(
            microphoneUnavailable ? 'unavailable' : 'blocked',
          );
          errors.push(
            microphoneUnavailable
              ? 'No microphone was found.'
              : 'Enable Microphone for TroCode in System Settings → Privacy & Security.',
          );
        }
      }

      try {
        setComputerStatus(await requestScreenRecordingPermission(window.tro));
        setComputerStatusLoaded(true);
      } catch (connectError) {
        errors.push(
          connectError instanceof Error
            ? connectError.message
            : 'The computer-use permission request could not be opened.',
        );
      }

      setPermissionError(errors.length > 0 ? errors.join(' ') : null);
    } finally {
      setIsRequestingPermissions(false);
    }
  }, [languageDraft, permissionSetupComplete]);

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
          : 'TroCode could not request Screen Recording permission.',
      );
    } finally {
      setIsRequestingPermissions(false);
    }
  }, []);

  const startTask = useCallback(async (taskId: string) => {
    const activeSnapshot = latestSnapshotRef.current;
    if (
      activeSnapshot?.taskId !== taskId ||
      activeSnapshot.phase !== 'ready' ||
      isSendingRef.current
    ) return;

    isSendingRef.current = true;
    clearError();
    setAutoStartFailedTaskId(null);
    setIsSubmitting(true);
    try {
      const startedSnapshot = await window.tro.startTask(taskId);
      const latestSnapshot = latestSnapshotRef.current;
      if (
        latestSnapshot?.taskId === taskId &&
        !TERMINAL_PHASES.has(latestSnapshot.phase)
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
  }, [clearError, recordSnapshot, reportError]);

  const stopTask = useCallback(async () => {
    const activeSnapshot = latestSnapshotRef.current;
    if (
      !activeSnapshot ||
      !isTaskCancellable(activeSnapshot) ||
      isStoppingTaskRef.current
    ) return;

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
        executionReady,
        isBusy: isSubmitting,
      }) ||
      autoStartAttemptedTaskIdsRef.current.has(snapshot.taskId)
    ) {
      return;
    }

    autoStartAttemptedTaskIdsRef.current.add(snapshot.taskId);
    const taskId = snapshot.taskId;
    queueMicrotask(() => void startTask(taskId));
  }, [executionReady, isSubmitting, snapshot, startTask]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (!shouldStopTaskForEscape(event, latestSnapshotRef.current)) return;

      event.preventDefault();
      event.stopPropagation();
      void stopTask();
    };

    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [stopTask]);

  if (!permissionSetupComplete || !languageSetupComplete) {
    return (
      <PermissionOnboarding
        checklist={permissionChecklist}
        computerStatus={computerStatus}
        error={permissionError ?? preferencesLoadError}
        isChecking={isCheckingPermissions}
        isLanguageLoading={!preferencesLoaded}
        isRequesting={isRequestingPermissions}
        onLanguageChange={setLanguageDraft}
        onEnable={() => void enablePermissions()}
        onOpenScreenRecordingSettings={() =>
          void openScreenRecordingSettings()
        }
        onRefresh={() => void refreshPermissions()}
        permissionsComplete={permissionSetupComplete}
        primaryLanguage={languageDraft}
      />
    );
  }

  if (!membershipAccessAllowed) {
    return (
      <MembershipGate
        error={membershipError}
        isActivating={isActivatingMembership}
        isChecking={isCheckingMembership}
        isSigningOut={isSigningOut}
        onActivate={(code) => void activateMembership(code)}
        onRefresh={() => void refreshMembership()}
        onSignOut={onSignOut}
        status={membershipStatus}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <div>
            <strong>TroCode</strong>
            <span>Desktop agent</span>
          </div>
        </div>

        <button
          className="new-task-button"
          disabled={isSubmitting}
          onClick={() => {
            setActiveView('agent');
            void resetTask();
          }}
          type="button"
        >
          <span aria-hidden="true">＋</span>
          New task
        </button>

        <nav aria-label="Workspace">
          <span className="nav-label">Workspace</span>
          <button
            aria-current={activeView === 'agent' ? 'page' : undefined}
            className={`nav-item ${
              activeView === 'agent' ? 'nav-item--active' : ''
            }`}
            onClick={() => setActiveView('agent')}
            type="button"
          >
            <NavigationIcon name="agent" />
            Agent
          </button>
          <button
            aria-current={activeView === 'history' ? 'page' : undefined}
            className={`nav-item ${
              activeView === 'history' ? 'nav-item--active' : ''
            }`}
            onClick={() => setActiveView('history')}
            type="button"
          >
            <NavigationIcon name="history" />
            History
            <span className="nav-count">{historyTaskCount}</span>
          </button>
          <button
            aria-current={activeView === 'insights' ? 'page' : undefined}
            className={`nav-item ${
              activeView === 'insights' ? 'nav-item--active' : ''
            }`}
            onClick={() => setActiveView('insights')}
            type="button"
          >
            <NavigationIcon name="insights" />
            Insights
          </button>
          <button
            aria-current={activeView === 'settings' ? 'page' : undefined}
            className={`nav-item ${
              activeView === 'settings' ? 'nav-item--active' : ''
            }`}
            onClick={() => setActiveView('settings')}
            type="button"
          >
            <NavigationIcon name="settings" />
            Settings
          </button>
        </nav>

        {hasLiveTask && (
          <nav aria-label="Observe">
            <span className="nav-label">Observe</span>
            <button
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
              type="button"
            >
              <NavigationIcon name="activity" />
              Live activity
              <span className="nav-count">{events.length}</span>
            </button>
          </nav>
        )}

        <div className="sidebar-footer">
          <span className="safety-indicator" aria-hidden="true" />
          <div>
            <strong>Bounded by default</strong>
            <span>Approval gates enabled</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <span className="topbar-kicker">
              {activeView === 'agent'
                ? 'General-purpose agent'
                : activeView === 'history'
                  ? 'Session task record'
                : activeView === 'insights'
                  ? 'Private on-device summary'
                  : 'Personal preferences'}
            </span>
            <strong>
              {activeView === 'agent'
                ? taskPhase
                : activeView === 'history'
                  ? `${historyTaskCount} finished ${historyTaskCount === 1 ? 'task' : 'tasks'}`
                : activeView === 'insights'
                  ? 'Insights overview'
                  : 'Voice and language'}
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
                {isStoppingTask ? 'Stopping…' : 'Stop task'} <kbd>Esc</kbd>
              </button>
            )}
            <span className="prototype-pill">Foundation · v0.1</span>
            <span className="account-chip" title={currentUser.email}>
              <span className="account-avatar" aria-hidden="true">
                {currentUser.name.slice(0, 1).toUpperCase()}
              </span>
              <span>{currentUser.name}</span>
            </span>
            <button
              className="sign-out-button"
              disabled={isSigningOut}
              onClick={onSignOut}
              type="button"
            >
              {isSigningOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </header>

        {activeView === 'history' ? (
          <HistoryPage
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
            events={sessionEvents}
            persistence={taskPersistence}
            tasks={sessionTaskSnapshots}
          />
        ) : activeView === 'settings' ? (
          <SettingsPage
            error={settingsError}
            hasChanges={appPreferences?.primaryLanguage !== languageDraft}
            isSaving={isSavingPreferences}
            onLanguageChange={(language) => {
              setLanguageDraft(language);
              setSettingsError(null);
              setSettingsSaveMessage(null);
            }}
            onSave={() => void saveSettings()}
            primaryLanguage={languageDraft}
            saveMessage={settingsSaveMessage}
          />
        ) : (
        <div className="content-grid" id="task">
          <section className="task-column">
            <div className={`hero-copy hero-copy--${hero.state}`}>
              <p className="eyebrow">{hero.eyebrow}</p>
              <h1>{hero.heading}</h1>
              <p>{hero.description}</p>
            </div>

            <form
              className={`task-composer ${hasLiveTask || pendingInteraction ? 'task-composer--compact' : ''}`}
              onSubmit={(event) => {
                event.preventDefault();
                void sendInput();
              }}
            >
              <label htmlFor="task-request">
                {pendingClarification
                  ? 'Answer TroCode to continue this task'
                  : isSteering
                    ? 'Steer the active task'
                    : 'Describe the outcome'}
              </label>
              <div
                aria-live="polite"
                className={`voice-status voice-status--${voiceStatus}`}
              >
                <span className="voice-indicator" aria-hidden="true" />
                <span>{voiceStatusMessage(voiceStatus, voicePlatform)}</span>
                <VoiceShortcut platform={voicePlatform} />
              </div>
              <textarea
                id="task-request"
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  pendingClarification
                    ? 'Type or hold the voice shortcut to answer…'
                    : isSteering
                      ? 'Pause, stop, or change the next step…'
                      : 'Open YouTube for me, research a topic, fix code, or guide me through an app…'
                }
                rows={hasLiveTask || pendingInteraction ? 2 : 4}
                value={input}
              />
              <div className="composer-footer">
                <span>
                  {pendingClarification
                    ? 'This answer stays attached to the current task.'
                    : isSteering
                      ? 'Steering is reviewed at the next safe boundary.'
                      : 'Nothing executes until scope and approvals are checked.'}
                </span>
                <button className="primary-button" disabled={!canSubmit} type="submit">
                  {isSubmitting
                    ? 'Sending…'
                    : pendingClarification
                      ? 'Send answer'
                      : isSteering
                        ? 'Send steering'
                        : 'Compile goal'}
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </form>

            {!snapshot && (
              <div className="examples" aria-label="Example tasks">
                {EXAMPLE_TASKS.map((example) => (
                  <button
                    key={example}
                    onClick={() => setInput(example)}
                    type="button"
                  >
                    {example}
                  </button>
                ))}
              </div>
            )}

            {hasLiveTask && snapshot && (
              <LiveTaskRail
                autoStartFailed={autoStartFailedTaskId === snapshot.taskId}
                canStart={executionReady}
                goal={snapshot.goal}
                isStarting={isSubmitting}
                lastEvent={snapshot.lastEvent}
                onRetry={() => void startTask(snapshot.taskId)}
                phase={snapshot.phase}
                progress={snapshot.progress}
                request={snapshot.request}
              />
            )}

            {error && (
              <div className="error-banner" role="alert">
                <strong>Something needs attention</strong>
                <span>{error}</span>
              </div>
            )}

            {pendingInteraction && (
              <PendingInteractionCard
                interaction={pendingInteraction}
                isSending={isSubmitting}
                onAnswerChoice={(answer) => void sendInput(answer)}
                onApproval={(decision) => void decideApproval(decision)}
              />
            )}

            {hasLiveTask && snapshot && <Conversation snapshot={snapshot} />}
            {isTerminalTask && snapshot && (
              <TerminalOutcome
                onViewHistory={() => setActiveView('history')}
                snapshot={snapshot}
              />
            )}
          </section>

          <aside className="context-column">
            <VoiceConnection
              inputStatus={voiceStatus}
              primaryLanguage={
                appPreferences?.primaryLanguage ?? languageDraft
              }
              status={voiceProviderStatus}
            />

            {hasLiveTask && (
              <section className="activity-card" id="activity" aria-labelledby="activity-heading">
                <div className="section-heading-row">
                  <div>
                    <p className="eyebrow">Live lifecycle</p>
                    <h2 id="activity-heading">Task activity</h2>
                  </div>
                  <span className="event-count">{events.length}</span>
                </div>
                <ActivityList events={events} />
              </section>
            )}
          </aside>
        </div>
        )}
      </main>
    </div>
  );
}
