CREATE TABLE "asset_price_snapshots" (
	"asset_id" uuid NOT NULL,
	"sampled_at" timestamp with time zone NOT NULL,
	"quote_generated_at" timestamp with time zone NOT NULL,
	"bid_usd" numeric(24, 8) NOT NULL,
	CONSTRAINT "asset_price_snapshots_asset_id_sampled_at_pk" PRIMARY KEY("asset_id","sampled_at")
);
--> statement-breakpoint
ALTER TABLE "asset_price_snapshots" ADD CONSTRAINT "asset_price_snapshots_asset_id_eligible_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."eligible_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_price_snapshots_sampled_at_idx" ON "asset_price_snapshots" USING btree ("sampled_at");