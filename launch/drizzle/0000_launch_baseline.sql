CREATE TYPE "public"."competition_phase" AS ENUM('draft', 'scheduled', 'open', 'auditing', 'final', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."evidence_action" AS ENUM('submission', 'vote');--> statement-breakpoint
CREATE TYPE "public"."evidence_status" AS ENUM('pending', 'valid', 'invalid', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('draft', 'confirmed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."vote_status" AS ENUM('valid', 'invalid');--> statement-breakpoint
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
	"market_id" uuid NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"liquidity_usd" numeric(24, 8),
	"market_cap_usd" numeric(30, 2),
	"market_cap_verified" boolean,
	"gt_verified" boolean,
	"gt_score" numeric(8, 2),
	"is_honeypot" boolean,
	"locked_liquidity_pct" numeric(8, 4),
	"reasons" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"provider_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "asset_eligibility_snapshots_market_id_sampled_at_pk" PRIMARY KEY("market_id","sampled_at"),
	CONSTRAINT "asset_eligibility_status" CHECK ("asset_eligibility_snapshots"."status" in ('Pass', 'Pending', 'Fail'))
);
--> statement-breakpoint
CREATE TABLE "asset_market_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_user_id" text NOT NULL,
	"network" text DEFAULT 'robinhood-mainnet' NOT NULL,
	"asset_address" text NOT NULL,
	"pool_address" text,
	"pricing_source" text NOT NULL,
	"primary_address" text NOT NULL,
	"secondary_address" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_market_request_status" CHECK ("asset_market_requests"."status" in ('pending', 'registered', 'rejected')),
	CONSTRAINT "asset_market_request_pricing_source" CHECK ("asset_market_requests"."pricing_source" in ('chainlink-direct', 'chainlink-weth', 'uniswap-v3')),
	CONSTRAINT "asset_market_request_pricing_shape" CHECK ((
    "asset_market_requests"."pricing_source" in ('chainlink-direct', 'uniswap-v3') and "asset_market_requests"."secondary_address" is null
  ) or (
    "asset_market_requests"."pricing_source" = 'chainlink-weth' and "asset_market_requests"."secondary_address" is not null
  )),
	CONSTRAINT "asset_market_request_pricing_addresses" CHECK ("asset_market_requests"."primary_address" ~ '^0x[0-9a-fA-F]{40}$' and ("asset_market_requests"."secondary_address" is null or "asset_market_requests"."secondary_address" ~ '^0x[0-9a-fA-F]{40}$'))
);
--> statement-breakpoint
CREATE TABLE "asset_markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"market_id" text NOT NULL,
	"pool_address" text NOT NULL,
	"factory_address" text NOT NULL,
	"quote_token_address" text NOT NULL,
	"fee_tier" integer NOT NULL,
	"version" text DEFAULT 'v3' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"pool_created_at" timestamp with time zone,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_markets_market_id_unique" UNIQUE("market_id"),
	CONSTRAINT "asset_market_v3_only" CHECK ("asset_markets"."version" = 'v3'),
	CONSTRAINT "asset_market_fee_positive" CHECK ("asset_markets"."fee_tier" > 0)
);
--> statement-breakpoint
CREATE TABLE "asset_price_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"capture_run_id" uuid,
	"quote_generated_at" timestamp with time zone NOT NULL,
	"bid_usd" numeric(24, 8) NOT NULL,
	"twap_window_seconds" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_pricing_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"source" text NOT NULL,
	"primary_address" text NOT NULL,
	"secondary_address" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_pricing_config_source" CHECK ("asset_pricing_configs"."source" in ('chainlink-direct', 'chainlink-weth', 'uniswap-v3')),
	CONSTRAINT "asset_pricing_config_shape" CHECK ((
    "asset_pricing_configs"."source" in ('chainlink-direct', 'uniswap-v3') and "asset_pricing_configs"."secondary_address" is null
  ) or (
    "asset_pricing_configs"."source" = 'chainlink-weth' and "asset_pricing_configs"."secondary_address" is not null
  )),
	CONSTRAINT "asset_pricing_config_addresses" CHECK ("asset_pricing_configs"."primary_address" ~ '^0x[0-9a-fA-F]{40}$' and ("asset_pricing_configs"."secondary_address" is null or "asset_pricing_configs"."secondary_address" ~ '^0x[0-9a-fA-F]{40}$'))
);
--> statement-breakpoint
CREATE TABLE "ballot_allocations" (
	"ballot_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"votes" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ballot_allocations_ballot_id_proposal_id_pk" PRIMARY KEY("ballot_id","proposal_id"),
	CONSTRAINT "ballot_allocation_votes_range" CHECK ("ballot_allocations"."votes" between 1 and 12)
);
--> statement-breakpoint
CREATE TABLE "ballots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"voter_user_id" text NOT NULL,
	"follower_count" integer NOT NULL,
	"status" "vote_status" NOT NULL,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"singleton" boolean DEFAULT true NOT NULL,
	"phase" "competition_phase" DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"rules" jsonb NOT NULL,
	"rules_hash" text NOT NULL,
	"rules_frozen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitions_singleton_unique" UNIQUE("singleton"),
	CONSTRAINT "competition_singleton" CHECK ("competitions"."singleton" = true),
	CONSTRAINT "competition_time_order" CHECK ("competitions"."ends_at" > "competitions"."starts_at"),
	CONSTRAINT "competition_rules_hash" CHECK ("competitions"."rules_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "eligible_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"contract_address" text NOT NULL,
	"network" text DEFAULT 'robinhood-mainnet' NOT NULL,
	"chain_id" integer,
	"decimals" integer DEFAULT 18 NOT NULL,
	"quality" text DEFAULT 'normal' NOT NULL,
	"price_source" text DEFAULT 'robinhood-bid' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eligible_asset_contract_address" CHECK ("eligible_assets"."contract_address" ~ '^0x[0-9a-fA-F]{40}$'),
	CONSTRAINT "eligible_asset_price_source" CHECK ("eligible_assets"."price_source" in ('robinhood-bid', 'coinbase-eth-usd-bid', 'coingecko-usd')),
	CONSTRAINT "eligible_asset_quality" CHECK ("eligible_assets"."quality" in ('high', 'normal')),
	CONSTRAINT "eligible_asset_exact_decimals" CHECK ("eligible_assets"."decimals" = 18)
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
CREATE TABLE "price_capture_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"capture_key" text NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"requested_asset_ids" uuid[] NOT NULL,
	"missing_symbols" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"provider" text DEFAULT 'robinhood-bid' NOT NULL,
	"purpose" text DEFAULT 'scoring' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_capture_run_status" CHECK ("price_capture_runs"."status" in ('complete', 'partial')),
	CONSTRAINT "price_capture_run_purpose" CHECK ("price_capture_runs"."purpose" in ('submission', 'entry', 'final', 'scoring'))
);
--> statement-breakpoint
CREATE TABLE "proposal_assets" (
	"proposal_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"market_id" uuid,
	"pricing_source" text,
	"primary_address" text,
	"secondary_address" text,
	"weight_bps" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "proposal_assets_proposal_id_asset_id_pk" PRIMARY KEY("proposal_id","asset_id"),
	CONSTRAINT "proposal_asset_minimum" CHECK ("proposal_assets"."weight_bps" >= 100 and "proposal_assets"."weight_bps" <= 10000),
	CONSTRAINT "proposal_asset_pricing_source" CHECK ("proposal_assets"."pricing_source" is null or "proposal_assets"."pricing_source" in ('chainlink-direct', 'chainlink-weth', 'uniswap-v3')),
	CONSTRAINT "proposal_asset_pricing_shape" CHECK ("proposal_assets"."pricing_source" is null or (
    "proposal_assets"."pricing_source" in ('chainlink-direct', 'uniswap-v3') and "proposal_assets"."primary_address" is not null and "proposal_assets"."secondary_address" is null
  ) or (
    "proposal_assets"."pricing_source" = 'chainlink-weth' and "proposal_assets"."primary_address" is not null and "proposal_assets"."secondary_address" is not null
  )),
	CONSTRAINT "proposal_asset_pricing_addresses" CHECK ("proposal_assets"."pricing_source" is null or ("proposal_assets"."primary_address" ~ '^0x[0-9a-fA-F]{40}$' and ("proposal_assets"."secondary_address" is null or "proposal_assets"."secondary_address" ~ '^0x[0-9a-fA-F]{40}$')))
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
	"proposal_id" uuid,
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
	"show_real_username_on_voter_leaderboard" boolean DEFAULT false NOT NULL,
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
CREATE TABLE "vote_tranches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"ballot_id" uuid NOT NULL,
	"voter_user_id" text NOT NULL,
	"proposal_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"entry_price_capture_run_id" uuid,
	"effective_entry_at" timestamp with time zone,
	"performance_comparison_proposal_ids" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vote_tranche_quantity_positive" CHECK ("vote_tranches"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "x_action_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" "evidence_action" NOT NULL,
	"competition_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"proposal_id" uuid,
	"token" text NOT NULL,
	"reason" text NOT NULL,
	"post_text" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "x_action_challenges_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_eligibility_snapshots" ADD CONSTRAINT "asset_eligibility_snapshots_market_id_asset_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."asset_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_market_requests" ADD CONSTRAINT "asset_market_requests_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_markets" ADD CONSTRAINT "asset_markets_asset_id_eligible_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."eligible_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_price_snapshots" ADD CONSTRAINT "asset_price_snapshots_asset_id_eligible_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."eligible_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_price_snapshots" ADD CONSTRAINT "asset_price_snapshots_capture_run_id_price_capture_runs_id_fk" FOREIGN KEY ("capture_run_id") REFERENCES "public"."price_capture_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_pricing_configs" ADD CONSTRAINT "asset_pricing_configs_asset_id_eligible_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."eligible_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballot_allocations" ADD CONSTRAINT "ballot_allocations_ballot_id_ballots_id_fk" FOREIGN KEY ("ballot_id") REFERENCES "public"."ballots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballot_allocations" ADD CONSTRAINT "ballot_allocations_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ballots" ADD CONSTRAINT "ballots_voter_user_id_users_id_fk" FOREIGN KEY ("voter_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_checks" ADD CONSTRAINT "evidence_checks_evidence_id_tweet_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."tweet_evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_assets" ADD CONSTRAINT "proposal_assets_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_assets" ADD CONSTRAINT "proposal_assets_asset_id_eligible_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."eligible_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_assets" ADD CONSTRAINT "proposal_assets_market_id_asset_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."asset_markets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tweet_evidence" ADD CONSTRAINT "tweet_evidence_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tweet_evidence" ADD CONSTRAINT "tweet_evidence_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tweet_evidence" ADD CONSTRAINT "tweet_evidence_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_tranches" ADD CONSTRAINT "vote_tranches_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_tranches" ADD CONSTRAINT "vote_tranches_ballot_id_ballots_id_fk" FOREIGN KEY ("ballot_id") REFERENCES "public"."ballots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_tranches" ADD CONSTRAINT "vote_tranches_voter_user_id_users_id_fk" FOREIGN KEY ("voter_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_tranches" ADD CONSTRAINT "vote_tranches_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_tranches" ADD CONSTRAINT "vote_tranches_evidence_id_tweet_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."tweet_evidence"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_tranches" ADD CONSTRAINT "vote_tranches_entry_price_capture_run_id_price_capture_runs_id_fk" FOREIGN KEY ("entry_price_capture_run_id") REFERENCES "public"."price_capture_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_action_challenges" ADD CONSTRAINT "x_action_challenges_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_action_challenges" ADD CONSTRAINT "x_action_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_action_challenges" ADD CONSTRAINT "x_action_challenges_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_eligibility_time_idx" ON "asset_eligibility_snapshots" USING btree ("sampled_at");--> statement-breakpoint
CREATE INDEX "asset_market_requests_status_idx" ON "asset_market_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_market_pool_uq" ON "asset_markets" USING btree (lower("pool_address"));--> statement-breakpoint
CREATE INDEX "asset_markets_asset_active_idx" ON "asset_markets" USING btree ("asset_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_price_snapshot_run_asset_uq" ON "asset_price_snapshots" USING btree ("capture_run_id","asset_id");--> statement-breakpoint
CREATE INDEX "asset_price_snapshots_sampled_at_idx" ON "asset_price_snapshots" USING btree ("sampled_at");--> statement-breakpoint
CREATE INDEX "asset_pricing_configs_asset_active_idx" ON "asset_pricing_configs" USING btree ("asset_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_pricing_config_exact_uq" ON "asset_pricing_configs" USING btree ("asset_id","source",lower("primary_address"),lower(coalesce("secondary_address", '')));--> statement-breakpoint
CREATE INDEX "ballot_allocations_proposal_idx" ON "ballot_allocations" USING btree ("proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ballot_once_per_competition_uq" ON "ballots" USING btree ("competition_id","voter_user_id");--> statement-breakpoint
CREATE INDEX "valid_ballots_idx" ON "ballots" USING btree ("competition_id","status");--> statement-breakpoint
CREATE INDEX "eligible_asset_symbol_idx" ON "eligible_assets" USING btree (upper("symbol"));--> statement-breakpoint
CREATE UNIQUE INDEX "eligible_asset_network_contract_uq" ON "eligible_assets" USING btree ("network",lower("contract_address"));--> statement-breakpoint
CREATE INDEX "evidence_check_history_idx" ON "evidence_checks" USING btree ("evidence_id","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_capture_runs_capture_key_uq" ON "price_capture_runs" USING btree ("capture_key");--> statement-breakpoint
CREATE INDEX "price_capture_runs_sampled_at_idx" ON "price_capture_runs" USING btree ("sampled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_asset_position_uq" ON "proposal_assets" USING btree ("proposal_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_competition_slug_uq" ON "proposals" USING btree ("competition_id","slug") WHERE "proposals"."status" <> 'deleted';--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_competition_name_uq" ON "proposals" USING btree ("competition_id",lower("name")) WHERE "proposals"."status" <> 'deleted';--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_competition_ticker_uq" ON "proposals" USING btree ("competition_id",lower("ticker")) WHERE "proposals"."status" <> 'deleted';--> statement-breakpoint
CREATE INDEX "tweet_evidence_competition_status_idx" ON "tweet_evidence" USING btree ("competition_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_evidence_once_uq" ON "tweet_evidence" USING btree ("proposal_id") WHERE "tweet_evidence"."action" = 'submission';--> statement-breakpoint
CREATE INDEX "vote_tranches_competition_idx" ON "vote_tranches" USING btree ("competition_id","accepted_at");--> statement-breakpoint
CREATE INDEX "vote_tranches_voter_idx" ON "vote_tranches" USING btree ("voter_user_id");--> statement-breakpoint
CREATE INDEX "vote_tranches_proposal_idx" ON "vote_tranches" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "x_action_challenge_lookup_idx" ON "x_action_challenges" USING btree ("user_id","proposal_id","expires_at");
--> statement-breakpoint
INSERT INTO "competitions" ("phase", "starts_at", "ends_at", "rules", "rules_hash", "rules_frozen_at") VALUES (
  'open',
  CURRENT_TIMESTAMP - interval '7 days',
  date_trunc('day', CURRENT_TIMESTAMP + interval '30 days'),
  '{"minFollowers":100,"minAccountAgeDays":30,"minAssets":2,"minAssetWeightBps":100,"portfolioWeightBps":10000,"submissionOnlyDays":7,"votingDays":30,"initialVotes":3,"votesPerUnlock":1,"voteUnlockIntervalDays":3,"totalVotes":12,"maxProposalsPerAccount":null,"eligibilityAllowlistBypasses":["verified","minFollowers"]}'::jsonb,
  '5df25ba08c24842420a2523d327f81dabd673f8fad50b2a415b685d86ea3dfb9',
  CURRENT_TIMESTAMP - interval '7 days'
);
--> statement-breakpoint
INSERT INTO "eligible_assets" ("symbol", "name", "contract_address", "price_source", "quality") VALUES
  ('AAPL', 'Apple', '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', 'robinhood-bid', 'high'),
  ('AMD', 'Advanced Micro Devices', '0x86923f96303D656E4aa86D9d42D1e57ad2023fdC', 'robinhood-bid', 'high'),
  ('AMZN', 'Amazon', '0x12f190a9F9d7D37a250758b26824B97CE941bF54', 'robinhood-bid', 'high'),
  ('ASML', 'ASML Holding', '0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA', 'robinhood-bid', 'high'),
  ('BABA', 'Alibaba Group', '0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4', 'robinhood-bid', 'high'),
  ('COIN', 'Coinbase', '0x6330D8C3178a418788dF01a47479c0ce7CCF450b', 'robinhood-bid', 'high'),
  ('COST', 'Costco Wholesale', '0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2', 'robinhood-bid', 'high'),
  ('CRCL', 'Circle Internet Group', '0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5', 'robinhood-bid', 'high'),
  ('DELL', 'Dell Technologies', '0x941AE714EC6D8130c7B75d67160Ca08f1e7d11Dd', 'robinhood-bid', 'high'),
  ('GME', 'GameStop', '0x1b0E319c6A659F002271B69dB8A7df2F911c153E', 'robinhood-bid', 'high'),
  ('GOOGL', 'Alphabet Class A', '0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3', 'robinhood-bid', 'high'),
  ('INTC', 'Intel', '0xc72b96e0E48ecd4DC75E1e45396e26300BC39681', 'robinhood-bid', 'high'),
  ('META', 'Meta Platforms', '0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35', 'robinhood-bid', 'high'),
  ('MSFT', 'Microsoft', '0xe93237C50D904957Cf27E7B1133b510C669c2e74', 'robinhood-bid', 'high'),
  ('MSTR', 'Strategy', '0xec262a75e413fAfD0dF80480274532C79D42da09', 'robinhood-bid', 'high'),
  ('MU', 'Micron Technology', '0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD', 'robinhood-bid', 'high'),
  ('NFLX', 'Netflix', '0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8', 'robinhood-bid', 'high'),
  ('NVDA', 'NVIDIA', '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', 'robinhood-bid', 'high'),
  ('PLTR', 'Palantir Technologies', '0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A', 'robinhood-bid', 'high'),
  ('QQQ', 'Invesco QQQ Trust', '0xD5f3879160bc7c32ebb4dC785F8a4F505888de68', 'robinhood-bid', 'high'),
  ('QUBT', 'Quantum Computing Inc.', '0x59818904ab4cE163b3cE4FfB64f2D6Ca02c434B4', 'robinhood-bid', 'high'),
  ('RBLX', 'Roblox', '0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8', 'robinhood-bid', 'high'),
  ('RDDT', 'Reddit', '0x05b37Fb53A299a1b874A619e1c4C404D52C36F4C', 'robinhood-bid', 'high'),
  ('SGOV', 'iShares 0–3 Month Treasury Bond ETF', '0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5', 'robinhood-bid', 'high'),
  ('SLV', 'iShares Silver Trust', '0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f', 'robinhood-bid', 'high'),
  ('SNDK', 'Sandisk', '0xB90A19fF0Af67f7779afF50A882A9CfF42446400', 'robinhood-bid', 'high'),
  ('SPCX', 'SpaceX', '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa', 'robinhood-bid', 'high'),
  ('SPY', 'SPDR S&P 500 ETF Trust', '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C', 'robinhood-bid', 'high'),
  ('TSLA', 'Tesla', '0x322F0929c4625eD5bAd873c95208D54E1c003b2d', 'robinhood-bid', 'high'),
  ('TSM', 'Taiwan Semiconductor Manufacturing', '0x58FfE4a942d3885bAa22D7520691F611EF09e7AA', 'robinhood-bid', 'high'),
  ('TTWO', 'Take-Two Interactive', '0x5e81213613b6B86EaB4c6c50d718d34359459786', 'robinhood-bid', 'high'),
  ('USO', 'United States Oil Fund', '0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344', 'robinhood-bid', 'high'),
  ('AAOI', 'Applied Optoelectronics', '0x521Cf887E6531c6F667b5BC4D896E5d9bfE8EB2E', 'robinhood-bid', 'high'),
  ('AMC', 'AMC Entertainment Holdings', '0x05a3d1Cd21d0C88145E82600E62e7E496e0F222B', 'robinhood-bid', 'high'),
  ('APLD', 'Applied Digital', '0xb8DBf92F9741c9ac1c32115E78581f23509916FD', 'robinhood-bid', 'high'),
  ('AVGO', 'Broadcom', '0x156E175DD063a8cE274C50654eF40e0032b3fbcF', 'robinhood-bid', 'high'),
  ('CLSK', 'CleanSpark', '0xcBB95BBF36099d34dA091dc6Fa6F49EfA257Cee3', 'robinhood-bid', 'high'),
  ('DJT', 'Trump Media & Technology Group', '0x1D11f0496982706C5e14A514D4E79F2e6BdE4516', 'robinhood-bid', 'high'),
  ('ETH', 'Ethereum', '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', 'coinbase-eth-usd-bid', 'high'),
  ('LLY', 'Eli Lilly', '0x8005d266423c7ea827372c9c864491e5786600ea', 'robinhood-bid', 'high'),
  ('ORCL', 'Oracle', '0xb0992820E760d836549ba69BC7598b4af75dEE03', 'robinhood-bid', 'high'),
  ('PENG', 'Penguin Solutions', '0x9b23573b156B52565012F5cE02CDF60AFBaa70Be', 'robinhood-bid', 'high'),
  ('RIVN', 'Rivian Automotive', '0xB1BF26c1D20ff267A4f93550d1E0d06ac40a114B', 'robinhood-bid', 'high'),
  ('SKHY', 'SK hynix ADR', '0x84CAb63bc87912E71ad199ff14A0bA45de68FeF8', 'robinhood-bid', 'high'),
  ('SMCI', 'Super Micro Computer', '0xc01aA1fECeC0605b13bc84874ff7256C0f5F562a', 'robinhood-bid', 'high'),
  ('USAR', 'USA Rare Earth', '0xd917B029C761D264c6A312BBbcDA868658eF86a6', 'robinhood-bid', 'high');
--> statement-breakpoint
UPDATE "eligible_assets" SET "chain_id" = 4663 WHERE "network" = 'robinhood-mainnet';
--> statement-breakpoint
CREATE FUNCTION "assert_competition_inputs_mutable"("target_competition_id" uuid) RETURNS void AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "competitions"
    WHERE "id" = "target_competition_id"
      AND (
        "ends_at" <= statement_timestamp()
        OR "phase" IN ('auditing', 'final', 'cancelled')
      )
  ) THEN
    RAISE EXCEPTION 'COMPETITION_NOT_OPEN';
  END IF;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE FUNCTION "protect_proposal_inputs_after_close"() RETURNS trigger AS $$
BEGIN
  PERFORM "assert_competition_inputs_mutable"(COALESCE(NEW."competition_id", OLD."competition_id"));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "proposal_inputs_frozen_after_close"
BEFORE INSERT OR UPDATE OR DELETE ON "proposals"
FOR EACH ROW EXECUTE FUNCTION "protect_proposal_inputs_after_close"();
--> statement-breakpoint
CREATE FUNCTION "protect_proposal_asset_inputs_after_close"() RETURNS trigger AS $$
DECLARE
  target_competition_id uuid;
BEGIN
  SELECT "competition_id" INTO target_competition_id
  FROM "proposals" WHERE "id" = COALESCE(NEW."proposal_id", OLD."proposal_id");
  PERFORM "assert_competition_inputs_mutable"(target_competition_id);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "proposal_asset_inputs_frozen_after_close"
BEFORE INSERT OR UPDATE OR DELETE ON "proposal_assets"
FOR EACH ROW EXECUTE FUNCTION "protect_proposal_asset_inputs_after_close"();
--> statement-breakpoint
CREATE FUNCTION "protect_ballot_inputs_after_close"() RETURNS trigger AS $$
BEGIN
  PERFORM "assert_competition_inputs_mutable"(COALESCE(NEW."competition_id", OLD."competition_id"));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "ballot_inputs_frozen_after_close"
BEFORE INSERT OR UPDATE OR DELETE ON "ballots"
FOR EACH ROW EXECUTE FUNCTION "protect_ballot_inputs_after_close"();
--> statement-breakpoint
CREATE FUNCTION "protect_ballot_allocation_inputs_after_close"() RETURNS trigger AS $$
DECLARE
  target_competition_id uuid;
BEGIN
  SELECT "competition_id" INTO target_competition_id
  FROM "ballots" WHERE "id" = COALESCE(NEW."ballot_id", OLD."ballot_id");
  PERFORM "assert_competition_inputs_mutable"(target_competition_id);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "ballot_allocation_inputs_frozen_after_close"
BEFORE INSERT OR UPDATE OR DELETE ON "ballot_allocations"
FOR EACH ROW EXECUTE FUNCTION "protect_ballot_allocation_inputs_after_close"();
--> statement-breakpoint
CREATE FUNCTION "protect_vote_tranche_inputs_after_close"() RETURNS trigger AS $$
BEGIN
  PERFORM "assert_competition_inputs_mutable"(COALESCE(NEW."competition_id", OLD."competition_id"));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "vote_tranche_inputs_frozen_after_close"
BEFORE INSERT OR UPDATE OR DELETE ON "vote_tranches"
FOR EACH ROW EXECUTE FUNCTION "protect_vote_tranche_inputs_after_close"();
--> statement-breakpoint
CREATE FUNCTION "enforce_ballot_distribution"() RETURNS trigger AS $$
DECLARE
  target_ballot_id uuid;
BEGIN
  target_ballot_id := COALESCE(NEW.ballot_id, OLD.ballot_id);
  IF NOT EXISTS (SELECT 1 FROM ballots WHERE id = target_ballot_id) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM ballot_allocations ba
    JOIN ballots b ON b.id = ba.ballot_id
    JOIN proposals p ON p.id = ba.proposal_id
    WHERE ba.ballot_id = target_ballot_id
      AND p.competition_id <> b.competition_id
  ) THEN
    RAISE EXCEPTION 'INVALID_BALLOT_ALLOCATION';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ballot_distribution_valid"
AFTER INSERT OR UPDATE OR DELETE ON "ballot_allocations"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "enforce_ballot_distribution"();
--> statement-breakpoint
CREATE FUNCTION "protect_competition_singleton"() RETURNS trigger AS $$
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
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "competition_singleton_immutable"
BEFORE UPDATE OR DELETE ON "competitions"
FOR EACH ROW EXECUTE FUNCTION "protect_competition_singleton"();
--> statement-breakpoint
CREATE FUNCTION "protect_vote_tranche_immutability"() RETURNS trigger AS $$
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
CREATE TRIGGER "vote_tranches_immutable"
BEFORE UPDATE ON "vote_tranches"
FOR EACH ROW EXECUTE FUNCTION "protect_vote_tranche_immutability"();
