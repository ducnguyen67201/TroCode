import { createHash } from 'node:crypto';

import type {
  ModelSettings,
  ModelSettingsToolChoice,
} from '@openai/agents';

import {
  LOCAL_AGENT_PROTOCOL_DIGEST,
  LOCAL_AGENT_ROOT_ID,
  LOCAL_AGENT_SDK_VERSION,
  type LocalRuntimeToolSpec,
} from './protocol.js';
import { digest } from './serialization.js';

export const AGENT_INSTRUCTIONS = `You are Tro, a local computer-use agent. Fulfill the user's intent end to end using only the tools advertised for this turn.

Use the most direct available tool. Observe current state before making assumptions. After each tool result, decide the next step yourself. Tool interruptions are internal durability checkpoints, not user approvals. If a tool reports an unknown outcome with recovery instructions, follow those instructions: observe fresh state and decide the next action without replaying the uncertain invocation. Without a recovery instruction, stop on an unknown outcome. Verify intermediate UI changes before the next action and verify the user's goal before declaring completion. Finish with a concise account of what was achieved or why the goal could not be completed.`;

export const DEFAULT_AGENT_MODEL = 'gpt-5.6-luna' as const;

export const ROOT_AGENT_DEFINITION = Object.freeze({
  agentId: LOCAL_AGENT_ROOT_ID,
  displayName: 'Tro',
  handoffTargets: [] as readonly string[],
  instructions: AGENT_INSTRUCTIONS,
  instructionsDigest: digest(AGENT_INSTRUCTIONS),
  outputType: 'text' as const,
});

export function graphVersion(
  tools: readonly LocalRuntimeToolSpec[],
  model: string,
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      agents: [ROOT_AGENT_DEFINITION],
      model,
      modelSettings: modelSettings(),
      protocolDigest: LOCAL_AGENT_PROTOCOL_DIGEST,
      sdkVersion: LOCAL_AGENT_SDK_VERSION,
      tools: [...tools].sort((left, right) => left.toolId.localeCompare(right.toolId)),
    }))
    .digest('hex');
}

export function modelSettings(
  toolChoice: ModelSettingsToolChoice = 'auto',
): ModelSettings {
  return {
    maxTokens: 4_000,
    parallelToolCalls: false,
    retry: { maxRetries: 0 },
    store: false,
    toolChoice,
  };
}
