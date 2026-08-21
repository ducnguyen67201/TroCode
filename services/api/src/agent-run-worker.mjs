import { createHash, randomUUID } from 'node:crypto';

export class AgentRunWorker {
  constructor({
    agentRuntime,
    crypto,
    desktopWorkerController,
    leaseMs = 30_000,
    modelPolicy,
    outcomeVerifier,
    repository,
    runService,
    sessionFactory,
    visualSidecar,
    workerId = randomUUID(),
  }) {
    this.agentRuntime = agentRuntime;
    this.crypto = crypto;
    this.desktopWorkerController = desktopWorkerController;
    this.leaseMs = leaseMs;
    this.modelPolicy = modelPolicy;
    this.outcomeVerifier = outcomeVerifier;
    this.repository = repository;
    this.runService = runService;
    this.sessionFactory = sessionFactory;
    this.visualSidecar = visualSidecar;
    this.workerId = workerId;
  }

  async runOnce(signal) {
    const run = await this.repository.claim({ workerId: this.workerId, leaseMs: this.leaseMs });
    if (!run) return null;
    const leaseController = new AbortController();
    const abortFromCaller = () => leaseController.abort(signal?.reason);
    signal?.addEventListener('abort', abortFromCaller, { once: true });
    const renewTimer = setInterval(() => {
      void this.repository.renew({
        runId: run.id,
        workerId: this.workerId,
        runVersion: run.runVersion,
        leaseMs: this.leaseMs,
      }).catch((error) => leaseController.abort(error));
    }, Math.max(1_000, Math.floor(this.leaseMs / 3)));
    renewTimer.unref?.();
    try {
      return await this.#process(run, leaseController.signal);
    } catch (error) {
      await this.repository.transition({
        runId: run.id,
        workerId: this.workerId,
        runVersion: run.runVersion,
        from: ['queued', 'planning', 'recovering', 'verifying', 'awaiting_worker'],
        to: 'blocked',
        eventType: 'run.blocked',
        summary: 'The durable agent run stopped at a safe recovery boundary.',
      }).catch(() => undefined);
      throw error;
    } finally {
      clearInterval(renewTimer);
      signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  async #process(run, signal) {
    const capabilities = await this.desktopWorkerController.capabilitiesForUser(run.userId);
    if (!capabilities) {
      return this.repository.transition({
        runId: run.id,
        workerId: this.workerId,
        runVersion: run.runVersion,
        from: ['queued', 'planning', 'recovering', 'verifying'],
        to: 'awaiting_worker',
        eventType: 'run.awaiting_worker',
        summary: 'Waiting for the signed-in desktop worker.',
      });
    }
    const encrypted = await this.repository.loadOperational({
      runId: run.id,
      workerId: this.workerId,
      runVersion: run.runVersion,
    });
    const operational = this.runService.decryptOperational(run.id, encrypted);
    const session = this.sessionFactory(run.id);
    const control = await this.repository.pendingControl({
      runId: run.id,
      workerId: this.workerId,
      runVersion: run.runVersion,
    });
    if (control) {
      const payload = this.runService.decryptControl(run.id, control);
      await session.addControlItem(control.id, {
        role: 'user',
        content: payload.instruction,
      });
      await this.repository.acknowledgeControl({
        runId: run.id,
        workerId: this.workerId,
        runVersion: run.runVersion,
        sequence: control.sequence,
        type: control.type,
      });
    }
    const common = {
      budgetContext: {
        agentTurnId: operational.agentTurnId,
        planId: capabilities.planId,
        taskId: operational.taskId,
        userId: operational.userId,
      },
      capabilities,
      maxTurns: operational.contract.limits.maxModelSamples,
      intentRevision: operational.contract.schemaVersion === 8
        ? operational.contract.intentAuthorization.revision
        : 0,
      resolveCommittedToolResult: async () => {
        throw new Error('No committed desktop result is available during an initial run.');
      },
      routeInput: {
        executionProfile: operational.contract.executionProfile,
        recoveryCount: run.state === 'recovering' ? 1 : 0,
      },
      runId: run.id,
      session,
      signal,
    };
    const checkpoint = await this.repository.latestCheckpoint({
      runId: run.id,
      workerId: this.workerId,
      runVersion: run.runVersion,
    });
    let result;
    if (checkpoint) {
      const invocation = await this.repository.pendingOrTerminalInvocation(run.id);
      if (!invocation || !['confirmed', 'failed', 'denied', 'not_executed', 'unknown', 'cancelled'].includes(invocation.state)) {
        return this.repository.transition({
          runId: run.id,
          workerId: this.workerId,
          runVersion: run.runVersion,
          from: ['recovering', 'verifying', 'planning'],
          to: 'awaiting_worker',
          eventType: 'run.awaiting_worker',
          summary: 'Waiting for the pending desktop result.',
        });
      }
      if (invocation.consequential && invocation.state === 'unknown') {
        return this.repository.transition({
          runId: run.id,
          workerId: this.workerId,
          runVersion: run.runVersion,
          from: ['recovering', 'verifying', 'planning'],
          to: 'blocked',
          eventType: 'run.blocked',
          summary:
            'A consequential desktop action has an unknown outcome and will not be retried.',
        });
      }
      const serializedState = this.crypto.decryptJson(checkpoint.stateEnvelope, {
        graphDigest: checkpoint.graphDigest,
        kind: 'agent_run_state',
        modelStepId: checkpoint.modelStepId,
        runId: run.id,
        runVersion: checkpoint.runVersion,
        schemaVersion: 1,
      }).serializedState;
      const committedResult = invocation.result_ciphertext
        ? this.crypto.decryptJson({
            ciphertext: invocation.result_ciphertext,
            iv: invocation.result_iv,
            tag: invocation.result_tag,
            keyVersion: invocation.result_key_version,
          }, { invocationId: invocation.id, kind: 'agent_tool_result', runId: run.id, schemaVersion: 1 })
        : { status: invocation.state, summary: invocation.public_summary };
      const visual = this.visualSidecar?.take(invocation.id);
      if (visual) committedResult.visual = visual;
      result = await this.agentRuntime.resume({
        ...common,
        callId: invocation.call_id,
        graphDigest: checkpoint.graphDigest,
        resolveCommittedToolResult: async ({ callId }) => {
          if (callId !== invocation.call_id) throw new Error('Committed result call ID mismatch.');
          return committedResult;
        },
        serializedState,
      });
    } else {
      await this.repository.transition({
        runId: run.id,
        workerId: this.workerId,
        runVersion: run.runVersion,
        from: ['queued', 'planning', 'recovering', 'verifying'],
        to: 'planning',
        eventType: 'run.planning',
        summary: 'Durable agent planning started.',
      });
      result = await this.agentRuntime.start({ ...common, request: operational.request });
    }
    if (result.kind === 'interrupted') {
      const modelStepId = randomUUID();
      const stateEnvelope = this.crypto.encryptJson(
        { serializedState: result.serializedState },
        {
          graphDigest: result.graphDigest,
          kind: 'agent_run_state',
          modelStepId,
          runId: run.id,
          runVersion: run.runVersion,
          schemaVersion: 1,
        },
      );
      await this.repository.saveCheckpoint({
        graphDigest: result.graphDigest,
        modelStepId,
        runId: run.id,
        runVersion: run.runVersion,
        stateEnvelope,
        workerId: this.workerId,
      });
      const invocationId = randomUUID();
      const requestEnvelope = this.crypto.encryptJson(result.invocation, {
        invocationId, kind: 'agent_tool_request', runId: run.id, schemaVersion: 1,
      });
      const verifier = {
        kind: 'tool_effect',
        operation: result.invocation.operation,
        toolId: result.invocation.toolId,
      };
      const verifierDigest = createHash('sha256').update(JSON.stringify(verifier)).digest('hex');
      const effectCriterion = {
        id: `effect-${verifierDigest.slice(0, 16)}`,
        verifierDigest,
      };
      effectCriterion.descriptionEnvelope = this.crypto.encryptJson(
        {
          description: `Complete ${result.invocation.toolId}.${result.invocation.operation}.`,
          verifier,
        },
        {
          criterionId: effectCriterion.id,
          kind: 'agent_outcome_criterion',
          runId: run.id,
          schemaVersion: 1,
        },
      );
      return this.repository.registerInvocation({
        ...result.invocation,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        effectCriterion,
        idempotencyKey: `${run.runVersion}:${result.invocation.callId}`,
        invocationId,
        requestEnvelope,
        runId: run.id,
        runVersion: run.runVersion,
        workerId: this.workerId,
      });
    }
    if (result.kind === 'blocked') {
      return this.repository.transition({
        runId: run.id,
        workerId: this.workerId,
        runVersion: run.runVersion,
        from: ['planning', 'recovering', 'verifying'],
        to: 'blocked',
        eventType: 'run.blocked',
        summary: result.summary,
      });
    }
    const evidence = await this.repository.evidenceForRun(run.id, operational.outcomeRevision);
    const verification = await this.outcomeVerifier.verify({
      assistantOutput: result.finalOutput,
      contract: operational.contract.outcomeContract,
      evidence,
    });
    await this.repository.setCriterionResults({
      results: verification.criterionResults,
      revision: verification.contractRevision,
      runId: run.id,
      runVersion: run.runVersion,
      workerId: this.workerId,
    });
    if (!verification.complete) {
      return this.repository.transition({
        runId: run.id,
        workerId: this.workerId,
        runVersion: run.runVersion,
        from: ['planning', 'recovering', 'verifying'],
        to: 'blocked',
        eventType: 'run.outcomes_incomplete',
        summary: 'The agent stopped without verifying every required outcome.',
      });
    }
    const completion = await this.repository.completeVerified({
      finalEnvelope: this.crypto.encryptJson(
        { finalOutput: result.finalOutput },
        { kind: 'agent_final_output', runId: run.id, schemaVersion: 1 },
      ),
      runId: run.id,
      runVersion: run.runVersion,
      workerId: this.workerId,
    });
    if (completion.kind === 'incomplete') {
      return this.repository.transition({
        runId: run.id,
        workerId: this.workerId,
        runVersion: run.runVersion,
        from: ['planning', 'recovering', 'verifying'],
        to: 'blocked',
        eventType: 'run.outcomes_incomplete',
        summary: `Required outcome ${completion.criterionId} is ${completion.state}.`,
      });
    }
    return completion;
  }
}
