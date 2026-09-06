import type * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AgentActivityUpdate,
  TaskEvent,
  TaskHistory,
  TaskSnapshot,
  UsageBudgetSnapshot,
} from '../../../shared/contracts';
import { acceptAgentActivity } from '../../agent-activity-projection';
import { type ActiveView } from '../../app-navigation';

import {
  appendUniqueEvent,
  mergeTaskEvents,
  mergeTaskSnapshots,
} from './task-session-projection';

export function useTaskSession({
  setActiveView,
}: {
  setActiveView: React.Dispatch<React.SetStateAction<ActiveView>>;
}) {
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

  const [usageBudget, setUsageBudget] = useState<UsageBudgetSnapshot | null>(
    null,
  );

  const [autoStartFailedTaskId, setAutoStartFailedTaskId] = useState<
    string | null
  >(null);

  const activeTaskIdRef = useRef<string | null>(null);

  const latestSnapshotRef = useRef<TaskSnapshot | null>(null);

  const taskRequestRef = useRef<HTMLTextAreaElement | null>(null);

  const autoStartAttemptedTaskIdsRef = useRef(new Set<string>());

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

    return () => {
      unsubscribeAgentActivity();
      unsubscribeTaskUpdates();
      unsubscribeTaskComposerFocus();
    };
  }, [recordSnapshot, setActiveView]);

  useEffect(() => {
    void window.tro
      .getUsageBudget()
      .then(setUsageBudget)
      .catch(() => undefined);
  }, []);

  return {
    usageBudget,
    snapshot,
    sessionSnapshots,
    recordSnapshot,
    activeTaskIdRef,
    setEvents,
    setAgentActivities,
    setAgentActivity,
    setStreamingDraft,
    latestSnapshotRef,
    taskRequestRef,
    setAutoStartFailedTaskId,
    autoStartAttemptedTaskIdsRef,
    events,
    sessionEvents,
    taskPersistence,
    agentActivities,
    agentActivity,
    autoStartFailedTaskId,
    streamingDraft,
  };
}
