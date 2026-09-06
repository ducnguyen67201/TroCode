import { type ChangeEvent, useState } from 'react';

import { adminApi, errorMessage, isUnauthorized } from '../api/adminApi';
import type { AdminUser, ClassroomRole } from '../api/contracts';
import { EmptyState } from '../components/EmptyState';
import { GrantCodeDialog } from '../components/GrantCodeDialog';
import { SummaryCard } from '../components/SummaryCard';
import { UsersTable } from '../components/UsersTable';
import { useUsers } from '../hooks/useUsers';
import type { RoleSaveState } from '../lib/role-save-state';

interface UsersPageProps {
  active: boolean;
  notify: (message: string) => void;
  onCreateCodes: () => void;
  onSessionExpired: () => void;
}

export function UsersPage({
  active,
  notify,
  onCreateCodes,
  onSessionExpired,
}: UsersPageProps) {
  const [busyUserId, setBusyUserId] = useState('');
  const [knowledgeBusyUserId, setKnowledgeBusyUserId] = useState('');
  const {
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
  } = useUsers({ onSessionExpired, notify, active });

  const [grantUser, setGrantUser] = useState<AdminUser | null>(null);
  const [roleStates, setRoleStates] = useState<Record<string, RoleSaveState>>(
    {},
  );

  async function changeAccess(user: AdminUser) {
    const blocked = user.status !== 'blocked';
    if (
      blocked &&
      !window.confirm(
        `Block ${user.email}? Their active sessions will be revoked immediately.`,
      )
    ) {
      return;
    }
    setBusyUserId(user.id);
    try {
      await adminApi.blockUser(user.id, blocked);
      await loadUsers();
      notify(`${user.email} is now ${blocked ? 'blocked' : 'active'}.`);
    } catch (caught) {
      if (isUnauthorized(caught)) {
        onSessionExpired();
        return;
      }
      notify(errorMessage(caught));
    } finally {
      setBusyUserId('');
    }
  }

  async function changeClassroomRole(
    user: AdminUser,
    event: ChangeEvent<HTMLSelectElement>,
  ) {
    const role = event.target.value as ClassroomRole;
    const previousRole = user.classroomRole;
    setRoleStates((current) => ({
      ...current,
      [user.id]: { kind: 'saving', message: 'Saving…' },
    }));
    setResponse((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              item.id === user.id ? { ...item, classroomRole: role } : item,
            ),
          }
        : current,
    );
    try {
      await adminApi.setClassroomRole(user.id, role);
      setRoleStates((current) => ({
        ...current,
        [user.id]: { kind: 'saved', message: 'Saved' },
      }));
      notify(
        `${user.email} is now ${role === 'unassigned' ? 'unassigned' : `a ${role}`}.`,
      );
    } catch (caught) {
      setResponse((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === user.id
                  ? { ...item, classroomRole: previousRole }
                  : item,
              ),
            }
          : current,
      );
      setRoleStates((current) => ({
        ...current,
        [user.id]: {
          kind: 'error',
          message: 'Not saved',
        },
      }));
      if (isUnauthorized(caught)) {
        onSessionExpired();
        return;
      }
      notify(errorMessage(caught));
    }
  }

  async function changeKnowledgeSpacesAccess(user: AdminUser) {
    const enabled = !user.knowledgeSpacesEnabled;
    setKnowledgeBusyUserId(user.id);
    try {
      await adminApi.setKnowledgeSpacesEnabled(user.id, enabled);
      setResponse((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === user.id
                  ? { ...item, knowledgeSpacesEnabled: enabled }
                  : item,
              ),
            }
          : current,
      );
      notify(
        `Class workspaces are now ${enabled ? 'enabled' : 'disabled'} for ${user.email}.`,
      );
    } catch (caught) {
      if (isUnauthorized(caught)) {
        onSessionExpired();
        return;
      }
      notify(errorMessage(caught));
    } finally {
      setKnowledgeBusyUserId('');
    }
  }

  const users = response?.items ?? [];
  const total = response?.page.total ?? 0;
  const summary = response?.summary;

  return (
    <section className="page-view" hidden={!active} id="users-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Workspace access</p>
          <h1>Users</h1>
          <p className="page-subtitle">
            Assign classroom roles, plans, and product access.
          </p>
        </div>
        <button
          className="button button--primary"
          onClick={onCreateCodes}
          type="button"
        >
          <span aria-hidden="true">＋</span>
          New code
        </button>
      </header>

      <section className="summary-grid" aria-label="User summary">
        <SummaryCard
          foot="All registered accounts"
          label="Total users"
          value={summary?.totalUsers ?? '—'}
        />
        <SummaryCard
          foot="Can access Tro"
          footKind="good"
          label="Active"
          value={summary?.activeUsers ?? '—'}
        />
        <SummaryCard
          foot="Access disabled"
          footKind="warning"
          label="Blocked"
          value={summary?.blockedUsers ?? '—'}
        />
      </section>

      <aside className="classroom-flow-note" aria-label="Classroom setup flow">
        <div className="classroom-flow-note__copy">
          <span className="classroom-flow-note__mark" aria-hidden="true">
            ↗
          </span>
          <div>
            <strong>Classroom setup</strong>
            <span>
              Set a role here before a teacher adds this account to a class.
            </span>
          </div>
        </div>
        <ol>
          <li>
            <span>1</span> Account created
          </li>
          <li>
            <span>2</span> Role assigned
          </li>
          <li>
            <span>3</span> Added to class
          </li>
        </ol>
      </aside>

      <section className="table-card" aria-labelledby="users-table-title">
        <div className="table-toolbar">
          <div>
            <h2 id="users-table-title">All accounts</h2>
            <p>
              {loading
                ? 'Loading accounts…'
                : `${total.toLocaleString()} matching account${total === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className="toolbar-controls">
            <label className="search-field">
              <span className="filter-field__label">Search</span>
              <span aria-hidden="true">⌕</span>
              <span className="sr-only">Search users</span>
              <input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name or email"
                type="search"
                value={search}
              />
            </label>
            <label className="filter-field">
              <span className="filter-field__label">Class role</span>
              <select
                onChange={(event) => setClassroomRole(event.target.value)}
                value={classroomRole}
              >
                <option value="">All roles</option>
                <option value="unassigned">Unassigned</option>
                <option value="teacher">Teacher</option>
                <option value="student">Student</option>
              </select>
            </label>
            <label className="filter-field">
              <span className="filter-field__label">Status</span>
              <select
                onChange={(event) => setStatus(event.target.value)}
                value={status}
              >
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="blocked">Blocked</option>
              </select>
            </label>
          </div>
        </div>
        {users.length ? (
          <div className="table-scroll">
            <UsersTable
              users={users}
              roleStates={roleStates}
              knowledgeBusyUserId={knowledgeBusyUserId}
              setGrantUser={setGrantUser}
              busyUserId={busyUserId}
              changeClassroomRole={changeClassroomRole}
              changeKnowledgeSpacesAccess={changeKnowledgeSpacesAccess}
              changeAccess={changeAccess}
            />
          </div>
        ) : (
          !loading && (
            <EmptyState
              detail="Try a different search or status filter."
              icon="◎"
              title="No users found"
            />
          )
        )}
        <div className="table-footer">
          <span>
            {users.length
              ? `Showing 1–${users.length} of ${total}`
              : 'No accounts to show'}
          </span>
          {users.length < total && (
            <button
              className="button button--secondary"
              disabled={loading}
              onClick={() => void loadUsers(true)}
              type="button"
            >
              Load more
            </button>
          )}
        </div>
      </section>

      {grantUser && (
        <GrantCodeDialog
          notify={notify}
          onClose={() => setGrantUser(null)}
          onGranted={() => loadUsers()}
          onSessionExpired={onSessionExpired}
          user={grantUser}
        />
      )}
    </section>
  );
}
