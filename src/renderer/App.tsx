import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import type {
  AgentActivityUpdate,
  AutonomyMode,
  AppLanguage,
  AppPreferences,
  AppUpdateStatus,
  AuthUser,
  CuaStatus,
  ExecutionProfile,
  GoalSpec,
  MembershipStatus,
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
} from '../shared/contracts';
import { VOICE_TRANSCRIPTION_MODEL } from '../shared/contracts';

import { acceptAgentActivity } from './agent-activity-projection';
import { appLanguageLabel, translate } from './app-language';
import { navigationTitle, type ActiveView } from './app-navigation';
import { approvalDetails } from './approval-details';
import { AppUpdateButton } from './AppUpdateButton';
import { BrandMark } from './BrandMark';
import { HistoryPage } from './HistoryPage';
import { InsightsPage } from './InsightsPage';
import { KnowledgeHubPage } from './KnowledgeHubPage';
import {
  isPrimaryLanguageSetupComplete,
  primaryLanguageLabel,
} from './language-options';
import { appEntryGate } from './membership';
import { MembershipGate } from './MembershipGate';
import {
  createPermissionChecklist,
  inspectMicrophonePermission,
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
  isTaskCancellable,
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
  model: VOICE_TRANSCRIPTION_MODEL,
  summary: 'Checking OpenAI GPT Transcribe…',
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
  name: 'activity' | 'agent' | 'assigned' | 'history' | 'insights' | 'settings' | 'spaces';
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

  if (name === 'spaces') {
    return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 6.5h7l2 2h9v10H3z" /><path d="M3 10h18" /></svg>;
  }

  if (name === 'assigned') {
    return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 3h12v18H6z" /><path d="m9 12 2 2 4-5M9 7h6" /></svg>;
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
  platform: PushToTalkPlatform,
  appLanguage: AppLanguage,
): string {
  switch (status) {
    case 'listening':
      return translate(
        appLanguage,
        'Listening… Release the voice shortcut to send.',
      );
    case 'processing':
      return translate(appLanguage, 'Finishing transcript…');
    case 'requesting_permission':
      return translate(appLanguage, 'Waiting for microphone access…');
    case 'unavailable':
      return translate(
        appLanguage,
        'Voice recognition is unavailable. Type your request instead.',
      );
    case 'idle': {
      const globalShortcut = globalPushToTalkShortcutName(platform);
      if (globalShortcut) {
        if (platform === 'macos') {
          return translate(
            appLanguage,
            'Voice ready. Hold {shortcut} to talk from any app.',
            { shortcut: globalShortcut },
          );
        }
        return translate(
          appLanguage,
          'Voice ready. Hold {shortcut} to talk, or hold {globalShortcut} globally.',
          {
            globalShortcut,
            shortcut: pushToTalkShortcutName(platform),
          },
        );
      }
      return translate(
        appLanguage,
        'Voice ready. Hold {shortcut} to talk.',
        { shortcut: pushToTalkShortcutName(platform) },
      );
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
  activities,
  activity,
  appLanguage,
  autoStartFailed,
  canStart,
  goal,
  isStarting,
  lastEvent,
  onRetry,
  outcomes,
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
  outcomes: TaskSnapshot['outcomes'];
  phase: TaskSnapshot['phase'];
  progress: TaskSnapshot['progress'];
  request: string;
  streamingDraft: string;
}) {
  const t = (message: string) => translate(appLanguage, message);
  const isAgentProgress = Boolean(progress && 'kind' in progress);
  const completedToolCalls =
    progress && 'kind' in progress ? progress.completed : 0;
  const progressLabel = progress
    ? 'kind' in progress
      ? translate(
          appLanguage,
          progress.completed === 1 ? '{count} tool call' : '{count} tool calls',
          { count: progress.completed },
        )
      : `${progress.currentStep} / ${progress.maxSteps}`
    : t('Not started');
  const progressPercentage =
    progress && !('kind' in progress)
      ? Math.min(
          100,
          Math.round((progress.currentStep / progress.maxSteps) * 100),
        )
    : 0;
  const taskTitle = goal
    ? goal.schemaVersion !== 2
      ? goal.originalRequest
      : goal.objective
    : request;
  const showProgress = !isAgentProgress || completedToolCalls > 0;
  const activityText =
    activity?.kind === 'text_delta'
      ? streamingDraft.slice(-500)
      : activity?.summary ?? lastEvent?.summary;
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
              {!isAgentProgress && (
                <i aria-hidden="true">
                  <span style={{ width: `${progressPercentage}%` }} />
                </i>
              )}
            </div>
          )}
        </div>

        <div className="live-task-rail__summary">
          <span>
            {goal?.schemaVersion === 2
              ? formatLabel(goal.behavior, appLanguage)
              : goal?.schemaVersion === 5 ||
                  goal?.schemaVersion === 6 ||
                  goal?.schemaVersion === 7 ||
                  goal?.schemaVersion === 8
                ? goal.executionProfile === 'workspace'
                  ? t('Workspace agent')
                  : t('Everyday agent')
                : goal
                  ? t('Agent')
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

        {outcomes && (
          <section
            aria-label={t('Outcome verification')}
            aria-live="polite"
            className="outcome-checklist"
          >
            <strong>
              {phase === 'completed'
                ? t('Completed and verified')
                : t('Verifying outcomes')}
            </strong>
            <ul>
              {outcomes.criterionResults.map((result) => {
                const description =
                  goal && (goal.schemaVersion === 7 || goal.schemaVersion === 8)
                    ? goal.outcomeContract.criteria.find(
                        (criterion) => criterion.id === result.criterionId,
                      )?.description
                    : undefined;
                return (
                  <li key={result.criterionId} data-status={result.status}>
                    <span aria-hidden="true">
                      {result.status === 'passed'
                        ? '✓'
                        : result.status === 'failed'
                          ? '×'
                          : result.status === 'unknown'
                            ? '?'
                            : '…'}
                    </span>
                    <span>{formatLabel(result.status, appLanguage)}</span>
                    <span>{description ?? result.criterionId.replaceAll('-', ' ')}</span>
                  </li>
                );
              })}
            </ul>
          </section>
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
              {(goal.schemaVersion === 6 || goal.schemaVersion === 7 || goal.schemaVersion === 8) && goal.activity && (
                <div className="activity-context-chip">
                  <span>{goal.activity.space.name}</span>
                  <strong>{goal.activity.activity.title}</strong>
                </div>
              )}
              <div>
                <span className="field-label">{t('Execution')}</span>
                <p>
                  {t(
                    goal.schemaVersion === 8 && goal.autonomyMode === 'balanced'
                      ? 'Your instruction authorizes requested reversible work. Tro still asks before communications, deletion, publishing or deployment, money, credentials or permissions, installs, sensitive transfers, and scope expansion.'
                      : goal.schemaVersion === 8
                        ? 'Strict mode asks before every mutation or side effect.'
                        : 'Tro chooses from the tools currently available and asks before consequential actions.',
                  )}
                </p>
              </div>
              <div>
                <span className="field-label">{t('Success looks like')}</span>
                <p>
                  {goal.schemaVersion === 7 || goal.schemaVersion === 8
                    ? goal.outcomeContract.criteria
                        .filter((criterion) => criterion.required)
                        .map((criterion) => criterion.description)
                        .join(' · ')
                    : goal.schemaVersion !== 2
                      ? t(
                          'A useful assistant answer or an evidence-backed tool result.',
                        )
                    : goal.successCriteria[0]?.description}
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
                  ? t(
                      'Tro could not start automatically. You can try again.',
                    )
                  : isStarting
                    ? t(
                        'Starting automatically… Press Escape at any time to stop.',
                      )
                    : t(
                        'Ready. Starting automatically… Press Escape at any time to stop.',
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
        <p className="eyebrow">
          {formatLabel(snapshot.phase, appLanguage)}
        </p>
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
          <span className={`activity-marker activity-marker--${event.status}`} />
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
    <section className="conversation-card" aria-labelledby="conversation-heading">
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
  onApproval,
}: {
  appLanguage: AppLanguage;
  interaction: PendingInteraction;
  isSending: boolean;
  onAnswerChoice: (answer: string, choiceId: string) => void;
  onApproval: (decision: 'approve' | 'deny') => void;
}) {
  const t = (message: string) => translate(appLanguage, message);
  if (interaction.kind === 'clarification') {
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

  return (
    <section
      aria-live="assertive"
      aria-labelledby="interaction-heading"
      className="interaction-card interaction-card--approval"
    >
      <p className="eyebrow">{t('Exact approval required')}</p>
      <h2 id="interaction-heading">{interaction.prompt}</h2>
      <p>{interaction.consequence}</p>
      <dl className="approval-details">
        <div>
          <dt>{t('Action')}</dt>
          <dd>{formatLabel(interaction.action.action, appLanguage)}</dd>
        </div>
        <div>
          <dt>{t('Description')}</dt>
          <dd>{interaction.action.description}</dd>
        </div>
        {interaction.action.target && (
          <div>
            <dt>{t('Target')}</dt>
            <dd>{interaction.action.target}</dd>
          </div>
        )}
        {approvalDetails(interaction.action.parameters).map((detail) => (
          <div key={detail.key}>
            <dt>{t(detail.label)}</dt>
            <dd className={detail.payload ? 'approval-details__payload' : undefined}>
              {detail.value}
            </dd>
          </div>
        ))}
      </dl>
      <p className="approval-note">
        {t(
          'Approve here or in the cursor card. Spoken or typed “yes” cannot approve an exact action.',
        )}
      </p>
      <div className="approval-actions">
        <button
          className="secondary-button"
          disabled={isSending}
          onClick={() => onApproval('deny')}
          type="button"
        >
          {t('Deny')}
        </button>
        <button
          className="primary-button"
          disabled={isSending}
          onClick={() => onApproval('approve')}
          type="button"
        >
          {t('Approve exact action')}
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
  const [knowledgeSpacesEnabled, setKnowledgeSpacesEnabled] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [input, setInput] = useState('');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [snapshot, setSnapshot] = useState<TaskSnapshot | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [agentActivity, setAgentActivity] =
    useState<AgentActivityUpdate | null>(null);
  const [agentActivities, setAgentActivities] = useState<
    AgentActivityUpdate[]
  >([]);
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
  const [appPreferences, setAppPreferences] =
    useState<AppPreferences | null>(null);
  const [appUpdateStatus, setAppUpdateStatus] =
    useState<AppUpdateStatus | null>(null);
  const [appUpdateError, setAppUpdateError] = useState<string | null>(null);
  const [usageBudget, setUsageBudget] =
    useState<UsageBudgetSnapshot | null>(null);
  const [isUpdatingApp, setIsUpdatingApp] = useState(false);
  const [languageDraft, setLanguageDraft] =
    useState<PrimaryLanguage>('en');
  const [appLanguageDraft, setAppLanguageDraft] =
    useState<AppLanguage>('en');
  const [autonomyModeDraft, setAutonomyModeDraft] =
    useState<AutonomyMode>('balanced');
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
  const taskRequestRef = useRef<HTMLTextAreaElement | null>(null);
  const autoStartAttemptedTaskIdsRef = useRef(new Set<string>());
  const isSendingRef = useRef(false);
  const isStoppingTaskRef = useRef(false);
  const permissionRefreshIdRef = useRef(0);
  const membershipRefreshIdRef = useRef(0);
  const t = useCallback(
    (
      message: string,
      replacements?: Readonly<Record<string, string | number>>,
    ) => translate(appLanguageDraft, message, replacements),
    [appLanguageDraft],
  );
  const displayedPlan = accountPlan(
    usageBudget?.plan,
    membershipStatus?.plan,
  );
  const usagePercent = remainingUsagePercent(usageBudget);
  const languageSetupComplete =
    isPrimaryLanguageSetupComplete(appPreferences, preferencesLoaded);
  const entryGate = appEntryGate({
    languageSetupComplete,
    membershipStatus,
  });
  const membershipAccessAllowed = entryGate !== 'membership';

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
      if (!acceptAgentActivity(activity, activeTaskId, activitySequences)) return;
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
      .getKnowledgeCapabilities()
      .then((capabilities) => {
        setKnowledgeSpacesEnabled(capabilities.knowledgeSpaces.enabled);
      })
      .catch(() => setKnowledgeSpacesEnabled(false));

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
        setAppLanguageDraft(preferences.appLanguage);
        setAutonomyModeDraft(preferences.autonomyMode);
        setMuteSystemAudioWhileSpeakingDraft(
          preferences.muteSystemAudioWhileSpeaking,
        );
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
  const pendingClarification =
    pendingInteraction?.kind === 'clarification' ? pendingInteraction : null;
  const isSteering = snapshot ? STEERABLE_PHASES.has(snapshot.phase) : false;

  const canSubmit =
    input.trim().length >= (pendingClarification || isSteering ? 1 : 2) &&
    !isSubmitting &&
    (pendingClarification ||
      isSteering ||
      executionProfile === 'everyday' ||
      Boolean(workspaceRuntime?.available && workspaceSelection)) &&
    pendingInteraction?.kind !== 'approval';
  const taskPhase = useMemo(
    () =>
      snapshot
        ? formatLabel(snapshot.phase, appLanguageDraft)
        : t('No active task'),
    [appLanguageDraft, snapshot, t],
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
        eyebrow: t('Your move'),
        heading: t('A decision is waiting.'),
        description: t(
          'Review the request below. Tro will hold position until you answer or approve the exact action.',
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
              'Describe the finish line. Tro will define a bounded scope, choose its tools, and verify the result.',
            ),
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
  const agentReady = voiceProviderStatus.state === 'ready';
  const selectedTaskRuntimeReady = agentReady;
  const voiceReady =
    agentReady && microphonePermission !== 'unavailable';
  const desktopReady =
    computerStatus.state === 'ready' &&
    computerStatus.available;

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
          : 'Tro could not activate this membership code.',
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
        appLanguage: appLanguageDraft,
        autonomyMode: autonomyModeDraft,
        muteSystemAudioWhileSpeaking: muteSystemAudioWhileSpeakingDraft,
        primaryLanguage: languageDraft,
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
    autonomyModeDraft,
    languageDraft,
    muteSystemAudioWhileSpeakingDraft,
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
          // Analytics belongs off the task hot path. Task submission performs
          // its own auth and membership checks at the trusted IPC boundary.
          void window.tro
            .recordVoiceTranscript({ text: normalizedRequest })
            .catch(() => undefined);
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
          setAgentActivities([]);
          setAgentActivity(null);
          setStreamingDraft('');
          recordSnapshot(null);
          nextSnapshot = await window.tro.submitTask({
            activityAttemptId: null,
            executionProfile,
            text: normalizedRequest,
            workspaceSelectionId:
              executionProfile === 'workspace'
                ? workspaceSelection?.selectionId ?? null
                : null,
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
        if (activeSnapshot && !TERMINAL_PHASES.has(activeSnapshot.phase)) {
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

  const handleVoiceAttemptStart = useCallback(() => {
    clearError();
    setVoiceTranscript('');
  }, [clearError]);
  const handleVoiceTranscriptChange = useCallback((transcript: string) => {
    setInput(transcript);
    setVoiceTranscript(transcript);
  }, []);

  const {
    isHolding: isVoiceShortcutHeld,
    platform: voicePlatform,
    status: voiceStatus,
  } = usePushToTalk({
    disabled:
      !voiceReady ||
      !membershipAccessAllowed ||
      isSubmitting ||
      pendingInteraction?.kind === 'approval',
    enabled:
      voiceReady &&
      languageSetupComplete &&
      membershipAccessAllowed,
    onAttemptStart: handleVoiceAttemptStart,
    onError: reportError,
    onTranscriptChange: handleVoiceTranscriptChange,
    onTranscriptSubmit: (transcript) => void sendInput(transcript, 'voice'),
  });
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
      voiceStatus === 'processing';
    void window.tro.setCompanionVoiceActivity(
      voiceActive
        ? {
            appLanguage: appLanguageDraft,
            phase: voiceStatus,
            transcript: voiceTranscript,
          }
        : null,
    );
  }, [appLanguageDraft, voiceStatus, voiceTranscript]);

  useEffect(
    () => () => {
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
          autonomyMode: autonomyModeDraft,
          muteSystemAudioWhileSpeaking: muteSystemAudioWhileSpeakingDraft,
          primaryLanguage: languageDraft,
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
    autonomyModeDraft,
    languageDraft,
    muteSystemAudioWhileSpeakingDraft,
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
      if (!shouldStopTaskForEscape(event, latestSnapshotRef.current)) return;

      event.preventDefault();
      event.stopPropagation();
      void stopTask();
    };

    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [stopTask]);

  if (entryGate === 'membership') {
    return (
      <MembershipGate
        appLanguage={appLanguageDraft}
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
        onOpenScreenRecordingSettings={() =>
          void openScreenRecordingSettings()
        }
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
            <strong>{planTitle(displayedPlan)}</strong>
            <span>
              {usagePercent === null
                ? t('Desktop agent')
                : t('Weekly usage · {percent}% left', {
                    percent: usagePercent,
                  })}
            </span>
          </div>
        </div>

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
          {knowledgeSpacesEnabled && (
            <>
              <button
                aria-label={t('Knowledge Spaces')}
                aria-current={activeView === 'spaces' ? 'page' : undefined}
                className={`nav-item ${
                  activeView === 'spaces' ? 'nav-item--active' : ''
                }`}
                onClick={() => setActiveView('spaces')}
                title={
                  isSidebarCollapsed ? t('Knowledge Spaces') : undefined
                }
                type="button"
              >
                <NavigationIcon name="spaces" />
                <span className="sidebar-item-label">
                  {t('Knowledge Spaces')}
                </span>
              </button>
              <button
                aria-label={t('Assigned Activities')}
                aria-current={activeView === 'assigned' ? 'page' : undefined}
                className={`nav-item ${
                  activeView === 'assigned' ? 'nav-item--active' : ''
                }`}
                onClick={() => setActiveView('assigned')}
                title={
                  isSidebarCollapsed ? t('Assigned Activities') : undefined
                }
                type="button"
              >
                <NavigationIcon name="assigned" />
                <span className="sidebar-item-label">
                  {t('Assigned Activities')}
                </span>
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
            <button
              aria-label={t('Settings')}
              aria-current={activeView === 'settings' ? 'page' : undefined}
              className={`nav-item ${
                activeView === 'settings' ? 'nav-item--active' : ''
              }`}
              onClick={() => setActiveView('settings')}
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
              <strong>{t('Bounded by default')}</strong>
              <span>{t('Approval gates enabled')}</span>
            </div>
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
            <span className="account-chip" title={currentUser.email}>
              <span className="account-avatar" aria-hidden="true">
                {currentUser.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="account-name">{currentUser.name}</span>
            </span>
            <AppUpdateButton
              appLanguage={appLanguageDraft}
              isUpdating={isUpdatingApp}
              onRestartAndInstall={() => void restartAndInstallAppUpdate()}
              status={appUpdateStatus}
            />
            <button
              className="sign-out-button"
              disabled={isSigningOut}
              onClick={onSignOut}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M10 5H6.5A2.5 2.5 0 0 0 4 7.5v9A2.5 2.5 0 0 0 6.5 19H10" />
                <path d="M14.5 8.5 18 12l-3.5 3.5M18 12H9" />
              </svg>
              <span>{isSigningOut ? t('Signing out…') : t('Sign out')}</span>
            </button>
          </div>
        </header>

        {activeView === 'spaces' || activeView === 'assigned' ? (
          <KnowledgeHubPage
            appLanguage={appLanguageDraft}
            mode={activeView}
            onLaunch={launchKnowledgeActivity}
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
        ) : activeView === 'settings' ? (
          <SettingsPage
            appLanguage={appLanguageDraft}
            autonomyMode={autonomyModeDraft}
            appUpdateError={appUpdateError}
            appUpdateStatus={appUpdateStatus}
            error={settingsError}
            hasChanges={
              appPreferences?.appLanguage !== appLanguageDraft ||
              appPreferences?.autonomyMode !== autonomyModeDraft ||
              appPreferences?.muteSystemAudioWhileSpeaking !==
                muteSystemAudioWhileSpeakingDraft ||
              appPreferences?.primaryLanguage !== languageDraft
            }
            isSaving={isSavingPreferences}
            isUpdatingApp={isUpdatingApp}
            onAppLanguageChange={(language) => {
              setAppLanguageDraft(language);
              setSettingsError(null);
              setSettingsSaveMessage(null);
            }}
            onAutonomyModeChange={(mode) => {
              setAutonomyModeDraft(mode);
              setSettingsError(null);
              setSettingsSaveMessage(null);
            }}
            onCheckForUpdates={() => void checkForAppUpdates()}
            onLanguageChange={(language) => {
              setLanguageDraft(language);
              setSettingsError(null);
              setSettingsSaveMessage(null);
            }}
            onMuteSystemAudioWhileSpeakingChange={(enabled) => {
              setMuteSystemAudioWhileSpeakingDraft(enabled);
              setSettingsError(null);
              setSettingsSaveMessage(null);
            }}
            onRestartAndInstall={() => void restartAndInstallAppUpdate()}
            onSave={() => void saveSettings()}
            primaryLanguage={languageDraft}
            saveMessage={settingsSaveMessage}
            muteSystemAudioWhileSpeaking={muteSystemAudioWhileSpeakingDraft}
            systemAudioMuteSupported={voicePlatform === 'macos'}
          />
        ) : (
          <div className="content-grid" id="task">
            <section className="task-column">
              <section className={`agent-stage agent-stage--${hero.state}`}>
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
                aria-live="polite"
                className={`voice-status voice-status--${voiceStatus}`}
              >
                <span className="voice-indicator" aria-hidden="true" />
                <span>
                  {voiceStatusMessage(
                    voiceStatus,
                    voicePlatform,
                    appLanguageDraft,
                  )}
                </span>
                <VoiceShortcut platform={voicePlatform} />
              </div>
              <textarea
                id="task-request"
                ref={taskRequestRef}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  pendingClarification
                    ? t('Type or hold the voice shortcut to answer…')
                    : isSteering
                      ? t('Pause, stop, or change the next step…')
                      : t(
                          'Open YouTube for me, research a topic, fix code, or guide me through an app…',
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
                    <span>{t('Apps, research, and routine desktop work')}</span>
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
                          autonomyModeDraft === 'balanced'
                            ? 'Your instruction authorizes requested reversible work; Tro still asks for high-impact or expanded-scope actions.'
                            : 'Strict mode asks before every mutation or side effect.',
                        )}
                </span>
                <button className="primary-button" disabled={!canSubmit} type="submit">
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
                outcomes={snapshot.outcomes}
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
                onAnswerChoice={(answer, choiceId) => {
                  if (choiceId !== 'connect_computer') {
                    void sendInput(answer);
                    return;
                  }
                  void openScreenRecordingSettings().then(() =>
                    sendInput(answer),
                  );
                }}
                onApproval={(decision) => void decideApproval(decision)}
              />
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
                <span>{t('Bounded by default')}</span>
                <span>{t('Approval gates enabled')}</span>
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
              <section className="activity-card" id="activity" aria-labelledby="activity-heading">
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
      </main>
    </div>
  );
}
