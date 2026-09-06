import type * as React from 'react';

import type { CompanionCustomizationStatus } from '../../../shared/contracts';

import {
  ImageIcon,
  LocalImagePreview,
  LockIcon,
} from './CompanionImagePreview';
import type {
  CompanionCustomizationBusy,
  SelectedSource,
} from './customization-types';
import { firstClipboardImage, firstFile } from './image-selection';

interface CompanionGeneratorProps {
  t: (
    message: string,
    replacements?: Record<string, string | number>,
  ) => string;
  isBusy: boolean;
  inputId: string;
  selectSource: (file: File | null) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  sourceHelpId: string;
  selectedSource: SelectedSource | null;
  isDragging: boolean;
  openImagePicker: () => void;
  setIsDragging: React.Dispatch<React.SetStateAction<boolean>>;
  localError: string | null;
  promptHelpId: string;
  setPrompt: React.Dispatch<React.SetStateAction<string>>;
  prompt: string;
  resetDate: string | null;
  quota: CompanionCustomizationStatus['quota'] | null;
  canGenerate: boolean;
  submitGeneration: () => Promise<void>;
  busy: CompanionCustomizationBusy;
  generateLabel: string;
}

export function CompanionGenerator({
  t,
  isBusy,
  inputId,
  selectSource,
  fileInputRef,
  sourceHelpId,
  selectedSource,
  isDragging,
  openImagePicker,
  setIsDragging,
  localError,
  promptHelpId,
  setPrompt,
  prompt,
  resetDate,
  quota,
  canGenerate,
  submitGeneration,
  busy,
  generateLabel,
}: CompanionGeneratorProps) {
  return (
    <div className="companion-customization-generator">
      <div className="companion-customization-generator__heading">
        <div>
          <h3>{t('Create your own pet')}</h3>
          <p>
            {t('Start with a picture, then describe how your pet should look.')}
          </p>
        </div>
        <span>
          {t('Generated pets keep Tro’s state badges and motion reactions.')}
        </span>
      </div>
      <ol className="companion-customization-steps">
        <li className="companion-customization-step">
          <div className="companion-customization-step__heading">
            <span
              aria-hidden="true"
              className="companion-customization-step__number"
            >
              1
            </span>
            <span>
              <strong>{t('Choose a picture')}</strong>
              <small>
                {t(
                  'A pet, drawing, character, or anything that feels like you.',
                )}
              </small>
            </span>
          </div>

          <input
            accept="image/png,image/jpeg"
            className="companion-customization-file-input"
            disabled={isBusy}
            id={inputId}
            onChange={(event) =>
              selectSource(firstFile(event.target.files ?? []))
            }
            ref={fileInputRef}
            type="file"
          />
          <button
            aria-describedby={sourceHelpId}
            className={`companion-customization-dropzone${selectedSource ? ' companion-customization-dropzone--selected' : ''}${isDragging ? ' companion-customization-dropzone--dragging' : ''}`}
            disabled={isBusy}
            onClick={openImagePicker}
            onDragEnter={() => setIsDragging(true)}
            onDragLeave={() => setIsDragging(false)}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDrop={(event) => {
              event.preventDefault();
              selectSource(firstFile(event.dataTransfer.files));
            }}
            onPaste={(event) => {
              event.preventDefault();
              selectSource(firstClipboardImage(event.clipboardData.items));
            }}
            type="button"
          >
            <span className="companion-customization-source-preview">
              {selectedSource ? (
                <LocalImagePreview
                  file={selectedSource.file}
                  label={t('Selected source')}
                />
              ) : (
                <ImageIcon />
              )}
            </span>
            <span className="companion-customization-dropzone__copy">
              <strong>
                {selectedSource
                  ? t('Picture ready')
                  : t('Drop, paste, or click to choose')}
              </strong>
              <small id={sourceHelpId}>
                {selectedSource ? (
                  <>
                    {selectedSource.file.name}
                    <span aria-hidden="true"> · </span>
                    {t('Click to choose another')}
                  </>
                ) : (
                  t('PNG or JPEG · up to 5 MiB')
                )}
              </small>
            </span>
            <span
              aria-hidden="true"
              className="companion-customization-dropzone__action"
            >
              {selectedSource ? t('Change') : t('Browse')}
            </span>
          </button>
          {localError && (
            <p className="companion-customization-inline-error" role="alert">
              {localError}
            </p>
          )}
        </li>

        <li className="companion-customization-step">
          <div className="companion-customization-step__heading">
            <span
              aria-hidden="true"
              className="companion-customization-step__number"
            >
              2
            </span>
            <span>
              <strong>{t('Describe the vibe')}</strong>
              <small id={promptHelpId}>
                {t('Try a style, mood, and a few colors.')}
              </small>
            </span>
          </div>

          <label className="companion-customization-prompt">
            <span className="companion-customization-prompt__label">
              {t('Your idea')}
            </span>
            <textarea
              aria-describedby={promptHelpId}
              disabled={isBusy}
              maxLength={400}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={t(
                'A cheerful pixel-art fox in sunny yellow and orange',
              )}
              rows={3}
              value={prompt}
            />
            <small>
              {t('{count} of 400 characters', { count: prompt.length })}
            </small>
          </label>
        </li>
      </ol>

      <div className="companion-customization-action-panel">
        <div className="companion-customization-action-panel__copy">
          <strong>{t('Ready for a first look?')}</strong>
          <span>
            {t('{used} of {limit} previews used · resets {date}', {
              date: resetDate ?? '',
              limit: quota?.limit ?? 5,
              used: quota?.used ?? 0,
            })}
          </span>
        </div>
        <button
          className="primary-button companion-customization-generate"
          disabled={!canGenerate}
          onClick={() => void submitGeneration()}
          type="button"
        >
          {busy === 'generating' && (
            <span
              aria-hidden="true"
              className="companion-customization-spinner"
            />
          )}
          {generateLabel}
        </button>
        {busy === 'generating' && (
          <p className="companion-customization-progress" role="status">
            {t('This can take up to 2 minutes. Keep Tro open.')}
          </p>
        )}
      </div>

      <div className="companion-customization-privacy">
        <span className="companion-customization-privacy__icon">
          <LockIcon />
        </span>
        <div>
          <strong>{t('Private by design')}</strong>
          <p>
            {t(
              'Sent once to OpenAI; your source and prompt are not saved by Tro.',
            )}
          </p>
          <details>
            <summary>{t('Privacy and monthly slots')}</summary>
            <p>
              {t(
                'Your source image and prompt are sent to OpenAI only for this generation; Tro does not save them. A companion you activate stays encrypted on this device. OpenAI may retain images flagged for child-safety review. An uncertain provider outcome may use one monthly slot, and Tro will not retry it automatically.',
              )}
            </p>
          </details>
        </div>
      </div>
    </div>
  );
}
