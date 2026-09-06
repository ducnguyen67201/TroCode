import type * as React from 'react';
import { useCallback, useEffect, useId, useState } from 'react';

import type { OrganizationSummary } from '../../../shared/contracts';
import { MAX_ORGANIZATION_HOME_BANNER_BYTES } from '../../../shared/contracts';

import { readImageAsDataUrl } from './banner-image';

export function useOrganizationBanner({
  organization,
  t,
  setNotice,
  isOrganizer,
  onOrganizationChange,
}: {
  organization: OrganizationSummary | null;
  t: (
    message: string,
    replacements?: Readonly<Record<string, string | number>>,
  ) => string;
  setNotice: React.Dispatch<React.SetStateAction<string | null>>;
  isOrganizer: boolean;
  onOrganizationChange: (organization: OrganizationSummary) => void;
}) {
  const bannerInputId = useId();

  const [bannerError, setBannerError] = useState<string | null>(null);

  const [bannerDraft, setBannerDraft] = useState<string | null>(
    organization?.homeBanner?.imageDataUrl ?? null,
  );

  const [isSavingBanner, setIsSavingBanner] = useState(false);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setBannerDraft(organization?.homeBanner?.imageDataUrl ?? null);
      setBannerError(null);
      setIsSavingBanner(false);
    });
    return () => {
      cancelled = true;
    };
  }, [organization?.homeBanner?.imageDataUrl, organization?.id]);

  const selectBannerImage = useCallback(
    async (file: File | null) => {
      if (!file) return;
      if (
        !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
        file.size < 1 ||
        file.size > MAX_ORGANIZATION_HOME_BANNER_BYTES
      ) {
        setBannerError(
          t('Choose a PNG, JPEG, or WebP image no larger than 750 KB.'),
        );
        return;
      }
      setBannerError(null);
      setNotice(null);
      try {
        setBannerDraft(await readImageAsDataUrl(file));
      } catch (readError) {
        setBannerError(
          readError instanceof Error
            ? t(readError.message)
            : t('Tro could not read this image.'),
        );
      }
    },
    [setNotice, t],
  );

  const saveHomeBanner = useCallback(async () => {
    if (!organization || !isOrganizer || !bannerDraft) return;
    setIsSavingBanner(true);
    setBannerError(null);
    setNotice(null);
    try {
      const response = await window.tro.updateOrganization({
        homeBannerImageDataUrl: bannerDraft,
      });
      onOrganizationChange(response.organization);
      setBannerDraft(response.organization.homeBanner?.imageDataUrl ?? null);
      setNotice(t('Home banner saved for this organization.'));
    } catch (saveError) {
      setBannerError(
        saveError instanceof Error
          ? saveError.message
          : t('Tro could not save the home banner.'),
      );
    } finally {
      setIsSavingBanner(false);
    }
  }, [
    bannerDraft,
    isOrganizer,
    onOrganizationChange,
    organization,
    setNotice,
    t,
  ]);

  const restoreDefaultHomeBanner = useCallback(async () => {
    if (!organization || !isOrganizer) return;
    setIsSavingBanner(true);
    setBannerError(null);
    setNotice(null);
    try {
      const response = await window.tro.updateOrganization({
        homeBannerImageDataUrl: null,
      });
      onOrganizationChange(response.organization);
      setBannerDraft(null);
      setNotice(t('The default Tro banner is active.'));
    } catch (saveError) {
      setBannerError(
        saveError instanceof Error
          ? saveError.message
          : t('Tro could not restore the default banner.'),
      );
    } finally {
      setIsSavingBanner(false);
    }
  }, [isOrganizer, onOrganizationChange, organization, setNotice, t]);

  return {
    bannerError,
    bannerDraft,
    bannerInputId,
    isSavingBanner,
    selectBannerImage,
    saveHomeBanner,
    restoreDefaultHomeBanner,
  };
}
