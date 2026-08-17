import {
  developerMessageInputItem,
  toolOutputInputItem,
  userMessageInputItem,
  type AgentToolOutput,
  type AgentTurn,
} from '../agent/agent-contracts';

import {
  countCurrentImages,
  demoteVisualEvidence,
  prepareContextWindow,
} from './context-window-policy';

const MAX_HISTORY_ITEMS = 192;
const MAX_HISTORY_BYTES = 12_000_000;

export interface InferenceSessionOptions {
  credential: string;
  request: string;
  responsesUrl: string;
  taskId: string;
}

function assertHistoryBounded(items: readonly Record<string, unknown>[]): void {
  if (items.length > MAX_HISTORY_ITEMS) {
    throw new Error('The inference session reached its item limit.');
  }
  if (JSON.stringify(items).length > MAX_HISTORY_BYTES) {
    throw new Error('The inference session reached its memory limit.');
  }
}

export class InferenceSession {
  readonly credential: string;

  readonly request: string;

  readonly responsesUrl: string;

  readonly taskId: string;

  private items: Array<Record<string, unknown>>;

  private pendingCallIds = new Set<string>();

  private sampleCount = 0;

  private visualEvidencePending = false;

  constructor(options: InferenceSessionOptions) {
    this.credential = options.credential;
    this.request = options.request;
    this.responsesUrl = options.responsesUrl;
    this.taskId = options.taskId;
    this.items = [userMessageInputItem(options.request)];
  }

  appendToolOutput(output: AgentToolOutput): void {
    if (!this.pendingCallIds.delete(output.callId)) {
      throw new Error(
        `Tool output does not match an outstanding model call: ${output.callId}`,
      );
    }
    const item = toolOutputInputItem(output);
    this.items.push(item);
    this.visualEvidencePending = countCurrentImages([item]) > 0;
    assertHistoryBounded(this.items);
  }

  appendUserMessage(text: string): void {
    this.items.push(userMessageInputItem(text));
    assertHistoryBounded(this.items);
  }

  appendDeveloperMessage(text: string): void {
    this.items.push(developerMessageInputItem(text));
    assertHistoryBounded(this.items);
  }

  beginSample(): {
    hasCurrentImage: boolean;
    imageCount: number;
    input: Array<Record<string, unknown>>;
    ordinal: number;
  } {
    if (this.pendingCallIds.size > 0) {
      throw new Error('The previous model tool call still needs an output.');
    }
    const input = prepareContextWindow(this.items, this.visualEvidencePending);
    const imageCount = countCurrentImages(input);
    this.sampleCount += 1;
    return {
      hasCurrentImage: imageCount > 0,
      imageCount,
      input,
      ordinal: this.sampleCount,
    };
  }

  recordTurn(turn: AgentTurn): void {
    this.items = demoteVisualEvidence(this.items);
    this.visualEvidencePending = false;
    this.items.push(...turn.responseItems);
    if (turn.kind === 'tool_call') {
      if (this.pendingCallIds.has(turn.call.callId)) {
        throw new Error('The provider reused a pending function call ID.');
      }
      this.pendingCallIds.add(turn.call.callId);
    }
    assertHistoryBounded(this.items);
  }
}
