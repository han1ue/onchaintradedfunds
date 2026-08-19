ALTER TABLE "ballots" DROP CONSTRAINT IF EXISTS "ballots_evidence_id_tweet_evidence_id_fk";
--> statement-breakpoint
ALTER TABLE "ballots" DROP CONSTRAINT IF EXISTS "ballots_evidence_id_unique";
--> statement-breakpoint
ALTER TABLE "ballots" DROP COLUMN IF EXISTS "evidence_id";
--> statement-breakpoint
TRUNCATE TABLE
  "sessions",
  "verification_tokens",
  "proposals",
  "proposal_assets",
  "tweet_evidence",
  "x_action_challenges",
  "evidence_checks",
  "ballots",
  "ballot_allocations",
  "vote_tranches",
  "activity_events",
  "finalization_runs",
  "xp_calculation_runs",
  "xp_snapshot_rows",
  "leaderboard_snapshots",
  "leaderboard_rows",
  "launch_queue",
  "admin_actions"
RESTART IDENTITY CASCADE;
--> statement-breakpoint
INSERT INTO "competitions" (
  "phase", "starts_at", "ends_at", "rules_frozen_at"
)
SELECT
  'open', CURRENT_TIMESTAMP - interval '7 days',
  date_trunc('day', CURRENT_TIMESTAMP + interval '30 days'), CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "competitions");
--> statement-breakpoint
INSERT INTO "eligible_assets" (
  "symbol", "name", "contract_address", "price_source", "quality"
) VALUES
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
  ('MSTR', 'Strategy', '0xec262a75e413fAfD0fD80480274532C79D42da09', 'robinhood-bid', 'high'),
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
  ('ETH', 'Ethereum', 'N/A', 'coinbase-eth-usd-bid', 'high'),
  ('LLY', 'Eli Lilly', '0x8005d266423c7ea827372c9c864491e5786600ea', 'robinhood-bid', 'high'),
  ('ORCL', 'Oracle', '0xb0992820E760d836549ba69BC7598b4af75dEE03', 'robinhood-bid', 'high'),
  ('PENG', 'Penguin Solutions', '0x9b23573b156B52565012F5cE02CDF60AFBaa70Be', 'robinhood-bid', 'high'),
  ('RIVN', 'Rivian Automotive', '0xB1BF26c1D20ff267A4f93550d1E0d06ac40a114B', 'robinhood-bid', 'high'),
  ('SKHY', 'SK hynix ADR', '0x84CAb63bc87912E71ad199ff14A0bA45de68FeF8', 'robinhood-bid', 'high'),
  ('SMCI', 'Super Micro Computer', '0xc01aA1fECeC0605b13bc84874ff7256C0f5F562a', 'robinhood-bid', 'high'),
  ('USAR', 'USA Rare Earth', '0xd917B029C761D264c6A312BBbcDA868658eF86a6', 'robinhood-bid', 'high')
ON CONFLICT DO NOTHING;
