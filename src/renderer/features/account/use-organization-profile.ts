import type * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { OrganizationSummary } from '../../../shared/contracts';

export function useOrganizationProfile({
  organization,
  isOrganizer,
  t,
  setNotice,
  onOrganizationChange,
}: {
  organization: OrganizationSummary | null;
  isOrganizer: boolean;
  t: (
    message: string,
    replacements?: Readonly<Record<string, string | number>>,
  ) => string;
  setNotice: React.Dispatch<React.SetStateAction<string | null>>;
  onOrganizationChange: (organization: OrganizationSummary) => void;
}) {
  const [organizationNameDraft, setOrganizationNameDraft] = useState(
    organization?.name ?? '',
  );

  const [isSavingName, setIsSavingName] = useState(false);

  const [profileError, setProfileError] = useState<string | null>(null);

  const profileRequestIdRef = useRef(0);

  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    profileRequestIdRef.current += 1;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setOrganizationNameDraft(organization?.name ?? '');
      setProfileError(null);
      setIsSavingName(false);
    });
    return () => {
      cancelled = true;
      profileRequestIdRef.current += 1;
    };
  }, [organization?.id, organization?.name, organization?.role]);

  const saveOrganizationName = useCallback(async () => {
    if (!organization || !isOrganizer) return;
    const name = organizationNameDraft.trim();
    if (name.length < 1 || name.length > 100) {
      setProfileError(
        t('Organization name must be between 1 and 100 characters.'),
      );
      return;
    }
    if (name === organization.name) {
      setNotice(t('Organization name is already up to date.'));
      nameInputRef.current?.focus();
      return;
    }

    const requestId = profileRequestIdRef.current + 1;
    profileRequestIdRef.current = requestId;
    const expectedOrganizationId = organization.id;
    setIsSavingName(true);
    setProfileError(null);
    setNotice(null);
    try {
      const response = await window.tro.updateOrganization({ name });
      if (
        profileRequestIdRef.current !== requestId ||
        response.organization.id !== expectedOrganizationId
      ) {
        return;
      }
      onOrganizationChange(response.organization);
      setOrganizationNameDraft(response.organization.name);
      setNotice(t('Organization name saved.'));
      nameInputRef.current?.focus();
    } catch (updateError) {
      if (profileRequestIdRef.current !== requestId) return;
      setProfileError(
        updateError instanceof Error
          ? updateError.message
          : t('Tro could not save the organization name.'),
      );
    } finally {
      if (profileRequestIdRef.current === requestId) {
        setIsSavingName(false);
      }
    }
  }, [
    isOrganizer,
    onOrganizationChange,
    organization,
    organizationNameDraft,
    setNotice,
    t,
  ]);

  return {
    profileError,
    saveOrganizationName,
    isSavingName,
    setOrganizationNameDraft,
    setProfileError,
    nameInputRef,
    organizationNameDraft,
  };
}
