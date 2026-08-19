const plans = {
  basic: {
    activeRuns: 5,
    dailyMicroUsd: 1_000_000,
    monthlyMessages: 1_200,
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
  max: {
    activeRuns: 100,
    dailyMicroUsd: 8_000_000,
    monthlyMessages: 7_500,
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
  pro: {
    activeRuns: 25,
    dailyMicroUsd: 3_000_000,
    monthlyMessages: 3_000,
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
};

for (const plan of Object.values(plans)) Object.freeze(plan);

export const PLAN_CATALOG = Object.freeze(plans);

export function planFor(planId) {
  const plan = PLAN_CATALOG[planId];
  if (!plan) throw new Error(`Unknown usage plan: ${String(planId)}`);
  return plan;
}
