import { describe, expect, it } from 'vitest';

import { BoundedAgentSession } from './bounded-agent-session';

function visualResult(callId: string) {
  return {
    type: 'function_call_result' as const,
    name: 'observe_desktop',
    callId,
    status: 'completed' as const,
    output: [
      { type: 'input_text' as const, text: 'screen' },
      {
        type: 'input_image' as const,
        image: 'data:image/png;base64,aA==',
      },
    ],
  };
}

describe('BoundedAgentSession', () => {
  it('keeps only the newest screenshot while preserving text history', async () => {
    const session = new BoundedAgentSession('task-1');
    await session.addItems([visualResult('call-1')]);
    await session.addItems([visualResult('call-2')]);

    const items = await session.getItems();
    expect(JSON.stringify(items[0])).not.toContain('data:image');
    expect(JSON.stringify(items[0])).toContain('screen');
    expect(JSON.stringify(items[1])).toContain('data:image');
  });

  it('returns defensive history copies and supports pop and clear', async () => {
    const session = new BoundedAgentSession('task-1');
    await session.addItems([
      { role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
    ]);
    const first = await session.getItems();
    first.splice(0);
    expect(await session.getItems()).toHaveLength(1);
    expect(await session.popItem()).toBeDefined();
    await session.clearSession();
    expect(await session.getItems()).toEqual([]);
  });
});
