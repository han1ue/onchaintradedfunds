DROP INDEX "proposal_competition_slug_uq";--> statement-breakpoint
DROP INDEX "proposal_competition_name_uq";--> statement-breakpoint
DROP INDEX "proposal_competition_ticker_uq";--> statement-breakpoint
ALTER TYPE "public"."proposal_status" RENAME TO "proposal_status_old";--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM ('draft', 'confirmed', 'expired', 'deleted');--> statement-breakpoint
ALTER TABLE "proposals" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "proposals" ALTER COLUMN "status" TYPE "public"."proposal_status" USING "status"::text::"public"."proposal_status";--> statement-breakpoint
ALTER TABLE "proposals" ALTER COLUMN "status" SET DEFAULT 'draft';--> statement-breakpoint
DROP TYPE "public"."proposal_status_old";--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "draft_expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "proposals" SET "draft_expires_at" = "created_at" + interval '24 hours' WHERE "status" = 'draft' AND "draft_expires_at" IS NULL;--> statement-breakpoint
UPDATE "proposals" SET "status" = 'expired', "updated_at" = CURRENT_TIMESTAMP WHERE "status" = 'draft' AND "draft_expires_at" <= CURRENT_TIMESTAMP;--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_competition_slug_uq" ON "proposals" USING btree ("competition_id", "slug") WHERE "proposals"."status" in ('draft', 'confirmed');--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_competition_name_uq" ON "proposals" USING btree ("competition_id", lower("name")) WHERE "proposals"."status" in ('draft', 'confirmed');--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_competition_ticker_uq" ON "proposals" USING btree ("competition_id", lower("ticker")) WHERE "proposals"."status" in ('draft', 'confirmed');--> statement-breakpoint
CREATE INDEX "proposal_draft_expiry_idx" ON "proposals" USING btree ("draft_expires_at") WHERE "proposals"."status" = 'draft';--> statement-breakpoint
CREATE OR REPLACE FUNCTION "protect_proposal_inputs_after_close"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD."status" IN ('draft', 'expired')
    AND NEW."status" IN ('expired', 'deleted')
    AND NEW."id" IS NOT DISTINCT FROM OLD."id"
    AND NEW."competition_id" IS NOT DISTINCT FROM OLD."competition_id"
    AND NEW."creator_user_id" IS NOT DISTINCT FROM OLD."creator_user_id"
    AND NEW."slug" IS NOT DISTINCT FROM OLD."slug"
    AND NEW."name" IS NOT DISTINCT FROM OLD."name"
    AND NEW."ticker" IS NOT DISTINCT FROM OLD."ticker"
    AND NEW."thesis" IS NOT DISTINCT FROM OLD."thesis"
    AND NEW."accepted_at" IS NOT DISTINCT FROM OLD."accepted_at"
    AND NEW."moderated_reason" IS NOT DISTINCT FROM OLD."moderated_reason"
    AND NEW."created_at" IS NOT DISTINCT FROM OLD."created_at"
    AND NEW."draft_expires_at" IS NOT DISTINCT FROM OLD."draft_expires_at"
    AND ((NEW."status" = 'expired' AND NEW."draft_allocations" IS NOT DISTINCT FROM OLD."draft_allocations") OR (NEW."status" = 'deleted' AND NEW."draft_allocations" = '[]'::jsonb))
  THEN RETURN NEW;
  END IF;
  PERFORM "assert_competition_inputs_mutable"(COALESCE(NEW."competition_id", OLD."competition_id"));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "competitions" WHERE "rules_hash" <> '4b63532c5d7b50d30209b760eace59027e77942adc70a9996420f655457ce0f2' AND "rules_hash" <> '5df25ba08c24842420a2523d327f81dabd673f8fad50b2a415b685d86ea3dfb9') THEN
    RAISE EXCEPTION 'Refusing to replace an unrecognized competition rules snapshot';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "competitions" c
    WHERE c."rules_hash" = '5df25ba08c24842420a2523d327f81dabd673f8fad50b2a415b685d86ea3dfb9'
      AND (
        EXISTS (SELECT 1 FROM "proposals" p WHERE p."competition_id" = c."id" AND p."status" = 'confirmed')
        OR EXISTS (SELECT 1 FROM "tweet_evidence" te WHERE te."competition_id" = c."id")
        OR EXISTS (SELECT 1 FROM "ballots" b WHERE b."competition_id" = c."id")
        OR EXISTS (SELECT 1 FROM "vote_tranches" vt WHERE vt."competition_id" = c."id")
      )
  ) THEN
    RAISE EXCEPTION 'Refusing to alter a live competition containing real participant data; create a new competition rules snapshot';
  END IF;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "protect_competition_singleton"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'The singleton competition cannot be deleted'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."singleton" IS DISTINCT FROM OLD."singleton" THEN RAISE EXCEPTION 'The singleton competition identity is immutable'; END IF;
  IF OLD."phase" IN ('open', 'auditing', 'final', 'cancelled') AND (NEW."rules" IS DISTINCT FROM OLD."rules" OR NEW."rules_hash" IS DISTINCT FROM OLD."rules_hash" OR NEW."rules_frozen_at" IS DISTINCT FROM OLD."rules_frozen_at") AND NOT (
    OLD."rules_hash" = '5df25ba08c24842420a2523d327f81dabd673f8fad50b2a415b685d86ea3dfb9'
    AND NEW."rules_hash" = '4b63532c5d7b50d30209b760eace59027e77942adc70a9996420f655457ce0f2'
    AND NEW."rules" = jsonb_set(OLD."rules", '{maxProposalsPerAccount}', '10'::jsonb)
    AND NEW."rules_frozen_at" IS NOT DISTINCT FROM OLD."rules_frozen_at"
  ) THEN RAISE EXCEPTION 'Competition rules are frozen'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
UPDATE "competitions" SET "rules" = jsonb_set("rules", '{maxProposalsPerAccount}', '10'::jsonb), "rules_hash" = '4b63532c5d7b50d30209b760eace59027e77942adc70a9996420f655457ce0f2', "updated_at" = CURRENT_TIMESTAMP WHERE "rules_hash" = '5df25ba08c24842420a2523d327f81dabd673f8fad50b2a415b685d86ea3dfb9';--> statement-breakpoint
CREATE OR REPLACE FUNCTION "protect_competition_singleton"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'The singleton competition cannot be deleted'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."singleton" IS DISTINCT FROM OLD."singleton" THEN RAISE EXCEPTION 'The singleton competition identity is immutable'; END IF;
  IF OLD."phase" IN ('open', 'auditing', 'final', 'cancelled') AND (NEW."rules" IS DISTINCT FROM OLD."rules" OR NEW."rules_hash" IS DISTINCT FROM OLD."rules_hash" OR NEW."rules_frozen_at" IS DISTINCT FROM OLD."rules_frozen_at") THEN RAISE EXCEPTION 'Competition rules are frozen'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
