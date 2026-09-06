import type * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  OrganizationMember,
  OrganizationSummary,
} from '../../../shared/contracts';

import { MEMBERS_PAGE_SIZE } from './member-pagination';

export function useOrganizationMembers({
  organizationId,
  isOrganizer,
  onOrganizationChange,
  t,
  setNotice,
  organization,
}: {
  organizationId: string | null;
  isOrganizer: boolean;
  onOrganizationChange: (organization: OrganizationSummary) => void;
  t: (
    message: string,
    replacements?: Readonly<Record<string, string | number>>,
  ) => string;
  setNotice: React.Dispatch<React.SetStateAction<string | null>>;
  organization: OrganizationSummary | null;
}) {
  const [email, setEmail] = useState('');

  const [members, setMembers] = useState<OrganizationMember[]>([]);

  const [memberCount, setMemberCount] = useState(0);

  const [membersError, setMembersError] = useState<string | null>(null);

  const [isLoadingMembers, setIsLoadingMembers] = useState(false);

  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [isAdding, setIsAdding] = useState(false);

  const [cancellingMemberId, setCancellingMemberId] = useState<string | null>(
    null,
  );

  const membersRequestIdRef = useRef(0);

  const emailInputRef = useRef<HTMLInputElement | null>(null);

  const membersHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const loadMembers = useCallback(
    async ({
      append = false,
      offset = 0,
    }: { append?: boolean; offset?: number } = {}) => {
      if (!organizationId || !isOrganizer) {
        membersRequestIdRef.current += 1;
        setMembers([]);
        setMemberCount(0);
        setMembersError(null);
        return;
      }

      const requestId = membersRequestIdRef.current + 1;
      membersRequestIdRef.current = requestId;
      if (append) setIsLoadingMore(true);
      else setIsLoadingMembers(true);
      setMembersError(null);

      try {
        const response = await window.tro.listOrganizationMembers({
          limit: MEMBERS_PAGE_SIZE,
          offset,
        });
        if (membersRequestIdRef.current !== requestId) return;
        setMembers((current) =>
          append
            ? [
                ...current,
                ...response.items.filter(
                  (member) =>
                    !current.some(
                      (currentMember) => currentMember.id === member.id,
                    ),
                ),
              ]
            : response.items,
        );
        setMemberCount(response.page.total);
        onOrganizationChange(response.organization);
      } catch (loadError) {
        if (membersRequestIdRef.current !== requestId) return;
        setMembersError(
          loadError instanceof Error
            ? loadError.message
            : t('Tro could not load organization members.'),
        );
      } finally {
        if (membersRequestIdRef.current === requestId) {
          setIsLoadingMembers(false);
          setIsLoadingMore(false);
        }
      }
    },
    [isOrganizer, onOrganizationChange, organizationId, t],
  );

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setMembers([]);
      setMemberCount(0);
      setNotice(null);
      void loadMembers();
    });
    return () => {
      cancelled = true;
      membersRequestIdRef.current += 1;
    };
  }, [loadMembers, setNotice]);

  const addMember = useCallback(async () => {
    if (!organization || organization.capacity.state === 'full') return;
    setIsAdding(true);
    setMembersError(null);
    setNotice(null);
    try {
      const response = await window.tro.addOrganizationMember({ email });
      onOrganizationChange(response.organization);
      setEmail('');
      setNotice(
        response.newlyCreated
          ? t('Seat reserved for {email}.', { email: response.member.email })
          : t('{email} already has a reserved seat.', {
              email: response.member.email,
            }),
      );
      await loadMembers();
      emailInputRef.current?.focus();
    } catch (addError) {
      setMembersError(
        addError instanceof Error
          ? addError.message
          : t('Tro could not reserve this seat.'),
      );
    } finally {
      setIsAdding(false);
    }
  }, [email, loadMembers, onOrganizationChange, organization, setNotice, t]);

  const cancelPendingMember = useCallback(
    async (member: OrganizationMember) => {
      if (member.state !== 'pending') return;
      setCancellingMemberId(member.id);
      setMembersError(null);
      setNotice(null);
      try {
        const response = await window.tro.cancelOrganizationMember({
          memberId: member.id,
        });
        onOrganizationChange(response.organization);
        setNotice(
          t('The reserved seat for {email} was cancelled.', {
            email: member.email,
          }),
        );
        await loadMembers();
        membersHeadingRef.current?.focus();
      } catch (cancelError) {
        setMembersError(
          cancelError instanceof Error
            ? cancelError.message
            : t('Tro could not cancel this reserved seat.'),
        );
      } finally {
        setCancellingMemberId(null);
      }
    },
    [loadMembers, onOrganizationChange, setNotice, t],
  );

  const canLoadMore = members.length < memberCount;

  return {
    membersError,
    addMember,
    isAdding,
    setEmail,
    emailInputRef,
    email,
    membersHeadingRef,
    memberCount,
    isLoadingMembers,
    loadMembers,
    members,
    cancellingMemberId,
    cancelPendingMember,
    canLoadMore,
    isLoadingMore,
  };
}
