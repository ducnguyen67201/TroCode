import { describe, expect, it, vi } from 'vitest';

import type { TaskUpdate } from '../../shared/contracts';

import { ActivityProgressReporter } from './activity-progress-reporter';

function update(phase: TaskUpdate['snapshot']['phase']): TaskUpdate {
  const taskId = '00000000-0000-4000-8000-000000000001';
  const timestamp = '2026-08-25T00:00:00.000Z';
  return {
    snapshot: {
      taskId, request: 'Help with loops.', phase, goal: null, messages: [],
      pendingInteraction: null, progress: null,
      queuedSteering: [], runtimeResume: null, createdAt: timestamp, updatedAt: timestamp, lastEvent: null,
    },
    event: {
      eventId: '00000000-0000-4000-8000-000000000002', taskId, phase,
      timestamp, status: 'success', summary: 'Updated.', nextActions: [], artifacts: [],
    },
  };
}

describe('ActivityProgressReporter', () => {
  it('maps terminal blocked to paused and stops later session updates', async () => {
    const updateWorkSession = vi.fn(async () => undefined);
    const now = 20_000;
    const reporter = new ActivityProgressReporter({ updateWorkSession }, () => now);
    reporter.bind('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003');
    await reporter.report(update('blocked'));
    expect(updateWorkSession).toHaveBeenLastCalledWith('00000000-0000-4000-8000-000000000003', { state: 'paused' });
    await reporter.report(update('completed'));
    expect(updateWorkSession).toHaveBeenCalledOnce();
  });

  it('marks a bound Work Session failed when task creation aborts', async () => {
    const updateWorkSession = vi.fn(async () => undefined);
    const reporter = new ActivityProgressReporter({ updateWorkSession });
    reporter.bind(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000003',
    );

    await reporter.fail('00000000-0000-4000-8000-000000000001');
    await reporter.fail('00000000-0000-4000-8000-000000000001');

    expect(updateWorkSession).toHaveBeenCalledOnce();
    expect(updateWorkSession).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000003',
      { state: 'failed' },
    );
  });
});

it('serializes active before terminal and publishes confirmed sync', async () => {
  let release!: () => void;
  const updateWorkSession = vi.fn().mockImplementationOnce(() => new Promise<void>(r => {release=r;})).mockResolvedValue(undefined);
  const sync=vi.fn(); const reporter=new ActivityProgressReporter({updateWorkSession},Date.now,sync);
  const taskId=update('planning').snapshot.taskId; reporter.bind(taskId,'session');
  const active=reporter.report(update('planning')); const terminal=reporter.report(update('completed'));
  await Promise.resolve(); expect(updateWorkSession).toHaveBeenCalledOnce(); release(); await Promise.all([active,terminal]);
  expect(updateWorkSession.mock.calls.map(call=>call[1].state)).toEqual(['active','completed']);
  expect(sync).toHaveBeenLastCalledWith(taskId,'synced');
});
it('stops queued mutations after uncertainty or account clear', async () => {
  for (const clear of [false,true]) {
    let reject!: (reason:Error)=>void;
    const updateWorkSession=vi.fn(()=>new Promise<void>((_,r)=>{reject=r;})); const sync=vi.fn();
    const reporter=new ActivityProgressReporter({updateWorkSession},Date.now,sync); const taskId=update('planning').snapshot.taskId;
    reporter.bind(taskId,'session'); const active=reporter.report(update('planning')); const terminal=reporter.report(update('completed'));
    await Promise.resolve(); if(clear) reporter.clear(); reject(new Error('lost response')); await Promise.all([active,terminal]);
    expect(updateWorkSession).toHaveBeenCalledOnce();
    if(!clear) expect(sync).toHaveBeenLastCalledWith(taskId,'unknown');
    else expect(sync).toHaveBeenCalledTimes(1);
  }
});
