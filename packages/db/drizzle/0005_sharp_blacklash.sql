-- SIGN-OFF REQUIRED before running.
-- Take a Supabase point-in-time snapshot first.
-- Irreversible.
ALTER TABLE "transactions" DROP COLUMN IF EXISTS "date";