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
3. Create an X OAuth 2.0 application with callback URL `/api/auth/callback/twitter` and scopes `users.read tweet.read tweet.write offline.access`. Configure an app bearer token for action-time user checks and daily post verification. OAuth user tokens are encrypted with a key derived from `AUTH_SECRET` before database storage.
4. Configure Upstash Redis and Cloudflare Turnstile. Production writes fail closed when launch data or X checks are unavailable.
5. After each production deployment, run the administrator asset reconciliation once, explicitly enable healthy pools, and open the competition only after rules are frozen. Asset discovery is intentionally not scheduled as a recurring cron job.

The direct-post implementation replaces the original, pre-deployment challenge schema in the initial migration. If that earlier migration was applied to a disposable launch database, recreate or reset that launch-only branch before running this migration.

The reconciler reads Robinhood Chain mainnet (`4663`), canonical USDG, and the official Robinhood Uniswap V3 factory/quoter. It verifies pool bytecode, pair tokens, initialization, liquidity, and $1,000 two-way quotes against multiplier-adjusted Robinhood bid/ask prices. Discovery never publishes an asset; an administrator must enable it.

## Verification and finalization

- Every submission and vote shows the exact X post first. The user supplies 20–120 characters of context and explicitly approves the `POST /2/tweets` call; the application never posts in the background.
- The returned X post ID, canonical URL, text hash, author, and action-time identity snapshot become the durable evidence record. No nonce, pasted URL, or challenge cleanup is involved.
- The immutable X ID is the actor identity. Verification, protection, account age, and follower state are snapshotted at action time.
- Valid votes sort descending, then earlier proposal acceptance, then immutable proposal UUID.
- Finalization rechecks evidence and pool health before creating the leaderboard snapshot and private launch queue in one transaction.
- Public launch-order responses contain rank only. The private administrator export contains readiness dates and the canonical hash.

Cron handlers require `Authorization: Bearer $CRON_SECRET`. On Vercel Hobby, public X evidence is rechecked and expired raw post text is cleaned once daily at 02:42 UTC. Asset reconciliation is a one-time post-deployment administrator action.

## Vercel

Create a second Vercel project from this repository with Root Directory `launch`. Keep source files outside the Root Directory enabled so Vercel can read the workspace manifest and root lockfile. Configure the launch environment variables only on that project, enable unaffected-project skipping, and attach `launch.onchaintradedfunds.com` after production validation.

The configured daily cron schedule is compatible with Vercel Hobby. Begin on the project’s `*.vercel.app` URL. For cutover, add the exact CNAME Vercel supplies, verify TLS, set `NEXT_PUBLIC_SITE_URL=https://launch.onchaintradedfunds.com`, update the X callback, and redirect the Vercel alias to the custom hostname.

Do not share the main app’s database, Auth.js secret, X application, Redis instance, analytics property, or environment variables with this project.

## Design provenance

The launch UI snapshots the operational tokens and patterns from main app commit `e2c21c6238390aec812970dff5b919b4d8d91e62`. It does not import from `app/src` at runtime.
