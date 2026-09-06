// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import type {
  OrganizationMemberList,
  OrganizationSummary,
} from '../../../shared/contracts';
import type { DesktopApi } from '../../../shared/desktop-api';

import { useOrganizationMembers } from './use-organization-members';

it('ignores a pending roster response after organizer access is removed', async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const organization: OrganizationSummary = {
    capacity: {
      assignedSeats: 1,
      maxSeats: 10,
      remainingSeats: 9,
      state: 'available',
    },
    homeBanner: null,
    id: 'org',
    name: 'Class',
    plan: 'pro',
    role: 'organizer',
  };
  let resolveMembers!: (value: OrganizationMemberList) => void;
  const pending = new Promise<OrganizationMemberList>((resolve) => {
    resolveMembers = resolve;
  });
  const onOrganizationChange = vi.fn();
  const setNotice = vi.fn();
  const t = (message: string) => message;
  let current!: ReturnType<typeof useOrganizationMembers>;
  window.tro = {
    listOrganizationMembers: vi.fn(() => pending),
  } as unknown as DesktopApi;
  function Harness({ organizer }: { organizer: boolean }) {
    current = useOrganizationMembers({
      organization,
      organizationId: organization.id,
      isOrganizer: organizer,
      onOrganizationChange,
      setNotice,
      t,
    });
    return null;
  }
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<Harness organizer />));
    await act(async () => root.render(<Harness organizer={false} />));
    await act(async () =>
      resolveMembers({
        items: [],
        organization,
        page: { limit: 50, offset: 0, total: 9 },
      }),
    );
    expect(current.memberCount).toBe(0);
    expect(current.members).toEqual([]);
    expect(onOrganizationChange).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    element.remove();
  }
});
