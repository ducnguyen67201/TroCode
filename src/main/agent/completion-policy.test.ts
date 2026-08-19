import { describe, expect, it } from 'vitest';

import {
  requestReferencesVisibleContext,
  requestUsesCurrentSurfaceContext,
  requestsVisibleContextAction,
  shouldCaptureInitialDesktopObservation,
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

  it.each([
    'Help me do this.',
    'Please fix this for me.',
    'Continue what is currently open.',
    'Giúp tôi làm bài này.',
    'Sửa cái đang hiển thị này.',
  ])('recognizes delegated visible action: %s', (request) => {
    expect(requestsVisibleContextAction(request)).toBe(true);
  });

  it.each([
    'Help me do the assignment.',
    'Please continue this homework.',
    'Đúng rồi, giúp tôi làm bài tập.',
    'Giúp tôi làm bài tập Eroki.',
    'Tiếp tục.',
  ])('infers current-screen context from lazy assistance: %s', (request) => {
    expect(requestUsesCurrentSurfaceContext(request)).toBe(true);
    expect(shouldCaptureInitialDesktopObservation(request)).toBe(true);
  });

  it.each([
    'Explain this exercise.',
    'What is this?',
    'Read what is currently visible.',
    'Giải thích bài này.',
    'Đọc màn hình này.',
  ])('does not turn visible reading or explanation into action: %s', (request) => {
    expect(requestsVisibleContextAction(request)).toBe(false);
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

  it.each([
    'Create me a simple sheet for tracking money.',
    'Fill in this form with my details.',
    'Đúng rồi, đang mở Google Sheets nè, tạo trên Google Sheets.',
    'Try again and use what is on screen.',
  ])('captures initial screen context for visible app work: %s', (request) => {
    expect(shouldCaptureInitialDesktopObservation(request)).toBe(true);
  });

  it.each([
    'What is a spreadsheet?',
    'Explain how Google Sheets formulas work.',
    'Open Gmail and read the latest email.',
    'Create a list of vegetables.',
    'Write an email draft for my manager.',
    'Write an eight-bar chord progression.',
    'Write an assignment template.',
    'Help me plan a vacation.',
  ])('does not pre-capture for text or navigation-first work: %s', (request) => {
    expect(shouldCaptureInitialDesktopObservation(request)).toBe(false);
  });
});
