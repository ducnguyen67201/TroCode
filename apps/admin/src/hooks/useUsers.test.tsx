// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { adminApi } from '../api/adminApi';
import type { UsersResponse } from '../api/contracts';

import { useUsers } from './useUsers';

vi.mock('../api/adminApi', () => ({
  adminApi: { listUsers: vi.fn() },
  errorMessage: (error: Error) => error.message,
  isUnauthorized: (error: Error) => error.message === 'expired',
}));

describe('users query lifecycle', () => {
  let root: Root;
  let container: HTMLDivElement;
  let current: ReturnType<typeof useUsers>;
  const notify = vi.fn();
  const expire = vi.fn();

  function Harness() {
    current = useUsers({ active: false, notify, onSessionExpired: expire });
    return null;
  }

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('ignores an older response that arrives after the latest query', async () => {
    let first!: (value: UsersResponse) => void;
    let second!: (value: UsersResponse) => void;
    vi.mocked(adminApi.listUsers)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            first = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            second = resolve;
          }),
      );
    await act(async () => root.render(<Harness />));
    let oldRequest!: Promise<void>;
    let newRequest!: Promise<void>;
    await act(async () => {
      oldRequest = current.loadUsers();
      newRequest = current.loadUsers();
    });
    const response: UsersResponse = {
      items: [],
      page: { limit: 50, offset: 0, total: 2 },
      summary: { activeUsers: 2, blockedUsers: 0, totalUsers: 2 },
    };
    await act(async () => {
      second(response);
      await newRequest;
    });
    await act(async () => {
      first({ ...response, page: { ...response.page, total: 1 } });
      await oldRequest;
    });
    expect(current.response?.page.total).toBe(2);
    expect(current.loading).toBe(false);
  });

  it('expires the session on authorization failure and reports other failures', async () => {
    await act(async () => root.render(<Harness />));
    vi.mocked(adminApi.listUsers).mockRejectedValueOnce(new Error('expired'));
    await act(async () => current.loadUsers());
    expect(expire).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    vi.mocked(adminApi.listUsers).mockRejectedValueOnce(new Error('offline'));
    await act(async () => current.loadUsers());
    expect(notify).toHaveBeenCalledWith('offline');
    expect(current.loading).toBe(false);
  });
});
