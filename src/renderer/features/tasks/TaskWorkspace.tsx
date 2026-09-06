import type * as React from 'react';

import type {
  AgentActivityUpdate,
  AppLanguage,
  OrganizationSummary,
  PendingInteraction,
  TaskSnapshot,
  VoiceMode,
  WorkspaceRuntimeAvailability,
  WorkspaceSelection,
} from '../../../shared/contracts';
import { type ActiveView } from '../../app-navigation';
import { BrandMark } from '../../BrandMark';
import type { PushToTalkPlatform } from '../../push-to-talk';
import { VoiceModeControl } from '../../VoiceModeControl';
import type { VoiceInputStatus } from '../voice/voice-input-types';

import { Conversation } from './Conversation';
import { EXAMPLE_TASKS } from './example-tasks';
import { LiveTaskRail } from './LiveTaskRail';
import { PendingInteractionCard } from './PendingInteractionCard';
import { voiceStatusMessage } from './task-presentation';
import { TerminalOutcome } from './TerminalOutcome';

interface TaskWorkspaceProps {
  hero: {
    state: string;
    eyebrow: string;
    heading: string;
    description: string;
  };
  organizationHomeBanner: { imageDataUrl: string } | null;
  t: (
    message: string,
    replacements?: Readonly<Record<string, string | number>>,
  ) => string;
  organization: OrganizationSummary | null;
  hasLiveTask: boolean;
  pendingInteraction: PendingInteraction | null;
  sendInput: (
    requestText?: string,
    options?: {
      screenContext?: 'auto' | 'required' | 'disabled';
      teacherClassroomSelectionId?: string | null;
    },
  ) => Promise<boolean>;
  pendingClarification: PendingInteraction | null;
  isSteering: boolean;
  voiceStatus: VoiceInputStatus;
  voiceMode: 'dictation' | 'task' | null;
  selectedVoiceMode: 'dictation' | 'task';
  appLanguageDraft: AppLanguage;
  voiceModeLocked: boolean;
  selectVoiceMode: (nextMode: VoiceMode) => void;
  voicePlatform: PushToTalkPlatform;
  taskRequestRef: React.RefObject<HTMLTextAreaElement | null>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  input: string;
  executionProfile: 'everyday' | 'workspace';
  setExecutionProfile: React.Dispatch<
    React.SetStateAction<'everyday' | 'workspace'>
  >;
  workspaceRuntime: WorkspaceRuntimeAvailability | null;
  isSelectingWorkspace: boolean;
  workspaceSelection: WorkspaceSelection | null;
  chooseWorkspace: () => Promise<void>;
  canSubmit: boolean | PendingInteraction;
  isSubmitting: boolean;
  snapshot: TaskSnapshot | null;
  agentActivities: AgentActivityUpdate[];
  agentActivity: AgentActivityUpdate | null;
  autoStartFailedTaskId: string | null;
  selectedTaskRuntimeReady: boolean;
  startTask: (taskId: string) => Promise<void>;
  streamingDraft: string;
  error: string | null;
  permissionWait: Extract<
    NonNullable<TaskSnapshot['lifecycle']>['waitingOn'],
    { kind: 'permission' }
  > | null;
  permissionPresentation: { body: string; title: string } | null;
  isTerminalTask: boolean;
  setActiveView: React.Dispatch<React.SetStateAction<ActiveView>>;
}

