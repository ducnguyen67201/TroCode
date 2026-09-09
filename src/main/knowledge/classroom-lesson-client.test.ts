import { describe, expect, it, vi } from 'vitest';

import { ClassroomLessonClient } from './classroom-lesson-client';
import { lessonFixture } from './classroom-lesson.fixture';
import { KnowledgeHttpClient, KnowledgeSpaceRequestError } from './knowledge-http-client';

describe('typed lesson HTTP client', () => {
  it.each([undefined, 2, 3])('negotiates plans without breaking older servers (version %s)', async (maxPlanVersion) => {
    const f = lessonFixture();
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => new Response(JSON.stringify(
      init?.method === 'POST' ? { ok: true } : {
        sessionId: f.context.sessionId, sessionState: 'open', serverTime: f.envelope.serverTime,
        maxSequence: 0, items: [], stoppedIds: [], ...(maxPlanVersion ? { maxPlanVersion } : {}),
      },
    )));
    const client = new ClassroomLessonClient(new KnowledgeHttpClient('https://stage.example', async () => 'test-token', fetcher));
    await client.feed(f.plan.targetRunId, 0);
    expect(fetcher.mock.calls[0]?.[0]).toContain('maxPlanVersion=3&afterSequence=0');
    await client.device(f.plan.targetRunId, f.envelope.lessonId, 'test-build', true);
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).lessonsVersion).toBe(maxPlanVersion ?? 1);
  });
  it('uses the authenticated lesson endpoint and validates responses', async () => {
    const f = lessonFixture();
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(f.context), { status: 200 }));
    const client = new ClassroomLessonClient(
      new KnowledgeHttpClient('https://stage.example/', async () => 'test-token', fetcher),
    );
    expect(await client.context(f.plan.targetRunId, f.context.sessionId, f.plan.targetRunId)).toEqual(f.context);
    expect(fetcher.mock.calls[0]![0]).toContain('/lesson-context?runId=');
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ headers: { Authorization: 'Bearer test-token' } });
    fetcher.mockResolvedValueOnce(new Response('{}'));
    await expect(client.context(f.plan.targetRunId, f.context.sessionId, f.plan.targetRunId)).rejects.toThrow();
  });
  it('preserves typed authorization errors instead of treating them as a text broadcast', async () => {
    const http = new KnowledgeHttpClient(
      'https://stage.example',
      async () => 'test-token',
      async () =>
        new Response(JSON.stringify({ code: 'lesson_stopped', error: 'Teacher stopped the lesson.' }), { status: 409 }),
    );
    const f = lessonFixture();
    const client = new ClassroomLessonClient(http);
    await expect(client.status(f.envelope.lessonId)).rejects.toBeInstanceOf(KnowledgeSpaceRequestError);
    await expect(client.status(f.envelope.lessonId)).rejects.toMatchObject({ code: 'lesson_stopped', status: 409 });
  });
});
