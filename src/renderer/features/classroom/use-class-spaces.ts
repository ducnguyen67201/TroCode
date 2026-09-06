import type * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ClassroomAccountRole,
  KnowledgeSpaceSummary,
} from '../../../shared/contracts';
import { type ActiveView } from '../../app-navigation';
import { hasAssignedClassroomRole } from '../../class-workspace';

export function useClassSpaces({
  setActiveView,
  currentUserId,
  membershipAccessAllowed,
}: {
  setActiveView: React.Dispatch<React.SetStateAction<ActiveView>>;
  currentUserId: string;
  membershipAccessAllowed: boolean;
}) {
  const [knowledgeSpacesEnabled, setKnowledgeSpacesEnabled] = useState(false);

  const [classroomRole, setClassroomRole] =
    useState<ClassroomAccountRole>('unassigned');

  const [classSpaces, setClassSpaces] = useState<KnowledgeSpaceSummary[]>([]);

  const [classSpacesLoading, setClassSpacesLoading] = useState(false);

  const [classSpacesError, setClassSpacesError] = useState<string | null>(null);

  const [selectedClassSpace, setSelectedClassSpace] =
    useState<KnowledgeSpaceSummary | null>(null);

  const classSpacesRefreshIdRef = useRef(0);
  const knowledgeCapabilitiesRefreshIdRef = useRef(0);

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
  }, [membershipAccessAllowed, setActiveView]);

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
  }, [membershipAccessAllowed, refreshClassSpaces, setActiveView]);

  useEffect(() => {
    let active = true;
    if (!membershipAccessAllowed) {
      queueMicrotask(() => {
        if (!active) return;
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
      });
      return () => {
        active = false;
      };
    }
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
  }, [
    currentUserId,
    membershipAccessAllowed,
    refreshKnowledgeCapabilities,
    setActiveView,
  ]);

  return {
    knowledgeSpacesEnabled,
    classroomRole,
    selectedClassSpace,
    setSelectedClassSpace,
    classSpaces,
    classSpacesError,
    classSpacesLoading,
    refreshClassSpaces,
  };
}
