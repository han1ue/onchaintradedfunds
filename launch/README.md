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
3. Create an X OAuth 2.0 application with callback URL `/api/auth/callback/twitter` and scope `users.read`. Login performs one authenticated profile lookup to snapshot immutable X ID, verification, account age, public status, and follower count. Submissions and votes use free X intents plus single-use oEmbed challenges; the app never publishes posts through the X API.
4. Configure Redis Cloud with `REDIS_URL` and Cloudflare Turnstile with the public site key, secret key, and `TURNSTILE_HOSTNAMES`. Use `localhost,127.0.0.1` locally and only the exact public launch hostname in production. Production writes fail closed when launch data, rate limiting, Turnstile, or X checks are unavailable.
5. After the production deployment, run the administrator asset reconciliation once, explicitly enable healthy pools, and create the competition after the rules are frozen. If dates are omitted, it opens immediately and closes two calendar months later. Asset discovery is intentionally not scheduled as a recurring cron job.

The direct-post implementation replaces the original, pre-deployment challenge schema in the initial migration. If that earlier migration was applied to a disposable launch database, recreate or reset that launch-only branch before running this migration.

The reconciler reads Robinhood Chain mainnet (`4663`), canonical USDG, and the official Robinhood Uniswap V3 factory/quoter. It verifies pool bytecode, pair tokens, initialization, liquidity, and $1,000 two-way quotes against multiplier-adjusted Robinhood bid/ask prices. Discovery never publishes an asset; an administrator must enable it.

## Verification and finalization

- Every submission and vote shows the exact X post with a 15-minute single-use code. The user publishes it through X, pastes the public post URL, and the application verifies the code and connected handle through oEmbed.
- The returned X post ID, canonical URL, text hash, author, and action-time identity snapshot become the durable evidence record. No nonce, pasted URL, or challenge cleanup is involved.
- The immutable X ID is the actor identity. Verification, protection, account age, and follower state are snapshotted at action time.
- Valid votes sort descending, then earlier proposal acceptance, then immutable proposal UUID.
- Finalization rechecks evidence and pool health before creating the leaderboard snapshot and private launch queue in one transaction.
- Public launch-order responses contain rank only. The private administrator export contains readiness dates and the canonical hash.

Cron handlers require `Authorization: Bearer $CRON_SECRET`. On Vercel Hobby, public X evidence is rechecked and expired raw post text is cleaned once daily at 02:42 UTC. Asset reconciliation is a one-time post-deployment administrator action.

## Vercel

Create a second Vercel project from this repository with Root Directory `launch`. Keep source files outside the Root Directory enabled so Vercel can read the workspace manifest and root lockfile. Configure the launch environment variables only on that project, enable unaffected-project skipping, and use `https://onchaintradedfunds-launch.vercel.app` as the initial production URL.

The configured daily cron schedule is compatible with Vercel Hobby. Set `NEXT_PUBLIC_SITE_URL=https://onchaintradedfunds-launch.vercel.app`, `TURNSTILE_HOSTNAMES=onchaintradedfunds-launch.vercel.app`, and the X callback to `https://onchaintradedfunds-launch.vercel.app/api/auth/callback/twitter`. Update all three together if a custom hostname is added later.

Do not share the main app’s database, Auth.js secret, X application, Redis instance, analytics property, or environment variables with this project.

## Design provenance

The launch UI snapshots the operational tokens and patterns from main app commit `e2c21c6238390aec812970dff5b919b4d8d91e62`. Canonical product marks and favicon data come from the neutral `@onchaintradedfunds/brand` workspace package. Launch never imports from `app/src` at runtime.
