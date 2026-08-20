import type {
  PlanId,
  UsageBudgetSnapshot,
} from '../shared/contracts';

export function accountPlan(
  budgetPlan: PlanId | null | undefined,
  membershipPlan: PlanId | null | undefined,
): PlanId {
  return budgetPlan ?? membershipPlan ?? 'free';
}

export function planTitle(plan: PlanId): string {
  return `Tro ${plan.charAt(0).toUpperCase()}${plan.slice(1)}`;
}

export function remainingUsagePercent(
  budget: UsageBudgetSnapshot | null,
): number | null {
  if (!budget) return null;

  if (budget.messages.limit === 0) return null;

  return Math.floor(
    Math.max(
      0,
      Math.min(1, budget.messages.remaining / budget.messages.limit),
    ) * 100,
  );
}
