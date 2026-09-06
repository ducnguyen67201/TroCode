// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import type { AdminUser } from '../api/contracts';

import { UsersTable } from './UsersTable';

it('routes row controls to the selected user and disables pending mutations', async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const user: AdminUser = {
    id: 'user-1',
    name: 'Teacher',
    email: 'teacher@example.com',
    accessCodeId: null,
    blockedAt: null,
    classroomRole: 'teacher',
    codeLabel: null,
    createdAt: '2026-09-06T00:00:00Z',
    lastSeenAt: null,
    knowledgeSpacesEnabled: true,
    plan: 'free',
    status: 'active',
  };
  const actions = {
    changeClassroomRole: vi.fn().mockResolvedValue(undefined),
    changeKnowledgeSpacesAccess: vi.fn().mockResolvedValue(undefined),
    changeAccess: vi.fn().mockResolvedValue(undefined),
    setGrantUser: vi.fn(),
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <UsersTable
          users={[user]}
          roleStates={{}}
          knowledgeBusyUserId=""
          busyUserId=""
          {...actions}
        />,
      ),
    );
    const select = container.querySelector('select')!;
    await act(async () => {
      select.value = 'student';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      for (const button of container.querySelectorAll('button')) button.click();
    });
    expect(actions.changeClassroomRole).toHaveBeenCalledWith(
      user,
      expect.anything(),
    );
    expect(actions.changeKnowledgeSpacesAccess).toHaveBeenCalledWith(user);
    expect(actions.changeAccess).toHaveBeenCalledWith(user);
    expect(actions.setGrantUser).toHaveBeenCalledWith(user);
    await act(async () =>
      root.render(
        <UsersTable
          users={[user]}
          roleStates={{ [user.id]: { kind: 'saving', message: 'Saving…' } }}
          knowledgeBusyUserId={user.id}
          busyUserId={user.id}
          {...actions}
        />,
      ),
    );
    expect(container.querySelector('select')?.disabled).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-pressed]')
        ?.disabled,
    ).toBe(true);
    expect(
      [...container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Blocking…',
      )?.disabled,
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
  }
});
