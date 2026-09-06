import { useId, useRef, useState } from 'react';

import desktopPetUrl from '../assets/tro-desktop-pet.png';
import type {
  AppLanguage,
  CompanionCustomizationStatus,
  GenerateCompanionImageRequest,
} from '../shared/contracts';
import { MAX_COMPANION_IMAGE_BYTES } from '../shared/contracts';

import { appLocale, translate } from './app-language';
import { CompanionGenerator } from './features/companion/CompanionGenerator';
import { CompanionLibrary } from './features/companion/CompanionLibrary';
import type {
  CompanionCustomizationBusy,
  SelectedSource,
} from './features/companion/customization-types';
import { readFileAsBase64 } from './features/companion/image-selection';

interface CompanionCustomizationCardProps {
  appLanguage: AppLanguage;
  busy: CompanionCustomizationBusy;
  error: string | null;
  onActivate(candidateId: string): Promise<void>;
  onActivateSaved(companionId: string): Promise<void>;
  onGenerate(request: GenerateCompanionImageRequest): Promise<boolean>;
  onUseDefault(): Promise<void>;
  status: CompanionCustomizationStatus | null;
}

export function CompanionCustomizationCard({
  appLanguage,
  busy,
  error,
  onActivate,
  onActivateSaved,
  onGenerate,
  onUseDefault,
  status,
}: CompanionCustomizationCardProps) {
  const inputId = useId();
  const sourceHelpId = `${inputId}-source-help`;
  const promptHelpId = `${inputId}-prompt-help`;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [selectedSource, setSelectedSource] = useState<SelectedSource | null>(
    null,
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const t = (message: string, replacements?: Record<string, string | number>) =>
    translate(appLanguage, message, replacements);
  const isBusy = busy !== null;
  const isDefaultActive = status?.appearance.kind === 'default';
  const quota = status?.quota ?? null;
  const hasPrompt = prompt.trim().length > 0;
  const canGenerate =
    status?.state === 'available' &&
    quota !== null &&
    quota.remaining > 0 &&
    selectedSource !== null &&
    hasPrompt &&
    !isBusy;
  const resetDate = quota
    ? new Intl.DateTimeFormat(appLocale(appLanguage), {
        dateStyle: 'medium',
        timeZone: 'UTC',
      }).format(new Date(quota.periodEndsAt))
    : null;

  const selectSource = (file: File | null): void => {
    setIsDragging(false);
    if (!file) {
      setLocalError(t('Choose a PNG or JPEG image.'));
      return;
    }
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      setLocalError(t('Choose a PNG or JPEG image.'));
      return;
    }
    if (file.size === 0 || file.size > MAX_COMPANION_IMAGE_BYTES) {
      setLocalError(t('Choose an image no larger than 5 MiB.'));
      return;
    }
    setLocalError(null);
    setSelectedSource({ file });
  };

  const openImagePicker = (): void => {
    if (!fileInputRef.current) return;
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  };

  const submitGeneration = async (): Promise<void> => {
    if (!canGenerate || !selectedSource) return;
    setLocalError(null);
    try {
      const succeeded = await onGenerate({
        imageBase64: await readFileAsBase64(selectedSource.file),
        mimeType: selectedSource.file.type as 'image/png' | 'image/jpeg',
        prompt: prompt.trim(),
        requestId: crypto.randomUUID(),
      });
      if (succeeded) {
        setSelectedSource(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch (generationError) {
      setLocalError(
        generationError instanceof Error
          ? t(generationError.message)
          : t('Tro could not read this image.'),
      );
    }
  };

  const activeImageUrl =
    status?.appearance.kind === 'custom'
      ? status.appearance.assetUrl
      : desktopPetUrl;
  const generateLabel =
    busy === 'generating'
      ? t('Creating your preview…')
      : !selectedSource
        ? t('Add an image to continue')
        : !hasPrompt
          ? t('Describe a style to continue')
          : t('Generate preview');

  return (
    <section
      aria-busy={isBusy}
      aria-labelledby="companion-customization-heading"
      className="settings-card companion-customization-card"
    >
      <div className="companion-customization-card__header">
        <div>
          <p className="eyebrow">{t('Personalization')}</p>
          <h2 id="companion-customization-heading">{t('Custom companion')}</h2>
          <p className="settings-help companion-customization-card__intro">
            {t(
              'Start with any picture, choose a style, then preview your tiny desktop companion.',
            )}
          </p>
        </div>
        {quota && (
          <div
            aria-label={t('{remaining} of {limit} left this month', {
              limit: quota.limit,
              remaining: quota.remaining,
            })}
            className={`companion-quota-meter${quota.remaining === 0 ? ' companion-quota-meter--empty' : ''}`}
            role="status"
          >
            <span aria-hidden="true" className="companion-quota-meter__pips">
              {Array.from({ length: quota.limit }, (_, index) => (
                <span
                  className={
                    index < quota.remaining ? 'is-available' : undefined
                  }
                  key={index}
                />
              ))}
            </span>
            <span>
              {t('{remaining} of {limit} left this month', {
                limit: quota.limit,
                remaining: quota.remaining,
              })}
            </span>
          </div>
        )}
      </div>

      {!status || busy === 'loading' ? (
        <div className="companion-customization-card__loading" role="status">
          <span className="companion-customization-card__loading-orb" />
          <span>{t('Getting your companion ready…')}</span>
        </div>
      ) : (
        <>
          <div aria-live="polite" className="companion-customization-current">
            <div className="companion-customization-preview companion-customization-preview--current">
              <img alt="" src={activeImageUrl} />
              <span className="companion-customization-active-mark">
                {t('Selected')}
              </span>
            </div>
            <div className="companion-customization-current__copy">
              <span className="companion-customization-kicker">
                {t('Ready for your desktop')}
              </span>
              <strong>{t('Current companion')}</strong>
              <p>
                {status.appearance.kind === 'custom'
                  ? t('Your custom companion is active.')
                  : t('Tro’s default companion is active.')}
              </p>
              {status.appearance.kind === 'custom' && (
                <button
                  className="companion-customization-reset"
                  disabled={isBusy}
                  onClick={() => void onUseDefault()}
                  type="button"
                >
                  {busy === 'resetting'
                    ? t('Restoring…')
                    : t('Use default companion')}
                </button>
              )}
            </div>
          </div>

          <CompanionLibrary
            t={t}
            status={status}
            isDefaultActive={isDefaultActive}
            isBusy={isBusy}
            onUseDefault={onUseDefault}
            onActivateSaved={onActivateSaved}
            appLanguage={appLanguage}
            busy={busy}
          />

          {status.state !== 'available' ? (
            <div
              className={`companion-customization-notice companion-customization-notice--${status.state}`}
              role={status.state === 'error' ? 'alert' : 'status'}
            >
              <span
                aria-hidden="true"
                className="companion-customization-notice__mark"
              >
                !
              </span>
              <span>
                <strong>{t('Generation unavailable')}</strong>
                <small>{t(status.summary)}</small>
              </span>
            </div>
          ) : quota?.remaining === 0 ? (
            <div
              className="companion-customization-notice companion-customization-notice--limit"
              role="status"
            >
              <span
                aria-hidden="true"
                className="companion-customization-notice__mark"
              >
                5
              </span>
              <span>
                <strong>{t('All previews used this month')}</strong>
                <small>
                  {t(
                    'You can create more on {date}. Your current companion stays active.',
                    { date: resetDate ?? '' },
                  )}
                </small>
              </span>
            </div>
          ) : (
            <CompanionGenerator
              t={t}
              isBusy={isBusy}
              inputId={inputId}
              selectSource={selectSource}
              fileInputRef={fileInputRef}
              sourceHelpId={sourceHelpId}
              selectedSource={selectedSource}
              isDragging={isDragging}
              openImagePicker={openImagePicker}
              setIsDragging={setIsDragging}
              localError={localError}
              promptHelpId={promptHelpId}
              setPrompt={setPrompt}
              prompt={prompt}
              resetDate={resetDate}
              quota={quota}
              canGenerate={canGenerate}
              submitGeneration={submitGeneration}
              busy={busy}
              generateLabel={generateLabel}
            />
          )}

          {status.candidate && (
            <div
              aria-live="polite"
              className="companion-customization-candidate"
            >
              <div className="companion-customization-candidate__heading">
                <span
                  aria-hidden="true"
                  className="companion-customization-step__number"
                >
                  3
                </span>
                <span>
                  <strong>{t('Meet your new companion')}</strong>
                  <small>
                    {t('Nothing changes until you choose to use it.')}
                  </small>
                </span>
              </div>
              <div className="companion-customization-candidate__body">
                <div className="companion-customization-preview companion-customization-preview--candidate">
                  <img alt="" src={status.candidate.assetUrl} />
                </div>
                <div>
                  <span className="companion-customization-kicker">
                    {t('Preview ready')}
                  </span>
                  <strong>{t('Made for your desktop')}</strong>
                  <p>
                    {t('Preview available until {time}.', {
                      time: new Intl.DateTimeFormat(appLocale(appLanguage), {
                        hour: 'numeric',
                        minute: '2-digit',
                      }).format(new Date(status.candidate.expiresAt)),
                    })}
                  </p>
                  <button
                    className="primary-button"
                    disabled={isBusy}
                    onClick={() => void onActivate(status.candidate!.id)}
                    type="button"
                  >
                    {busy === 'activating'
                      ? t('Activating…')
                      : t('Use this companion')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <div aria-live="polite">
        {error && (
          <p
            className="settings-feedback settings-feedback--error"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

export type { CompanionCustomizationBusy } from './features/companion/customization-types';
