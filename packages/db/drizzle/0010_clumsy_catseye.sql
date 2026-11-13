ALTER TABLE "users" ADD COLUMN "ingest_key_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_ingest_key_hash_unique" UNIQUE("ingest_key_hash");