import type {
  AppLanguage,
  CuaStatus,
  TaskEvent,
  UsageBudgetSnapshot,
} from '../../../shared/contracts';
import { planTitle } from '../../usage-presentation';

import { ActivityList } from './ActivityList';
import { ComputerConnection } from './ComputerConnection';

interface TaskContextPanelProps {
  t: (
    message: string,
    replacements?: Readonly<Record<string, string | number>>,
  ) => string;
  displayedPlan: 'free' | 'basic' | 'pro' | 'max';
  usagePercent: number | null;
  usageBudget: UsageBudgetSnapshot | null;
  historyTaskCount: number;
  taskPhase: string;
  appLanguageDraft: AppLanguage;
  isRequestingPermissions: boolean;
  openScreenRecordingSettings: () => Promise<void>;
  desktopReady: boolean;
  computerStatus: CuaStatus;
  hasLiveTask: boolean;
  events: TaskEvent[];
}

export function TaskContextPanel({
  t,
  displayedPlan,
  usagePercent,
  usageBudget,
  historyTaskCount,
  taskPhase,
  appLanguageDraft,
  isRequestingPermissions,
  openScreenRecordingSettings,
  desktopReady,
  computerStatus,
  hasLiveTask,
  events,
}: TaskContextPanelProps) {
  return (
    <aside className="context-column">
      <section
        className="usage-overview"
        aria-labelledby="usage-overview-heading"
      >
        <div className="usage-overview__heading">
          <div>
            <p className="eyebrow">{t('Plan & weekly usage')}</p>
            <h2 id="usage-overview-heading">{planTitle(displayedPlan)}</h2>
          </div>
          <strong className="usage-overview__percent">
            {usagePercent === null
              ? '—'
              : t('{percent}% left', { percent: usagePercent })}
          </strong>
        </div>
        {usagePercent === null ? (
          <p className="usage-overview__detail">
            {t('Usage details unavailable')}
          </p>
        ) : (
          <>
            <div
              aria-label={t('Weekly usage')}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={usagePercent}
              aria-valuetext={t('{percent}% left', {
                percent: usagePercent,
              })}
              className="usage-overview__progress"
              role="progressbar"
            >
              <span style={{ width: `${usagePercent}%` }} />
            </div>
            <p className="usage-overview__detail">
              {t('{remaining} of {limit} messages left', {
                limit: usageBudget?.messages.limit ?? 0,
                remaining: usageBudget?.messages.remaining ?? 0,
              })}
            </p>
          </>
        )}
      </section>
      <section
        className="context-overview"
        aria-labelledby="session-overview-heading"
      >
        <p className="eyebrow">{t('Current app session')}</p>
        <div className="context-overview__metric">
          <strong>{historyTaskCount}</strong>
          <span>
            {t(
              historyTaskCount === 1
                ? '{count} finished task'
                : '{count} finished tasks',
              { count: historyTaskCount },
            ).replace(`${historyTaskCount} `, '')}
          </span>
        </div>
        <h2 id="session-overview-heading">{taskPhase}</h2>
        <div className="context-overview__guardrails">
          <span>{t('Goal-scoped execution')}</span>
          <span>{t('OS permissions enforced')}</span>
          <span>{t('Tools selected at runtime')}</span>
        </div>
      </section>
      <ComputerConnection
        appLanguage={appLanguageDraft}
        isConnecting={isRequestingPermissions}
        onConnect={() => void openScreenRecordingSettings()}
        ready={desktopReady}
        status={computerStatus}
      />
      {hasLiveTask && (
        <section
          className="activity-card"
          id="activity"
          aria-labelledby="activity-heading"
        >
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">{t('Live lifecycle')}</p>
              <h2 id="activity-heading">{t('Task activity')}</h2>
            </div>
            <span className="event-count">{events.length}</span>
          </div>
          <ActivityList appLanguage={appLanguageDraft} events={events} />
        </section>
      )}
    </aside>
  );
}
