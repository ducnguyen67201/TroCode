import { useCallback, useEffect, useRef, useState } from 'react';

import type { MembershipStatus } from '../../../shared/contracts';

export function useMembershipStatus() {
  const [membershipStatus, setMembershipStatus] =
    useState<MembershipStatus | null>(null);

  const [membershipError, setMembershipError] = useState<string | null>(null);

  const [isCheckingMembership, setIsCheckingMembership] = useState(true);

  const membershipRefreshIdRef = useRef(0);

  const refreshMembership = useCallback(async () => {
    const refreshId = membershipRefreshIdRef.current + 1;
    membershipRefreshIdRef.current = refreshId;
    setIsCheckingMembership(true);
    setMembershipError(null);
    try {
      const nextStatus = await window.tro.getMembershipStatus();
      if (membershipRefreshIdRef.current !== refreshId) return;
      setMembershipStatus(nextStatus);
    } catch (membershipStatusError) {
      if (membershipRefreshIdRef.current !== refreshId) return;
      setMembershipStatus(null);
      setMembershipError(
        membershipStatusError instanceof Error
          ? membershipStatusError.message
          : 'Tro could not check your membership.',
      );
    } finally {
      if (membershipRefreshIdRef.current === refreshId) {
        setIsCheckingMembership(false);
      }
    }
  }, []);

  useEffect(() => {
    const handleWindowFocus = (): void => {
      void refreshMembership();
    };
    queueMicrotask(() => void refreshMembership());
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      membershipRefreshIdRef.current += 1;
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [refreshMembership]);

  useEffect(() => {
    if (membershipStatus?.state !== 'active' || !membershipStatus.expiresAt) {
      return;
    }

    const remainingMs = Date.parse(membershipStatus.expiresAt) - Date.now();
    if (remainingMs <= 0) {
      queueMicrotask(() => void refreshMembership());
      return;
    }

    const expiryTimer = setTimeout(
      () => void refreshMembership(),
      Math.min(remainingMs, 2_147_483_647),
    );
    return () => clearTimeout(expiryTimer);
  }, [membershipStatus, refreshMembership]);

  return {
    membershipStatus,
    setMembershipError,
    setMembershipStatus,
    membershipError,
    isCheckingMembership,
    refreshMembership,
  };
}
