import { describe, expect, it } from 'vitest';

import {
  requestReferencesVisibleContext,
  shouldRequestCompletionReview,
} from './completion-policy';

describe('agent completion review policy', () => {
  it.each([
    'Help me work on this assignment.',
    'giúp tôi làm bài tập này',
    'Explain what is currently visible.',
    'Giải thích nội dung trên màn hình.',
  ])('recognizes visible-context references: %s', (request) => {
    expect(requestReferencesVisibleContext(request)).toBe(true);
    expect(
      shouldRequestCompletionReview({ request, resolvedToolCalls: 0 }),
    ).toBe(true);
  });

  it('reviews every task that entered the tool loop', () => {
    expect(
      shouldRequestCompletionReview({
        request: 'Open Gmail and read the latest email.',
        resolvedToolCalls: 2,
      }),
    ).toBe(true);
  });

  it.each([
    'What is 27 × 14?',
    'Write an eight-bar chord progression.',
    'Dịch “Hello” sang tiếng Việt.',
  ])('keeps self-contained assistant work on the fast path: %s', (request) => {
    expect(
      shouldRequestCompletionReview({ request, resolvedToolCalls: 0 }),
    ).toBe(false);
  });
});
