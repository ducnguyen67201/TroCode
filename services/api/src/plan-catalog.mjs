const plans = {
  free: {
    dailyMicroUsd: 250_000,
    weeklyMessages: 25,
    monthlyPriceCents: 0,
    monthlyMicroUsd: 1_000_000,
    providerCallsPerTurn: 40,
    responsesPerMinute: 15,
    taskMicroUsd: 100_000,
  },
  basic: {
    dailyMicroUsd: 1_000_000,
    weeklyMessages: 300,
    monthlyPriceCents: 2_000,
    monthlyMicroUsd: 8_000_000,
    providerCallsPerTurn: 40,
    responsesPerMinute: 30,
    taskMicroUsd: 750_000,
  },
  pro: {
    dailyMicroUsd: 3_000_000,
    weeklyMessages: 750,
    monthlyPriceCents: 5_000,
    monthlyMicroUsd: 20_000_000,
    providerCallsPerTurn: 40,
    responsesPerMinute: 45,
    taskMicroUsd: 2_000_000,
  },
  max: {
    dailyMicroUsd: 8_000_000,
    weeklyMessages: 1_875,
    monthlyPriceCents: 10_000,
    monthlyMicroUsd: 45_000_000,
    providerCallsPerTurn: 40,
    responsesPerMinute: 60,
    taskMicroUsd: 5_000_000,
  },
};

for (const plan of Object.values(plans)) Object.freeze(plan);

export const PLAN_CATALOG = Object.freeze(plans);
export const PLAN_IDS = Object.freeze(Object.keys(plans));

export function planFor(planId) {
  if (typeof planId !== 'string' || !Object.hasOwn(PLAN_CATALOG, planId)) {
    throw new Error(`Unknown usage plan: ${String(planId)}`);
  }
  const plan = PLAN_CATALOG[planId];
  return plan;
}
