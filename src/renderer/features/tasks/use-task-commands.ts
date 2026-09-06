import type * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AgentActivityUpdate,
  PendingInteraction,
  SubmitTaskRequest,
  TaskEvent,
  TaskSnapshot,
  WorkspaceSelection,
  TeacherClassroomSelection,
} from '../../../shared/contracts';
import { type ActiveView } from '../../app-navigation';
import {
  isTaskCancellable,
  isTaskTerminal,
  shouldAutoStartTask,
  shouldStopTaskForEscape,
} from '../../task-execution';

export function useTaskCommands({
  input,
  pendingClarification,
  isSteering,
  clearError,
  teacherSelectionPendingRef,
  teacherSelectionRef,
  snapshot,
  teacherTaskBindingsRef,
  recordSnapshot,
  activeTaskIdRef,
  setEvents,
  setAgentActivities,
  setAgentActivity,
  setStreamingDraft,
  executionProfile,
  workspaceSelection,
  setInput,
  reportError,
  latestSnapshotRef,
  setActiveView,
  setAutoStartFailedTaskId,
  selectedTaskRuntimeReady,
  autoStartAttemptedTaskIdsRef,
  settingsOpen,
}: {
  input: string;
  pendingClarification: PendingInteraction | null;
  isSteering: boolean;
  clearError: () => void;
  teacherSelectionPendingRef: React.RefObject<boolean>;
  teacherSelectionRef: React.RefObject<TeacherClassroomSelection | null>;
  snapshot: TaskSnapshot | null;
  teacherTaskBindingsRef: React.RefObject<Map<string, string | null>>;
  recordSnapshot: (nextSnapshot: TaskSnapshot | null) => void;
  activeTaskIdRef: React.RefObject<string | null>;
  setEvents: React.Dispatch<React.SetStateAction<TaskEvent[]>>;
  setAgentActivities: React.Dispatch<
    React.SetStateAction<AgentActivityUpdate[]>
  >;
  setAgentActivity: React.Dispatch<
    React.SetStateAction<AgentActivityUpdate | null>
  >;
  setStreamingDraft: React.Dispatch<React.SetStateAction<string>>;
  executionProfile: 'everyday' | 'workspace';
  workspaceSelection: WorkspaceSelection | null;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  reportError: (message: string) => void;
  latestSnapshotRef: React.RefObject<TaskSnapshot | null>;
  setActiveView: React.Dispatch<React.SetStateAction<ActiveView>>;
  setAutoStartFailedTaskId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedTaskRuntimeReady: boolean;
  autoStartAttemptedTaskIdsRef: React.RefObject<Set<string>>;
  settingsOpen: boolean;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isStoppingTask, setIsStoppingTask] = useState(false);

  const isSendingRef = useRef(false);

  const isStoppingTaskRef = useRef(false);

  const sendInput = useCallback(
    async (
      requestText = input,
      options: {
        screenContext?: 'auto' | 'required' | 'disabled';
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
      activeTaskIdRef,
      clearError,
      executionProfile,
      input,
      isSteering,
      isSubmitting,
      pendingClarification,
      recordSnapshot,
      reportError,
      setAgentActivities,
      setAgentActivity,
      setEvents,
      setInput,
      setStreamingDraft,
      snapshot,
      teacherSelectionPendingRef,
      teacherSelectionRef,
      teacherTaskBindingsRef,
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
    [
      activeTaskIdRef,
      clearError,
      isSubmitting,
      latestSnapshotRef,
      recordSnapshot,
      reportError,
      setActiveView,
      setAgentActivities,
      setAgentActivity,
      setEvents,
      setStreamingDraft,
    ],
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
  }, [
    activeTaskIdRef,
    clearError,
    recordSnapshot,
    reportError,
    setEvents,
    setInput,
    snapshot,
  ]);

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
    [
      clearError,
      latestSnapshotRef,
      recordSnapshot,
      reportError,
      setAutoStartFailedTaskId,
    ],
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
  }, [
    activeTaskIdRef,
    clearError,
    latestSnapshotRef,
    recordSnapshot,
    reportError,
  ]);

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
  }, [
    autoStartAttemptedTaskIdsRef,
    isSubmitting,
    selectedTaskRuntimeReady,
    snapshot,
    startTask,
  ]);

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
  }, [latestSnapshotRef, recordSnapshot, reportError, settingsOpen]);

  return {
    isSubmitting,
    sendInput,
    resetTask,
    isStoppingTask,
    stopTask,
    launchKnowledgeActivity,
    startTask,
  };
}
