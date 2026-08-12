# Launch operations runbook

## Before opening

- Apply launch-only Drizzle migrations to a backed-up Neon branch.
- Verify X OAuth callbacks for preview and production URLs.
- Confirm Redis, Turnstile, cron authorization, CSP, and administrator X IDs.
- Run the one-time post-deployment Robinhood asset reconciliation and enable only reviewed, liquid RWA/USDG V3 pools. Asset discovery is not a recurring cron job.
- Create the competition with final dates and thresholds. Rules freeze when it opens.
- Exercise one real submission and vote in a non-production competition. Confirm each button publishes only the exact previewed text and the returned post URL is stored.

## During the competition

- Monitor X API rate limits and spend, OAuth refresh failures, post-publication errors, evidence rechecks, and moderation actions.
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
