import { planFor } from './plan-catalog.mjs';

export class AgentTurnError extends Error {
  constructor(code, message, status = 402) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class AgentTurnService {
  constructor(repository, options) {
    this.repository = repository;
    this.mode = options.mode;
  }

  async create(input) {
    const plan = planFor(input.planId);
    const result = await this.repository.create({
      ...input,
      authorize: ({ monthMessages }) =>
        monthMessages + 1 > plan.monthlyMessages
          ? {
              code: 'monthly_message_limit_reached',
              message: 'The monthly agent message allowance has been reached.',
            }
          : null,
      enforce: this.mode === 'enforce',
    });
    if (result.kind === 'denied') {
      throw new AgentTurnError(result.denial.code, result.denial.message);
    }
    if (result.kind === 'conflict') {
      throw new AgentTurnError(
        'agent_turn_conflict',
        'This user turn ID is already linked to another task.',
        409,
      );
    }
    return {
      ...result.turn,
      newlyCreated: result.kind === 'created',
      wouldDeny: Boolean(result.denial || result.turn.wouldDeny),
    };
  }
}
