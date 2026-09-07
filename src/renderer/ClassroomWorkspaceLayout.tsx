import { useState, type ReactNode } from 'react';

import type { AppLanguage } from '../shared/contracts';

import './styles/classroom-workspace.css';

export function ClassroomWorkspaceLayout({
  appLanguage,
  enabled,
  sidebar,
  children,
}: {
  appLanguage: AppLanguage;
  enabled: boolean;
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const vi = appLanguage === 'vi';
  return (
    <div
      className={
        enabled ? 'classroom-workspace' : 'classroom-workspace--horizontal'
      }
    >
      <div className="classroom-workspace__main">{children}</div>
      <aside
        className="classroom-workspace__rail"
        aria-label={vi ? 'Cập nhật lớp học' : 'Class updates'}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            setOpen(false);
            event.currentTarget
              .querySelector<HTMLButtonElement>('button')
              ?.focus();
          }
        }}
      >
        <button
          className="classroom-workspace__toggle"
          type="button"
          aria-expanded={open}
          aria-controls="classroom-updates"
          onClick={() => setOpen(!open)}
        >
          {open
            ? vi
              ? 'Đóng cập nhật'
              : 'Close updates'
            : vi
              ? 'Cập nhật lớp học'
              : 'Class updates'}
          <span aria-hidden="true">{open ? '×' : '☰'}</span>
        </button>
        <div
          id="classroom-updates"
          className={`classroom-workspace__updates${open ? ' is-open' : ''}`}
        >
          <h2>{vi ? 'Cập nhật lớp học' : 'Class updates'}</h2>
          {sidebar}
        </div>
      </aside>
    </div>
  );
}
