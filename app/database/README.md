# Asset registry, pricing and NAV

Postgres is the operational registry. The initial seed contains 15 assets, eight verified identities, 16 price-source policies and six approved V3 pools. Deployment manifests remain in `app/src/config`.

## Setup and environments

Set `DATABASE_URL` in the gitignored `app/.env.local`, then run these commands from the repository root:

```sh
pnpm registry:migrate
pnpm registry:seed
node --env-file=app/.env.local app/scripts/database.mjs status
```

Migrations have a checksum ledger and run in transactions. Seeds insert missing records and preserve later administrative decisions. Run migrations and seeds before serving a new environment. Do not edit an applied migration.

The application selects `otf_development` locally, `otf_preview_<branch hash>` for each Vercel preview branch, and `otf_production` in production. Preview configuration requires `VERCEL_GIT_COMMIT_REF`. Production writes also require `REGISTRY_PRODUCTION_WRITES=true`. Test schemas must start with `otf_test_`; the integration test creates and removes its own schema. Application queries qualify their schema explicitly.

Use environment-scoped database credentials in Vercel. For database-enforced isolation, restrict each role to its application schema or use branches of the existing Neon project. The local owner credential can access more than the application schema; application schema selection is not a database permission boundary.

`UNISWAP_API_KEY`, `DATABASE_URL`, `CRON_SECRET`, and optional RPC URLs are server secrets. Do not give them `NEXT_PUBLIC_` names. Optional `UNISWAP_RATE_LIMIT_DATABASE_URL` must point all instances sharing one API key at the same coordinator database if application schemas use separate Neon branches.

## Registry decisions

Assets are identified by chain and address. Verification, enabled status, source approval and pool approval have separate fields. The Registered Assets page shows all enabled assets and their verification status. Registration does not make an asset eligible for fund creation or execution.

Administrative changes to assets, sources, pools and settings write before/after rows to `registry_audit`. Set the transaction-local `otf.actor` setting to an operator or job identifier. Keep source validation metadata tied to an independently checked asset identity. After changing a mapping, clear its `validated_at` until the collector validates it again.

V3 records contain a pool address, pair and fee. V4 records contain the PoolManager, pool ID, ordered currencies, fee, tick spacing, hooks and hook data. Nonzero hooks require an approved runtime hash. Pool checks compare these records with the configured contracts and current chain state. Deployment tooling reads Postgres and registers new protocol tokens as unverified, with their price sources unapproved.

## Routing policy

The initial candidate generator considers direct paths and two-hop paths through approved Uniswap pools. It supports competing pools for the same pair. It does not discover fund-share pools.

The on-chain quote policy limits a comparison to 16 candidates. It compares the requested amount with a 1% probe and permits at most 200 basis points of estimated price impact. Inputs below 100 raw units cannot produce that probe. Registered routes also require an input value of at most $10,000 using an approved usable observation. Canonical quote currencies have quantity caps of 10,000 USDG or one WETH; these caps do not assert a dollar peg.

V3 uses packed multi-hop paths and reverses them for exact output. V4 uses its Quoter's multi-hop structure and exact-output currency ordering. Mixed routes quote segments in the required direction, convert native ETH/WETH at version boundaries, and use the actual intermediate balances during execution. Basket routes exclude intermediates that could consume another constituent's reserved balance.

Both networks use the same registered routes and complete basket simulation. Mainnet can discover a missing or unusable path through the Trading API, with one outbound quote request per endpoint pair per top-level basket quote. Amount changes reuse authenticated paths and on-chain Quoters. Testnet has no API fallback. A failed simulation returns unavailable without an API retry. Registered execution needs no API key; missing Quoter or adapter bindings make the affected path unavailable.

Fund-to-fund swaps settle through WETH; other redemptions target the requested output. Compatible one- or two-hop exits can share a final pool conversion. Pool identity, direction, and execution semantics must match. The planner excludes hooked, dynamic-fee, split, and mixed paths from aggregation, quotes the combined input, preserves constituent funding and output minimums, and validates the complete transaction. Simulation supplies gas, output, and residual refunds. Registry verification decisions remain independent of route approval.

Candidate comparison can subtract gas costs when every candidate has a reliable conversion into the comparison token. The current RPC integration leaves this conversion unset because Quoter execution gas alone omits L2 data fees. It compares token amounts and reports available simulation gas estimates. Direct fund-share and basket results still compete by usable output; the UI claims only the best result among compared routes.

