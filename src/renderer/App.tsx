import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  CuaStatus,
  GoalSpec,
  TaskEvent,
  TaskSnapshot,
} from '../shared/contracts';

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

function formatLabel(value: string): string {
  return value.replaceAll('_', ' ');
}

function voiceStatusMessage(
  status: VoiceInputStatus,
  platform: PushToTalkPlatform,
): string {
  switch (status) {
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

function ComputerStatus({
  isConnecting,
  onConnect,
  status,
}: {
  isConnecting: boolean;
  onConnect: () => void;
  status: CuaStatus;
}) {
  const statusLabel = status.state === 'ready' ? 'Connected' : 'Not connected';

  return (
    <section className="computer-card" aria-labelledby="computer-heading">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Computer use</p>
          <h2 id="computer-heading">CUA Driver</h2>
        </div>
        <span className={`status-dot status-dot--${status.state}`}>
          {statusLabel}
        </span>
      </div>
      <p>{status.summary}</p>
      {status.version && <p className="metadata">Driver {status.version}</p>}
      <button
        className="secondary-button"
        disabled={isConnecting || status.state === 'ready'}
        onClick={onConnect}
        type="button"
      >
        {isConnecting ? 'Connecting…' : 'Connect computer'}
      </button>
    </section>
  );
}

function GoalPreview({ goal }: { goal: GoalSpec }) {
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

export function App() {
  const [input, setInput] = useState('');
  const [snapshot, setSnapshot] = useState<TaskSnapshot | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [computerStatus, setComputerStatus] = useState<CuaStatus>(
    EMPTY_COMPUTER_STATUS,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const unsubscribe = window.tro.onTaskEvent((taskEvent) => {
      setEvents((currentEvents) => [...currentEvents, taskEvent]);
    });

    void window.tro
      .getComputerStatus()
      .then((status) => {
        if (isMounted) setComputerStatus(status);
      })
      .catch((statusError: unknown) => {
        if (isMounted) {
          setError(
            statusError instanceof Error
              ? statusError.message
              : 'Could not inspect the CUA runtime.',
          );
        }
      });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  const canSubmit = input.trim().length >= 2 && !isSubmitting;
  const taskPhase = useMemo(
    () => (snapshot ? formatLabel(snapshot.phase) : 'No active task'),
    [snapshot],
  );

  const submitTask = useCallback(async (requestText = input) => {
    const normalizedRequest = requestText.trim();
    if (normalizedRequest.length < 2 || isSubmitting) return;

    setError(null);
    setEvents([]);
    setIsSubmitting(true);
    setInput(normalizedRequest);

    try {
      const nextSnapshot = await window.tro.submitTask({
        text: normalizedRequest,
      });
      setSnapshot(nextSnapshot);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'The goal could not be compiled.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [input, isSubmitting]);

  const { platform: voicePlatform, status: voiceStatus } = usePushToTalk({
    disabled: isSubmitting,
    onError: setError,
    onTranscriptChange: setInput,
    onTranscriptSubmit: (transcript) => void submitTask(transcript),
  });

  const connectComputer = useCallback(async () => {
    setError(null);
    setIsConnecting(true);

    try {
      setComputerStatus(await window.tro.connectComputer());
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : 'The CUA runtime could not be connected.',
      );
    } finally {
      setIsConnecting(false);
    }
  }, []);

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
          onClick={() => {
            setInput('');
            setSnapshot(null);
            setEvents([]);
            setError(null);
          }}
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
          <a className="nav-item" href="#computer-heading">
            <span aria-hidden="true">▣</span>
            Computer
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
          <div>
            <span className="topbar-kicker">General-purpose agent</span>
            <strong>{taskPhase}</strong>
          </div>
          <span className="prototype-pill">Foundation · v0.1</span>
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
                void submitTask();
              }}
            >
              <label htmlFor="task-request">Describe the outcome</label>
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
                placeholder="Open YouTube for me, research a topic, fix code, or guide me through an app…"
                rows={4}
                value={input}
              />
              <div className="composer-footer">
                <span>Nothing executes until scope and approvals are checked.</span>
                <button className="primary-button" disabled={!canSubmit} type="submit">
                  {isSubmitting ? 'Compiling…' : 'Compile goal'}
                  <span aria-hidden="true">→</span>
                </button>
              </div>
            </form>

            <div className="examples" aria-label="Example tasks">
              {EXAMPLE_TASKS.map((example) => (
                <button key={example} onClick={() => setInput(example)} type="button">
                  {example}
                </button>
              ))}
            </div>

            {error && (
              <div className="error-banner" role="alert">
                <strong>Something needs attention</strong>
                <span>{error}</span>
              </div>
            )}

            {snapshot?.goal && <GoalPreview goal={snapshot.goal} />}
          </section>

          <aside className="context-column">
            <ComputerStatus
              isConnecting={isConnecting}
              onConnect={() => void connectComputer()}
              status={computerStatus}
            />

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
