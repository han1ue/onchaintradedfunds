ALTER TABLE "eligible_assets" DROP CONSTRAINT "eligible_asset_price_source";--> statement-breakpoint
ALTER TABLE "price_capture_runs" DROP CONSTRAINT "price_capture_run_purpose";--> statement-breakpoint
UPDATE "eligible_assets" SET "price_source" = 'coingecko-usd' WHERE "price_source" = 'uniswap-v3-twap';--> statement-breakpoint
ALTER TABLE "proposals" DROP CONSTRAINT "proposal_acceptance_has_initial_checkpoint";--> statement-breakpoint
ALTER TABLE "proposals" DROP CONSTRAINT "proposals_initial_price_capture_run_id_price_capture_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "vote_tranches" ADD COLUMN "entry_price_capture_run_id" uuid;--> statement-breakpoint
ALTER TABLE "vote_tranches" ADD CONSTRAINT "vote_tranches_entry_price_capture_run_id_price_capture_runs_id_fk" FOREIGN KEY ("entry_price_capture_run_id") REFERENCES "public"."price_capture_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_eligibility_snapshots" DROP COLUMN "critical_sell_or_tax_flag";--> statement-breakpoint
ALTER TABLE "asset_eligibility_snapshots" DROP COLUMN "buy_impact_pct";--> statement-breakpoint
ALTER TABLE "asset_eligibility_snapshots" DROP COLUMN "sell_impact_pct";--> statement-breakpoint
ALTER TABLE "asset_eligibility_snapshots" DROP COLUMN "twap_price_usd";--> statement-breakpoint
ALTER TABLE "asset_markets" DROP COLUMN "twap_one_hour_ready";--> statement-breakpoint
ALTER TABLE "asset_markets" DROP COLUMN "twap_twenty_four_hour_ready";--> statement-breakpoint
ALTER TABLE "asset_markets" DROP COLUMN "twap_one_hour_price_usd";--> statement-breakpoint
ALTER TABLE "asset_markets" DROP COLUMN "twap_one_hour_price_at";--> statement-breakpoint
ALTER TABLE "proposals" DROP COLUMN "initial_price_capture_run_id";--> statement-breakpoint
ALTER TABLE "eligible_assets" ADD CONSTRAINT "eligible_asset_price_source" CHECK ("eligible_assets"."price_source" in ('robinhood-bid', 'coinbase-eth-usd-bid', 'coingecko-usd'));--> statement-breakpoint
ALTER TABLE "price_capture_runs" ADD CONSTRAINT "price_capture_run_purpose" CHECK ("price_capture_runs"."purpose" in ('submission', 'entry', 'final', 'scoring'));
