import type { AgentInputItem, Session } from '@openai/agents';

import {
  countCurrentImages,
  demoteVisualEvidence,
  prepareContextWindow,
} from '../inference/context-window-policy';

const MAX_HISTORY_ITEMS = 192;
const MAX_HISTORY_BYTES = 12_000_000;

function copy(items: readonly AgentInputItem[]): AgentInputItem[] {
  return structuredClone(items) as AgentInputItem[];
}

function bounded(items: readonly AgentInputItem[]): AgentInputItem[] {
  if (items.length > MAX_HISTORY_ITEMS) {
    throw new Error('The agent session reached its item limit.');
  }
  if (JSON.stringify(items).length > MAX_HISTORY_BYTES) {
    throw new Error('The agent session reached its memory limit.');
  }
  return copy(items);
}

/** In-memory task history with one retained current screenshot and hard bounds. */
export class BoundedAgentSession implements Session {
  private items: AgentInputItem[] = [];

  constructor(private readonly sessionId: string) {}

  async getSessionId(): Promise<string> {
    return this.sessionId;
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    const items = limit === undefined ? this.items : this.items.slice(-limit);
    return copy(items);
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    const previous = demoteVisualEvidence(
      this.items as Array<Record<string, unknown>>,
    );
    const incomingRecords = items as Array<Record<string, unknown>>;
    const incoming = prepareContextWindow(
      incomingRecords,
      countCurrentImages(incomingRecords) > 0,
    );
    this.items = bounded([
      ...(previous as AgentInputItem[]),
      ...(incoming as AgentInputItem[]),
    ]);
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    const item = this.items.pop();
    return item ? structuredClone(item) : undefined;
  }

  async clearSession(): Promise<void> {
    this.items = [];
  }
}
