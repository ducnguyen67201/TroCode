// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { KnowledgeClassSession } from '../shared/contracts';
import type { DesktopApi } from '../shared/desktop-api';

import { ClassSessionsPanel } from './ClassSessionsPanel';

vi.mock('./FacilitatorRunPage', () => ({
  FacilitatorRunPage: ({ onRunStateChanged }: {
    onRunStateChanged: (state: 'open' | 'closed') => Promise<void>;
  }) => <div>
    <button onClick={() => void onRunStateChanged('open')}>Start class</button>
    <button onClick={() => void onRunStateChanged('closed')}>End class</button>
  </div>,
}));

const SPACE = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';
const baseSession: KnowledgeClassSession = {
  id: SESSION, title: 'Practice session', state: 'draft',
  createdAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:00Z',
  activities: [{ position: 0, runId: RUN, activityVersionId: SESSION,
    title: 'Practice', objective: 'Learn a skill', criteria: [],
    allowRoomJoin: true, allowedOrigins: [] }],
};

describe('Session lobby navigation', () => {
  let root: Root;
  let container: HTMLDivElement;
  let session: KnowledgeClassSession;
  beforeEach(() => {
    session = { ...baseSession };
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    window.tro = {
      listPublishedKnowledgeActivities: vi.fn().mockResolvedValue({ items: [] }),
      listKnowledgeClassSessions: vi.fn(async () => ({ items: [session] })),
      createKnowledgeRoomCode: vi.fn().mockResolvedValue(null),
    } as unknown as DesktopApi;
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });
  async function render() {
    await act(async () => root.render(<ClassSessionsPanel
      appLanguage="en" canFacilitate refreshToken={0} spaceId={SPACE}
      onTeacherSessionSelect={async (_, id) => {
        if (id) session = { ...session, state: 'open' };
      }} />));
  }
  const button = (text: string) => Array.from(container.querySelectorAll('button'))
    .find((item) => item.textContent?.includes(text))!;

  it('opens and reopens a lobby without claiming the class is live or rotating its code', async () => {
    await render();
    expect(container.textContent).toContain('Room lobby');
    expect(container.textContent).not.toContain('Start live');
    await act(async () => button('Open lobby').click());
    expect(window.tro.createKnowledgeRoomCode).toHaveBeenCalledWith(expect.objectContaining({
      spaceId: SPACE, runId: RUN, reuseActive: true,
    }));
    await act(async () => button('All Sessions').click());
    expect(button('Open lobby')).toBeDefined();
    await act(async () => button('Open lobby').click());
    expect(vi.mocked(window.tro.createKnowledgeRoomCode).mock.calls.every(
      ([request]) => request.reuseActive === true,
    )).toBe(true);
  });

  it('shows Open live after class starts and the teacher returns to the list', async () => {
    await render();
    await act(async () => button('Open lobby').click());
    await act(async () => button('Start class').click());
    await act(async () => button('All Sessions').click());
    expect(container.textContent).toContain('Live');
    expect(button('Open live')).toBeDefined();
    expect(container.textContent).not.toContain('Open lobby');
  });

  it('reads the live state on remount and only reviews ended sessions', async () => {
    session = { ...session, state: 'open' };
    await render();
    expect(button('Open live')).toBeDefined();
    await act(async () => root.unmount());
    root = createRoot(container);
    session = { ...session, state: 'closed' };
    await render();
    expect(container.textContent).toContain('Ended');
    await act(async () => button('Review').click());
    expect(window.tro.createKnowledgeRoomCode).not.toHaveBeenCalled();
  });
});
