import { randomUUID } from 'node:crypto';

import OpenAI from 'openai';

export interface OpenAIClientFactoryOptions {
  accessTokenProvider: () => Promise<string | null>;
  apiBaseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  uuid?: () => string;
}

export interface HostedOpenAIClient {
  client: OpenAI;
  setUserTurnIds(clientTurnIds: readonly string[]): void;
}

interface AgentTurn {
  clientTurnId: string;
  id: string;
  taskId: string;
}

type AgentTurnReservation =
  | { kind: 'accepted'; turn: AgentTurn }
  | { kind: 'rejected'; response: Response };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function normalizeApiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/u, '') ?? '';
  if (!trimmed) return '';
  const url = new URL(trimmed);
  if (
    url.protocol !== 'https:' &&
    url.hostname !== '127.0.0.1' &&
    url.hostname !== 'localhost'
  ) {
    throw new Error('TROCODE_API_BASE_URL must use HTTPS.');
  }
  return url.toString().replace(/\/+$/u, '');
}

export class OpenAIClientFactory {
  private readonly apiBaseUrl: string;

  constructor(private readonly options: OpenAIClientFactoryOptions) {
    this.apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  }

  async create(taskId: string): Promise<HostedOpenAIClient> {
    if (!this.apiBaseUrl) {
      throw new Error('The TroCode model service is not configured.');
    }
    const credential = await this.options.accessTokenProvider();
    if (!credential) {
      throw new Error('Sign in with Google before starting the task.');
    }

    const acceptedTurns = new Map<string, AgentTurn>();
    const pendingTurns = new Map<string, Promise<AgentTurnReservation>>();
    let userTurnIds: readonly string[] = [];
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const reserveTurn = async (
      clientTurnId: string,
    ): Promise<AgentTurnReservation> => {
      const accepted = acceptedTurns.get(clientTurnId);
      if (accepted) return { kind: 'accepted', turn: accepted };
      const pending = pendingTurns.get(clientTurnId);
      if (pending) return pending;
      const reservation = (async (): Promise<AgentTurnReservation> => {
        const response = await fetchImpl(`${this.apiBaseUrl}/v1/agent-turns`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${credential}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ clientTurnId, taskId }),
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 45_000),
        });
        if (!response.ok) {
          return { kind: 'rejected', response };
        }
        const value: unknown = await response.json();
        if (
          !value ||
          typeof value !== 'object' ||
          !('id' in value) ||
          typeof value.id !== 'string' ||
          !UUID_PATTERN.test(value.id) ||
          !('clientTurnId' in value) ||
          value.clientTurnId !== clientTurnId ||
          !('taskId' in value) ||
          value.taskId !== taskId
        ) {
          throw new Error('TroCode returned an invalid agent turn.');
        }
        const turn = { clientTurnId, id: value.id, taskId };
        acceptedTurns.set(clientTurnId, turn);
        return { kind: 'accepted', turn };
      })();
      pendingTurns.set(clientTurnId, reservation);
      try {
        return await reservation;
      } finally {
        pendingTurns.delete(clientTurnId);
      }
    };

    const client = new OpenAI({
      apiKey: credential,
      baseURL: `${this.apiBaseUrl}/v1/openai`,
      fetch: async (url, init) => {
        let latestTurn: AgentTurn | null = null;
        for (const clientTurnId of userTurnIds) {
          const result = await reserveTurn(clientTurnId);
          if (result.kind === 'rejected') return result.response;
          latestTurn = result.turn;
        }
        if (!latestTurn) {
          throw new Error('A user turn is required before model inference.');
        }
        const headers = new Headers(init?.headers);
        headers.set('X-Trocode-Request-Id', (this.options.uuid ?? randomUUID)());
        headers.set('X-Trocode-Task-Id', taskId);
        headers.set('X-Trocode-Agent-Turn-Id', latestTurn.id);
        return fetchImpl(url, { ...init, headers });
      },
      maxRetries: 0,
      timeout: this.options.timeoutMs ?? 45_000,
    });
    return {
      client,
      setUserTurnIds(clientTurnIds) {
        const unique = [...new Set(clientTurnIds)];
        if (unique.some((value) => !UUID_PATTERN.test(value))) {
          throw new Error('Agent user turn IDs must be UUIDs.');
        }
        userTurnIds = unique;
      },
    };
  }
}
