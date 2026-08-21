import { randomUUID } from 'node:crypto';

import {
  AGENT_RUNTIME_PROTOCOL_VERSION,
  ApprovalDecisionSchema,
  HOST_ALWAYS_CONFIRM_EFFECTS,
  IntentAuthorizationContractSchema,
  SteeringRequestSchema,
  SubmitAgentRunSchema,
} from './agent-runtime-contracts.mjs';
import { AGENT_TOOL_SCHEMA_DIGEST } from './agent-tool-catalog.mjs';
import { compileIntentAuthorization } from './intent-authorization-compiler.mjs';
import { verifierDigest } from './outcome-compiler.mjs';

const DEFAULT_TASK_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_PAYLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export function reviseIntentAuthorization({
  authorityText,
  contract,
  enabled,
}) {
  const revision = contract.intentAuthorization.revision + 1;
  if (enabled) {
    return compileIntentAuthorization(authorityText, {
      enabled: true,
      executionProfile: contract.executionProfile,
      revision,
    });
  }
  return IntentAuthorizationContractSchema.parse({
    ...contract.intentAuthorization,
    revision,
  });
}

export class AgentRunService {
  constructor({
    agentTurnService,
    crypto,
    outcomeCompiler,
    repository,
    taskTtlMs = DEFAULT_TASK_TTL_MS,
    payloadTtlMs = DEFAULT_PAYLOAD_TTL_MS,
    maxActiveRunsPerUser = 2,
    maxQueueDepth = 1_000,
    intentAuthorizationPolicy = { enabledFor: () => false },
  }) {
    this.agentTurnService = agentTurnService;
    this.crypto = crypto;
    this.outcomeCompiler = outcomeCompiler;
    this.repository = repository;
    this.taskTtlMs = taskTtlMs;
    this.payloadTtlMs = payloadTtlMs;
    this.maxActiveRunsPerUser = maxActiveRunsPerUser;
    this.maxQueueDepth = maxQueueDepth;
    this.intentAuthorizationPolicy = intentAuthorizationPolicy;
  }

  async submit(user, input) {
    const request = SubmitAgentRunSchema.parse(input);
    const runId = randomUUID();
    const outcomeContract = await this.outcomeCompiler.compile({
      request: request.request,
      executionProfile: request.executionProfile,
      availableVerifierKinds: [
        'assistant_output', 'application_surface', 'browser_semantic',
        'filesystem_effect', 'tool_effect', 'semantic_judge',
      ],
    });
    const intentAuthorization = compileIntentAuthorization(request.request, {
      enabled: this.intentAuthorizationPolicy.enabledFor(user.id),
      executionProfile: request.executionProfile,
    });
    const contract = {
      schemaVersion: 8,
      id: randomUUID(),
      originalRequest: request.request,
      runtimeKind: 'openai_agents',
      executionProfile: request.executionProfile,
      autonomyMode: request.autonomyMode,
      workspaceSelectionId: request.workspaceSelectionId,
      outcomeContract,
      intentAuthorization,
      approvalPolicy: { alwaysConfirmEffects: [...HOST_ALWAYS_CONFIRM_EFFECTS] },
      limits: {
        maxImages: 20,
        maxMicroUsd: 5_000_000,
        maxMinutes: 30,
        maxModelSamples: 40,
        maxToolCalls: 30,
      },
    };
    const turn = await this.agentTurnService.create({
      clientTurnId: request.clientTaskId,
      planId: user.plan,
      taskId: request.taskId,
      userId: user.id,
    });
    const requestEnvelope = this.crypto.encryptJson({ request: request.request }, {
      kind: 'agent_run_request', runId, schemaVersion: 1,
    });
    const contractEnvelope = this.crypto.encryptJson(contract, {
      kind: 'agent_run_contract', runId, schemaVersion: 8,
    });
    const criteria = outcomeContract.criteria.map((criterion) => ({
      id: criterion.id,
      required: criterion.required,
      verifierKind: criterion.verifier.kind,
      verifierDigest: verifierDigest(criterion.verifier),
      descriptionEnvelope: this.crypto.encryptJson(
        { description: criterion.description, verifier: criterion.verifier },
        { criterionId: criterion.id, kind: 'agent_outcome_criterion', runId, schemaVersion: 1 },
      ),
    }));
    const now = Date.now();
    const result = await this.repository.submit({
      agentTurnId: turn.id,
      clientTaskId: request.clientTaskId,
      contractEnvelope,
      criteria,
      deadlineAt: new Date(now + this.taskTtlMs).toISOString(),
      executionProfile: request.executionProfile,
      payloadExpiresAt: new Date(now + this.payloadTtlMs).toISOString(),
      protocolVersion: AGENT_RUNTIME_PROTOCOL_VERSION,
      publicSummary: 'Task queued for the durable agent runtime.',
      requestEnvelope,
      runId,
      schemaDigest: AGENT_TOOL_SCHEMA_DIGEST,
      taskId: request.taskId,
      userId: user.id,
      workspaceSelectionId: request.workspaceSelectionId,
      maxActiveRunsPerUser: this.maxActiveRunsPerUser,
      maxQueueDepth: this.maxQueueDepth,
    });
    if (result.kind === 'capacity') {
      const error = new Error(
        result.reason === 'user_concurrency_limit'
          ? 'Finish or stop an active task before starting another.'
          : 'The agent queue is full; retry shortly.',
      );
      error.code = result.reason;
      error.status = 429;
      error.retryAfterSeconds = result.reason === 'user_concurrency_limit' ? 5 : 10;
      throw error;
    }
    if (result.kind === 'conflict') {
      const error = new Error('This client task ID is already linked to another task.');
      error.code = 'agent_run_conflict';
      error.status = 409;
      throw error;
    }
    let persistedContract = contract;
    let persistedRequest = request.request;
    if (result.kind === 'duplicate') {
      const envelope = await this.repository.getOwnedContractEnvelope(user.id, result.run.id);
      persistedContract = this.#decryptContract(result.run, envelope);
      const persistedRequestEnvelope = await this.repository.getOwnedRequestEnvelope(
        user.id,
        result.run.id,
      );
      if (persistedRequestEnvelope) {
        persistedRequest = this.crypto.decryptJson(persistedRequestEnvelope, {
          kind: 'agent_run_request',
          runId: result.run.id,
          schemaVersion: 1,
        }).request;
      }
    }
    return {
      ...result.run,
      newlyCreated: result.kind === 'created',
      request: persistedRequest,
      ...this.#publicContract(persistedContract),
    };
  }

