import { assertTransition, isRunOpen } from './activity-lifecycle.mjs';
import { canRecordEvidence } from './knowledge-space-policy.mjs';

export class ActivityService {
  constructor({ activityRepository, objectStore, spaceService, uploadService }) {
    this.activityRepository = activityRepository;
    this.objectStore = objectStore;
    this.spaceService = spaceService;
    this.uploadService = uploadService;
  }
  async saveDraft(userId, spaceId, input) {
    await this.spaceService.role(userId, spaceId, 'activity.write');
    return this.activityRepository.saveDraft({ ...input, spaceId, userId });
  }
  async publish(userId, spaceId, activityId, input) {
    await this.spaceService.role(userId, spaceId, 'activity.publish');
    return this.activityRepository.publish({ activityId, clientId: input.clientId, spaceId, userId });
  }
  async createRun(userId, spaceId, input, limits = null) {
    await this.spaceService.role(userId, spaceId, 'run.manage');
    if (limits) {
      if (await this.activityRepository.activeRunCount(spaceId) >= limits.activeRuns) {
        const error = new Error('This Space reached its active Run limit.');
        error.status = 409; error.code = 'active_run_quota'; throw error;
      }
      const assignmentCount = input.target.kind === 'group'
        ? await this.activityRepository.groupSize(input.target.groupId, spaceId)
        : new Set(input.target.userIds).size;
      if (assignmentCount > limits.groupParticipants) {
        const error = new Error('This Run has too many participants for the current plan.');
        error.status = 409; error.code = 'participant_quota'; throw error;
      }
    }
    return this.activityRepository.createRun({ ...input, spaceId, userId });
  }
  async setRunState(userId, spaceId, runId, nextState) {
    await this.spaceService.role(userId, spaceId, 'run.manage');
    const current = await this.activityRepository.runState(runId, spaceId);
    if (!current) return null;
    if (current === nextState) return { id: runId, state: current };
    assertTransition('run', current, nextState);
    return this.activityRepository.setRunState(runId, spaceId, nextState);
  }
  listAssigned(userId) { return this.activityRepository.listAssigned(userId); }
  async attempt(userId, attemptId) {
    const context = await this.activityRepository.attemptContext(attemptId, userId);
    if (!context) return null;
    return context;
  }
  async starterFiles(userId, attemptId) {
    const context = await this.attempt(userId, attemptId);
    if (!context) return null;
    const files = await this.activityRepository.starterFiles(attemptId, userId);
    return Promise.all(files.map(async ({ objectKey, ...file }) => ({
      ...file,
      download: await this.objectStore.createGetTicket(objectKey),
    })));
  }
  async initiateSubmission(userId, attemptId, input, limits = null) {
    const context = await this.attempt(userId, attemptId);
    if (!context) return null;
    if (limits) {
      if (input.files.length > limits.uploadFilesPerBatch) {
        const error = new Error('This upload has too many files for the current plan.');
        error.status = 409; error.code = 'upload_file_quota'; throw error;
      }
      const requested = input.files.reduce((total, file) => total + file.byteSize, 0);
      if (requested > limits.spaceStorageBytes) {
        const error = new Error('This upload exceeds the current plan storage limit.');
        error.status = 409; error.code = 'storage_quota_reached'; throw error;
      }
    }
    return this.uploadService.initiateSubmission({
      attemptId,
      files: input.files,
      spaceId: context.space.id,
      userId,
    });
  }
  async commitSubmission(userId, attemptId) {
    const context = await this.attempt(userId, attemptId);
    if (!context) return null;
    if (!context.definition.completionPolicy.requiresSubmission) {
      const error = new Error('This Activity does not require a submission.');
      error.status = 409;
      error.code = 'submission_not_required';
      throw error;
    }
    return this.activityRepository.commitSubmission(attemptId, userId);
  }
  async requestHelp(userId, attemptId, clientId) {
    return this.activityRepository.requestHelp(attemptId, userId, clientId);
  }
  async acknowledge(userId, attemptId, policyVersion) {
    return this.activityRepository.acknowledgePolicy(attemptId, userId, policyVersion);
  }
  async createWorkSession(userId, attemptId, input) {
    const context = await this.attempt(userId, attemptId);
    if (!context) return null;
    if (!isRunOpen(context.run)) { const error = new Error('This Run is not open.'); error.status = 409; error.code = 'run_not_open'; throw error; }
    if (context.definition.launchTarget !== input.launchKind) { const error = new Error('Launch selection does not match the published Activity.'); error.status = 409; error.code = 'launch_target_mismatch'; throw error; }
    return this.activityRepository.createWorkSession({ ...input, attemptId, userId });
  }
  updateWorkSession(userId, workSessionId, input) {
    return this.activityRepository.updateWorkSession({ ...input, userId, workSessionId });
  }
  async recordEvidence(userId, attemptId, input) {
    if (input.provenance !== 'participant' && input.provenance !== 'agent_candidate') {
      const error = new Error('This evidence provenance is not available on the participant endpoint.');
      error.status = 403; error.code = 'evidence_forbidden'; throw error;
    }
    const authority = await this.activityRepository.workSessionAuthority(input.workSessionId, userId);
    if (!authority || authority.attemptId !== attemptId) return null;
    const criterion = authority.criteria.find((item) => item.id === input.criterionId);
    const permitted = canRecordEvidence({
      attemptUserId: authority.userId, criterionIds: authority.criteria.map((item) => item.id),
      insightPolicy: authority.insightPolicy, policyAcknowledged: authority.acknowledgedPolicyVersion === authority.insightPolicyVersion,
      provenance: input.provenance, sessionAttemptId: authority.attemptId, targetAttemptId: attemptId,
      tagAllowlist: criterion?.tags ?? [], userId, criterionId: input.criterionId, tag: input.tag,
    });
    if (!permitted) { const error = new Error('Evidence is not permitted for this Attempt.'); error.status = 403; error.code = 'evidence_forbidden'; throw error; }
    return this.activityRepository.insertEvidence({ ...input, attemptId, userId });
  }
}
