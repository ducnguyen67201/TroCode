import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  AuthUser,
  CuaStatus,
  GoalSpec,
  PendingInteraction,
  TaskEvent,
  TaskSnapshot,
  VoiceStatus,
} from '../shared/contracts';

import { getCompanionState } from './companion-state';
import {
  createPermissionChecklist,
  inspectMicrophonePermission,
  isPermissionSetupComplete,
  shouldConnectAfterPermissionRefresh,
  type PermissionState,
} from './permission-onboarding';
import { PermissionOnboarding } from './PermissionOnboarding';
import {
  pushToTalkShortcutName,
  type PushToTalkPlatform,
} from './push-to-talk';
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
      return 'Listening… Release either key to send.';
    case 'processing':
      return 'Finishing transcript…';
    case 'requesting_permission':
      return 'Waiting for microphone access…';
    case 'unavailable':
      return 'Voice recognition is unavailable. Type your request instead.';
    case 'idle':
      return `Hold ${pushToTalkShortcutName(platform)} to talk.`;
  }
}

function VoiceConnection({ status }: { status: VoiceStatus }) {
  const connected = status.state === 'ready';

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
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>
      <p>{status.summary}</p>
      <p className="metadata">Model {status.model}</p>
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

function GoalPreview({
  canStart,
  goal,
  isStarting,
  onStart,
  phase,
}: {
  canStart: boolean;
  goal: GoalSpec;
  isStarting: boolean;
  onStart: () => void;
  phase: TaskSnapshot['phase'];
}) {
  return (
    <section className="goal-card" aria-labelledby="goal-heading">
      <div className="goal-title-row">
        <div>
          <p className="eyebrow">Compiled goal</p>
          <h2 id="goal-heading">{goal.objective}</h2>
        </div>
        <span className="mode-badge">{goal.interactionMode}</span>
      </div>

      <div className="goal-grid">
        <div>
          <span className="field-label">Domain</span>
          <strong>{goal.domain}</strong>
        </div>
        <div>
          <span className="field-label">Step budget</span>
          <strong>{goal.limits.maxSteps} actions</strong>
        </div>
      </div>

      <div className="goal-section">
        <span className="field-label">Capabilities</span>
        <div className="tag-list">
          {goal.capabilities.map((capability) => (
            <span className="tag" key={capability}>
              {formatLabel(capability)}
            </span>
          ))}
        </div>
      </div>

      <div className="goal-section">
        <span className="field-label">Success</span>
        <p>{goal.successCriteria[0]?.description}</p>
      </div>

      <div className="guardrail">
        <span aria-hidden="true">◆</span>
        <p>
          Sensitive actions require approval. The goal cannot expand its own
          capability or resource scope.
        </p>
      </div>

      {phase === 'ready' && (
        <div className="goal-start">
          <p>
            {canStart
              ? 'OpenAI and CUA are ready. Starting will begin the observe → act → verify loop.'
              : 'Connect OpenAI Realtime and the CUA Driver before starting.'}
          </p>
          <button
            className="primary-button"
            disabled={!canStart || isStarting}
            onClick={onStart}
            type="button"
          >
            {isStarting ? 'Starting…' : 'Start task'}
          </button>
        </div>
      )}
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
  const [input, setInput] = useState('');
  const [snapshot, setSnapshot] = useState<TaskSnapshot | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [computerStatus, setComputerStatus] = useState<CuaStatus>(
    EMPTY_COMPUTER_STATUS,
  );
  const [voiceProviderStatus, setVoiceProviderStatus] =
    useState<VoiceStatus>(EMPTY_VOICE_STATUS);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingPermissions, setIsCheckingPermissions] = useState(true);
  const [isRequestingPermissions, setIsRequestingPermissions] =
    useState(false);
  const [computerStatusLoaded, setComputerStatusLoaded] = useState(false);
  const [microphonePermission, setMicrophonePermission] =
    useState<PermissionState>('checking');
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeTaskIdRef = useRef<string | null>(null);
  const isSendingRef = useRef(false);
  const permissionRefreshIdRef = useRef(0);
  const spokenInteractionIdRef = useRef<string | null>(null);

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
      setSnapshot(update.snapshot);
      setEvents((currentEvents) =>
        currentEvents.some((event) => event.eventId === update.event.eventId)
          ? currentEvents
          : [...currentEvents, update.event],
      );
    });

    void window.tro
      .getVoiceStatus()
      .then((status) => {
        setVoiceProviderStatus(status);
      })
      .catch((statusError: unknown) => {
        setError(
          statusError instanceof Error
            ? statusError.message
            : 'Could not inspect the OpenAI voice connection.',
        );
      });

    return () => {
      unsubscribe();
    };
  }, []);

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

  const sendInput = useCallback(
    async (requestText = input) => {
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
      setError(null);
      setIsSubmitting(true);

      try {
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
            await window.tro.cancelTask(snapshot.taskId);
          }
          activeTaskIdRef.current = null;
          setEvents([]);
          setSnapshot(null);
          nextSnapshot = await window.tro.submitTask({
            text: normalizedRequest,
          });
        }

        activeTaskIdRef.current = nextSnapshot.taskId;
        setSnapshot(nextSnapshot);
        setInput('');
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : 'The task could not accept that input.',
        );
      } finally {
        isSendingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [input, isSteering, isSubmitting, pendingClarification, snapshot],
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
      setError(null);
      setIsSubmitting(true);

      try {
        setSnapshot(
          await window.tro.decideApproval({
            taskId: snapshot.taskId,
            interactionId: approval.id,
            kind: 'approval',
            decision,
            actionDigest: approval.actionDigest,
          }),
        );
      } catch (approvalError) {
        setError(
          approvalError instanceof Error
            ? approvalError.message
            : 'The approval decision could not be recorded.',
        );
      } finally {
        isSendingRef.current = false;
        setIsSubmitting(false);
      }
    },
    [isSubmitting, snapshot],
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
        await window.tro.cancelTask(activeSnapshot.taskId);
      }

      activeTaskIdRef.current = null;
      setInput('');
      setSnapshot(null);
      setEvents([]);
      setError(null);
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : 'The current task could not be cancelled.',
      );
    } finally {
      isSendingRef.current = false;
      setIsSubmitting(false);
    }
  }, [snapshot]);

  const { platform: voicePlatform, status: voiceStatus } = usePushToTalk({
    disabled:
      !permissionSetupComplete ||
      isSubmitting ||
      pendingInteraction?.kind === 'approval',
    enabled:
      permissionSetupComplete && voiceProviderStatus.state === 'ready',
    onError: setError,
    onTranscriptChange: setInput,
    onTranscriptSubmit: (transcript) => void sendInput(transcript),
  });
  const companionState = getCompanionState({
    hasError:
      error !== null ||
      snapshot?.phase === 'failed' ||
      computerStatus.state === 'error' ||
      voiceProviderStatus.state === 'error',
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
        setComputerStatus(await window.tro.connectComputer());
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
  }, []);

  const startTask = useCallback(async () => {
    if (
      !snapshot ||
      snapshot.phase !== 'ready' ||
      isSendingRef.current
    ) {
      return;
    }

    isSendingRef.current = true;
    setError(null);
    setIsSubmitting(true);
    try {
      setSnapshot(await window.tro.startTask(snapshot.taskId));
    } catch (startError) {
      setError(
        startError instanceof Error
          ? startError.message
          : 'The task could not start.',
      );
    } finally {
      isSendingRef.current = false;
      setIsSubmitting(false);
    }
  }, [snapshot]);

  if (!permissionSetupComplete) {
    return (
      <PermissionOnboarding
        checklist={permissionChecklist}
        computerStatus={computerStatus}
        error={permissionError}
        isChecking={isCheckingPermissions}
        isRequesting={isRequestingPermissions}
        onEnable={() => void enablePermissions()}
        onRefresh={() => void refreshPermissions()}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            T
          </div>
          <div>
            <strong>TroCode</strong>
            <span>Desktop agent</span>
          </div>
        </div>

        <button
          className="new-task-button"
          disabled={isSubmitting}
          onClick={() => void resetTask()}
          type="button"
        >
          <span aria-hidden="true">＋</span>
          New task
        </button>

        <nav aria-label="Workspace">
          <span className="nav-label">Workspace</span>
          <a aria-current="page" className="nav-item nav-item--active" href="#task">
            <span aria-hidden="true">◇</span>
            Agent
          </a>
          <a className="nav-item" href="#activity">
            <span aria-hidden="true">↗</span>
            Activity
          </a>
        </nav>

        <div className="sidebar-footer">
          <span className="safety-indicator" aria-hidden="true" />
          <div>
            <strong>Bounded by default</strong>
            <span>Approval gates enabled</span>
          </div>
        </div>
      </aside>

      <main className="workspace" id="task">
        <header className="topbar">
          <div className="topbar-title">
            <span className="topbar-kicker">General-purpose agent</span>
            <strong>{taskPhase}</strong>
          </div>
          <div className="topbar-actions">
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

        <div className="content-grid">
          <section className="task-column">
            <div className="hero-copy">
              <p className="eyebrow">Outcome first</p>
              <h1>What should we accomplish?</h1>
              <p>
                TroCode turns a request into a bounded goal, selects the right
                capabilities, and verifies the result before it stops.
              </p>
            </div>

            <form
              className="task-composer"
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
                rows={4}
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

            {snapshot && <Conversation snapshot={snapshot} />}
            {snapshot?.goal && (
              <GoalPreview
                canStart={
                  computerStatus.state === 'ready' &&
                  computerStatus.available &&
                  voiceProviderStatus.state === 'ready'
                }
                goal={snapshot.goal}
                isStarting={isSubmitting}
                onStart={() => void startTask()}
                phase={snapshot.phase}
              />
            )}
          </section>

          <aside className="context-column">
            <VoiceConnection status={voiceProviderStatus} />

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
          </aside>
        </div>
      </main>
    </div>
  );
}
