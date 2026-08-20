ALTER TABLE access_codes
  ADD COLUMN IF NOT EXISTS code_ciphertext BYTEA;

COMMENT ON COLUMN access_codes.code_ciphertext IS
  'AES-256-GCM encrypted access code for authenticated admin retrieval. NULL identifies legacy digest-only rows.';
