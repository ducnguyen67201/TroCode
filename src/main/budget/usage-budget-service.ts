import {
  UsageBudgetSnapshotSchema,
  type UsageBudgetSnapshot,
} from '../../shared/contracts';

function localSnapshot(): UsageBudgetSnapshot {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const empty = {
    limitMicroUsd: 0,
    remainingMicroUsd: 0,
    reservedMicroUsd: 0,
    settledMicroUsd: 0,
  };
  return UsageBudgetSnapshotSchema.parse({
    actualMicroUsd: 0,
    daily: empty,
    enforcementMode: 'observe',
    estimatedMicroUsd: 0,
    monthEndsAt: end.toISOString(),
    monthly: empty,
    periodStartsAt: start.toISOString(),
    source: 'local_advisory',
    task: empty,
    warningThresholdMicroUsd: 0,
  });
}

export class UsageBudgetService {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly accessTokenProvider: () => Promise<string | null>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async get(taskId?: string): Promise<UsageBudgetSnapshot> {
    const baseUrl = this.apiBaseUrl.trim().replace(/\/+$/u, '');
    if (!baseUrl) return localSnapshot();
    const credential = await this.accessTokenProvider();
    if (!credential) throw new Error('Sign in to view the hosted usage budget.');
    const url = new URL(`${baseUrl}/v1/usage/budget`);
    if (taskId) url.searchParams.set('taskId', taskId);
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${credential}` },
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Usage budget returned HTTP ${response.status}.`);
    }
    return UsageBudgetSnapshotSchema.parse({
      ...(await response.json()),
      source: 'hosted',
    });
  }
}
