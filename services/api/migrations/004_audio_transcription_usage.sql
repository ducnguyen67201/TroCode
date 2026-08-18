ALTER TABLE model_budget_reservations
  DROP CONSTRAINT IF EXISTS model_budget_reservations_lane_check;
ALTER TABLE model_budget_reservations
  ADD CONSTRAINT model_budget_reservations_lane_check
  CHECK (lane IN ('responses', 'realtime_transcription', 'transcription', 'speech'));

ALTER TABLE model_usage_events
  DROP CONSTRAINT IF EXISTS model_usage_events_lane_check;
ALTER TABLE model_usage_events
  ADD CONSTRAINT model_usage_events_lane_check
  CHECK (lane IN ('responses', 'realtime_transcription', 'transcription', 'speech'));
ALTER TABLE model_usage_events
  ADD COLUMN IF NOT EXISTS audio_duration_ms BIGINT NOT NULL DEFAULT 0
  CHECK (audio_duration_ms >= 0);
