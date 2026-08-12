# OTF Launch Competition

Independent Next.js application for the OTF pre-launch competition and future points activity ledger. It shares the repository and root pnpm lockfile with the main OTF app, but has its own deployment, data, authentication, and operational configuration.

## Local development

```bash
corepack pnpm install
cp launch/.env.example launch/.env.local
corepack pnpm launch:dev
```

The public read surfaces use clearly labelled preview data when `DATABASE_URL` is absent. Mutating endpoints fail closed until the database and X credentials are configured.

## Production setup

1. Create a launch-only Neon database and run `corepack pnpm --filter @onchaintradedfunds/launch db:migrate`.
2. Set the variables in `.env.example`. `AUTH_SECRET`, `CRON_SECRET`, and `IP_HASH_SECRET` must be independent random secrets. `ADMIN_X_IDS` contains immutable X IDs, not handles.
3. Create an X OAuth 2.0 application with callback URL `/api/auth/callback/twitter` and read-only scopes `users.read tweet.read`. Configure an app bearer token for action-time user and post verification.
4. Configure Upstash Redis and Cloudflare Turnstile. Production writes fail closed when launch data or X checks are unavailable.
5. Create the competition through the administrator API, reconcile assets, explicitly enable healthy pools, and open only after rules are frozen.

The reconciler reads Robinhood Chain mainnet (`4663`), canonical USDG, and the official Robinhood Uniswap V3 factory/quoter. It verifies pool bytecode, pair tokens, initialization, liquidity, and $1,000 two-way quotes against multiplier-adjusted Robinhood bid/ask prices. Discovery never publishes an asset; an administrator must enable it.

## Verification and finalization

- Proposals and votes create 30-minute, single-use challenges. X posts are never created automatically.
- The immutable X ID is the actor identity. Verification, protection, account age, and follower state are snapshotted at action time.
- Valid votes sort descending, then earlier proposal acceptance, then immutable proposal UUID.
- Finalization rechecks evidence and pool health before creating the leaderboard snapshot and private launch queue in one transaction.
- Public launch-order responses contain rank only. The private administrator export contains readiness dates and the canonical hash.

Cron handlers require `Authorization: Bearer $CRON_SECRET` and cover hourly asset reconciliation, hourly evidence checks, and daily expired-challenge/raw-text cleanup.

## Vercel

Create a second Vercel project from this repository with Root Directory `launch`. Keep source files outside the Root Directory enabled so Vercel can read the workspace manifest and root lockfile. Configure the launch environment variables only on that project, enable unaffected-project skipping, and attach `launch.onchaintradedfunds.com` after production validation.

Use Vercel Pro for the hourly cron schedule. Begin on the project’s `*.vercel.app` URL. For cutover, add the exact CNAME Vercel supplies, verify TLS, set `NEXT_PUBLIC_SITE_URL=https://launch.onchaintradedfunds.com`, update the X callback, and redirect the Vercel alias to the custom hostname.

Do not share the main app’s database, Auth.js secret, X application, Redis instance, analytics property, or environment variables with this project.

## Design provenance

The launch UI snapshots the operational tokens and patterns from main app commit `e2c21c6238390aec812970dff5b919b4d8d91e62`. It does not import from `app/src` at runtime.
