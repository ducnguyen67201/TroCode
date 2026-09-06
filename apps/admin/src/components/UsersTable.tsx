import type * as React from 'react';

import type { AdminUser } from '../api/contracts';
import { dateLabel, initials } from '../lib/formatters';
import type { RoleSaveState } from '../lib/role-save-state';
import { idleRoleState } from '../lib/role-save-state';

interface UsersTableProps {
  users: AdminUser[];
  roleStates: Record<string, RoleSaveState>;
  knowledgeBusyUserId: string;
  setGrantUser: React.Dispatch<React.SetStateAction<AdminUser | null>>;
  busyUserId: string;
  changeClassroomRole: (
    user: AdminUser,
    event: React.ChangeEvent<HTMLSelectElement>,
  ) => Promise<void>;
  changeKnowledgeSpacesAccess: (user: AdminUser) => Promise<void>;
  changeAccess: (user: AdminUser) => Promise<void>;
}

export function UsersTable({
  users,
  roleStates,
  knowledgeBusyUserId,
  setGrantUser,
  busyUserId,
  changeClassroomRole,
  changeKnowledgeSpacesAccess,
  changeAccess,
}: UsersTableProps) {
  return (
    <table className="users-table">
      <thead>
        <tr>
          <th scope="col">User</th>
          <th scope="col">Plan</th>
          <th scope="col">Classroom role</th>
          <th scope="col">Class workspaces</th>
          <th scope="col">Access code</th>
          <th scope="col">Last seen</th>
          <th scope="col">Status</th>
          <th scope="col">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => {
          const blocked = user.status === 'blocked';
          const roleState = roleStates[user.id] ?? idleRoleState;
          return (
            <tr key={user.id}>
              <td>
                <div className="user-cell">
                  <span className="avatar">
                    {initials(user.name, user.email)}
                  </span>
                  <span>
                    <span className="user-name">
                      {user.name || 'Unnamed user'}
                    </span>
                    <span className="user-email">{user.email}</span>
                  </span>
                </div>
              </td>
              <td>
                <span className={`plan-badge plan-badge--${user.plan}`}>
                  {user.plan}
                </span>
              </td>
              <td className="classroom-role-cell" data-label="Classroom role">
                <div
                  className={`classroom-role-control classroom-role-control--${user.classroomRole}`}
                  data-state={roleState.kind}
                >
                  <span className="classroom-role-control__mark">●</span>
                  <select
                    aria-label={`Classroom role for ${user.email}`}
                    className="classroom-role-select"
                    disabled={roleState.kind === 'saving'}
                    onChange={(event) => void changeClassroomRole(user, event)}
                    value={user.classroomRole}
                  >
                    <option value="unassigned">Unassigned</option>
                    <option value="teacher">Teacher</option>
                    <option value="student">Student</option>
                  </select>
                </div>
                <span
                  className={`classroom-role-save-state${roleState.kind === 'idle' ? '' : ` classroom-role-save-state--${roleState.kind}`}`}
                  role="status"
                >
                  {roleState.message}
                </span>
              </td>
              <td data-label="Class workspaces">
                <button
                  aria-pressed={user.knowledgeSpacesEnabled}
                  className={`row-action${user.knowledgeSpacesEnabled ? '' : ' row-action--block'}`}
                  disabled={knowledgeBusyUserId === user.id}
                  onClick={() => void changeKnowledgeSpacesAccess(user)}
                  type="button"
                >
                  {knowledgeBusyUserId === user.id
                    ? 'Saving…'
                    : user.knowledgeSpacesEnabled
                      ? 'Enabled'
                      : 'Disabled'}
                </button>
              </td>
              <td>
                {user.codeLabel ||
                  (user.accessCodeId ? 'Unlabelled code' : '—')}
              </td>
              <td>{dateLabel(user.lastSeenAt)}</td>
              <td>
                <span className={`status-badge status-badge--${user.status}`}>
                  {user.status}
                </span>
              </td>
              <td>
                <div className="code-actions">
                  {!user.accessCodeId && (
                    <button
                      className="row-action row-action--users"
                      disabled={blocked}
                      onClick={() => setGrantUser(user)}
                      title={
                        blocked
                          ? 'Unblock this user before granting a code.'
                          : undefined
                      }
                      type="button"
                    >
                      Grant code
                    </button>
                  )}
                  <button
                    className={`row-action${blocked ? '' : ' row-action--block'}`}
                    disabled={busyUserId === user.id}
                    onClick={() => void changeAccess(user)}
                    type="button"
                  >
                    {busyUserId === user.id
                      ? blocked
                        ? 'Unblocking…'
                        : 'Blocking…'
                      : blocked
                        ? 'Unblock'
                        : 'Block'}
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