export function TaskWorkspace({
  hero,
  organizationHomeBanner,
  t,
  organization,
  hasLiveTask,
  pendingInteraction,
  sendInput,
  pendingClarification,
  isSteering,
  voiceStatus,
  voiceMode,
  selectedVoiceMode,
  appLanguageDraft,
  voiceModeLocked,
  selectVoiceMode,
  voicePlatform,
  taskRequestRef,
  setInput,
  input,
  executionProfile,
  setExecutionProfile,
  workspaceRuntime,
  isSelectingWorkspace,
  workspaceSelection,
  chooseWorkspace,
  canSubmit,
  isSubmitting,
  snapshot,
  agentActivities,
  agentActivity,
  autoStartFailedTaskId,
  selectedTaskRuntimeReady,
  startTask,
  streamingDraft,
  error,
  permissionWait,
  permissionPresentation,
  isTerminalTask,
  setActiveView,
}: TaskWorkspaceProps) {
  return (
    <section className="task-column">
      <section
        className={`agent-stage agent-stage--${hero.state} ${
          organizationHomeBanner ? 'agent-stage--organization-banner' : ''
        }`}
      >
        {organizationHomeBanner ? (
          <img
            alt={t('Announcement from {organization}', {
              organization: organization?.name ?? t('your organization'),
            })}
            className="agent-stage__organization-banner"
            src={organizationHomeBanner.imageDataUrl}
          />
        ) : (
          <>
            <div className={`hero-copy hero-copy--${hero.state}`}>
              <p className="eyebrow">{hero.eyebrow}</p>
              <h1>{hero.heading}</h1>
              <p>{hero.description}</p>
            </div>

            <div className="agent-stage__map" aria-hidden="true">
              <div className="agent-stage__orbit agent-stage__orbit--outer" />
              <div className="agent-stage__orbit agent-stage__orbit--inner" />
              <span className="agent-stage__node agent-stage__node--scope">
                {t('Outcome first')}
              </span>
              <span className="agent-stage__node agent-stage__node--act">
                {t('Act')}
              </span>
              <span className="agent-stage__node agent-stage__node--verify">
                {t('Success looks like')}
              </span>
              <span className="agent-stage__core">
                <BrandMark className="agent-stage__mark" />
                <i />
              </span>
            </div>
          </>
        )}
      </section>

      <form
        className={`task-composer ${hasLiveTask || pendingInteraction ? 'task-composer--compact' : ''}`}
        onSubmit={(event) => {
          event.preventDefault();
          void sendInput();
        }}
      >
        <label htmlFor="task-request">
          {pendingClarification
            ? t('Answer Tro to continue this task')
            : isSteering
              ? t('Steer the active task')
              : t('Describe the outcome')}
        </label>
        <div
          className={`voice-status voice-status--${voiceStatus} voice-status--${voiceMode ?? selectedVoiceMode}`}
        >
          <span aria-live="polite" className="voice-status__message">
            <span className="voice-indicator" aria-hidden="true" />
            <span>
              {voiceStatusMessage(voiceStatus, appLanguageDraft, voiceMode)}
            </span>
          </span>
          <VoiceModeControl
            appLanguage={appLanguageDraft}
            disabled={voiceModeLocked}
            mode={selectedVoiceMode}
            onChange={selectVoiceMode}
            platform={voicePlatform}
          />
        </div>
        <textarea
          id="task-request"
          ref={taskRequestRef}
          onChange={(event) => setInput(event.target.value)}
          placeholder={
            pendingClarification
              ? t('Type, dictate, or use Ask Tro to answer…')
              : isSteering
                ? t('Type, dictate, or give Tro a voice task…')
                : t(
                    'Type a task, or use Write my words to add text without sending…',
                  )
          }
          rows={hasLiveTask || pendingInteraction ? 2 : 4}
          value={input}
        />
        {!pendingClarification && !isSteering && (
          <div
            aria-label={t('Execution mode')}
            className="execution-profile-picker"
            role="group"
          >
            <button
              aria-pressed={executionProfile === 'everyday'}
              onClick={() => setExecutionProfile('everyday')}
              type="button"
            >
              <strong>{t('Everyday')}</strong>
              <span>{t('Apps, research, and routine desktop work')}</span>
            </button>
            {workspaceRuntime?.available && (
              <button
                aria-pressed={executionProfile === 'workspace'}
                disabled={isSelectingWorkspace}
                onClick={() => {
                  if (workspaceSelection && executionProfile !== 'workspace') {
                    setExecutionProfile('workspace');
                  } else {
                    void chooseWorkspace();
                  }
                }}
                type="button"
              >
                <strong>
                  {isSelectingWorkspace ? t('Choosing…') : t('Workspace')}
                </strong>
                <span>
                  {workspaceSelection
                    ? workspaceSelection.displayName
                    : t('Choose a trusted project folder')}
                </span>
              </button>
            )}
            {workspaceRuntime && !workspaceRuntime.available && (
              <p className="execution-profile-picker__unavailable">
                {workspaceRuntime.summary}
              </p>
            )}
          </div>
        )}
        <div className="composer-footer">
          <span>
            {pendingClarification
              ? t('This answer stays attached to the current task.')
              : isSteering
                ? t('Steering is reviewed at the next safe boundary.')
                : t(
                    'Tro will carry out this goal within the selected scope and pause only for clarification, system permission, or account access.',
                  )}
          </span>
          <button
            className="primary-button"
            disabled={!canSubmit}
            type="submit"
          >
            {isSubmitting
              ? t('Sending…')
              : pendingClarification
                ? t('Send answer')
                : isSteering
                  ? t('Send steering')
                  : t('Start task')}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </form>

      {!snapshot && (
        <div className="examples" aria-label={t('Example tasks')}>
          {EXAMPLE_TASKS.map((example) => (
            <button
              key={example}
              onClick={() => setInput(example)}
              type="button"
            >
              {t(example)}
            </button>
          ))}
        </div>
      )}

      {hasLiveTask && snapshot && (
        <LiveTaskRail
          activities={agentActivities.filter(
            (item) => item.taskId === snapshot.taskId,
          )}
          activity={
            agentActivity?.taskId === snapshot.taskId ? agentActivity : null
          }
          appLanguage={appLanguageDraft}
          autoStartFailed={autoStartFailedTaskId === snapshot.taskId}
          canStart={selectedTaskRuntimeReady}
          goal={snapshot.goal}
          isStarting={isSubmitting}
          lastEvent={snapshot.lastEvent}
          onRetry={() => void startTask(snapshot.taskId)}
          phase={snapshot.phase}
          progress={snapshot.progress}
          request={snapshot.request}
          streamingDraft={streamingDraft}
        />
      )}

      {error && (
        <div className="error-banner" role="alert">
          <strong>{t('Something needs attention')}</strong>
          <span>{error}</span>
        </div>
      )}

      {pendingInteraction && (
        <PendingInteractionCard
          appLanguage={appLanguageDraft}
          interaction={pendingInteraction}
          isSending={isSubmitting}
          onAnswerChoice={(answer) => void sendInput(answer)}
        />
      )}

      {permissionWait && permissionPresentation && snapshot && (
        <section className="pending-interaction" aria-live="polite">
          <div>
            <strong>{t(permissionPresentation.title)}</strong>
            <p>{t(permissionPresentation.body)}</p>
          </div>
          <div className="pending-interaction__actions">
            <button
              className="primary-button"
              onClick={() =>
                void window.tro.resolveComputerPermission({
                  taskId: snapshot.taskId,
                  action: 'open_system_settings',
                })
              }
              type="button"
            >
              {t('Open System Settings')}
            </button>
            <button
              className="secondary-button"
              onClick={() =>
                void window.tro.resolveComputerPermission({
                  taskId: snapshot.taskId,
                  action: 'continue_without_computer',
                })
              }
              type="button"
            >
              {t('Continue without computer')}
            </button>
          </div>
        </section>
      )}

      {hasLiveTask && snapshot && (
        <Conversation appLanguage={appLanguageDraft} snapshot={snapshot} />
      )}
      {isTerminalTask && snapshot && (
        <TerminalOutcome
          appLanguage={appLanguageDraft}
          onViewHistory={() => setActiveView('history')}
          snapshot={snapshot}
        />
      )}
    </section>
  );
}
