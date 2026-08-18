import { planFor } from './plan-catalog.mjs';

export class BudgetError extends Error {
  constructor(code, message, status = 402) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function nonnegativeInteger(name, value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative integer.`);
  }
  return value;
}

export class BudgetService {
  constructor(repository, options) {
    this.repository = repository;
    this.options = {
      dailyMicroUsd: nonnegativeInteger('dailyMicroUsd', options.dailyMicroUsd),
      enabled: options.enabled,
      mode: options.mode,
      monthlyMicroUsd: nonnegativeInteger(
        'monthlyMicroUsd',
        options.monthlyMicroUsd,
      ),
      reservationTtlMs: nonnegativeInteger(
        'reservationTtlMs',
        options.reservationTtlMs,
      ),
      realtimeCallMicroUsd: nonnegativeInteger(
        'realtimeCallMicroUsd',
        options.realtimeCallMicroUsd,
      ),
      speechMicroUsdPerThousandCharacters: nonnegativeInteger(
        'speechMicroUsdPerThousandCharacters',
        options.speechMicroUsdPerThousandCharacters,
      ),
      transcriptionMicroUsdPerMinute: nonnegativeInteger(
        'transcriptionMicroUsdPerMinute',
        options.transcriptionMicroUsdPerMinute,
      ),
      taskMicroUsd: nonnegativeInteger('taskMicroUsd', options.taskMicroUsd),
      warningPercent: nonnegativeInteger(
        'warningPercent',
        options.warningPercent,
      ),
    };
  }

  realtimeCallEstimateMicroUsd() {
    return this.options.realtimeCallMicroUsd;
  }

  speechEstimateMicroUsd(characterCount) {
    nonnegativeInteger('characterCount', characterCount);
    return Math.ceil(
      (characterCount * this.options.speechMicroUsdPerThousandCharacters) /
        1_000,
    );
  }

  transcriptionEstimateMicroUsd(durationMs) {
    nonnegativeInteger('durationMs', durationMs);
    if (durationMs > 15_000) {
      throw new Error('durationMs exceeds the transcription segment limit.');
    }
    return Math.ceil(
      (durationMs * this.options.transcriptionMicroUsdPerMinute) / 60_000,
    );
  }

  transcriptionActualMicroUsd(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 16) {
      throw new Error('seconds must be a bounded nonnegative number.');
    }
    return Math.ceil(
      (seconds * this.options.transcriptionMicroUsdPerMinute) / 60,
    );
  }

  async reserve(input) {
    if (!this.options.enabled) {
      throw new BudgetError(
        'cost_guard_disabled',
        'Hosted model calls are temporarily disabled.',
        503,
      );
    }
    const reservedMicroUsd = nonnegativeInteger(
      'reservedMicroUsd',
      input.reservedMicroUsd,
    );
    const limits = this.limitsFor(input.planId);
    const result = await this.repository.reserve({
      ...input,
      authorize: (committed) =>
        this.denialFor(committed, reservedMicroUsd, input.lane, limits),
      enforce: this.options.mode === 'enforce',
      maxProviderCallsPerTurn: limits.providerCallsPerTurn,
      reservationTtlMs: this.options.reservationTtlMs,
    });
    if (result.kind === 'duplicate') {
      throw new BudgetError(
        'duplicate_request',
        'This model request was already accepted.',
        409,
      );
    }
    if (result.kind === 'denied') {
      throw new BudgetError(result.denial.code, result.denial.message);
    }
    if (result.kind === 'invalid_turn') {
      throw new BudgetError(
        'invalid_agent_turn',
        'The agent turn is missing, expired, or belongs to another task.',
        403,
      );
    }
    if (result.kind === 'turn_exhausted') {
      throw new BudgetError(
        'agent_turn_call_limit_reached',
        'This agent turn reached its internal model-call limit.',
        429,
      );
    }
    return { ...result.reservation, wouldDeny: Boolean(result.denial) };
  }

  async markDispatched(userId, requestId) {
    return this.repository.markDispatched(userId, requestId);
  }

  async settle(input) {
    return this.repository.settle(input);
  }

  async release(userId, requestId, disposition) {
    return this.repository.release(userId, requestId, disposition);
  }

  async markUncertain(userId, requestId) {
    return this.repository.markUncertain(userId, requestId);
  }

  async snapshot(userId, taskId = null, planId = 'basic') {
    const limits = this.limitsFor(planId);
    const value = await this.repository.snapshot(userId, taskId);
    const monthCommitted =
      value.monthSettledMicroUsd + value.monthReservedMicroUsd;
    const dayCommitted = value.daySettledMicroUsd + value.dayReservedMicroUsd;
    const taskCommitted = value.taskSettledMicroUsd + value.taskReservedMicroUsd;
    return {
      actualMicroUsd: value.monthSettledMicroUsd,
      daily: {
        limitMicroUsd: limits.dailyMicroUsd,
        remainingMicroUsd: Math.max(0, limits.dailyMicroUsd - dayCommitted),
        reservedMicroUsd: value.dayReservedMicroUsd,
        settledMicroUsd: value.daySettledMicroUsd,
      },
      enforcementMode: this.options.mode,
      estimatedMicroUsd: value.monthReservedMicroUsd,
      messages: {
        limit: limits.monthlyMessages,
        remaining: Math.max(0, limits.monthlyMessages - value.monthMessages),
        used: value.monthMessages,
      },
      monthEndsAt: value.monthEndsAt,
      monthly: {
        limitMicroUsd: limits.monthlyMicroUsd,
        remainingMicroUsd: Math.max(
          0,
          limits.monthlyMicroUsd - monthCommitted,
        ),
        reservedMicroUsd: value.monthReservedMicroUsd,
        settledMicroUsd: value.monthSettledMicroUsd,
      },
      periodStartsAt: (() => {
        const periodEnd = new Date(value.monthEndsAt);
        return new Date(
          Date.UTC(
            periodEnd.getUTCFullYear(),
            periodEnd.getUTCMonth() - 1,
            1,
          ),
        ).toISOString();
      })(),
      plan: planId,
      pricing: {
        currency: 'usd',
        monthlyCents: limits.monthlyPriceCents,
      },
      task: {
        limitMicroUsd: limits.taskMicroUsd,
        remainingMicroUsd: Math.max(0, limits.taskMicroUsd - taskCommitted),
        reservedMicroUsd: value.taskReservedMicroUsd,
        settledMicroUsd: value.taskSettledMicroUsd,
      },
      warningThresholdMicroUsd: Math.floor(
        (limits.monthlyMicroUsd * this.options.warningPercent) / 100,
      ),
    };
  }

  denialFor(committed, amount, lane, limits) {
    if (committed.monthMicroUsd + amount > limits.monthlyMicroUsd) {
      return {
        code: 'monthly_budget_exhausted',
        message: 'The monthly model budget has been reached.',
      };
    }
    if (committed.dayMicroUsd + amount > limits.dailyMicroUsd) {
      return {
        code: 'daily_budget_exhausted',
        message: 'The daily model budget has been reached.',
      };
    }
    if (committed.taskMicroUsd + amount > limits.taskMicroUsd) {
      return {
        code: 'task_budget_exhausted',
        message: 'This task needs another budget tranche before it can continue.',
      };
    }
    return null;
  }

  limitsFor(planId) {
    const plan = planFor(planId);
    return {
      dailyMicroUsd: Math.min(plan.dailyMicroUsd, this.options.dailyMicroUsd),
      monthlyMessages: plan.monthlyMessages,
      monthlyPriceCents: plan.monthlyPriceCents,
      providerCallsPerTurn: plan.providerCallsPerTurn,
      monthlyMicroUsd: Math.min(
        plan.monthlyMicroUsd,
        this.options.monthlyMicroUsd,
      ),
      taskMicroUsd: Math.min(plan.taskMicroUsd, this.options.taskMicroUsd),
    };
  }
}
