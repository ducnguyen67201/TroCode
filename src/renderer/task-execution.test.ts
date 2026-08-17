import { describe, expect, it } from 'vitest';

import {
  isTaskCancellable,
  shouldAutoStartTask,
  shouldStopTaskForEscape,
} from './task-execution';

describe('task execution presentation policy', () => {
  it('auto-starts a ready task once execution dependencies are available', () => {
    expect(
      shouldAutoStartTask({ phase: 'ready' }, {
        agentReady: true,
        isBusy: false,
      }),
    ).toBe(true);
    expect(
      shouldAutoStartTask({ phase: 'ready' }, {
        agentReady: false,
        isBusy: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoStartTask({ phase: 'ready' }, {
        agentReady: true,
        isBusy: true,
      }),
    ).toBe(false);
    expect(
      shouldAutoStartTask({ phase: 'planning' }, {
        agentReady: true,
        isBusy: false,
      }),
    ).toBe(false);
  });

  it('treats every non-terminal task phase as cancellable', () => {
    expect(isTaskCancellable({ phase: 'ready' })).toBe(true);
    expect(isTaskCancellable({ phase: 'awaiting_approval' })).toBe(true);
    expect(isTaskCancellable({ phase: 'completed' })).toBe(false);
    expect(isTaskCancellable({ phase: 'failed' })).toBe(false);
    expect(isTaskCancellable({ phase: 'cancelled' })).toBe(false);
    expect(isTaskCancellable(null)).toBe(false);
  });

  it('uses a non-repeating Escape press to stop a cancellable task', () => {
    expect(
      shouldStopTaskForEscape(
        { key: 'Escape', repeat: false },
        { phase: 'observing' },
      ),
    ).toBe(true);
    expect(
      shouldStopTaskForEscape(
        { key: 'Escape', repeat: true },
        { phase: 'observing' },
      ),
    ).toBe(false);
    expect(
      shouldStopTaskForEscape(
        { key: 'Enter', repeat: false },
        { phase: 'observing' },
      ),
    ).toBe(false);
    expect(
      shouldStopTaskForEscape(
        { key: 'Escape', repeat: false },
        { phase: 'completed' },
      ),
    ).toBe(false);
  });
});
