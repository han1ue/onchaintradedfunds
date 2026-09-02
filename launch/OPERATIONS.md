# Launch operations runbook

## Before opening

- Back up the target Neon branch, then apply launch-only Drizzle migrations.
- Confirm the competition dates, thresholds, and frozen rules snapshot. Opening the competition makes the rules immutable.
- Test X OAuth callbacks for preview and production. Confirm that administrator configuration uses immutable X IDs.
- Verify Redis, Turnstile, cron authorization, content security policy, and all required secrets.
- Configure `COINGECKO_DEMO_API_KEY` and `COINGECKO_NETWORK_ID`. The server queries public GeckoTerminal first and uses the Demo API only as a bounded fallback. It never sends the key to the browser.
- Configure `ROBINHOOD_V3_FACTORY_ADDRESS`, `ROBINHOOD_WETH_ADDRESS`, `ROBINHOOD_USDG_ADDRESS`, `ROBINHOOD_V3_SUPPORTED_FEES`, and `ROBINHOOD_RPC_URL`.
- Verify the asset-discovery index, Chainlink manifest, V3 market registry, price resolver, factory, WETH, USDG, and canonical pools against deployed code and transactions. Keep Robinhood Mainnet disabled until this review is complete.
- Check asset-registry pricing and verified-address membership. Treat them as frontend and scoring metadata, never as onchain approval.
- Confirm that vote activation selects the newest complete checkpoint at or before activation and no more than 90 minutes old. A missing checkpoint must fail with `PRICE_CHECKPOINT_UNAVAILABLE`; activation must not call providers.
- Exercise one real submission and vote in a non-production competition. Confirm the X intents, one-time codes, pasted URL verification, and stored evidence.

Unlisted-asset validation runs in stages as the user enters token and pool addresses. Token and pool evidence is cached for 30 minutes in Redis when available, with an in-memory fallback. Save and submit operations must recheck the combined result and refresh only missing or expired evidence.

## During the competition

- Monitor X API limits and spend, OAuth failures, evidence rechecks, post errors, and moderation actions.
- Call `/api/jobs/prices` every 30 minutes. The endpoint captures provider prices only while the competition is active and only for confirmed, non-deleted proposals.
- Call `/api/jobs/x-evidence` daily to recheck public evidence.
- Monitor incomplete price checkpoints. The service must not replace failed constituent prices with current spot estimates.
- Use audited administrator actions. Do not edit accepted proposals, valid votes, evidence, or activity events directly.
- Leave new X-dependent actions disabled while identity or evidence services are unavailable.

The X-evidence GitHub workflow runs only through September 30, 2026 and has an October 1 cutoff. The database competition window remains authoritative. If the schedule changes, update both the workflow window and cutoff.

There is no hourly market-evidence job. Market eligibility is captured during asset validation and checked again before submission.

## After close

- Confirm that submission, voting, and price capture stop at `ends_at`. The price endpoint should report inactive and must not create a final checkpoint.
- Verify that ranking inputs remain frozen after close despite later deletion, moderation, or evidence changes.
- Run the final competition audit and ranking locally.
- Keep votes cast for deleted proposals as spent, auditable slots. Exclude those proposals and votes from launch rank and every XP category.
- Preserve accepted proposals, valid votes, evidence, price checkpoints, and the frozen rules hash as audit inputs.

## Recovery

- Restore Neon point-in-time data into a new branch. Validate evidence records, competition rules, and snapshot hashes before promotion.
- Rotate compromised secrets only in the launch deployment. Invalidate sessions after an Auth.js secret incident.
- Record a later fraud finding as a voided launch slot. Do not renumber final ranks.
