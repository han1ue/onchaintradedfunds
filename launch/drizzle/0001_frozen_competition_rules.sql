ALTER TABLE "competitions" ADD COLUMN IF NOT EXISTS "rules" jsonb;--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN IF NOT EXISTS "rules_hash" text;--> statement-breakpoint
ALTER TABLE "competitions" ADD COLUMN IF NOT EXISTS "rules_frozen_at" timestamp with time zone;--> statement-breakpoint
UPDATE "competitions"
SET
  "rules" = COALESCE(
    "rules",
    '{"minFollowers":100,"minAccountAgeDays":30,"minAssets":2,"minAssetWeightBps":100,"portfolioWeightBps":10000,"submissionOnlyDays":7,"votingDays":30,"initialVotes":3,"votesPerUnlock":1,"voteUnlockIntervalDays":3,"totalVotes":12,"maxProposalsPerAccount":null,"eligibilityAllowlistBypasses":["verified","minFollowers"]}'::jsonb
  ),
  "rules_hash" = COALESCE("rules_hash", '5df25ba08c24842420a2523d327f81dabd673f8fad50b2a415b685d86ea3dfb9'),
  "rules_frozen_at" = COALESCE("rules_frozen_at", "starts_at")
WHERE "rules" IS NULL OR "rules_hash" IS NULL OR "rules_frozen_at" IS NULL;--> statement-breakpoint
ALTER TABLE "competitions" ALTER COLUMN "rules" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "competitions" ALTER COLUMN "rules_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "competitions" ALTER COLUMN "rules_frozen_at" SET NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'competition_rules_hash'
      AND conrelid = 'competitions'::regclass
  ) THEN
    ALTER TABLE "competitions"
      ADD CONSTRAINT "competition_rules_hash" CHECK ("rules_hash" ~ '^[0-9a-f]{64}$');
  END IF;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "protect_competition_singleton"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'The singleton competition cannot be deleted';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."singleton" IS DISTINCT FROM OLD."singleton" THEN
    RAISE EXCEPTION 'The singleton competition identity is immutable';
  END IF;
  IF OLD."phase" IN ('open', 'auditing', 'final', 'cancelled') AND (
    NEW."rules" IS DISTINCT FROM OLD."rules"
    OR NEW."rules_hash" IS DISTINCT FROM OLD."rules_hash"
    OR NEW."rules_frozen_at" IS DISTINCT FROM OLD."rules_frozen_at"
  ) THEN
    RAISE EXCEPTION 'Competition rules are frozen';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS "competition_singleton_immutable" ON "competitions";--> statement-breakpoint
CREATE TRIGGER "competition_singleton_immutable"
BEFORE UPDATE OR DELETE ON "competitions"
FOR EACH ROW EXECUTE FUNCTION "protect_competition_singleton"();
