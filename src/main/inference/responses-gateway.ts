import type {
  AgentTurn,
  ModelToolSpec,
} from '../agent/agent-contracts';

import type {
  DispatchDisposition,
  InferenceCallMetadata,
} from './inference-contracts';
import type { InferenceProfile } from './inference-profile-policy';

export interface ResponsesGatewayRequest {
  credential: string;
  imageCount: number;
  input: Array<Record<string, unknown>>;
  instructions: string;
  profile: InferenceProfile;
  requestId: string;
  responsesUrl: string;
  sampleOrdinal: number;
  taskId: string;
  tools: readonly ModelToolSpec[];
}

export interface ResponsesGatewayResult {
  metadata: InferenceCallMetadata;
  turn: AgentTurn;
}

export class ResponsesGatewayError extends Error {
  constructor(
    message: string,
    readonly disposition: DispatchDisposition,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ResponsesGatewayError';
  }
}

export interface ResponsesGateway {
  call(
    request: ResponsesGatewayRequest,
    signal?: AbortSignal,
  ): Promise<ResponsesGatewayResult>;
}
