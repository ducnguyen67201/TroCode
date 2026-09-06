import type { VoiceDiagnostic, VoiceMode } from '../../../shared/contracts';
import type { PushToTalkPlatform } from '../../push-to-talk';
import { type VoiceCapturePipeline } from '../../voice-capture';
import type {
  OrderedTranscriptAssembler,
  SegmentUploadQueue,
  VoiceSegmenter,
  FinalizedVoiceSegment,
} from '../../voice-segmentation';

export type VoiceInputStatus =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'committing'
  | 'requesting_permission'
  | 'unavailable';

export type VoiceConnectionStep = VoiceDiagnostic['step'];

export type VoiceActivationMode = 'global_hold' | 'local_hold';

export interface VoiceTurnContext {
  activation: VoiceActivationMode;
  mode: VoiceMode;
  turnId: string;
}

export interface VoiceAttemptDecision {
  accepted: boolean;
  destination: {
    kind: 'application' | 'tro_composer' | 'task';
    label: string;
  };
}

export type VoiceTurnEndReason =
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'no_speech'
  | 'partial_failure'
  | 'preflight_rejected';

export type VoiceCommitDisposition = 'completed' | 'task_submitted';

export interface UsePushToTalkOptions {
  disabled?: boolean;
  enabled?: boolean;
  onAttemptStart(context: VoiceTurnContext): Promise<VoiceAttemptDecision>;
  onError(message: string): void;
  onTranscriptChange(context: VoiceTurnContext, transcript: string): void;
  onTranscriptReady(
    context: VoiceTurnContext,
    transcript: string,
  ): Promise<VoiceCommitDisposition | void>;
  onTurnEnd(context: VoiceTurnContext, reason: VoiceTurnEndReason): void;
  selectedMode: VoiceMode;
}

export interface PushToTalkState {
  cancel(): void;
  isHolding: boolean;
  mode: VoiceMode | null;
  platform: PushToTalkPlatform;
  status: VoiceInputStatus;
}

export interface ActiveVoiceTurn {
  abortController: AbortController;
  assembler: OrderedTranscriptAssembler;
  attempt: number;
  cancelled: boolean;
  capture: VoiceCapturePipeline | null;
  context: VoiceTurnContext;
  endNotified: boolean;
  expectedSegmentCount: number | null;
  finalizing: boolean;
  limitReached: boolean;
  queue: SegmentUploadQueue<FinalizedVoiceSegment, void>;
  released: boolean;
  releasedAt: number | null;
  segmentCount: number;
  segmenter: VoiceSegmenter;
}

export interface PushToTalkAttemptReadiness {
  disabled: boolean;
  enabled: boolean;
  hasActiveTurn: boolean;
  isChordHeld: boolean;
  platform: PushToTalkPlatform;
}

export interface VoiceShortcutEventHandlers {
  beginListening(mode: VoiceMode): unknown;
  finishListening(): void;
  isListening: boolean;
  selectedMode: VoiceMode;
}

export interface LocalVoiceReleaseState {
  activationMode: VoiceActivationMode | null;
  isListening: boolean;
  isLocalChordHeld: boolean;
}
