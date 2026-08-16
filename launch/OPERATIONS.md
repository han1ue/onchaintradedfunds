# Launch operations runbook

## Before opening

- Apply launch-only Drizzle migrations to a backed-up Neon branch.
- Verify X OAuth callbacks for preview and production URLs.
- Confirm Redis, Turnstile, cron authorization, CSP, and administrator X IDs.
- Verify the versioned asset and V3 market registries, trusted factory, WETH, USDG, and canonical WETH/USDG pool against deployed bytecode and transactions. Keep Robinhood Mainnet disabled until this is complete.
- Configure `COINGECKO_PRO_API_KEY`, `COINGECKO_NETWORK_ID`, and the authenticated `MARKET_EVIDENCE_URL`. The evidence service must read one-hour and 24-hour V3 TWAPs and simulate both $1,000 route directions; missing evidence must remain Pending.
- Confirm Robinhood/Coinbase feeds for qualified assets and one-hour/24-hour onchain V3 checkpoints for open assets return valid timestamps and positive values.
- Create the competition with final dates and thresholds. Rules freeze when it opens.
- Exercise one real submission and vote in a non-production competition. Confirm each X intent contains the one-time code and each pasted public post URL is verified and stored.

## During the competition

- Monitor X API rate limits and spend, OAuth refresh failures, post-publication errors, evidence rechecks, and moderation actions.
- Run `/api/jobs/prices` hourly. It captures market evidence first, stores threshold results, captures scoring prices, and then recomputes cohort-isolated XP.
- Do not manually alter accepted proposals, valid votes, evidence, or activity events. Use audited administrator actions.
- If X identity checks or posting are unavailable, new actions remain disabled until the affected X API recovers.

## Closing and finalization

- Database time is authoritative; writes are rejected at `ends_at`.
- Allow evidence and asset-health audits to complete. Failed runs never publish a partial leaderboard.
- A pool that fails at close receives the published 48-hour restoration window. Portfolios cannot be edited.
- Verify the canonical hash and row count, then retain JSON/CSV exports with the finalization run.
- Publicly expose rank/order only. Keep `earliest_launch_at` and readiness state private.

## Recovery

- Restore Neon point-in-time data into a new branch, validate immutable evidence and snapshot hashes, then promote it.
- Rotate a compromised secret in the launch Vercel project only. Rotate sessions after any Auth.js secret incident.
- A later fraud finding voids the affected launch slot with an audit record; never renumber final ranks.
