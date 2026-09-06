import type * as React from 'react';
import { useCallback, useState } from 'react';

import type { OrganizationSummary } from '../../../shared/contracts';

export function useMembershipActivation({
  setMembershipError,
  setMembershipStatus,
  refreshCompanionCustomization,
  openOrganizationAfterActivationRef,
  refreshOrganization,
}: {
  setMembershipError: React.Dispatch<React.SetStateAction<string | null>>;
  setMembershipStatus: React.Dispatch<
    React.SetStateAction<{
      state: 'error' | 'bypassed' | 'inactive' | 'active' | 'expired';
      required: boolean;
      referenceCode: string | null;
      expiresAt: string | null;
      plan: 'free' | 'basic' | 'pro' | 'max' | null;
      summary: string;
    } | null>
  >;
  refreshCompanionCustomization: () => Promise<void>;
  openOrganizationAfterActivationRef: React.RefObject<boolean>;
  refreshOrganization: () => Promise<OrganizationSummary | null>;
}) {
  const [isActivatingMembership, setIsActivatingMembership] = useState(false);

  const [isContinuingFree, setIsContinuingFree] = useState(false);

  const activateMembership = useCallback(
    async (code: string) => {
      setIsActivatingMembership(true);
      setMembershipError(null);
      try {
        setMembershipStatus(await window.tro.activateMembership({ code }));
        void refreshCompanionCustomization();
        openOrganizationAfterActivationRef.current = true;
        await refreshOrganization();
      } catch (activationError) {
        setMembershipError(
          activationError instanceof Error
            ? activationError.message
            : 'Tro could not activate this membership code.',
        );
      } finally {
        setIsActivatingMembership(false);
      }
    },
    [
      openOrganizationAfterActivationRef,
      refreshCompanionCustomization,
      refreshOrganization,
      setMembershipError,
      setMembershipStatus,
    ],
  );

  const continueWithFree = useCallback(async () => {
    setIsContinuingFree(true);
    setMembershipError(null);
    try {
      setMembershipStatus(await window.tro.continueWithFree());
      void refreshCompanionCustomization();
    } catch (continueError) {
      setMembershipError(
        continueError instanceof Error
          ? continueError.message
          : 'Tro could not start the Free plan.',
      );
    } finally {
      setIsContinuingFree(false);
    }
  }, [refreshCompanionCustomization, setMembershipError, setMembershipStatus]);

  return {
    isActivatingMembership,
    isContinuingFree,
    activateMembership,
    continueWithFree,
  };
}
