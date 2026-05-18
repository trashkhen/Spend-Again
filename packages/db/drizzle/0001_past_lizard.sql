ALTER TABLE "users" ADD COLUMN "monthly_budget" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "budget_alert_pct" integer DEFAULT 100;