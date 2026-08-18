import { describe, expect, it } from 'vitest';

import {
  countCurrentImages,
  demoteVisualEvidence,
  prepareContextWindow,
} from './context-window-policy';

const visualItem = {
  call_id: 'call-1',
  output: [
    { type: 'input_text', text: 'screen' },
    { type: 'input_image', image_url: 'data:image/png;base64,aA==' },
  ],
  type: 'function_call_output',
};

describe('agent context-window policy', () => {
  it('keeps only the newest current image and demotes it after one sample', () => {
    const context = prepareContextWindow(
      [visualItem, { ...visualItem, call_id: 'call-2' }],
      true,
    );
    expect(countCurrentImages(context)).toBe(1);
    expect(countCurrentImages(demoteVisualEvidence(context))).toBe(0);
  });
});
