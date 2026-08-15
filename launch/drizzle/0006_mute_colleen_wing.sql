CREATE TYPE "public"."xp_run_status" AS ENUM('live', 'final');--> statement-breakpoint
CREATE TABLE "price_capture_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"requested_asset_ids" uuid[] NOT NULL,
	"missing_symbols" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"provider" text DEFAULT 'robinhood-bid' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_capture_run_status" CHECK ("price_capture_runs"."status" in ('complete', 'partial'))
);
--> statement-breakpoint
CREATE TABLE "vote_tranches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"ballot_id" uuid NOT NULL,
	"voter_user_id" text NOT NULL,
	"proposal_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"effective_entry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vote_tranche_quantity_positive" CHECK ("vote_tranches"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "xp_calculation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"status" "xp_run_status" NOT NULL,
	"calculated_at" timestamp with time zone NOT NULL,
	"price_checkpoint_at" timestamp with time zone,
	"performance_released" integer NOT NULL,
	"performance_allocated" integer NOT NULL,
	"participation_released" integer NOT NULL,
	"participation_allocated" integer NOT NULL,
	"creator_released" integer NOT NULL,
	"creator_allocated" integer NOT NULL,
	"policy_version" text NOT NULL,
	"canonical_hash" text NOT NULL,
	"canonical_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xp_snapshot_rows" (
	"run_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"performance_xp" integer NOT NULL,
	"participation_xp" integer NOT NULL,
	"creator_xp" integer NOT NULL,
	"total_xp" integer NOT NULL,
	"unique_supporter_count" integer DEFAULT 0 NOT NULL,
	"submission_boost" boolean DEFAULT false NOT NULL,
	"pending_tranche_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "xp_snapshot_rows_run_id_user_id_pk" PRIMARY KEY("run_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "asset_price_snapshots" ADD COLUMN "capture_run_id" uuid;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "initial_price_capture_run_id" uuid;--> statement-breakpoint
ALTER TABLE "vote_tranches" ADD CONSTRAINT "vote_tranches_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_tranches" ADD CONSTRAINT "vote_tranches_ballot_id_ballots_id_fk" FOREIGN KEY ("ballot_id") REFERENCES "public"."ballots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_tranches" ADD CONSTRAINT "vote_tranches_voter_user_id_users_id_fk" FOREIGN KEY ("voter_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_tranches" ADD CONSTRAINT "vote_tranches_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_tranches" ADD CONSTRAINT "vote_tranches_evidence_id_tweet_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."tweet_evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_calculation_runs" ADD CONSTRAINT "xp_calculation_runs_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_snapshot_rows" ADD CONSTRAINT "xp_snapshot_rows_run_id_xp_calculation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."xp_calculation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_snapshot_rows" ADD CONSTRAINT "xp_snapshot_rows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_capture_runs_sampled_at_idx" ON "price_capture_runs" USING btree ("sampled_at");--> statement-breakpoint
CREATE INDEX "vote_tranches_competition_idx" ON "vote_tranches" USING btree ("competition_id","accepted_at");--> statement-breakpoint
CREATE INDEX "vote_tranches_voter_idx" ON "vote_tranches" USING btree ("voter_user_id");--> statement-breakpoint
CREATE INDEX "vote_tranches_proposal_idx" ON "vote_tranches" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "xp_runs_competition_time_idx" ON "xp_calculation_runs" USING btree ("competition_id","calculated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "xp_final_once_uq" ON "xp_calculation_runs" USING btree ("competition_id") WHERE "xp_calculation_runs"."status" = 'final';--> statement-breakpoint
ALTER TABLE "asset_price_snapshots" ADD CONSTRAINT "asset_price_snapshots_capture_run_id_price_capture_runs_id_fk" FOREIGN KEY ("capture_run_id") REFERENCES "public"."price_capture_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_initial_price_capture_run_id_price_capture_runs_id_fk" FOREIGN KEY ("initial_price_capture_run_id") REFERENCES "public"."price_capture_runs"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposal_acceptance_has_initial_checkpoint" CHECK ("status" NOT IN ('accepted', 'hidden') OR ("accepted_at" IS NOT NULL AND "initial_price_capture_run_id" IS NOT NULL)) NOT VALID;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_vote_tranche_immutability() RETURNS trigger AS $$
BEGIN
  IF OLD.id <> NEW.id
    OR OLD.competition_id <> NEW.competition_id
    OR OLD.ballot_id <> NEW.ballot_id
    OR OLD.voter_user_id <> NEW.voter_user_id
    OR OLD.proposal_id <> NEW.proposal_id
    OR OLD.evidence_id <> NEW.evidence_id
    OR OLD.quantity <> NEW.quantity
    OR OLD.accepted_at <> NEW.accepted_at
    OR OLD.created_at <> NEW.created_at
    OR (OLD.effective_entry_at IS NOT NULL AND OLD.effective_entry_at IS DISTINCT FROM NEW.effective_entry_at)
  THEN
    RAISE EXCEPTION 'vote tranches are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER vote_tranches_immutable
BEFORE UPDATE ON "vote_tranches"
FOR EACH ROW EXECUTE FUNCTION protect_vote_tranche_immutability();
