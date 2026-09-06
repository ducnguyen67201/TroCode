import type * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AuthUser,
  MembershipStatus,
  OrganizationSummary,
} from '../../../shared/contracts';
import {
  type ActiveView,
  organizationSettingsAvailable,
} from '../../app-navigation';
import { membershipAllowsAccess } from '../../membership';

export function useOrganization({
  setActiveView,
  membershipStatus,
  currentUser,
  activeView,
}: {
  setActiveView: React.Dispatch<React.SetStateAction<ActiveView>>;
  membershipStatus: MembershipStatus | null;
  currentUser: AuthUser;
  activeView: ActiveView;
}) {
  const [organization, setOrganization] = useState<OrganizationSummary | null>(
    null,
  );

  const [organizationError, setOrganizationError] = useState<string | null>(
    null,
  );

  const [isLoadingOrganization, setIsLoadingOrganization] = useState(false);

  const organizationRefreshIdRef = useRef(0);

  const openOrganizationAfterActivationRef = useRef(false);

  const refreshOrganization =
    useCallback(async (): Promise<OrganizationSummary | null> => {
      const refreshId = organizationRefreshIdRef.current + 1;
      organizationRefreshIdRef.current = refreshId;
      setIsLoadingOrganization(true);
      setOrganizationError(null);
      try {
        const response = await window.tro.getOrganization();
        if (organizationRefreshIdRef.current !== refreshId) return null;
        setOrganization(response.organization);
        if (openOrganizationAfterActivationRef.current) {
          openOrganizationAfterActivationRef.current = false;
          if (organizationSettingsAvailable(response.organization)) {
            setActiveView('organization');
          }
        }
        return response.organization;
      } catch (organizationStatusError) {
        if (organizationRefreshIdRef.current !== refreshId) return null;
        setOrganizationError(
          organizationStatusError instanceof Error
            ? organizationStatusError.message
            : 'Tro could not load this organization.',
        );
        openOrganizationAfterActivationRef.current = false;
        return null;
      } finally {
        if (organizationRefreshIdRef.current === refreshId) {
          setIsLoadingOrganization(false);
        }
      }
    }, [setActiveView]);

  useEffect(() => {
    if (!membershipAllowsAccess(membershipStatus)) {
      organizationRefreshIdRef.current += 1;
      openOrganizationAfterActivationRef.current = false;
      queueMicrotask(() => {
        setOrganization(null);
        setOrganizationError(null);
        setIsLoadingOrganization(false);
      });
      return;
    }

    const handleWindowFocus = (): void => {
      void refreshOrganization();
    };
    queueMicrotask(() => void refreshOrganization());
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      organizationRefreshIdRef.current += 1;
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [currentUser.id, membershipStatus, refreshOrganization]);

  useEffect(() => {
    if (
      activeView !== 'organization' ||
      !membershipAllowsAccess(membershipStatus)
    ) {
      return;
    }
    queueMicrotask(() => void refreshOrganization());
  }, [activeView, membershipStatus, refreshOrganization]);

  useEffect(() => {
    if (
      activeView === 'organization' &&
      !isLoadingOrganization &&
      !organizationSettingsAvailable(organization)
    ) {
      queueMicrotask(() => setActiveView('agent'));
    }
  }, [activeView, isLoadingOrganization, organization, setActiveView]);

  return {
    organization,
    openOrganizationAfterActivationRef,
    refreshOrganization,
    organizationError,
    isLoadingOrganization,
    setOrganization,
  };
}
