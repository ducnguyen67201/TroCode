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
    activeRuns: 5,
    dailyMicroUsd: 1_000_000,
    weeklyMessages: 300,
    monthlyPriceCents: 2_000,
    monthlyMicroUsd: 8_000_000,
    groupParticipants: 200,
    knowledgeQueriesPerMinute: 60,
    providerCallsPerTurn: 40,
    responsesPerMinute: 30,
    spaceCount: 3,
    spaceStorageBytes: 1_073_741_824,
    uploadFilesPerBatch: 50,
    uploadInitiatesPerMinute: 20,
    taskMicroUsd: 750_000,
  },
  pro: {
    activeRuns: 25,
    dailyMicroUsd: 3_000_000,
    weeklyMessages: 750,
    monthlyPriceCents: 5_000,
    monthlyMicroUsd: 20_000_000,
    groupParticipants: 1_000,
    knowledgeQueriesPerMinute: 180,
    providerCallsPerTurn: 40,
    responsesPerMinute: 45,
    spaceCount: 20,
    spaceStorageBytes: 21_474_836_480,
    uploadFilesPerBatch: 100,
    uploadInitiatesPerMinute: 60,
    taskMicroUsd: 2_000_000,
  },
  max: {
    activeRuns: 100,
    dailyMicroUsd: 8_000_000,
    weeklyMessages: 1_875,
    monthlyPriceCents: 10_000,
    monthlyMicroUsd: 45_000_000,
    groupParticipants: 2_000,
    knowledgeQueriesPerMinute: 360,
    providerCallsPerTurn: 40,
    responsesPerMinute: 60,
    spaceCount: 100,
    spaceStorageBytes: 107_374_182_400,
    uploadFilesPerBatch: 100,
    uploadInitiatesPerMinute: 120,
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
