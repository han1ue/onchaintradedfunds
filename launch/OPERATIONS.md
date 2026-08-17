# Launch operations runbook

## Before opening

- Apply launch-only Drizzle migrations to a backed-up Neon branch.
- Verify X OAuth callbacks for preview and production URLs.
- Confirm Redis, Turnstile, cron authorization, CSP, and administrator X IDs.
- Verify the optional asset-discovery index, trusted Chainlink pair map, V3 market registry, pricing
  resolver, factory, WETH, USDG, and canonical WETH/USDG pool against deployed bytecode and
  transactions. Keep Robinhood Mainnet disabled until this is complete.
- Configure `COINGECKO_PRO_API_KEY` and `COINGECKO_NETWORK_ID`. Launch performance uses provider APIs
  only: Robinhood bids for supported stock-token contracts and CoinGecko USD prices keyed by network
  and contract for other catalog assets. These performance prices are not OTF onchain pricing.
- Confirm high-quality/normal labels and pricing prefills are recomputed from live evidence. They are
  frontend metadata only and MUST NOT be described as an onchain approval, qualification, block, or
  authorization.
- Confirm entry-price capture succeeds when a vote tranche is verified. Missing provider prices leave performance Pending without invalidating the vote.
- Create the competition with final dates and thresholds. Rules freeze when it opens.
- Exercise one real submission and vote in a non-production competition. Confirm each X intent contains the one-time code and each pasted public post URL is verified and stored.

## During the competition

- Monitor X API rate limits and spend, OAuth refresh failures, post-publication errors, evidence rechecks, and moderation actions.
- Run `/api/jobs/prices` every 30 minutes. It stores provider prices for every catalog asset, updates CoinGecko/GT eligibility evidence, feeds proposal return charts, and recomputes live participation and creator XP.
- Do not manually alter accepted proposals, valid votes, evidence, or activity events. Use audited administrator actions.
- If X identity checks or posting are unavailable, new actions remain disabled until the affected X API recovers.

## Closing and finalization

- Database time is authoritative; writes are rejected at `ends_at`.
- Allow evidence and asset-health audits to complete. Failed runs never publish a partial leaderboard.
- Finalization captures one provider-price snapshot after `ends_at`; each performance return compares that snapshot with the vote tranche's stored entry snapshot.
- A pool that fails at close receives the published 48-hour restoration window. Portfolios cannot be edited.
- Verify the canonical hash and row count, then retain JSON/CSV exports with the finalization run.
- Publicly expose rank/order only. Keep `earliest_launch_at` and readiness state private.

## Recovery

- Restore Neon point-in-time data into a new branch, validate immutable evidence and snapshot hashes, then promote it.
- Rotate a compromised secret in the launch Vercel project only. Rotate sessions after any Auth.js secret incident.
- A later fraud finding voids the affected launch slot with an audit record; never renumber final ranks.
