const ROUTES = Object.freeze({
  lunaLow: { model: 'gpt-5.6-luna', reasoningEffort: 'low' },
  terraMedium: { model: 'gpt-5.6-terra', reasoningEffort: 'medium' },
  terraHigh: { model: 'gpt-5.6-terra', reasoningEffort: 'high' },
  solHigh: { model: 'gpt-5.6-sol', reasoningEffort: 'high' },
  solXhigh: { model: 'gpt-5.6-sol', reasoningEffort: 'xhigh' },
});

export class AgentModelPolicy {
  constructor({ allowedModels = new Set(['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol']) } = {}) {
    this.allowedModels = allowedModels;
  }

  route(input = {}) {
    let route;
    let reasonCode;
    if (input.lane === 'outcome_compiler' || input.lane === 'deterministic_verifier' || input.directAnswer) {
      route = ROUTES.lunaLow;
      reasonCode = 'simple_structured_lane';
    } else if (input.recoveryCount >= 2 || input.previousVerificationFailures >= 2) {
      route = ROUTES.solHigh;
      reasonCode = 'bounded_recovery_escalation';
    } else if (input.executionProfile === 'workspace' || input.multiApplication || input.visualComplexity === 'high') {
      route = ROUTES.terraHigh;
      reasonCode = 'complex_workspace_or_visual';
    } else if (input.lane === 'semantic_judge') {
      route = ROUTES.terraMedium;
      reasonCode = 'independent_semantic_judge';
    } else {
      route = ROUTES.terraMedium;
      reasonCode = 'everyday_tool_task';
    }
    if (!this.allowedModels.has(route.model)) {
      const fallback = [ROUTES.terraHigh, ROUTES.terraMedium, ROUTES.lunaLow]
        .find((candidate) => this.allowedModels.has(candidate.model));
      if (!fallback) throw new Error('No allowlisted model is available for the agent route.');
      return { ...fallback, reasonCode: 'allowlist_fallback' };
    }
    return { ...route, reasonCode };
  }
}

export class ProviderCircuitBreaker {
  constructor({ failureThreshold = 5, resetAfterMs = 30_000, now = Date.now } = {}) {
    this.failureThreshold = failureThreshold;
    this.resetAfterMs = resetAfterMs;
    this.now = now;
    this.failures = 0;
    this.openedAt = null;
  }

  allow() {
    if (this.openedAt === null) return true;
    if (this.now() - this.openedAt >= this.resetAfterMs) return 'half_open';
    return false;
  }

  success() {
    this.failures = 0;
    this.openedAt = null;
  }

  failure() {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) this.openedAt = this.now();
  }
}

export class AgentAdmissionController {
  constructor({ maxActivePerUser = 2, maxQueueDepth = 1_000 }) {
    this.maxActivePerUser = maxActivePerUser;
    this.maxQueueDepth = maxQueueDepth;
    this.activeByUser = new Map();
    this.queued = 0;
  }

  admit(userId) {
    if (this.queued >= this.maxQueueDepth) return { admitted: false, reason: 'global_queue_full', retryAfterSeconds: 10 };
    if ((this.activeByUser.get(userId) ?? 0) >= this.maxActivePerUser) {
      return { admitted: false, reason: 'user_concurrency_limit', retryAfterSeconds: 5 };
    }
    this.queued += 1;
    return { admitted: true };
  }

  start(userId) {
    this.queued = Math.max(0, this.queued - 1);
    this.activeByUser.set(userId, (this.activeByUser.get(userId) ?? 0) + 1);
  }

  finish(userId) {
    const remaining = Math.max(0, (this.activeByUser.get(userId) ?? 0) - 1);
    if (remaining === 0) this.activeByUser.delete(userId);
    else this.activeByUser.set(userId, remaining);
  }
}
