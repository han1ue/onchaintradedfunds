CREATE TYPE "public"."competition_phase" AS ENUM('draft', 'scheduled', 'open', 'auditing', 'final', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."evidence_action" AS ENUM('submission', 'vote');--> statement-breakpoint
CREATE TYPE "public"."evidence_status" AS ENUM('pending', 'valid', 'invalid', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."launch_status" AS ENUM('waiting', 'eligible', 'launched', 'void');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('draft', 'posting', 'accepted', 'hidden', 'disqualified', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."vote_status" AS ENUM('posting', 'valid', 'invalid');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid,
	"actor_user_id" text,
	"proposal_id" uuid,
	"vote_id" uuid,
	"evidence_id" uuid,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rule_version" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reverses_event_id" uuid
);
--> statement-breakpoint
CREATE TABLE "admin_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_eligibility_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"pool_id" uuid,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"block_number" numeric(78, 0),
	"liquidity" numeric(78, 0),
	"buy_quote_out" numeric(78, 0),
	"sell_quote_out" numeric(78, 0),
	"buy_price_impact_bps" integer,
	"sell_price_impact_bps" integer,
	"reference_notional_usd" numeric(20, 2) DEFAULT '1000' NOT NULL,
	"eligible" boolean NOT NULL,
	"reason" text NOT NULL,
	"config_version" text DEFAULT 'v1' NOT NULL,
	"raw_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"protocol" text DEFAULT 'uniswap-v3' NOT NULL,
	"pool_address" text NOT NULL,
	"usdg_address" text NOT NULL,
	"fee_tier" integer NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"phase" "competition_phase" DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"launch_start_at" timestamp with time zone,
	"launch_interval_days" integer DEFAULT 4 NOT NULL,
	"min_followers" integer DEFAULT 100 NOT NULL,
	"min_account_age_days" integer DEFAULT 30 NOT NULL,
	"min_assets" integer DEFAULT 2 NOT NULL,
	"min_asset_weight_bps" integer DEFAULT 100 NOT NULL,
	"rule_version" text DEFAULT 'v1' NOT NULL,
	"ranking_policy_version" text DEFAULT 'votes-v1' NOT NULL,
	"rules_frozen_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitions_slug_unique" UNIQUE("slug"),
	CONSTRAINT "competition_positive_thresholds" CHECK ("competitions"."min_followers" >= 0 and "competitions"."min_account_age_days" >= 0 and "competitions"."launch_interval_days" > 0),
	CONSTRAINT "competition_time_order" CHECK ("competitions"."ends_at" > "competitions"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "eligible_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"robinhood_uid" text NOT NULL,
	"chain_id" integer DEFAULT 4663 NOT NULL,
	"contract_address" text NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"logo_url" text,
	"status" text NOT NULL,
	"multiplier" numeric(38, 18) NOT NULL,
	"admin_enabled" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eligible_assets_robinhood_uid_unique" UNIQUE("robinhood_uid")
);
--> statement-breakpoint
CREATE TABLE "evidence_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_id" uuid NOT NULL,
	"status" "evidence_status" NOT NULL,
	"reason" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response_meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finalization_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"status" text NOT NULL,
	"cursor" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "launch_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"earliest_launch_at" timestamp with time zone NOT NULL,
	"status" "launch_status" DEFAULT 'waiting' NOT NULL,
	"launched_at" timestamp with time zone,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "launch_queue_proposal_id_unique" UNIQUE("proposal_id")
);
--> statement-breakpoint
CREATE TABLE "leaderboard_rows" (
	"snapshot_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"valid_votes" integer NOT NULL,
	CONSTRAINT "leaderboard_rows_snapshot_id_proposal_id_pk" PRIMARY KEY("snapshot_id","proposal_id")
);
--> statement-breakpoint
CREATE TABLE "leaderboard_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"canonical_hash" text NOT NULL,
	"canonical_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leaderboard_snapshots_competition_id_unique" UNIQUE("competition_id")
);
--> statement-breakpoint
CREATE TABLE "proposal_assets" (
	"proposal_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"eligibility_snapshot_id" uuid NOT NULL,
	"weight_bps" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "proposal_assets_proposal_id_asset_id_pk" PRIMARY KEY("proposal_id","asset_id"),
	CONSTRAINT "proposal_asset_minimum" CHECK ("proposal_assets"."weight_bps" >= 100 and "proposal_assets"."weight_bps" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"creator_user_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"ticker" text NOT NULL,
	"thesis" text NOT NULL,
	"status" "proposal_status" DEFAULT 'draft' NOT NULL,
	"accepted_at" timestamp with time zone,
	"moderated_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_ticker_format" CHECK ("proposals"."ticker" ~ '^[A-Z0-9][A-Z0-9-]{0,15}$'),
	CONSTRAINT "proposal_name_suffix" CHECK ("proposals"."name" like '% OTF'),
	CONSTRAINT "proposal_thesis_nonempty" CHECK (octet_length("proposals"."thesis") between 1 and 2048)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tweet_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" "evidence_action" NOT NULL,
	"competition_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"proposal_id" uuid NOT NULL,
	"identity_snapshot_id" uuid NOT NULL,
	"x_post_id" text NOT NULL,
	"x_author_id" text NOT NULL,
	"post_url" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"edit_history_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_hash" text NOT NULL,
	"status" "evidence_status" DEFAULT 'pending' NOT NULL,
	"reason" text,
	"verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"raw_text_expires_at" timestamp with time zone,
	"raw_text" text,
	CONSTRAINT "tweet_evidence_x_post_id_unique" UNIQUE("x_post_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"email_verified" timestamp,
	"image" text,
	"x_user_id" text,
	"x_username" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_x_user_id_unique" UNIQUE("x_user_id")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"voter_user_id" text NOT NULL,
	"evidence_id" uuid,
	"identity_snapshot_id" uuid NOT NULL,
	"follower_count" integer NOT NULL,
	"status" "vote_status" DEFAULT 'posting' NOT NULL,
	"accepted_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "votes_evidence_id_unique" UNIQUE("evidence_id")
);
--> statement-breakpoint
CREATE TABLE "x_action_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" "evidence_action" NOT NULL,
	"competition_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"proposal_id" uuid NOT NULL,
	"identity_snapshot_id" uuid NOT NULL,
	"token" text NOT NULL,
	"reason" text NOT NULL,
	"post_text" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "x_action_challenges_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "x_identity_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider_type" text,
	"x_user_id" text NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"profile_url" text,
	"profile_image_url" text,
	"cover_image_url" text,
	"description" text,
	"location" text,
	"account_created_at" timestamp with time zone NOT NULL,
	"protected" boolean NOT NULL,
	"verified" boolean NOT NULL,
	"blue_verified" boolean NOT NULL,
	"verified_type" text,
	"followers_count" integer NOT NULL,
	"following_count" integer NOT NULL,
	"can_dm" boolean,
	"favourites_count" integer,
	"has_custom_timelines" boolean,
	"translator" boolean,
	"media_count" integer,
	"tweet_count" integer NOT NULL,
	"withheld_in_countries" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"affiliates_highlighted_label" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"possibly_sensitive" boolean,
	"pinned_tweet_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"automated" boolean,
	"automated_by" text,
	"unavailable" boolean,
	"provider_message" text,
	"unavailable_reason" text,
	"profile_bio" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"response_status" text,
	"response_message" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_vote_id_votes_id_fk" FOREIGN KEY ("vote_id") REFERENCES "public"."votes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_evidence_id_tweet_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."tweet_evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_eligibility_snapshots" ADD CONSTRAINT "asset_eligibility_snapshots_asset_id_eligible_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."eligible_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_eligibility_snapshots" ADD CONSTRAINT "asset_eligibility_snapshots_pool_id_asset_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."asset_pools"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_pools" ADD CONSTRAINT "asset_pools_asset_id_eligible_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."eligible_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_checks" ADD CONSTRAINT "evidence_checks_evidence_id_tweet_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."tweet_evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finalization_runs" ADD CONSTRAINT "finalization_runs_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_queue" ADD CONSTRAINT "launch_queue_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_queue" ADD CONSTRAINT "launch_queue_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_rows" ADD CONSTRAINT "leaderboard_rows_snapshot_id_leaderboard_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."leaderboard_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_rows" ADD CONSTRAINT "leaderboard_rows_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_assets" ADD CONSTRAINT "proposal_assets_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_assets" ADD CONSTRAINT "proposal_assets_asset_id_eligible_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."eligible_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_assets" ADD CONSTRAINT "proposal_assets_eligibility_snapshot_id_asset_eligibility_snapshots_id_fk" FOREIGN KEY ("eligibility_snapshot_id") REFERENCES "public"."asset_eligibility_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tweet_evidence" ADD CONSTRAINT "tweet_evidence_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tweet_evidence" ADD CONSTRAINT "tweet_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tweet_evidence" ADD CONSTRAINT "tweet_evidence_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tweet_evidence" ADD CONSTRAINT "tweet_evidence_identity_snapshot_id_x_identity_snapshots_id_fk" FOREIGN KEY ("identity_snapshot_id") REFERENCES "public"."x_identity_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_voter_user_id_users_id_fk" FOREIGN KEY ("voter_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_evidence_id_tweet_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."tweet_evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_identity_snapshot_id_x_identity_snapshots_id_fk" FOREIGN KEY ("identity_snapshot_id") REFERENCES "public"."x_identity_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_action_challenges" ADD CONSTRAINT "x_action_challenges_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_action_challenges" ADD CONSTRAINT "x_action_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_action_challenges" ADD CONSTRAINT "x_action_challenges_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_action_challenges" ADD CONSTRAINT "x_action_challenges_identity_snapshot_id_x_identity_snapshots_id_fk" FOREIGN KEY ("identity_snapshot_id") REFERENCES "public"."x_identity_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_identity_snapshots" ADD CONSTRAINT "x_identity_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_actor_time_idx" ON "activity_events" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "asset_snapshot_latest_idx" ON "asset_eligibility_snapshots" USING btree ("asset_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_pool_address_uq" ON "asset_pools" USING btree (lower("pool_address"));--> statement-breakpoint
CREATE UNIQUE INDEX "eligible_asset_chain_address_uq" ON "eligible_assets" USING btree ("chain_id",lower("contract_address"));--> statement-breakpoint
CREATE INDEX "eligible_asset_enabled_idx" ON "eligible_assets" USING btree ("admin_enabled","status");--> statement-breakpoint
CREATE INDEX "evidence_check_history_idx" ON "evidence_checks" USING btree ("evidence_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "launch_queue_rank_uq" ON "launch_queue" USING btree ("competition_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_rank_uq" ON "leaderboard_rows" USING btree ("snapshot_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_asset_position_uq" ON "proposal_assets" USING btree ("proposal_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_competition_slug_uq" ON "proposals" USING btree ("competition_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_competition_name_uq" ON "proposals" USING btree ("competition_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_competition_ticker_uq" ON "proposals" USING btree ("competition_id",lower("ticker"));--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_one_creator_uq" ON "proposals" USING btree ("competition_id","creator_user_id");--> statement-breakpoint
CREATE INDEX "tweet_evidence_competition_status_idx" ON "tweet_evidence" USING btree ("competition_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_evidence_once_uq" ON "tweet_evidence" USING btree ("proposal_id") WHERE "tweet_evidence"."action" = 'submission';--> statement-breakpoint
CREATE UNIQUE INDEX "vote_once_per_otf_uq" ON "votes" USING btree ("competition_id","proposal_id","voter_user_id");--> statement-breakpoint
CREATE INDEX "valid_votes_idx" ON "votes" USING btree ("proposal_id","status");--> statement-breakpoint
CREATE INDEX "x_action_challenge_lookup_idx" ON "x_action_challenges" USING btree ("user_id","proposal_id","expires_at");--> statement-breakpoint
CREATE INDEX "x_identity_user_observed_idx" ON "x_identity_snapshots" USING btree ("user_id","observed_at");--> statement-breakpoint
INSERT INTO "competitions" (
	"slug",
	"name",
	"phase",
	"starts_at",
	"ends_at",
	"min_followers",
	"min_account_age_days",
	"rules_frozen_at"
) VALUES (
	'genesis',
	'Genesis Competition',
	'open',
	CURRENT_TIMESTAMP,
	date_trunc('day', CURRENT_TIMESTAMP + interval '60 days'),
	100,
	30,
	CURRENT_TIMESTAMP
) ON CONFLICT ("slug") DO NOTHING;
