import { describe, expect, it } from 'vitest';

import {
  actionPreviewDwellMs,
  createActionPreview,
  isClassroomRequest,
} from './action-preview-policy';

describe('action preview policy', () => {
  it.each([
    'Help me finish this assignment.',
    'Teach me this lesson.',
    'Giúp tôi làm bài tập này.',
    'Bài học này làm như thế nào?',
  ])('detects classroom work: %s', (request) => {
    expect(isClassroomRequest(request)).toBe(true);
  });

  it.each([
    'Open my latest email.',
    'Update this spreadsheet.',
    'Fix the selected code in VS Code.',
  ])('does not treat general work as classroom work: %s', (request) => {
    expect(isClassroomRequest(request)).toBe(false);
  });

  it('briefly says what will happen for a general action', () => {
    expect(
      createActionPreview({
        action: {
          action: 'click_element',
          description: 'Open the newest email',
          target: 'Newest email',
        },
        request: 'Open my latest email.',
        taskId: 'task-1',
      }),
    ).toEqual({
      classroom: false,
      dwellMs: 2_500,
      language: 'en',
      message: 'Next: Open the newest email.',
      target: 'Newest email',
      taskId: 'task-1',
    });
  });

  it('uses Vietnamese for the preview and classroom reason', () => {
    const preview = createActionPreview({
      action: {
        action: 'click_element',
        description: 'Mở mục Sự kiện',
      },
      request: 'Giúp tôi làm bài tập Scratch này.',
      taskId: 'task-vi',
    });

    expect(preview).toMatchObject({
      classroom: true,
      language: 'vi',
      message:
        'Tiếp theo: Mở mục Sự kiện. Vì sao: Bước này cho thấy cách đi đến phần tiếp theo của hoạt động.',
    });
  });

  it('uses the saved language when a short request has no language signal', () => {
    const preview = createActionPreview({
      action: {
        action: 'click_element',
        description: 'Open Events',
      },
      preferredLanguage: 'vi',
      request: 'Do this',
      taskId: 'task-preference',
    });

    expect(preview).toMatchObject({
      language: 'vi',
      message: 'Tiếp theo: Open Events.',
    });
  });

  it('scales reading time with copy length inside bounded limits', () => {
    expect(actionPreviewDwellMs('Short preview.')).toBe(2_500);
    expect(actionPreviewDwellMs('x'.repeat(110))).toBe(5_000);
    expect(actionPreviewDwellMs('x'.repeat(500))).toBe(8_000);
  });

  it('adds why the step matters for a classroom action', () => {
    const preview = createActionPreview({
      action: {
        action: 'click_element',
        description: 'Open the Events category',
        target: 'Events',
      },
      request: 'Help me finish this Scratch assignment.',
      screenPoint: { x: 120, y: 300 },
      screenRegion: { x: 80, y: 270, width: 80, height: 60 },
      taskId: 'task-2',
    });

    expect(preview).toMatchObject({
      classroom: true,
      message:
        'Next: Open the Events category. Why: This shows how the next part of the activity is reached.',
      screenPoint: { x: 120, y: 300 },
      screenRegion: { x: 80, y: 270, width: 80, height: 60 },
    });
    expect(preview.message.length).toBeLessThanOrEqual(240);
  });

  it('uses the trusted visible tutorial context when the request is implicit', () => {
    const preview = createActionPreview({
      action: {
        action: 'click_element',
        description: 'Open the Events category',
      },
      context: 'Scratch editor with the Getting Started tutorial visible.',
      request: 'Help me do this.',
      taskId: 'task-implicit',
    });

    expect(preview.classroom).toBe(true);
    expect(preview.message).toContain(' Why: ');
  });

  it('keeps long model descriptions inside the trusted callout limit', () => {
    const preview = createActionPreview({
      action: {
        action: 'type_text',
        description: 'Enter the visible answer '.repeat(30),
      },
      request: 'Complete this worksheet.',
      taskId: 'task-3',
    });

    expect(preview.message).toContain(' Why: ');
    expect(preview.message.length).toBeLessThanOrEqual(240);
  });
});
