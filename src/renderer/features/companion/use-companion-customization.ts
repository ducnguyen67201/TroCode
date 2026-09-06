import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  CompanionCustomizationStatus,
  GenerateCompanionImageRequest,
  MembershipStatus,
} from '../../../shared/contracts';

import type { CompanionCustomizationBusy } from './customization-types';

export function useCompanionCustomization({
  settingsOpen,
  membershipStatus,
}: {
  settingsOpen: boolean;
  membershipStatus: MembershipStatus | null;
}) {
  const [companionStatus, setCompanionStatus] =
    useState<CompanionCustomizationStatus | null>(null);

  const [companionError, setCompanionError] = useState<string | null>(null);

  const [companionBusy, setCompanionBusy] =
    useState<CompanionCustomizationBusy>(null);

  const companionRefreshIdRef = useRef(0);

  const companionActionInFlightRef = useRef(false);

  const refreshCompanionCustomization = useCallback(async () => {
    const refreshId = companionRefreshIdRef.current + 1;
    companionRefreshIdRef.current = refreshId;
    setCompanionBusy('loading');
    setCompanionError(null);
    try {
      const nextStatus = await window.tro.getCompanionCustomizationStatus();
      if (companionRefreshIdRef.current !== refreshId) return;
      setCompanionStatus(nextStatus);
    } catch (statusError) {
      if (companionRefreshIdRef.current !== refreshId) return;
      setCompanionStatus(null);
      setCompanionError(
        statusError instanceof Error
          ? statusError.message
          : 'Tro could not load companion settings.',
      );
    } finally {
      if (companionRefreshIdRef.current === refreshId) {
        setCompanionBusy(null);
      }
    }
  }, []);

  useEffect(() => {
    if (!settingsOpen || membershipStatus?.state !== 'active') {
      return;
    }

    queueMicrotask(() => void refreshCompanionCustomization());
  }, [membershipStatus?.state, refreshCompanionCustomization, settingsOpen]);

  const generateCompanion = useCallback(
    async (request: GenerateCompanionImageRequest): Promise<boolean> => {
      if (companionActionInFlightRef.current) return false;
      companionActionInFlightRef.current = true;
      companionRefreshIdRef.current += 1;
      setCompanionBusy('generating');
      setCompanionError(null);
      try {
        setCompanionStatus(await window.tro.generateCompanionImage(request));
        return true;
      } catch (generationError) {
        setCompanionError(
          generationError instanceof Error
            ? generationError.message
            : 'Tro could not generate this companion.',
        );
        try {
          setCompanionStatus(
            await window.tro.getCompanionCustomizationStatus(),
          );
        } catch {
          // Keep the generation error when quota refresh is unavailable.
        }
        return false;
      } finally {
        companionActionInFlightRef.current = false;
        setCompanionBusy(null);
      }
    },
    [],
  );

  const activateCompanion = useCallback(async (candidateId: string) => {
    if (companionActionInFlightRef.current) return;
    companionActionInFlightRef.current = true;
    companionRefreshIdRef.current += 1;
    setCompanionBusy('activating');
    setCompanionError(null);
    try {
      setCompanionStatus(
        await window.tro.activateCompanionCandidate({ candidateId }),
      );
    } catch (activationError) {
      setCompanionError(
        activationError instanceof Error
          ? activationError.message
          : 'Tro could not activate this companion.',
      );
      try {
        setCompanionStatus(await window.tro.getCompanionCustomizationStatus());
      } catch {
        // Preserve the activation error when refreshing an expired candidate fails.
      }
    } finally {
      companionActionInFlightRef.current = false;
      setCompanionBusy(null);
    }
  }, []);

  const activateSavedCompanion = useCallback(async (companionId: string) => {
    if (companionActionInFlightRef.current) return;
    companionActionInFlightRef.current = true;
    companionRefreshIdRef.current += 1;
    setCompanionBusy('selecting');
    setCompanionError(null);
    try {
      setCompanionStatus(
        await window.tro.activateSavedCompanion({ companionId }),
      );
    } catch (activationError) {
      setCompanionError(
        activationError instanceof Error
          ? activationError.message
          : 'Tro could not activate this saved companion.',
      );
      try {
        setCompanionStatus(await window.tro.getCompanionCustomizationStatus());
      } catch {
        // Preserve the activation error when the saved library cannot refresh.
      }
    } finally {
      companionActionInFlightRef.current = false;
      setCompanionBusy(null);
    }
  }, []);

  const useDefaultCompanion = useCallback(async () => {
    if (companionActionInFlightRef.current) return;
    companionActionInFlightRef.current = true;
    companionRefreshIdRef.current += 1;
    setCompanionBusy('resetting');
    setCompanionError(null);
    try {
      setCompanionStatus(await window.tro.useDefaultCompanion());
    } catch (resetError) {
      setCompanionError(
        resetError instanceof Error
          ? resetError.message
          : 'Tro could not restore the default companion.',
      );
    } finally {
      companionActionInFlightRef.current = false;
      setCompanionBusy(null);
    }
  }, []);

  return {
    refreshCompanionCustomization,
    companionBusy,
    companionError,
    companionStatus,
    activateCompanion,
    activateSavedCompanion,
    generateCompanion,
    useDefaultCompanion,
  };
}
