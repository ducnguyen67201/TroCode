import { describe, expect, it } from 'vitest';

import { InferenceSession } from './inference-session';

describe('InferenceSession', () => {
  it('tracks exact call IDs and makes screenshots single-use evidence', () => {
    const session = new InferenceSession({
      credential: 'secret',
      request: 'Inspect the screen.',
      responsesUrl: 'https://api.example.test/responses',
      taskId: 'task-1',
    });
    session.beginSample();
    session.recordTurn({
      call: { arguments: '{}', callId: 'call-1', name: 'observe_desktop' },
      kind: 'tool_call',
      responseItems: [],
    });
    expect(() =>
      session.appendToolOutput({ callId: 'wrong', output: '{}' }),
    ).toThrow('does not match');
    session.appendToolOutput({
      callId: 'call-1',
      output: [
        { type: 'input_text', text: 'fresh observation' },
        {
          detail: 'original',
          image_url: 'data:image/png;base64,aA==',
          type: 'input_image',
        },
      ],
    });
    const visualSample = session.beginSample();
    expect(visualSample.imageCount).toBe(1);
    session.recordTurn({ kind: 'assistant_message', responseItems: [], text: 'Done.' });
    expect(session.beginSample().imageCount).toBe(0);
  });
});