  async get(userId, runId) {
    const run = await this.repository.getOwned(userId, runId);
    if (!run) return null;
    const requestEnvelope = await this.repository.getOwnedRequestEnvelope(userId, runId);
    const contractEnvelope = await this.repository.getOwnedContractEnvelope(userId, runId);
    const contract = contractEnvelope ? this.#decryptContract(run, contractEnvelope) : null;
    return {
      ...run,
      request: requestEnvelope
        ? this.crypto.decryptJson(requestEnvelope, {
            kind: 'agent_run_request', runId, schemaVersion: 1,
          }).request
        : 'Expired private task content.',
      ...(contract ? this.#publicContract(contract) : {}),
    };
  }

  async list(userId, options) {
    const runs = await this.repository.listOwned(userId, options);
    return Promise.all(runs.map(async (run) => {
      const requestEnvelope = await this.repository.getOwnedRequestEnvelope(userId, run.id);
      const contractEnvelope = await this.repository.getOwnedContractEnvelope(userId, run.id);
      const contract = contractEnvelope ? this.#decryptContract(run, contractEnvelope) : null;
      return {
        ...run,
        request: requestEnvelope
          ? this.crypto.decryptJson(requestEnvelope, {
              kind: 'agent_run_request', runId: run.id, schemaVersion: 1,
            }).request
          : 'Expired private task content.',
        ...(contract ? this.#publicContract(contract) : {}),
      };
    }));
  }

  async hasActive(userId) {
    return this.repository.hasActiveOwned(userId);
  }

  async events(userId, runId, afterSequence) {
    const events = await this.repository.eventsAfter(userId, runId, afterSequence);
    const outcomeStatus = await this.repository.outcomeStatus(runId);
    return events.map((event) => {
      if (!event.privateEnvelope || event.type !== 'run.completed') {
        const { privateEnvelope: _privateEnvelope, ...publicEvent } = event;
        return { ...publicEvent, ...outcomeStatus };
      }
      const payload = this.crypto.decryptJson(event.privateEnvelope, {
        kind: 'agent_final_output', runId, schemaVersion: 1,
      });
      const { privateEnvelope: _privateEnvelope, ...publicEvent } = event;
      return { ...publicEvent, ...outcomeStatus, finalOutput: payload.finalOutput };
    });
  }

  async cancel(userId, runId) {
    return this.repository.cancel(userId, runId);
  }

  async steer(user, runId, input) {
    const request = SteeringRequestSchema.parse(input);
    const run = await this.repository.getOwned(user.id, runId);
    if (!run) return null;
    await this.agentTurnService.create({
      clientTurnId: request.clientTurnId,
      planId: user.plan,
      taskId: run.taskId,
      userId: user.id,
    });
    const requestEnvelope = await this.repository.getOwnedRequestEnvelope(user.id, runId);
    const contractEnvelope = await this.repository.getOwnedContractEnvelope(user.id, runId);
    const originalRequest = this.crypto.decryptJson(requestEnvelope, {
      kind: 'agent_run_request', runId, schemaVersion: 1,
    }).request;
    const priorSteering = await this.repository.listOwnedSteeringEnvelopes(
      user.id,
      runId,
    );
    const authorityText = [
      originalRequest,
      ...priorSteering.map((event) => this.crypto.decryptJson(
        event.payloadEnvelope,
        { kind: 'agent_steering', runId, schemaVersion: 1 },
      ).instruction),
      request.instruction,
    ].join('\nSteering update: ');
    const contract = this.#decryptContract(run, contractEnvelope);
    const outcomeContract = await this.outcomeCompiler.compile({
      request: authorityText,
      executionProfile: contract.executionProfile,
      availableVerifierKinds: [
        'assistant_output', 'application_surface', 'browser_semantic',
        'filesystem_effect', 'tool_effect', 'semantic_judge',
      ],
    });
    outcomeContract.revision = run.outcomeRevision + 1;
    const intentAuthorization = contract.schemaVersion === 8
      ? reviseIntentAuthorization({
          authorityText,
          contract,
          enabled: this.intentAuthorizationPolicy.enabledFor(user.id),
        })
      : undefined;
    const revisedContract = {
      ...contract,
      outcomeContract,
      ...(intentAuthorization ? { intentAuthorization } : {}),
    };
    const revisedContractEnvelope = this.crypto.encryptJson(revisedContract, {
      kind: 'agent_run_contract', runId, schemaVersion: contract.schemaVersion,
    });
    const criteria = outcomeContract.criteria.map((criterion) => ({
      id: criterion.id,
      required: criterion.required,
      verifierKind: criterion.verifier.kind,
      verifierDigest: verifierDigest(criterion.verifier),
      descriptionEnvelope: this.crypto.encryptJson(
        { description: criterion.description, verifier: criterion.verifier },
        {
          criterionId: criterion.id,
          kind: 'agent_outcome_criterion',
          runId,
          schemaVersion: 1,
        },
      ),
    }));
    const payloadEnvelope = this.crypto.encryptJson(
      { instruction: request.instruction },
      { kind: 'agent_steering', runId, schemaVersion: 1 },
    );
    return this.repository.reviseOwnedOutcomes({
      contractEnvelope: revisedContractEnvelope,
      criteria,
      expectedOutcomeRevision: run.outcomeRevision,
      payloadEnvelope,
      runId,
      userId: user.id,
    });
  }

  async decideApproval(userId, runId, input) {
    const request = ApprovalDecisionSchema.parse(input);
    const payloadEnvelope = this.crypto.encryptJson(request, {
      kind: 'agent_approval_decision',
      runId,
      schemaVersion: 1,
    });
    return this.repository.appendOwnedEvent({
      payloadEnvelope,
      runId,
      summary: request.decision === 'approve' ? 'Approval granted.' : 'Approval denied.',
      type: 'run.approval_decided',
      userId,
    });
  }

  decryptOperational(runId, operational) {
    return {
      ...operational,
      contract: this.#decryptContract(operational, operational.contractEnvelope, runId),
      request: this.crypto.decryptJson(operational.requestEnvelope, {
        kind: 'agent_run_request', runId, schemaVersion: 1,
      }).request,
    };
  }

  decryptControl(runId, event) {
    if (event.type === 'run.steering_queued') {
      return this.crypto.decryptJson(event.payloadEnvelope, {
        kind: 'agent_steering', runId, schemaVersion: 1,
      });
    }
    if (event.type === 'run.approval_decided') {
      return this.crypto.decryptJson(event.payloadEnvelope, {
        kind: 'agent_approval_decision', runId, schemaVersion: 1,
      });
    }
    throw new Error('Unsupported durable control event.');
  }

  #contractSchemaVersion(run) {
    return Number(run.protocolVersion ?? run.protocol_version) >= 2 ? 8 : 7;
  }

  #decryptContract(run, envelope, explicitRunId = run.id) {
    if (!envelope) throw new Error('The encrypted agent contract is unavailable.');
    return this.crypto.decryptJson(envelope, {
      kind: 'agent_run_contract',
      runId: explicitRunId,
      schemaVersion: this.#contractSchemaVersion(run),
    });
  }

  #publicContract(contract) {
    return {
      contractSchemaVersion: contract.schemaVersion,
      autonomyMode: contract.autonomyMode ?? 'balanced',
      outcomeContract: contract.outcomeContract,
      ...(contract.schemaVersion === 8
        ? { intentAuthorization: contract.intentAuthorization }
        : {}),
    };
  }
}
