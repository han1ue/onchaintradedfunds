# OTF launch competition

`launch/` is a separate Next.js application for the prelaunch OTF competition and its points ledger. It shares the monorepo and root pnpm lockfile with the main application, but it has independent data, authentication, deployment, analytics, and operational configuration. Competition results do not govern protocol vaults.

## Local development

```bash
corepack pnpm install
cp launch/.env.example launch/.env.local
corepack pnpm launch:dev
```

Without `DATABASE_URL`, public read pages use labelled preview data. Endpoints that change state fail closed until the required database, X, rate-limit, and verification services are configured.

Run launch checks with:

```bash
corepack pnpm launch:test
corepack pnpm --filter @onchaintradedfunds/launch lint
corepack pnpm --filter @onchaintradedfunds/launch typecheck
corepack pnpm launch:build
```

## Production configuration

Create a launch-only Neon database and apply its migrations:

```bash
corepack pnpm --filter @onchaintradedfunds/launch db:migrate
```

The migrations create the singleton `Genesis Competition`. Migration `0002_start_competition_from_zero.sql` resets its start time when applied and sets a 37-day window: seven submission-only days followed by 30 voting days. Review the intended schedule before applying migrations to production.

Configure every value in `.env.example`. `AUTH_SECRET`, `CRON_SECRET`, and `IP_HASH_SECRET` must be independent random secrets. Preview and production must use the same `AUTH_SECRET` if sessions should survive promotion. `ADMIN_X_IDS` contains immutable X account IDs rather than handles.

Keep `AUTH_X_CONSUMER_SECRET`, `TWITTERAPI_IO_API_KEY`, database credentials, Redis credentials, Turnstile secret, and provider keys on the server.

### X identity and evidence

Configure X OAuth 1.0a for read-only access with callback URL:

```text
https://launch.onchaintradedfunds.com/api/auth/x/callback
```

The OAuth exchange establishes ownership of an immutable X user ID. TwitterAPI.io supplies the public profile when that ID is first inserted; later sign-ins reuse the stored profile.

Submissions and votes do not publish through an API. The application prepares a post containing a 15-minute, single-use code. The user publishes it with an X intent and pastes the public URL. The server verifies through oEmbed that the post exists, belongs to the signed-in handle, and contains the expected text. It stores the post ID, canonical URL, text hash, author, and accepted action as evidence.

The immutable X ID remains the actor identity even if the handle changes. Action-specific eligibility facts, such as accepted follower count, stay with the submission or vote.

### Assets and price sources

The database is the runtime source for asset names, symbols, Robinhood Chain contracts, and checkpoint price configuration. Verify the seeded assets after migration.

The baseline stock-token records use Robinhood Chain contract data and require an active 18-decimal deployment plus a live Robinhood bid. ETH exposure uses Robinhood Chain WETH.

An unlisted asset must pass server-side token and market validation before submission. Validation is staged as the token and pool are entered, cached for 30 minutes in Redis with an in-memory fallback, and checked again against the combined submission. The optional discovery index and saved verification fields are application and scoring metadata, not onchain authorization.

### Price checkpoints

During an active competition, `/api/jobs/prices` captures prices every 30 minutes for assets in confirmed, non-deleted proposals:

- Robinhood bid quotes for supported stock tokens;
- Coinbase Exchange `ETH-USD` best bid for ETH;
- one batched GeckoTerminal or CoinGecko request for `coingecko-usd` contracts.

A proposal checkpoint is complete only when every requested constituent succeeds in the same run. Provider failure produces a partial checkpoint; the service does not substitute a current estimate. A PostgreSQL advisory lock and unique capture key prevent duplicate cron calls from repeating provider requests. Captures stop at `ends_at`, and the service does not create a final checkpoint after close.

## Voting and ranking evidence

Valid votes sort by vote count, then earlier proposal acceptance, then immutable proposal UUID. Cast votes cannot be moved or reused. Votes for a later-deleted proposal remain spent and auditable but are excluded from launch ranking and XP calculations.

The database competition clock is authoritative. After `ends_at`, ranking inputs are frozen against user deletion, moderation changes, and evidence invalidation. Operators complete the final audit and ranking from the preserved proposals, votes, evidence, and checkpoints.

## Scheduled jobs

Both handlers require:

```text
Authorization: Bearer $CRON_SECRET
```

GitHub Actions calls `/api/jobs/prices` at minutes 17 and 47. A second workflow calls `/api/jobs/x-evidence` daily at 02:42 UTC during its bounded August and September 2026 schedule. The X workflow also has an October 1, 2026 cutoff because GitHub cron expressions have no year field. Update the cron window and cutoff if the competition dates change.

Set the GitHub Actions variable `LAUNCH_SITE_URL` to the production origin and `LAUNCH_CRON_SECRET` to the deployment's `CRON_SECRET`. Manual dispatch remains available.

## Deployment

Create a dedicated hosting project with Root Directory `launch`. Allow source files outside that directory so the build can read the workspace manifest and root lockfile. Configure only launch environment variables and enable unaffected-project skipping.

The public production origin is `https://launch.onchaintradedfunds.com`. OAuth callbacks, metadata, public links, X messages, Turnstile, and scheduled requests use this origin even when the code is built in preview.

Production deployment runs pending Drizzle migrations after a successful Next.js build and before activation. Preview builds skip migrations; apply migrations explicitly when a separate preview database is used.

Do not share the main application's database, Auth.js secret, X application, Redis instance, analytics property, or environment variables with the launch project.

## Design source

The launch UI snapshots operating patterns from main-application commit `e2c21c6238390aec812970dff5b919b4d8d91e62`. Shared marks and favicon data come from `@onchaintradedfunds/brand`. Launch code does not import from `app/src` at runtime.
