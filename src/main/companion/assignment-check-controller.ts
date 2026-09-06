import { randomUUID } from 'node:crypto';

import {
  CompanionResponseCardSchema,
  WorkCheckActionSchema,
  type CompanionResponseCard,
  type CompanionResponseActionRequest,
  type HostedAttemptContext,
  type KnowledgeFileSelection,
  type TaskSnapshot,
} from '../../shared/contracts';
import type { TaskApplicationService } from '../application/task-application-service';
import type { ClassroomSessionService } from '../knowledge/classroom-session-service';
import type { FileSelectionService } from '../knowledge/file-selection-service';
import type { KnowledgeSpaceClient } from '../knowledge/knowledge-space-client';
import type { KnowledgeUploadOrchestrator } from '../knowledge/knowledge-upload-service';
import type { WorkspaceSelectionService } from '../workspace/workspace-selection-service';

interface Options {
  language?(): Promise<'en' | 'vi'>;
  owner(): Promise<string>;
  session: Pick<
    ClassroomSessionService,
    'get' | 'updateAttemptState' | 'restore'
  >;
  client: Pick<
    KnowledgeSpaceClient,
    'getAttempt' | 'readyAttempt' | 'acknowledgeAttempt'
  >;
  tasks: Pick<TaskApplicationService, 'submitAndStart' | 'cancel'>;
  workspaces: Pick<WorkspaceSelectionService, 'select'>;
  files: Pick<FileSelectionService, 'select'>;
  uploads: Pick<KnowledgeUploadOrchestrator, 'submit'>;
  present(card: CompanionResponseCard): void;
  dismiss(): void;
}
interface Binding {
  owner: string;
  attempt: HostedAttemptContext;
  card: CompanionResponseCard;
  workspaceSelectionId: string | null;
  submission: KnowledgeFileSelection | null;
  runningTaskId: string | null;
  uncertainMutation: boolean;
}

