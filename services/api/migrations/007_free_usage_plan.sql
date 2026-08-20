ALTER TABLE access_codes
  DROP CONSTRAINT IF EXISTS access_codes_plan_check;
ALTER TABLE access_codes
  ADD CONSTRAINT access_codes_plan_check
  CHECK (plan IN ('free', 'basic', 'pro', 'max'));
ALTER TABLE access_codes
  ALTER COLUMN plan SET DEFAULT 'free';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'
  CHECK (plan IN ('free', 'basic', 'pro', 'max'));

UPDATE users
SET plan = access_codes.plan
FROM access_code_redemptions
JOIN access_codes
  ON access_codes.id = access_code_redemptions.access_code_id
WHERE access_code_redemptions.user_id = users.id
  AND users.plan IS DISTINCT FROM access_codes.plan;

ALTER TABLE agent_turns
  DROP CONSTRAINT IF EXISTS agent_turns_plan_check;
ALTER TABLE agent_turns
  ADD CONSTRAINT agent_turns_plan_check
  CHECK (plan IN ('free', 'basic', 'pro', 'max'));
