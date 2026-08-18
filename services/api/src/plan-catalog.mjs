const plans = {
  basic: {
    dailyMicroUsd: 1_000_000,
    monthlyMessages: 1_200,
    monthlyPriceCents: 2_000,
    monthlyMicroUsd: 8_000_000,
    providerCallsPerTurn: 40,
    responsesPerMinute: 30,
    taskMicroUsd: 750_000,
  },
  max: {
    dailyMicroUsd: 8_000_000,
    monthlyMessages: 7_500,
    monthlyPriceCents: 10_000,
    monthlyMicroUsd: 45_000_000,
    providerCallsPerTurn: 40,
    responsesPerMinute: 60,
    taskMicroUsd: 5_000_000,
  },
  pro: {
    dailyMicroUsd: 3_000_000,
    monthlyMessages: 3_000,
    monthlyPriceCents: 5_000,
    monthlyMicroUsd: 20_000_000,
    providerCallsPerTurn: 40,
    responsesPerMinute: 45,
    taskMicroUsd: 2_000_000,
  },
};

for (const plan of Object.values(plans)) Object.freeze(plan);

export const PLAN_CATALOG = Object.freeze(plans);

export function planFor(planId) {
  const plan = PLAN_CATALOG[planId];
  if (!plan) throw new Error(`Unknown usage plan: ${String(planId)}`);
  return plan;
}