/** Only explicit overlay gestures can request review or upload selected files. */
export class AssignmentCheckController {
  private binding: Binding | null = null;
  private busy = false;
  private hidden = false;
  private generation = 0;
  constructor(private readonly options: Options) {}
  clear(): void {
    this.generation++;
    this.binding = null;
    this.busy = false;
  }
  dismiss(): void {
    this.hidden = true;
  }
  owns(cardId: string, taskId: string): boolean {
    return (
      this.binding?.card.cardId === cardId &&
      this.binding.card.taskId === taskId
    );
  }
  async show(
    message = 'Press ⌘⌥K / Ctrl+Alt+K to check your assignment.',
  ): Promise<void> {
    this.hidden = false;
    try {
      const binding = await this.resolve();
      this.publish(binding, message);
    } catch {
      /* No eligible classroom binding; do not inspect unrelated work. */
    }
  }
  async check(): Promise<void> {
    if (this.busy || this.binding?.runningTaskId) return;
    this.hidden = false;
    this.busy = true;
    let binding: Binding | null = null;
    try {
      binding = await this.resolve();
      await this.validate(binding);
      if (
        binding.attempt.definition.launchTarget === 'workspace' &&
        !binding.workspaceSelectionId
      ) {
        this.publish(binding, 'Choose the saved project folder to check.');
        return;
      }
      if (
        binding.attempt.run.insightPolicy === 'evidence_candidates' &&
        binding.attempt.acknowledgedPolicyVersion !==
          binding.attempt.run.insightPolicyVersion
      ) {
        this.publish(
          binding,
          'This class permits bounded evidence suggestions for teacher review. Use Start working to acknowledge this policy before checking.',
        );
        return;
      }
      const task = await this.options.tasks.submitAndStart({
        activityAttemptId: binding.attempt.attemptId,
        activityIntent: 'check',
        requestedMode: 'coach',
        screenContext: 'auto',
        executionProfile:
          binding.attempt.definition.launchTarget === 'workspace'
            ? 'workspace'
            : 'everyday',
        workspaceSelectionId: binding.workspaceSelectionId,
        text:
          binding.card.workCheck?.language === 'vi'
            ? 'Kiểm tra bài làm theo tiêu chí giáo viên. Giải thích bằng tiếng Việt điều đã đạt, điều cần chỉnh sửa và điều chưa thể xác minh.'
            : 'Check my current work against the published criteria. Explain what looks correct, what needs work, and what you cannot verify.',
      });
      if (this.binding !== binding) {
        await this.options.tasks.cancel({
          taskId: task.taskId,
          source: 'replacement',
        });
        return;
      }
      // A fast completion may already have been projected by the task-update listener.
      if (binding.card.taskId !== task.taskId) {
        binding.runningTaskId = task.taskId;
        binding.card = { ...binding.card, taskId: task.taskId };
        this.publish(binding, 'Checking your assignment…');
      }
    } catch (error) {
      if (binding && this.binding === binding)
        this.publish(
          binding,
          error instanceof Error
            ? error.message.slice(0, 1200)
            : 'Check unavailable.',
        );
    } finally {
      this.busy = false;
      if (binding && this.binding === binding)
        this.publish(binding, binding.card.message);
    }
  }
  update(snapshot: TaskSnapshot): void {
    const binding = this.binding;
    const activity = snapshot.goal?.activity;
    if (
      !binding ||
      !activity ||
      activity.purpose !== 'check' ||
      activity.attemptId !== binding.attempt.attemptId ||
      activity.activityVersionId !== binding.attempt.activityVersionId
    )
      return;
    if (binding.runningTaskId && binding.runningTaskId !== snapshot.taskId)
      return;
    if (
      !this.busy &&
      !binding.runningTaskId &&
      binding.card.taskId !== snapshot.taskId
    )
      return;
    const terminal = ['completed', 'cancelled', 'failed', 'blocked'].includes(
      snapshot.phase,
    );
    binding.runningTaskId = terminal ? null : snapshot.taskId;
    binding.card = {
      ...binding.card,
      taskId: snapshot.taskId,
      workCheck: {
        ...binding.card.workCheck!,
        projection: snapshot.workCheck ?? null,
        sync: snapshot.workSessionSync ?? null,
      },
    };
    this.publish(
      binding,
      (snapshot.workCheck?.report ? 'Check finished.' : null) ??
        snapshot.workCheck?.message ??
        (terminal ? 'Check finished.' : 'Checking your assignment…'),
    );
  }
  async action(request: CompanionResponseActionRequest): Promise<void> {
    const action = WorkCheckActionSchema.parse(request.action);
    const binding = this.binding;
    if (!binding || !this.owns(request.cardId, request.taskId))
      throw new Error('That assignment panel expired.');
    if (action === 'stop_check') {
      if (binding.runningTaskId)
        await this.options.tasks.cancel({
          taskId: binding.runningTaskId,
          source: 'stop_button',
        });
      return;
    }
    if (this.busy || binding.runningTaskId) return;
    if (action === 'check_again') return this.check();
    this.busy = true;
    try {
      await this.validate(binding);
      if (action === 'choose_check_workspace') {
        const selected = await this.options.workspaces.select();
        await this.validate(binding);
        binding.workspaceSelectionId =
          selected?.selectionId ?? binding.workspaceSelectionId;
        this.publish(
          binding,
          selected
            ? `Saved project selected: ${selected.displayName}. Press the check shortcut when ready.`
            : 'Folder selection cancelled.',
        );
      } else if (action === 'start_assignment') {
        if (
          binding.attempt.run.insightPolicy === 'evidence_candidates' &&
          binding.attempt.acknowledgedPolicyVersion !==
            binding.attempt.run.insightPolicyVersion
        ) {
          await this.options.client.acknowledgeAttempt(
            binding.attempt.attemptId,
            binding.attempt.run.insightPolicyVersion,
          );
          await this.validate(binding);
        }
        if (
          binding.attempt.definition.launchTarget === 'workspace' &&
          !binding.workspaceSelectionId
        ) {
          this.publish(binding, 'Choose your project folder first.');
          return;
        }
        await this.options.tasks.submitAndStart({
          activityAttemptId: binding.attempt.attemptId,
          activityIntent: 'work',
          requestedMode: 'coach',
          screenContext: 'auto',
          executionProfile:
            binding.attempt.definition.launchTarget === 'workspace'
              ? 'workspace'
              : 'everyday',
          workspaceSelectionId: binding.workspaceSelectionId,
          text: 'Help me start practising this assignment. Guide me without doing my work.',
        });
        this.publish(
          binding,
          'Practice started. Use the check shortcut when you are ready.',
        );
      } else if (
        action === 'choose_submission_files' ||
        (action === 'send_for_review' &&
          binding.attempt.definition.completionPolicy.requiresSubmission)
      ) {
        if (binding.uncertainMutation)
          throw new Error(
            'A previous submission outcome is unknown. Refresh your classroom session before trying again.',
          );
        const selection = await this.options.files.select({
          role: 'submission',
          selectionKind: 'files',
        });
        await this.validate(binding);
        binding.submission = selection;
        this.publish(
          binding,
          selection
            ? 'Review these files, then select Submit files to send them to your teacher.'
            : 'File selection cancelled.',
        );
      } else if (action === 'confirm_submit_files') {
        if (
          !binding.submission ||
          binding.uncertainMutation ||
          !binding.attempt.definition.completionPolicy.requiresSubmission
        )
          throw new Error('No reviewed submission is available.');
        binding.uncertainMutation = true;
        const result = await this.options.uploads.submit(
          binding.attempt.attemptId,
          binding.submission.selectionId,
        );
        if (this.binding !== binding) return;
        if (result.cancelled) {
          binding.uncertainMutation = false;
          this.publish(binding, 'Submission cancelled.');
          return;
        }
        binding.submission = null;
        binding.uncertainMutation = false;
        binding.attempt.state = 'submitted';
        this.options.session.updateAttemptState('submitted');
        this.publish(binding, 'Submitted. Waiting for teacher review.');
      } else if (action === 'send_for_review') {
        if (binding.uncertainMutation)
          throw new Error(
            'The previous review request has an unknown outcome. Refresh your classroom session first.',
          );
        binding.uncertainMutation = true;
        const result = await this.options.client.readyAttempt(
          binding.attempt.attemptId,
          randomUUID(),
        );
        if (this.binding !== binding) return;
        binding.uncertainMutation = false;
        binding.attempt.state = result.state;
        this.options.session.updateAttemptState(result.state);
        this.publish(binding, 'Waiting for teacher review.');
      }
    } catch (error) {
      if (this.binding === binding)
        this.publish(
          binding,
          binding.uncertainMutation
            ? 'Could not confirm the review request. It will not be sent again automatically.'
            : error instanceof Error
              ? error.message.slice(0, 1200)
              : 'This action could not be completed.',
        );
    } finally {
      this.busy = false;
      if (this.binding === binding) this.publish(binding, binding.card.message);
    }
  }
  private async resolve(): Promise<Binding> {
    const generation = this.generation;
    const session = this.options.session.get();
    const owner = await this.options.owner();
    const language = (await this.options.language?.()) ?? 'en';
    if (
      !session ||
      session.leftAt ||
      session.role !== 'student' ||
      session.run.state !== 'open'
    )
      throw new Error('Join an open class assignment first.');
    const attempt = await this.options.client.getAttempt(session.attemptId);
    const current = this.options.session.get();
    if (
      generation !== this.generation ||
      current?.attemptId !== session.attemptId ||
      current.activityVersionId !== attempt.activityVersionId ||
      (await this.options.owner()) !== owner
    )
      throw new Error('The classroom assignment changed.');
    if (
      this.binding?.owner === owner &&
      this.binding.attempt.attemptId === attempt.attemptId &&
      this.binding.attempt.activityVersionId === attempt.activityVersionId
    ) {
      this.binding.attempt = attempt;
      return this.binding;
    }
    const card = CompanionResponseCardSchema.parse({
      cardId: randomUUID(),
      taskId: randomUUID(),
      phase: 'completed',
      side: 'right',
      message: 'Your assignment is ready.',
      workCheck: {
        language,
        assignmentTitle: attempt.definition.title,
        projection: null,
        busy: false,
        canCheck: true,
        canReview: true,
        needsWorkspace: attempt.definition.launchTarget === 'workspace',
        submissionFiles: null,
        sync: null,
      },
    });
    return (this.binding = {
      owner,
      attempt,
      card,
      workspaceSelectionId: null,
      submission: null,
      runningTaskId: null,
      uncertainMutation: false,
    });
  }
  private async validate(binding: Binding): Promise<void> {
    const current = await this.resolve();
    if (
      current !== binding ||
      !['assigned', 'in_progress', 'blocked'].includes(current.attempt.state)
    )
      throw new Error(
        'The assignment is waiting for review or is no longer active.',
      );
    if (current.attempt.userId !== current.owner)
      throw new Error('The assignment owner changed.');
  }
  private publish(binding: Binding, message: string): void {
    if (binding !== this.binding) return;
    const active = ['assigned', 'in_progress', 'blocked'].includes(
      binding.attempt.state,
    );
    binding.card = CompanionResponseCardSchema.parse({
      ...binding.card,
      phase: 'completed',
      message: message.slice(0, 8000),
      workCheck: {
        ...binding.card.workCheck!,
        policyNotice:
          binding.attempt.run.insightPolicy === 'evidence_candidates' &&
          binding.attempt.acknowledgedPolicyVersion !==
            binding.attempt.run.insightPolicyVersion
            ? 'This class allows bounded evidence suggestions for teacher review. Starting work acknowledges this class policy.'
            : null,
        busy: this.busy || Boolean(binding.runningTaskId),
        canCheck: active && !binding.uncertainMutation,
        canReview: active && !binding.uncertainMutation,
        needsWorkspace:
          binding.attempt.definition.launchTarget === 'workspace' &&
          !binding.workspaceSelectionId,
        submissionFiles:
          binding.submission?.files.map((f) => ({
            displayName: f.relativePath,
            byteSize: f.byteSize,
          })) ?? null,
      },
    });
    if (!this.hidden) this.options.present(binding.card);
  }
}
