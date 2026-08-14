ALTER TABLE "proposal_assets" DROP CONSTRAINT "proposal_assets_eligibility_snapshot_id_asset_eligibility_snapshots_id_fk";
--> statement-breakpoint
ALTER TABLE "proposal_assets" DROP COLUMN "eligibility_snapshot_id";--> statement-breakpoint
ALTER TABLE "asset_eligibility_snapshots" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "asset_pools" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "asset_eligibility_snapshots";--> statement-breakpoint
DROP TABLE "asset_pools";--> statement-breakpoint
ALTER TABLE "eligible_assets" DROP CONSTRAINT "eligible_assets_robinhood_uid_unique";--> statement-breakpoint
DROP INDEX "eligible_asset_chain_address_uq";--> statement-breakpoint
DROP INDEX "eligible_asset_enabled_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "eligible_asset_symbol_uq" ON "eligible_assets" USING btree (upper("symbol"));--> statement-breakpoint
CREATE UNIQUE INDEX "eligible_asset_contract_address_uq" ON "eligible_assets" USING btree (lower("contract_address"));--> statement-breakpoint
ALTER TABLE "eligible_assets" DROP COLUMN "robinhood_uid";--> statement-breakpoint
ALTER TABLE "eligible_assets" DROP COLUMN "chain_id";--> statement-breakpoint
ALTER TABLE "eligible_assets" DROP COLUMN "logo_url";--> statement-breakpoint
ALTER TABLE "eligible_assets" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "eligible_assets" DROP COLUMN "multiplier";--> statement-breakpoint
ALTER TABLE "eligible_assets" DROP COLUMN "admin_enabled";--> statement-breakpoint
ALTER TABLE "eligible_assets" DROP COLUMN "last_seen_at";--> statement-breakpoint
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
