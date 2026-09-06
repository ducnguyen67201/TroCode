import type { OrganizationSummary } from '../../../shared/contracts';

interface OrganizationBannerProps {
  t: (
    message: string,
    replacements?: Readonly<Record<string, string | number>>,
  ) => string;
  bannerDraft: string | null;
  bannerInputId: string;
  isSavingBanner: boolean;
  selectBannerImage: (file: File | null) => Promise<void>;
  organization: OrganizationSummary;
  saveHomeBanner: () => Promise<void>;
  restoreDefaultHomeBanner: () => Promise<void>;
}

export function OrganizationBanner({
  t,
  bannerDraft,
  bannerInputId,
  isSavingBanner,
  selectBannerImage,
  organization,
  saveHomeBanner,
  restoreDefaultHomeBanner,
}: OrganizationBannerProps) {
  return (
    <section
      aria-labelledby="organization-home-banner-heading"
      className="organization-home-banner"
    >
      <div className="organization-home-banner__copy">
        <p className="eyebrow">{t('Home announcement')}</p>
        <h2 id="organization-home-banner-heading">
          {t('Organization home banner')}
        </h2>
        <p>
          {t(
            'Upload one image for your organization. It replaces the Tro artwork when members open the Agent home screen, and the default returns whenever you remove it.',
          )}
        </p>
        <small>{t('PNG, JPEG, or WebP · maximum 750 KB')}</small>
      </div>
      <div className="organization-home-banner__preview">
        {bannerDraft ? (
          <img alt={t('Organization home banner preview')} src={bannerDraft} />
        ) : (
          <div className="organization-home-banner__default">
            <span aria-hidden="true">✦</span>
            <strong>{t('Default Tro banner')}</strong>
          </div>
        )}
      </div>
      <div className="organization-home-banner__actions">
        <label className="secondary-button" htmlFor={bannerInputId}>
          {bannerDraft ? t('Choose another image') : t('Choose an image')}
        </label>
        <input
          accept="image/png,image/jpeg,image/webp"
          disabled={isSavingBanner}
          id={bannerInputId}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null;
            event.currentTarget.value = '';
            void selectBannerImage(file);
          }}
          type="file"
        />
        <button
          className="primary-button"
          disabled={
            isSavingBanner ||
            !bannerDraft ||
            bannerDraft === organization.homeBanner?.imageDataUrl
          }
          onClick={() => void saveHomeBanner()}
          type="button"
        >
          {isSavingBanner ? t('Saving banner…') : t('Save banner')}
        </button>
        <button
          className="organization-home-banner__reset"
          disabled={
            isSavingBanner ||
            (organization.homeBanner === null && bannerDraft === null)
          }
          onClick={() => void restoreDefaultHomeBanner()}
          type="button"
        >
          {t('Use default Tro banner')}
        </button>
      </div>
    </section>
  );
}
