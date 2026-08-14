CREATE TYPE "public"."competition_phase" AS ENUM('draft', 'scheduled', 'open', 'auditing', 'final', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."evidence_action" AS ENUM('submission', 'vote');--> statement-breakpoint
CREATE TYPE "public"."evidence_status" AS ENUM('pending', 'valid', 'invalid', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."launch_status" AS ENUM('waiting', 'eligible', 'launched', 'void');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('draft', 'posting', 'accepted', 'hidden', 'disqualified', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."vote_status" AS ENUM('posting', 'valid', 'invalid');--> statement-breakpoint
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
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"contract_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"x_post_id" text NOT NULL,
	"x_author_id" text NOT NULL,
	"x_author_username" text NOT NULL,
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
	"x_user_id" text NOT NULL,
	"x_username" text NOT NULL,
	"display_name" text NOT NULL,
	"profile_image_url" text,
	"profile_url" text,
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
	"profile_fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
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
	"token" text NOT NULL,
	"reason" text NOT NULL,
	"post_text" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "x_action_challenges_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_vote_id_votes_id_fk" FOREIGN KEY ("vote_id") REFERENCES "public"."votes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_evidence_id_tweet_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."tweet_evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_checks" ADD CONSTRAINT "evidence_checks_evidence_id_tweet_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."tweet_evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finalization_runs" ADD CONSTRAINT "finalization_runs_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_queue" ADD CONSTRAINT "launch_queue_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launch_queue" ADD CONSTRAINT "launch_queue_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_rows" ADD CONSTRAINT "leaderboard_rows_snapshot_id_leaderboard_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."leaderboard_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_rows" ADD CONSTRAINT "leaderboard_rows_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_assets" ADD CONSTRAINT "proposal_assets_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_assets" ADD CONSTRAINT "proposal_assets_asset_id_eligible_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."eligible_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tweet_evidence" ADD CONSTRAINT "tweet_evidence_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tweet_evidence" ADD CONSTRAINT "tweet_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tweet_evidence" ADD CONSTRAINT "tweet_evidence_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_voter_user_id_users_id_fk" FOREIGN KEY ("voter_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_evidence_id_tweet_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."tweet_evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_action_challenges" ADD CONSTRAINT "x_action_challenges_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_action_challenges" ADD CONSTRAINT "x_action_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_action_challenges" ADD CONSTRAINT "x_action_challenges_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_actor_time_idx" ON "activity_events" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "eligible_asset_symbol_uq" ON "eligible_assets" USING btree (upper("symbol"));--> statement-breakpoint
CREATE UNIQUE INDEX "eligible_asset_contract_address_uq" ON "eligible_assets" USING btree (lower("contract_address"));--> statement-breakpoint
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
CREATE INDEX "x_action_challenge_lookup_idx" ON "x_action_challenges" USING btree ("user_id","proposal_id","expires_at");
--> statement-breakpoint
INSERT INTO "competitions" (
	"slug", "name", "phase", "starts_at", "ends_at", "min_followers", "min_account_age_days", "rules_frozen_at"
) VALUES (
	'genesis', 'Genesis Competition', 'open', CURRENT_TIMESTAMP,
	date_trunc('day', CURRENT_TIMESTAMP + interval '60 days'), 100, 30, CURRENT_TIMESTAMP
) ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
INSERT INTO "eligible_assets" ("symbol", "name", "contract_address") VALUES
  ('AAPL', 'Apple', '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9'),
  ('AMD', 'Advanced Micro Devices', '0x86923f96303D656E4aa86D9d42D1e57ad2023fdC'),
  ('AMZN', 'Amazon', '0x12f190a9F9d7D37a250758b26824B97CE941bF54'),
  ('ASML', 'ASML Holding', '0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA'),
  ('BABA', 'Alibaba Group', '0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4'),
  ('COIN', 'Coinbase', '0x6330D8C3178a418788dF01a47479c0ce7CCF450b'),
  ('COST', 'Costco Wholesale', '0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2'),
  ('CRCL', 'Circle Internet Group', '0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5'),
  ('DELL', 'Dell Technologies', '0x941AE714EC6D8130c7B75d67160Ca08f1e7d11Dd'),
  ('GME', 'GameStop', '0x1b0E319c6A659F002271B69dB8A7df2F911c153E'),
  ('GOOGL', 'Alphabet Class A', '0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3'),
  ('INTC', 'Intel', '0xc72b96e0E48ecd4DC75E1e45396e26300BC39681'),
  ('META', 'Meta Platforms', '0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35'),
  ('MSFT', 'Microsoft', '0xe93237C50D904957Cf27E7B1133b510C669c2e74'),
  ('MSTR', 'Strategy', '0xec262a75e413fAfD0dF80480274532C79D42da09'),
  ('MU', 'Micron Technology', '0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD'),
  ('NFLX', 'Netflix', '0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8'),
  ('NVDA', 'NVIDIA', '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC'),
  ('PLTR', 'Palantir Technologies', '0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A'),
  ('QQQ', 'Invesco QQQ Trust', '0xD5f3879160bc7c32ebb4dC785F8a4F505888de68'),
  ('QUBT', 'Quantum Computing Inc.', '0x59818904ab4cE163b3cE4FfB64f2D6Ca02c434B4'),
  ('RBLX', 'Roblox', '0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8'),
  ('RDDT', 'Reddit', '0x05b37Fb53A299a1b874A619e1c4C404D52C36F4C'),
  ('SGOV', 'iShares 0–3 Month Treasury Bond ETF', '0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5'),
  ('SLV', 'iShares Silver Trust', '0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f'),
  ('SNDK', 'Sandisk', '0xB90A19fF0Af67f7779afF50A882A9CfF42446400'),
  ('SPCX', 'SpaceX', '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa'),
  ('SPY', 'SPDR S&P 500 ETF Trust', '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C'),
  ('TSLA', 'Tesla', '0x322F0929c4625eD5bAd873c95208D54E1c003b2d'),
  ('TSM', 'Taiwan Semiconductor Manufacturing', '0x58FfE4a942d3885bAa22D7520691F611EF09e7AA'),
  ('TTWO', 'Take-Two Interactive', '0x5e81213613b6B86EaB4c6c50d718d34359459786'),
  ('USO', 'United States Oil Fund', '0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344')
ON CONFLICT DO NOTHING;
