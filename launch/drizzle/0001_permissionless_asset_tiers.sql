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
	"critical_sell_or_tax_flag" boolean,
	"locked_liquidity_pct" numeric(8, 4),
	"buy_impact_pct" numeric(8, 4),
	"sell_impact_pct" numeric(8, 4),
	"twap_price_usd" numeric(30, 8),
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
	"pool_address" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_market_request_status" CHECK ("asset_market_requests"."status" in ('pending', 'registered', 'rejected'))
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
	"twap_one_hour_ready" boolean DEFAULT false NOT NULL,
	"twap_twenty_four_hour_ready" boolean DEFAULT false NOT NULL,
	"twap_one_hour_price_usd" numeric(30, 8),
	"twap_one_hour_price_at" timestamp with time zone,
	"pool_created_at" timestamp with time zone,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_markets_market_id_unique" UNIQUE("market_id"),
	CONSTRAINT "asset_market_v3_only" CHECK ("asset_markets"."version" = 'v3'),
	CONSTRAINT "asset_market_fee_positive" CHECK ("asset_markets"."fee_tier" > 0)
);
--> statement-breakpoint
ALTER TABLE "eligible_assets" DROP CONSTRAINT "eligible_asset_price_source";--> statement-breakpoint
DROP INDEX "eligible_asset_symbol_uq";--> statement-breakpoint
DROP INDEX "eligible_asset_contract_address_uq";--> statement-breakpoint
ALTER TABLE "asset_price_snapshots" ADD COLUMN "twap_window_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "eligible_assets" ADD COLUMN "network" text DEFAULT 'robinhood-mainnet' NOT NULL;--> statement-breakpoint
ALTER TABLE "eligible_assets" ADD COLUMN "chain_id" integer;--> statement-breakpoint
ALTER TABLE "eligible_assets" ADD COLUMN "decimals" integer DEFAULT 18 NOT NULL;--> statement-breakpoint
ALTER TABLE "eligible_assets" ADD COLUMN "quality_status" text DEFAULT 'qualified' NOT NULL;--> statement-breakpoint
ALTER TABLE "price_capture_runs" ADD COLUMN "purpose" text DEFAULT 'scoring' NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal_assets" ADD COLUMN "market_id" uuid;--> statement-breakpoint
ALTER TABLE "vote_tranches" ADD COLUMN "performance_cohort" text;--> statement-breakpoint
ALTER TABLE "vote_tranches" ADD COLUMN "cohort_locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vote_tranches" ADD COLUMN "performance_comparison_proposal_ids" uuid[];--> statement-breakpoint
ALTER TABLE "xp_snapshot_rows" ADD COLUMN "qualified_performance_xp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "xp_snapshot_rows" ADD COLUMN "experimental_performance_xp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "xp_snapshot_rows" ADD COLUMN "creator_support_xp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "xp_snapshot_rows" ADD COLUMN "creator_award_xp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_eligibility_snapshots" ADD CONSTRAINT "asset_eligibility_snapshots_market_id_asset_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."asset_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_market_requests" ADD CONSTRAINT "asset_market_requests_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_markets" ADD CONSTRAINT "asset_markets_asset_id_eligible_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."eligible_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_eligibility_time_idx" ON "asset_eligibility_snapshots" USING btree ("sampled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_market_request_network_pool_uq" ON "asset_market_requests" USING btree ("network","pool_address");--> statement-breakpoint
CREATE INDEX "asset_market_requests_status_idx" ON "asset_market_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_market_pool_uq" ON "asset_markets" USING btree (lower("pool_address"));--> statement-breakpoint
CREATE INDEX "asset_markets_asset_active_idx" ON "asset_markets" USING btree ("asset_id","active");--> statement-breakpoint
ALTER TABLE "proposal_assets" ADD CONSTRAINT "proposal_assets_market_id_asset_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."asset_markets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eligible_asset_symbol_idx" ON "eligible_assets" USING btree (upper("symbol"));--> statement-breakpoint
CREATE UNIQUE INDEX "eligible_asset_network_contract_uq" ON "eligible_assets" USING btree ("network",lower("contract_address"));--> statement-breakpoint
ALTER TABLE "eligible_assets" ADD CONSTRAINT "eligible_asset_quality_status" CHECK ("eligible_assets"."quality_status" in ('open', 'qualified', 'blocked'));--> statement-breakpoint
ALTER TABLE "eligible_assets" ADD CONSTRAINT "eligible_asset_exact_decimals" CHECK ("eligible_assets"."decimals" = 18);--> statement-breakpoint
ALTER TABLE "eligible_assets" ADD CONSTRAINT "eligible_asset_price_source" CHECK ("eligible_assets"."price_source" in ('robinhood-bid', 'coinbase-eth-usd-bid', 'uniswap-v3-twap'));--> statement-breakpoint
ALTER TABLE "price_capture_runs" ADD CONSTRAINT "price_capture_run_purpose" CHECK ("price_capture_runs"."purpose" in ('submission', 'scoring'));--> statement-breakpoint
ALTER TABLE "vote_tranches" ADD CONSTRAINT "vote_tranche_performance_cohort" CHECK ("vote_tranches"."performance_cohort" is null or "vote_tranches"."performance_cohort" in ('qualified', 'experimental'));