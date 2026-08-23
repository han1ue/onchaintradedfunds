ALTER TABLE "asset_price_snapshots" ALTER COLUMN "bid_usd" SET DATA TYPE numeric(38, 18) USING "bid_usd"::numeric(38, 18);--> statement-breakpoint
ALTER TABLE "price_capture_runs" ADD COLUMN "ambiguous_symbols" text[] DEFAULT ARRAY[]::text[] NOT NULL;
