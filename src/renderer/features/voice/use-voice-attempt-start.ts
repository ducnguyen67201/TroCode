import type * as React from 'react';
import { useCallback } from 'react';

import type {
  AppLanguage,
  CompanionVoiceActivity,
  TaskSnapshot,
  TeacherClassroomSelection,
} from '../../../shared/contracts';
import {
  captureVoiceDraftSnapshot,
  type VoiceDraftSnapshot,
} from '../../voice-draft';
import type { VoiceTerminalDisposition } from '../../voice-route';
import { voiceTurnRoute } from '../../voice-route';

import type {
  VoiceAttemptDecision,
  VoiceTurnContext,
} from './voice-input-types';

export function useVoiceAttemptStart({
  clearError,
  latestVoiceTranscriptRef,
  setVoiceTranscript,
  setVoiceActivityOverride,
  voiceActivityTimerRef,
  teacherSelectionPendingRef,
  reportError,
  t,
  latestSnapshotRef,
  teacherVoiceBindingsRef,
  teacherSelectionRef,
  voiceDestinationsRef,
  setVoiceDestination,
  taskRequestRef,
  input,
  voiceDraftSnapshotsRef,
  showVoiceTerminalActivity,
  appLanguageDraft,
  preparedGlobalDictationsRef,
}: {
  clearError: () => void;
  latestVoiceTranscriptRef: React.RefObject<string>;
  setVoiceTranscript: React.Dispatch<React.SetStateAction<string>>;
  setVoiceActivityOverride: React.Dispatch<
    React.SetStateAction<CompanionVoiceActivity | null>
  >;
  voiceActivityTimerRef: React.RefObject<NodeJS.Timeout | null>;
  teacherSelectionPendingRef: React.RefObject<boolean>;
  reportError: (message: string) => void;
  t: (
    message: string,
    replacements?: Readonly<Record<string, string | number>>,
  ) => string;
  latestSnapshotRef: React.RefObject<TaskSnapshot | null>;
  teacherVoiceBindingsRef: React.RefObject<
    Map<
      string,
      {
        selectionId: string | null;
        taskId: string | null;
        interactionId: string | null;
      }
    >
  >;
  teacherSelectionRef: React.RefObject<TeacherClassroomSelection | null>;
  voiceDestinationsRef: React.RefObject<
    Map<
      string,
      { kind: 'application' | 'tro_composer' | 'task'; label: string }
    >
  >;
  setVoiceDestination: React.Dispatch<
    React.SetStateAction<CompanionVoiceActivity['destination']>
  >;
  taskRequestRef: React.RefObject<HTMLTextAreaElement | null>;
  input: string;
  voiceDraftSnapshotsRef: React.RefObject<Map<string, VoiceDraftSnapshot>>;
  showVoiceTerminalActivity: (
    activity: CompanionVoiceActivity,
    durationMs: number,
    disposition?: VoiceTerminalDisposition,
  ) => void;
  appLanguageDraft: AppLanguage;
  preparedGlobalDictationsRef: React.RefObject<Set<string>>;
}) {
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
      latestSnapshotRef,
      latestVoiceTranscriptRef,
      preparedGlobalDictationsRef,
      reportError,
      setVoiceActivityOverride,
      setVoiceDestination,
      setVoiceTranscript,
      showVoiceTerminalActivity,
      t,
      taskRequestRef,
      teacherSelectionPendingRef,
      teacherSelectionRef,
      teacherVoiceBindingsRef,
      voiceActivityTimerRef,
      voiceDestinationsRef,
      voiceDraftSnapshotsRef,
    ],
  );

  return { handleVoiceAttemptStart };
}
