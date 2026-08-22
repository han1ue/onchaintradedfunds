-- Separate registry metadata and pricing from address-only verification membership.
CREATE TABLE "verified_assets" (
	"asset_address" text PRIMARY KEY NOT NULL,
	CONSTRAINT "verified_asset_address" CHECK ("verified_assets"."asset_address" ~ '^0x[0-9a-fA-F]{40}$')
);
--> statement-breakpoint
ALTER TABLE "eligible_assets" RENAME TO "asset_registry";--> statement-breakpoint
INSERT INTO "verified_assets" ("asset_address")
SELECT "contract_address" FROM "asset_registry" WHERE "quality" = 'high';--> statement-breakpoint
ALTER TABLE "asset_registry" DROP CONSTRAINT "eligible_asset_contract_address";--> statement-breakpoint
ALTER TABLE "asset_registry" DROP CONSTRAINT "eligible_asset_price_source";--> statement-breakpoint
ALTER TABLE "asset_registry" DROP CONSTRAINT "eligible_asset_quality";--> statement-breakpoint
ALTER TABLE "asset_registry" DROP CONSTRAINT "eligible_asset_exact_decimals";--> statement-breakpoint
ALTER TABLE "asset_markets" DROP CONSTRAINT "asset_markets_asset_id_eligible_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "asset_price_snapshots" DROP CONSTRAINT "asset_price_snapshots_asset_id_eligible_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "asset_pricing_configs" DROP CONSTRAINT "asset_pricing_configs_asset_id_eligible_assets_id_fk";
--> statement-breakpoint
ALTER TABLE "proposal_assets" DROP CONSTRAINT "proposal_assets_asset_id_eligible_assets_id_fk";
--> statement-breakpoint
DROP INDEX "eligible_asset_symbol_idx";--> statement-breakpoint
DROP INDEX "eligible_asset_network_contract_uq";--> statement-breakpoint
ALTER TABLE "asset_markets" ADD CONSTRAINT "asset_markets_asset_id_asset_registry_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset_registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_price_snapshots" ADD CONSTRAINT "asset_price_snapshots_asset_id_asset_registry_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset_registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_pricing_configs" ADD CONSTRAINT "asset_pricing_configs_asset_id_asset_registry_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset_registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_assets" ADD CONSTRAINT "proposal_assets_asset_id_asset_registry_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset_registry"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_registry_symbol_idx" ON "asset_registry" USING btree (upper("symbol"));--> statement-breakpoint
CREATE UNIQUE INDEX "asset_registry_network_contract_uq" ON "asset_registry" USING btree ("network",lower("contract_address"));--> statement-breakpoint
ALTER TABLE "asset_registry" DROP COLUMN "quality";--> statement-breakpoint
ALTER TABLE "asset_registry" ADD CONSTRAINT "asset_registry_contract_address" CHECK ("asset_registry"."contract_address" ~ '^0x[0-9a-fA-F]{40}$');--> statement-breakpoint
ALTER TABLE "asset_registry" ADD CONSTRAINT "asset_registry_price_source" CHECK ("asset_registry"."price_source" in ('robinhood-bid', 'coinbase-eth-usd-bid', 'coingecko-usd'));--> statement-breakpoint
ALTER TABLE "asset_registry" ADD CONSTRAINT "asset_registry_exact_decimals" CHECK ("asset_registry"."decimals" = 18);
