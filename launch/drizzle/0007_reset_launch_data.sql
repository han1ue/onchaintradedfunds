ALTER TABLE "ballots" DROP CONSTRAINT IF EXISTS "ballots_evidence_id_tweet_evidence_id_fk";
--> statement-breakpoint
ALTER TABLE "ballots" DROP CONSTRAINT IF EXISTS "ballots_evidence_id_unique";
--> statement-breakpoint
ALTER TABLE "ballots" DROP COLUMN IF EXISTS "evidence_id";
--> statement-breakpoint
TRUNCATE TABLE
  "sessions",
  "verification_tokens",
  "competitions",
  "eligible_assets",
  "asset_pricing_configs",
  "asset_markets",
  "asset_eligibility_snapshots",
  "asset_market_requests",
  "price_capture_runs",
  "asset_price_snapshots",
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
