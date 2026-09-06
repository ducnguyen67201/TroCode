import type { CuaStatus, VoiceStatus } from '../shared/contracts';
import { VOICE_TRANSCRIPTION_MODEL } from '../shared/contracts';

export const EMPTY_COMPUTER_STATUS: CuaStatus = {
  state: 'disconnected',
  available: false,
  platform: 'unsupported',
  summary: 'Checking the computer-use runtime…',
  nextActions: [],
};

export const EMPTY_VOICE_STATUS: VoiceStatus = {
  state: 'not_configured',
  provider: 'openai',
  model: VOICE_TRANSCRIPTION_MODEL,
  summary: 'Checking OpenAI GPT Transcribe…',
};
