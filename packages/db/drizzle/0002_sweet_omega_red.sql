ALTER TABLE "transactions" ADD COLUMN "occurred_on" date;--> statement-breakpoint

UPDATE transactions
   SET occurred_on = to_date(date, 'DD/MM/YYYY')
 WHERE occurred_on IS NULL;
--> statement-breakpoint

DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT COUNT(*) INTO bad_count FROM transactions WHERE occurred_on IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Backfill failed: % rows have NULL occurred_on. Inspect transactions.date for malformed values before re-running.', bad_count;
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "transactions" ALTER COLUMN "occurred_on" SET NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "transactions_user_occurred_idx"
  ON "transactions" ("user_id", "occurred_on" DESC);
