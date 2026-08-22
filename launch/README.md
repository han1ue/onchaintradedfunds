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

1. Create a launch-only Neon database and run `corepack pnpm --filter @onchaintradedfunds/launch db:migrate`. The migrations create the open `Genesis Competition` and reset its clock at migration time: 7 submission-only days followed by 30 voting days.
2. Set the variables in `.env.example`. `AUTH_SECRET`, `CRON_SECRET`, and `IP_HASH_SECRET` must be independent random secrets. Use the same `AUTH_SECRET` in Preview and Production. `ADMIN_X_IDS` contains immutable X IDs, not handles. `AUTH_X_CONSUMER_SECRET` and `TWITTERAPI_IO_API_KEY` remain server-only.
3. Enable X OAuth 1.0a with read-only access and callback URL `https://launch.onchaintradedfunds.com/api/auth/x/callback`. The OAuth access-token exchange proves account ownership and returns the immutable X user ID. TwitterAPI.io supplies the public profile exactly once, when that immutable X ID is first added to `users`; repeat sign-ins never call it. Submissions and votes use free X intents plus oEmbed verification; the app never publishes posts through an API.
4. Configure Redis Cloud with `REDIS_URL` and Cloudflare Turnstile with the public site key and secret key. Allow `launch.onchaintradedfunds.com` in the Turnstile widget. Production writes fail closed when launch data, rate limiting, Turnstile, or X checks are unavailable.
5. Verify the seeded supported-asset records after migration. The database is the sole runtime source for asset names, tickers, Robinhood Chain token contracts, and checkpoint price sources.

The migration history contains the current-state baseline and one idempotent rules-snapshot backfill for databases that recorded the baseline before those columns existed. The seeded competition includes the canonical rules JSON, its SHA-256 hash, and the time it was frozen; those fields become immutable when the competition opens. Do not replay retired reset migrations from an older checkout.

The baseline stock-token records use one-time contract data from Robinhood's public APIs for Robinhood Chain (`4663`). Assets are included only after their active 18-decimal deployment and live Robinhood bid are verified. ETH exposure is represented by Robinhood Chain WETH. Runtime pages use the database rather than a second static asset catalog.

30-minute checkpoints use Robinhood bid quotes for stock tokens, the public Coinbase Exchange `ETH-USD` best bid for ETH, and one batched GeckoTerminal/CoinGecko token-price request for all `coingecko-usd` contract addresses referenced by confirmed, non-deleted proposals. Captures run only while the competition is active and stop at `ends_at`; there is no final checkpoint. A mixed portfolio is stored only as a complete checkpoint when every requested constituent succeeds in the same capture run; provider failures produce a partial checkpoint and never substitute a spot estimate. Checkpoint runs use a PostgreSQL advisory lock plus a unique capture key, so duplicate cron calls do not repeat provider requests.

## Verification

- Every submission and vote shows the exact X post with a 15-minute single-use code. The user publishes it through X, pastes the public post URL, and the application verifies that the post exists, contains the code, and belongs to the signed-in handle through free X oEmbed.
- The returned X post ID, canonical URL, text hash, and author become the durable evidence record. No nonce, pasted URL, or challenge cleanup is involved.
- The immutable X ID is the actor identity. Current X identity and eligibility fields live on the user record; action-specific facts such as accepted follower count stay with the action.
- Valid votes sort descending, then earlier proposal acceptance, then immutable proposal UUID.

Cron handlers require `Authorization: Bearer $CRON_SECRET`. The GitHub Actions price workflow requests provider-price checkpoints every 30 minutes; the endpoint captures only during the active competition window. The X-evidence workflow rechecks public evidence once daily at 02:42 UTC during its bounded August–September 2026 schedule; the endpoint uses the database competition window as authority, and the October 1 cutoff prevents calls if GitHub's yearless cron dates recur later. Manual dispatch remains available. Update both the database date and this workflow cutoff if the competition schedule changes. Unlisted validation is staged server-side as the token and pool are entered, with a 30-minute Redis/in-memory cache, then the backend rechecks the combined result before saving and submitting. There is no hourly market-evidence cron. Set the GitHub Actions variable `LAUNCH_SITE_URL` to the production launch origin and set the secret `LAUNCH_CRON_SECRET` to the same value as the launch deployment's `CRON_SECRET`.

## Deployment

Create a dedicated hosting project from this repository with Root Directory `launch`. Keep source files outside the Root Directory enabled so the build can read the workspace manifest and root lockfile. Configure the launch environment variables only on that project and enable unaffected-project skipping. The sole public production origin is `https://launch.onchaintradedfunds.com`.

Production deployments run pending Drizzle migrations automatically after a successful Next.js build and before the deployment becomes active. Preview deployments skip migrations so they cannot mutate the production database; migrate a separately scoped preview database explicitly when one is used.

Scheduled work runs through GitHub Actions rather than provider-specific cron jobs. Public links, X messages, metadata, OAuth callbacks, Turnstile verification, and scheduled endpoints all use `https://launch.onchaintradedfunds.com` directly, including from preview deployments.

Do not share the main app’s database, Auth.js secret, X application, Redis instance, analytics property, or environment variables with this project.

## Design provenance

The launch UI snapshots the operational tokens and patterns from main app commit `e2c21c6238390aec812970dff5b919b4d8d91e62`. Canonical product marks and favicon data come from the neutral `@onchaintradedfunds/brand` workspace package. Launch never imports from `app/src` at runtime.
