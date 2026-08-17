import type { DispatchDisposition } from './inference-contracts';

export interface FallbackDecision {
  action: 'stop' | 'retry_same_model' | 'fallback_named_profile';
  reason: string;
}

export function decideFallback(input: {
  combinedReservationFits: boolean;
  disposition: DispatchDisposition;
  namedFallbackProfile: boolean;
  retryAfterSatisfied: boolean;
}): FallbackDecision {
  if (input.disposition !== 'rejected_before_inference') {
    return {
      action: 'stop',
      reason: 'The provider billing outcome may be ambiguous; do not duplicate it.',
    };
  }
  if (!input.combinedReservationFits || !input.retryAfterSatisfied) {
    return {
      action: 'stop',
      reason: 'A second reserved request is not currently permitted.',
    };
  }
  return input.namedFallbackProfile
    ? {
        action: 'fallback_named_profile',
        reason: 'A named, pre-dispatch fallback profile is authorized.',
      }
    : {
        action: 'retry_same_model',
        reason: 'The first request was explicitly rejected before inference.',
      };
}
