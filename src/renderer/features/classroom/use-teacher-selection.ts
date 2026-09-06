import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  KnowledgeSpaceSummary,
  TeacherClassroomSelection,
} from '../../../shared/contracts';

export function useTeacherSelection({
  selectedClassSpace,
  currentUserId,
  membershipAccessAllowed,
}: {
  selectedClassSpace: KnowledgeSpaceSummary | null;
  currentUserId: string;
  membershipAccessAllowed: boolean;
}) {
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
    let active = true;
    if (!membershipAccessAllowed) {
      teacherSelectionRef.current = null;
      queueMicrotask(() => {
        if (active) setTeacherSelection(null);
      });
      return () => {
        active = false;
      };
    }
    if (!window.tro.onTeacherClassroomChanged) return;
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
  }, [currentUserId, membershipAccessAllowed]);

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

  return {
    teacherSelectionPendingRef,
    teacherSelectionRef,
    teacherTaskBindingsRef,
    teacherVoiceBindingsRef,
    teacherSelectionPending,
    teacherSelection,
    selectTeacherSession,
  };
}
