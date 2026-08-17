import { describe, expect, it } from 'vitest';

import {
  countCurrentImages,
  demoteVisualEvidence,
  prepareContextWindow,
} from './context-window-policy';
import { decideFallback } from './fallback-policy';
import { selectInferenceProfile } from './inference-profile-policy';
import { assertModelSupportsProfile } from './model-catalog';

const visualItem = {
  call_id: 'call-1',
  output: [
    { type: 'input_text', text: 'screen' },
    { type: 'input_image', image_url: 'data:image/png;base64,aA==' },
  ],
  type: 'function_call_output',
};

describe('cost-aware inference policies', () => {
  it('keeps only the newest current image and demotes it after one sample', () => {
    const context = prepareContextWindow(
      [visualItem, { ...visualItem, call_id: 'call-2' }],
      true,
    );
    expect(countCurrentImages(context)).toBe(1);
    expect(countCurrentImages(demoteVisualEvidence(context))).toBe(0);
  });

  it('selects bounded Luna profiles unless quality override is explicit', () => {
    expect(
      selectInferenceProfile({
        hasCurrentImage: false,
        qualityOverride: false,
        requestLength: 20,
      }),
    ).toMatchObject({ id: 'standard', model: 'gpt-5.6-luna', maxOutputTokens: 2_000 });
    const quality = selectInferenceProfile({
      hasCurrentImage: false,
      qualityOverride: true,
      requestLength: 20,
    });
    expect(quality).toMatchObject({ id: 'quality_override', model: 'gpt-5.6-terra' });
    expect(() => assertModelSupportsProfile(quality.model, quality.id)).not.toThrow();
  });

  it('stops on ambiguous dispatch and permits only reserved explicit rejection retries', () => {
    expect(
      decideFallback({
        combinedReservationFits: true,
        disposition: 'ambiguous',
        namedFallbackProfile: true,
        retryAfterSatisfied: true,
      }).action,
    ).toBe('stop');
    expect(
      decideFallback({
        combinedReservationFits: true,
        disposition: 'rejected_before_inference',
        namedFallbackProfile: false,
        retryAfterSatisfied: true,
      }).action,
    ).toBe('retry_same_model');
  });
});
