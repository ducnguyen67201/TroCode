import { useCallback, useEffect, useState } from 'react';

import type {
  ExecutionProfile,
  WorkspaceRuntimeAvailability,
  WorkspaceSelection,
} from '../../../shared/contracts';

export function useWorkspaceSelection({
  clearError,
  reportError,
}: {
  clearError: () => void;
  reportError: (message: string) => void;
}) {
  const [executionProfile, setExecutionProfile] =
    useState<ExecutionProfile>('everyday');

  const [workspaceRuntime, setWorkspaceRuntime] =
    useState<WorkspaceRuntimeAvailability | null>(null);

  const [workspaceSelection, setWorkspaceSelection] =
    useState<WorkspaceSelection | null>(null);

  const [isSelectingWorkspace, setIsSelectingWorkspace] = useState(false);

  useEffect(() => {
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
  }, []);

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

  return {
    executionProfile,
    workspaceRuntime,
    workspaceSelection,
    setExecutionProfile,
    isSelectingWorkspace,
    chooseWorkspace,
  };
}