Quotes expire after 45 seconds. The browser retains the 400 ms debounce, aborts superseded requests, and pauses automatic quote refresh while hidden. On return it requests current quotes.

Allowance checks run when the user executes. ERC-20 and Permit2 permissions use exact amounts. Complete transaction simulation must pass; quoting does not broadcast approvals or swaps. The RPC must support `eth_simulateV1` for server simulation.

The shared `otf_shared.provider_limits` table admits one request per API key every 210 ms. Row locks coordinate Vercel instances, including previews using the same key. Requests have a ten-second queue timeout and at most three API attempts. `Retry-After` sets a shared cooldown. A coordinator failure does not bypass the limit.

## Price observations

The authenticated collector reads approved source mappings once per run, shares identical upstream requests, and stores exact decimal observations. Client endpoints read Postgres. Valuation policies distinguish stock reference prices, token market prices and executable swap quotes. Executable quotes are excluded from NAV.

Stock mappings check the expected ticker. Mainnet stock references also require a matching active Robinhood chain/address deployment, decimals and a one-share multiplier. Oracle mappings check description, decimals, answer, round completeness and source time.

Live inspection identified the five imported stock oracles as Robinhood testnet mocks with synthetic values near $1. Their records remain preserved, but their price-source approval is disabled. Asset verification is unchanged. The testnet protocol OTF source uses its launch price and deployed synthetic ETH reference; it is an indicative valuation.

Freshness uses source time, not collection time. The seed permits stock references up to 90,000 seconds old during trading and 345,600 seconds (four days) when the provider reports a closed market. Held closing prices retain their original timestamp and the market-closed label. Observations beyond that limit remain stale. Market caps are collected separately and retained for at most 120 days; a missing cap can block market-cap creation calculations without blocking NAV. `price_source_status` records failed validations without logging credentials or raw provider errors.

## Shared snapshots

The collector discovers funds through factory events and checks factory provenance. It reads accounted balances, supply and bootstrap quantities at one block, 12 blocks behind the current head. Each snapshot records its block hash and the exact price-row references available at that block's time. Total NAV, NAV/share and bootstrap NAV are separate columns. Empty funds have no NAV/share; bootstrap values do not become historical share prices.

Snapshots use five-minute slots. The collector stores no historical values from current holdings. An observation that is missing or stale produces an unpriced snapshot. Charts use stored priced snapshots, and current shared valuations expire after ten minutes. Trading continues to read current contract state.

Leases exclude overlapping collectors and fence writes after lease expiry. Discovery advances in bounded log ranges and resumes from its stored block. Snapshots are unique per canonical fund/slot. Reorg checks invalidate later discovery, on-chain prices and snapshots, then resume at the matching checkpoint. A reorg beyond the retained 100-checkpoint search requires an operator to investigate and rewind; the collector stops instead of inventing an ancestor.

## Scheduling and activation

`app/vercel.json` schedules `/api/cron/collect` every five minutes. The handler requires `Authorization: Bearer <CRON_SECRET>`, has a 300-second limit, and runs pricing before snapshots. Source and market-cap failures do not prevent the other jobs from running. Failed jobs or source attempts return HTTP 503 with bounded status details.

Vercel cron runs on production deployments. The existing Hobby plan does not support five-minute cron. Before deployment, choose a compatible plan or have an existing scheduler call the authenticated endpoint and remove the Vercel cron entry. No scheduler service was provisioned for this change.

Production activation requires production-scoped credentials, migrations and seeds, `REGISTRY_PRODUCTION_WRITES=true`, a strong `CRON_SECRET`, and RPCs with the required simulation/history methods. Inspect source failures and choose the approved freshness policy before relying on NAV. No contracts, app deployment or transactions are part of database setup.

For local collection, start the app and run `node --env-file=app/.env.local app/scripts/collect-local.mjs`. This writes only the selected application schema. Inspect the database status command afterward. Mainnet fund collection stays unavailable until its factory deployment is configured.

## Verification

Run `pnpm --filter @onchaintradedfunds/app test`, `typecheck`, and `lint`. The unit suite covers competing pools, direction and mixed-version quoting, fallback, rate coordination, timestamps and exact NAV arithmetic.

For the opt-in Neon integration suite, set `RUN_DATABASE_TESTS=true`, load the local environment, and run Vitest against `src/server/registry.integration.test.mjs` with `--root app --maxWorkers=1`. It verifies repeatable migration/seed behavior, filters, audits, multiple pools, shared rate slots, lease fencing, reproducible snapshots and reorg replacement. It uses disposable database records and mocked chain state. It does not execute swaps.
