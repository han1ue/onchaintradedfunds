DROP TABLE IF EXISTS "activity_events";--> statement-breakpoint
DROP TABLE IF EXISTS "xp_snapshot_rows";--> statement-breakpoint
DROP TABLE IF EXISTS "xp_calculation_runs";--> statement-breakpoint
DROP TABLE IF EXISTS "leaderboard_rows";--> statement-breakpoint
DROP TABLE IF EXISTS "leaderboard_snapshots";--> statement-breakpoint
DROP TABLE IF EXISTS "launch_queue";--> statement-breakpoint
DROP TABLE IF EXISTS "finalization_runs";--> statement-breakpoint
ALTER TABLE "ballots" DROP COLUMN IF EXISTS "activated_at";--> statement-breakpoint
ALTER TABLE "competitions" DROP COLUMN IF EXISTS "launch_start_at";--> statement-breakpoint
ALTER TABLE "competitions" DROP COLUMN IF EXISTS "rules_frozen_at";--> statement-breakpoint
ALTER TABLE "competitions" DROP COLUMN IF EXISTS "finalized_at";--> statement-breakpoint
ALTER TABLE "ballots" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
UPDATE "ballots" SET "status" = 'invalid', "invalidated_at" = COALESCE("invalidated_at", NOW()) WHERE "status" = 'posting';--> statement-breakpoint
CREATE TYPE "public"."vote_status_new" AS ENUM('valid', 'invalid');--> statement-breakpoint
ALTER TABLE "ballots" ALTER COLUMN "status" TYPE "public"."vote_status_new" USING "status"::text::"public"."vote_status_new";--> statement-breakpoint
DROP TYPE "public"."vote_status";--> statement-breakpoint
ALTER TYPE "public"."vote_status_new" RENAME TO "vote_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."launch_status";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."xp_run_status";
