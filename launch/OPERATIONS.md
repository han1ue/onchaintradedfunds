# Launch operations runbook

## Before opening

- Apply launch-only Drizzle migrations to a backed-up Neon branch.
- Verify X OAuth callbacks for preview and production URLs.
- Confirm Redis, Turnstile, cron authorization, CSP, and administrator X IDs.
- Verify the optional asset-discovery index, frontend Chainlink manifest, V3 market registry, pricing
  resolver, factory, WETH, USDG, and canonical V3 dependencies against deployed bytecode and
  transactions. Keep Robinhood Mainnet disabled until this is complete.
- Configure `COINGECKO_DEMO_API_KEY` and `COINGECKO_NETWORK_ID`. The server calls public GeckoTerminal
  first and uses the Demo API only as a bounded fallback; the key is never sent to the browser. Launch
  performance uses Robinhood bids for supported stock-token contracts and CoinGecko USD prices keyed by
  network and contract for `coingecko-usd` assets. These performance prices are not OTF onchain pricing.
- Configure `ROBINHOOD_V3_FACTORY_ADDRESS`, `ROBINHOOD_WETH_ADDRESS`, `ROBINHOOD_USDG_ADDRESS`, and
  `ROBINHOOD_V3_SUPPORTED_FEES`. Unlisted asset validation reads token and pool state from
  `ROBINHOOD_RPC_URL` before making any CoinGecko request.
- Confirm asset-registry pricing and verified-address membership are correct. They are frontend and
  scoring metadata only and MUST NOT be described as an onchain approval, block, or authorization.
- Confirm vote activation finds the newest complete saved scoring checkpoint at or before activation
  within the 90-minute freshness window. Missing checkpoints fail closed with
  `PRICE_CHECKPOINT_UNAVAILABLE`; activation never makes provider calls.
- Unlisted validation is staged by token and pool address. Token and pool evidence is cached for
  30 minutes in Redis when available, with an in-memory fallback; backend save/submit checks reuse
  that cache and refresh only when it is missing or expired.
- Create the competition with final dates and thresholds. Rules freeze when it opens.
- Exercise one real submission and vote in a non-production competition. Confirm each X intent contains the one-time code and each pasted public post URL is verified and stored.

## During the competition

- Monitor X API rate limits and spend, OAuth refresh failures, post-publication errors, evidence rechecks, and moderation actions.
- Run `/api/jobs/prices` every 30 minutes. While the competition is active, it stores provider prices
  for assets referenced by confirmed, non-deleted proposals and feeds proposal return charts. Market eligibility is captured during one-time asset validation and
  independently revalidated before submission; there is no hourly market-evidence job. Run
  `/api/jobs/x-evidence` daily for public X evidence rechecks.
- The scheduled X-evidence workflow is bounded through September 30, 2026 and has an October 1
  absolute cutoff. The endpoint uses the database competition window as authority. If the competition
  dates change, update the workflow cron window and cutoff too.
- Do not manually alter accepted proposals, valid votes, evidence, or activity events. Use audited administrator actions.
- If X identity checks or posting are unavailable, new actions remain disabled until the affected X API recovers.

## After the competition closes

- Database time is authoritative; prices, votes, and OTF submissions stop at `ends_at`.
- Confirm the price endpoint reports inactive after `ends_at`; no final checkpoint is created.
- Ranking inputs are database-frozen after `ends_at`; user deletion, moderation, and evidence invalidation
  cannot alter proposals or ballots after close.
- Complete the competition-end audit and ranking locally after the competition closes.
- Preserve votes cast for deleted proposals as spent, auditable vote slots, but exclude those votes from launch ranking and every XP allocation, including participation, performance, and creator XP.
- Preserve the immutable evidence, price checkpoints, valid votes, and accepted proposals as the inputs to that local process.

## Recovery

- Restore Neon point-in-time data into a new branch, validate immutable evidence and snapshot hashes, then promote it.
- Rotate a compromised secret in the launch Vercel project only. Rotate sessions after any Auth.js secret incident.
- A later fraud finding voids the affected launch slot with an audit record; never renumber final ranks.
