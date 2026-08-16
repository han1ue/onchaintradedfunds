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
ALTER TABLE "eligible_assets" RENAME COLUMN "quality_status" TO "quality";--> statement-breakpoint
ALTER TABLE "eligible_assets" DROP CONSTRAINT "eligible_asset_quality_status";--> statement-breakpoint
UPDATE "eligible_assets"
SET "quality" = CASE WHEN "quality" = 'qualified' THEN 'high' ELSE 'normal' END;--> statement-breakpoint
ALTER TABLE "eligible_assets" ALTER COLUMN "quality" SET DEFAULT 'normal';--> statement-breakpoint
ALTER TABLE "vote_tranches" DROP CONSTRAINT "vote_tranche_performance_cohort";--> statement-breakpoint
DROP INDEX "asset_market_request_network_pool_uq";--> statement-breakpoint
ALTER TABLE "asset_market_requests" ALTER COLUMN "pool_address" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_market_requests" ADD COLUMN "pricing_source" text;--> statement-breakpoint
ALTER TABLE "asset_market_requests" ADD COLUMN "primary_address" text;--> statement-breakpoint
ALTER TABLE "asset_market_requests" ADD COLUMN "secondary_address" text;--> statement-breakpoint
ALTER TABLE "proposal_assets" ADD COLUMN "pricing_source" text;--> statement-breakpoint
ALTER TABLE "proposal_assets" ADD COLUMN "primary_address" text;--> statement-breakpoint
ALTER TABLE "proposal_assets" ADD COLUMN "secondary_address" text;--> statement-breakpoint
UPDATE "asset_market_requests"
SET "pricing_source" = 'uniswap-v3', "primary_address" = "pool_address"
WHERE "pool_address" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_market_requests" ALTER COLUMN "pricing_source" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_market_requests" ALTER COLUMN "primary_address" SET NOT NULL;--> statement-breakpoint
UPDATE "proposal_assets" pa
SET "pricing_source" = 'uniswap-v3', "primary_address" = am."pool_address"
FROM "asset_markets" am
WHERE pa."market_id" = am."id";--> statement-breakpoint
ALTER TABLE "asset_pricing_configs" ADD CONSTRAINT "asset_pricing_configs_asset_id_eligible_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."eligible_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_pricing_configs_asset_active_idx" ON "asset_pricing_configs" USING btree ("asset_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_pricing_config_exact_uq" ON "asset_pricing_configs" USING btree ("asset_id","source",lower("primary_address"),lower(coalesce("secondary_address", '')));--> statement-breakpoint
INSERT INTO "asset_pricing_configs" ("asset_id", "source", "primary_address", "secondary_address", "active", "created_at", "updated_at")
SELECT am."asset_id", 'uniswap-v3', lower(am."pool_address"), NULL, am."active", am."created_at", am."updated_at"
FROM "asset_markets" am
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "vote_tranches" SET "performance_comparison_proposal_ids" = NULL;--> statement-breakpoint
ALTER TABLE "vote_tranches" DROP COLUMN "performance_cohort";--> statement-breakpoint
ALTER TABLE "vote_tranches" DROP COLUMN "cohort_locked_at";--> statement-breakpoint
ALTER TABLE "xp_snapshot_rows" DROP COLUMN "qualified_performance_xp";--> statement-breakpoint
ALTER TABLE "xp_snapshot_rows" DROP COLUMN "experimental_performance_xp";--> statement-breakpoint
ALTER TABLE "asset_market_requests" ADD CONSTRAINT "asset_market_request_pricing_source" CHECK ("asset_market_requests"."pricing_source" in ('chainlink-direct', 'chainlink-weth', 'uniswap-v3'));--> statement-breakpoint
ALTER TABLE "asset_market_requests" ADD CONSTRAINT "asset_market_request_pricing_shape" CHECK ((
    "asset_market_requests"."pricing_source" in ('chainlink-direct', 'uniswap-v3') and "asset_market_requests"."secondary_address" is null
  ) or (
    "asset_market_requests"."pricing_source" = 'chainlink-weth' and "asset_market_requests"."secondary_address" is not null
  ));--> statement-breakpoint
ALTER TABLE "asset_market_requests" ADD CONSTRAINT "asset_market_request_pricing_addresses" CHECK ("asset_market_requests"."primary_address" ~ '^0x[0-9a-fA-F]{40}$' and ("asset_market_requests"."secondary_address" is null or "asset_market_requests"."secondary_address" ~ '^0x[0-9a-fA-F]{40}$'));--> statement-breakpoint
ALTER TABLE "eligible_assets" ADD CONSTRAINT "eligible_asset_quality" CHECK ("eligible_assets"."quality" in ('high', 'normal'));--> statement-breakpoint
ALTER TABLE "proposal_assets" ADD CONSTRAINT "proposal_asset_pricing_source" CHECK ("proposal_assets"."pricing_source" is null or "proposal_assets"."pricing_source" in ('chainlink-direct', 'chainlink-weth', 'uniswap-v3'));--> statement-breakpoint
ALTER TABLE "proposal_assets" ADD CONSTRAINT "proposal_asset_pricing_shape" CHECK ("proposal_assets"."pricing_source" is null or (
    "proposal_assets"."pricing_source" in ('chainlink-direct', 'uniswap-v3') and "proposal_assets"."primary_address" is not null and "proposal_assets"."secondary_address" is null
  ) or (
    "proposal_assets"."pricing_source" = 'chainlink-weth' and "proposal_assets"."primary_address" is not null and "proposal_assets"."secondary_address" is not null
  ));--> statement-breakpoint
ALTER TABLE "proposal_assets" ADD CONSTRAINT "proposal_asset_pricing_addresses" CHECK ("proposal_assets"."pricing_source" is null or ("proposal_assets"."primary_address" ~ '^0x[0-9a-fA-F]{40}$' and ("proposal_assets"."secondary_address" is null or "proposal_assets"."secondary_address" ~ '^0x[0-9a-fA-F]{40}$')));
