import { useCallback, useEffect, useRef, useState } from 'react';

import { adminApi, errorMessage, isUnauthorized } from '../api/adminApi';
import type { UsersResponse } from '../api/contracts';
import { PAGE_SIZE } from '../lib/user-pagination';

import { useDebouncedValue } from './useDebouncedValue';

export function useUsers({
  onSessionExpired,
  notify,
  active,
}: {
  onSessionExpired: () => void;
  notify: (message: string) => void;
  active: boolean;
}) {
  const [classroomRole, setClassroomRole] = useState('');

  const [loading, setLoading] = useState(true);

  const [response, setResponse] = useState<UsersResponse | null>(null);

  const [search, setSearch] = useState('');

  const [status, setStatus] = useState('');

  const debouncedSearch = useDebouncedValue(search.trim(), 260);

  const itemCountRef = useRef(0);

  const requestSequence = useRef(0);

  useEffect(() => {
    itemCountRef.current = response?.items.length ?? 0;
  }, [response?.items.length]);

  const loadUsers = useCallback(
    async (append = false) => {
      const requestId = ++requestSequence.current;
      setLoading(true);
      try {
        const result = await adminApi.listUsers({
          classroomRole,
          limit: PAGE_SIZE,
          offset: append ? itemCountRef.current : 0,
          search: debouncedSearch,
          status,
        });
        if (requestId !== requestSequence.current) return;
        setResponse((current) => ({
          ...result,
          items:
            append && current
              ? [...current.items, ...result.items]
              : result.items,
        }));
      } catch (caught) {
        if (requestId !== requestSequence.current) return;
        if (isUnauthorized(caught)) {
          onSessionExpired();
          return;
        }
        notify(errorMessage(caught));
      } finally {
        if (requestId === requestSequence.current) setLoading(false);
      }
    },
    [classroomRole, debouncedSearch, notify, onSessionExpired, status],
  );

  useEffect(() => {
    if (!active) return;
    const timeout = window.setTimeout(() => void loadUsers(), 0);
    return () => window.clearTimeout(timeout);
  }, [active, loadUsers]);

  return {
    loadUsers,
    setResponse,
    response,
    loading,
    setSearch,
    search,
    setClassroomRole,
    classroomRole,
    setStatus,
    status,
  };
}
