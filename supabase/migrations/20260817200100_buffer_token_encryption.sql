-- Buffer access tokens were stored plaintext while the UI claimed
-- "encrypted at rest". Add an encrypted column (AES-GCM "v1.<iv>.<ct>"
-- format, same scheme as provider API keys). The plaintext access_token
-- column is intentionally kept and still written during the transition:
-- cron executors read it directly, so it is only blanked once every reader
-- has migrated to access_token_enc.
ALTER TABLE public.buffer_connection ADD COLUMN IF NOT EXISTS access_token_enc TEXT;
