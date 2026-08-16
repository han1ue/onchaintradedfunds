ALTER TABLE "asset_price_snapshots" DROP CONSTRAINT "asset_price_snapshots_asset_id_sampled_at_pk";--> statement-breakpoint
ALTER TABLE "asset_price_snapshots" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_price_snapshot_run_asset_uq" ON "asset_price_snapshots" USING btree ("capture_run_id","asset_id");