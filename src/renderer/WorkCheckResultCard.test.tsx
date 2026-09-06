// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { workCheckFixture } from '../main/knowledge/work-check.fixture';

import { CompanionResponseCard } from './CompanionResponseCard';
import { WorkCheckResultCard } from './WorkCheckResultCard';

describe('assignment feedback surfaces', () => {
  it('shows scope, criterion titles and sync uncertainty without claiming a grade', () => {
    const f = workCheckFixture();
    const html = renderToStaticMarkup(
      <WorkCheckResultCard
        projection={{ phase: 'checked', report: f.report, message: null }}
        sync="unknown"
      />,
    );
    expect(html).toContain('Saved files only');
    expect(html).toContain('Repeat ten times');
    expect(html).toContain('not a grade');
    expect(html).toContain('Could not confirm progress sync');
    expect(html).not.toContain('for i in range');
  });
  it('translates fixed student feedback labels', () => {
    const f = workCheckFixture();
    const html = renderToStaticMarkup(
      <WorkCheckResultCard
        appLanguage="vi"
        projection={{ phase: 'checked', report: f.report, message: null }}
      />,
    );
    expect(html).toContain('Đã kiểm tra xong');
    expect(html).toContain('Chỉ các tệp đã lưu');
  });
  it('never captures number keys or opens the main app, and review needs a click', async () => {
    const f = workCheckFixture();
    const onAction = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const response = {
      cardId: f.packet.checkId,
      taskId: f.packet.taskId,
      message: 'Check finished.',
      phase: 'completed' as const,
      side: 'right' as const,
      workCheck: {
        assignmentTitle: 'Loops',
        projection: {
          phase: 'checked' as const,
          report: f.report,
          message: null,
        },
        busy: false,
        canCheck: true,
        canReview: true,
        needsWorkspace: false,
        submissionFiles: null,
        sync: null,
      },
    };
    await act(async () => {
      root.render(
        <CompanionResponseCard
          response={response}
          onAction={onAction}
          audioStatus={null}
        />,
      );
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2' }));
    expect(onAction).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Open task');
    const review = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Send for teacher review',
    );
    await act(async () => {
      review?.click();
    });
    expect(onAction).toHaveBeenCalledExactlyOnceWith('send_for_review');
    await act(async () => root.unmount());
    container.remove();
  });
});
