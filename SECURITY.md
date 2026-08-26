# Security

This repository contains unaudited experimental financial software. Do not deploy it to mainnet.

The normative authority rules, invariants, delegatecall requirements, and deployment gates are in
[`docs/PROTOCOL_SECURITY_SPEC.md`](./docs/PROTOCOL_SECURITY_SPEC.md).
The reproducible scope and adversarial checklist for outside reviewers are in
[`docs/INDEPENDENT_SECURITY_REVIEW.md`](./docs/INDEPENDENT_SECURITY_REVIEW.md).

## Responsible Disclosure

Please report suspected vulnerabilities privately before public disclosure. Include:

- Affected contract or frontend module.
- Impacted function or flow.
- Reproduction steps.
- Expected versus actual behavior.
- Whether funds, permissions, or accounting could be affected.

## Security Posture

The MVP is designed around explicit constraints rather than manager trust. A vault manager can express portfolio intent, but the contract must enforce whether that intent is allowed.

Primary security goals:

- Vault assets stay in the vault unless moved through redemption or approved rebalance settlement.
- Managers cannot make arbitrary external calls from a vault.
- Managers cannot shorten cooldowns after deployment.
- Manager fee changes remain within protocol hard caps and cannot occur during locked strategy
  states.
- Each partial trade fails atomically when any safety check fails.
- Reverted target proposals do not reset cooldowns.
- Anyone can prove an out-of-band portfolio and lock manager-fee withdrawals.
- Missed challenge deadlines forfeit challenge-window manager fees, credit 50% to the caller, and leave the rest unminted.
- Asset eligibility is mechanical rather than administrator-approved: deployed contract, exactly
  18 decimals, no duplicates, exact-transfer accounting, caps, and a valid submitted price source.
- Every OTF pins its concrete price source and per-leg validation parameters with no automatic fallback.
- Redemption does not depend on oracle health.
- The frontend is never a security boundary.

## Admin Powers

The factory owner can:

- Approve or remove trade adapters for vault rebalances.
- Change the protocol-wide minimum target weight for future portfolio proposals; the default is 1%
  and the immutable hard floor is 0.1%. An enabled OTF full-rebate threshold prevents raising this
  minimum above that threshold.
- Permanently identify the OTF protocol token and change or disable its full-rebate threshold. A
  nonzero threshold must be at least the current protocol-wide minimum target weight.
- Reversibly pause creation and all primary deposits globally.
- Reversibly pause direct and routed deposits for one factory-created OTF; non-factory targets are
  rejected.
- Start and complete ownership transfer.

The V3 market-registry owner can deprecate a pool for future selection. This does not change a source
already pinned by an OTF. No protocol role can approve, block, revoke, or remove an asset or
Chainlink feed.

The fee collector treasury can:

- Claim protocol fee shares held by `FeeCollector`.
- Start a two-step treasury transfer that the new treasury must accept.

The factory owner cannot:

- Transfer vault assets.
- Change an already deployed vault's cooldown.
- Bypass a vault's fee cap or challenge state.
- Bypass vault rebalance safety limits.
- Block proportional in-kind redemption.
- Change the fee collector treasury.
- Force a manager's target or stop earned fee accrual with either deposit pause.

## Manager Powers

A vault manager can:

- Stage a rationale for the next draft ERC-7621 proposal.
- Propose constituents and target weights with a required rationale while strategy is unlocked,
  supplying a valid pricing configuration for each newly introduced asset.
- Change weight bands while strategy is unlocked.
- Execute constrained partial rebalance trades.
- Add and remove authorized trade executors.
- Change the manager fee within the protocol cap while the portfolio is compliant.
- Transfer manager authority immediately to a new nonzero address.
- Update the fee recipient immediately to a new nonzero address.

A vault manager cannot:

- Transfer underlying assets directly.
- Call arbitrary targets from the vault.
- Shorten rebalance cooldown.
- Change protocol fee share.
- Redefine an unfinished target or change strategy during a challenge.
- Cancel a challenge or recover forfeited fees.
- Append, edit, or delete historical strategy rationales independently of target activation.
- Rescue unsupported tokens from the vault.
- Replace the source already pinned for an existing asset.
- Introduce a previously unpriced asset through the two-argument ERC-7621 `rebalance` selector,
  which has no pricing-config argument.

The manager is automatically recorded as an authorized executor and can remove or restore that
permission. Additional authorized executors use the same constrained partial-trade path. They
cannot change strategy, fees, ownership, recipients, adapters, or executor permissions. A manager
transfer is only effective after the nominated address accepts; acceptance checkpoints fees, clears
the previous executor set and manager-specific pending state, and records the new manager as the
sole executor.

## Rebalance Risks

Rebalancing depends on:

- Approved adapter correctness.
- Token behavior.
- Available liquidity.
- Oracle freshness.
- Final NAV and target-weight validation.

Target proposal, delayed activation, trade execution, and completion are separate. A proposal is
inert for 48 hours, during which holders can redeem against the unchanged active basket. Activation
revalidates the proposal. A new proposal is allowed only after the prior rebalance has been complete
inside its target bands for 14 days, with no active challenge and while the portfolio is currently
inside its completion bands. Every partial trade transaction is atomic. If a trade fails, slippage
is too high, an oracle is invalid, the cumulative execution loss would exceed the linearly
replenishing NAV-loss budget, or the batch moves any holding farther from target, that transaction
reverts while the activated strategic target remains active. When no challenge is active, an
activated strategy completes inside the wider challenge bands; an active challenge requires the
tighter completion bands. Consumed capacity returns continuously over seven days; profitable
execution does not restore it.

Changing the protocol-wide minimum target weight is not retroactive: it does not invalidate an
active portfolio or create a challenge. Existing and new vaults apply the live minimum when they
validate a new target proposal. The OTF protocol token follows this same constituent minimum.

The vault grants exact temporary approvals to the executor and clears them after each trade. This reduces approval exposure but does not remove adapter-integration risk.

Strategy-only entry points are delegated to a fixed `ManagedOTFVaultStrategy` module and selected
read-only entry points are delegated to a fixed `ManagedOTFVaultView` module so the custody contract
remains deployable under the EVM runtime-code limit. Both module addresses and expected runtime code
hashes are embedded in the vault implementation at construction and have no upgrade setter. Direct
calls to either module revert. All three contracts inherit the same canonical
`ManagedOTFVaultStorage` definition, and `contracts:security` rejects any compiled layout divergence.

## Challenge Risks

Challenges begin only when a caller proves a fresh oracle-valued challenge-band breach. The
contract cannot know the offchain time at which drift originally occurred; the grace period begins
when `flagOutOfBand()` succeeds.

Corrective trade batches automatically resolve an active challenge when their final fresh
oracle-valued weights are inside every tighter completion band. Natural price movement can instead be
resolved through the permissionless resolution call. A deadline is considered missed when an
onchain state transition observes it after expiry. Deposits and proportional withdrawals remain
available during active and overdue challenges.

## Cooldown Risks

The MVP uses one fixed 14-day cooldown measured from deployment for strategy version zero and from
successful rebalance completion thereafter.

Security intent:

- The first rebalance cannot happen immediately after vault creation.
- Strategic target proposals cannot happen back to back.
- Failed rebalances do not alter the cooldown.
- Successful completion restarts the cooldown; partial trades, challenges, and non-portfolio updates do not.
- Active challenges and portfolios outside completion bands cannot propose a new strategy.

The cooldown is not a market-risk guarantee. It only limits rebalance frequency.

## Oracle Risks

Oracle-dependent views and actions may revert when data is invalid or stale. This is intentional.
Failing closed is safer than allowing stale-price rebalances. Redemption remains independent from
all price sources.

Risk cases:

- A direct feed mapped to the wrong base or quote, including a reversed pair.
- One spoofed, stale, nonpositive, incomplete, future-dated, or unsupported-decimal leg in a
  composed asset/quoteToken × quoteToken/USD route.
- An asset/quoteToken feed being treated as quoteToken/asset, or any reliance on mutable `description()` text.
- A V3 pool from the wrong factory, pair, fee tier, or quote token; an uninitialized pool; inadequate
  observation capacity or history; and manipulation within the configured TWAP window.
- A creator selecting a mechanically valid feed for the wrong pair. Permissionless contract checks
  cannot prove semantic pair identity; the frontend manifest is informational, not authorization.
- Source unavailability. There is no Chainlink-to-TWAP or TWAP-to-Chainlink fallback.
- Corporate-action handling mismatch or a Robinhood Stock Token reporting `oraclePaused()`.
- Sequencer downtime. Robinhood recommends an L2 sequencer-uptime check, which is not yet
  implemented and is a production limitation.

Direct Chainlink routes and composed primary legs are creator-selected. Composed routes require an
enabled registered quote token and its exact current quote/USD configuration. A composed wrapper validates both legs on
every read and exposes the older timestamp. The asset leg is pinned; the quote/USD leg is loaded
from the registry on every read. Every feed check covers answer, round, timestamp,
the creator-selected staleness bound (capped at seven days), and decimals. The frontend marks a
configuration Verified only when asset, route, and explicit pricing source match its manifest and every
submitted limit is nonzero and no greater than the manifest maximum. Runtime staleness and pause
health do not change that informational status.

USD is the accounting unit for every oracle-dependent protocol calculation. WETH and USDG are
initially registered as peer pricing quote tokens and are also supported settlement and OTF-market
assets. Those execution roles do not make either token the accounting numeraire. Each quote token
has one current USD configuration.
Replacing it updates existing composed and V3 routes; disabling it blocks future selections. The
registry cannot prove Chainlink pair semantics from feed descriptions.

Robinhood Stock Token price feeds already include corporate-action multipliers. The vault must not
multiply by a separate UI multiplier. The upstream feed can keep returning a value while the token
is paused, so `ChainlinkRobinhood` pricing must require the base token's `oraclePaused()` call
to be available and false. See the [official Chainlink guidance](https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood)
and [Robinhood oracle documentation](https://docs.robinhood.com/chain/oracles-and-price-feeds).

## Token Risks

The MVP assumes plain ERC-20 behavior for every mechanically valid constituent. Mechanical
selection proves only deployed code, exactly 18 decimals, no duplicates, caps, a valid pricing
configuration, and exact balance changes when transfers are exercised. It is not a quality review.

Unsupported or dangerous token behaviors include:

- Fee-on-transfer tokens.
- Rebasing tokens.
- Tokens with blacklist or pause mechanics.
- Tokens with callbacks that enable reentrancy.
- Tokens with decimals other than exactly 18 or unavailable metadata.

There is no administrator asset allowlist to exclude these tokens. Exact-transfer checks make a
violating transfer revert atomically, but behavior that changes later or is not exercised during
creation remains an integration risk. Frontend verification status is informational only and
cannot authorize or block a contract interaction.

## Adapter Risks

Adapters are powerful integration points. Even though the vault does not call arbitrary manager-selected targets, an approved adapter can still create risk if implemented incorrectly.

Adapter review should verify:

- It never keeps vault funds unintentionally.
- It enforces minimum output.
- It cannot redirect output to an attacker.
- It has no hidden privileged behavior.
- It handles token approvals safely.
- It does not depend on centralized offchain promises for correctness.
- It treats `adapterData` as an explicit fee-bearing V3 path, validates exact token endpoints and
  every hop, permits arbitrary atomic intermediates, and never derives execution from a pricing
  market ID.
- It reconciles the router-reported output with observed input/output deltas and clears allowances.

Pricing and trading are separate trust surfaces. An OTF may price from one V3 pool or Chainlink
route and execute through different pools, intermediate tokens, and fee tiers. A pricing-market
deprecation must not disable an existing OTF's pinned reads or its otherwise-valid execution path.

### Entry and exit trade adapters

`OTFEntryExitRouter` is an optional convenience layer for entering and exiting a proportional basket with a caller-selected ERC-20 input or output token.
It is not part of vault custody or valuation. The router accepts only factory-registered OTFs,
requires an independently approved trade adapter for every non-direct constituent leg, checks
observed token deltas against adapter return values, and uses exact temporary approvals. The
exact-share path mints only after every exact-output purchase succeeds. The fixed-input path spends
fixed per-leg inputs, derives the largest strictly proportional mint from observed outputs, enforces
an aggregate minimum-share floor, and sells every surplus constituent back to the selected input token rather than
depositing it off-weight. Each refund sale uses a caller-provided minimum input-token-per-constituent rate;
the whole entry reverts if any purchase, mint, or refund sale violates its bound.

The entry path still inherits liquidity and integration risks:

- AMM execution prices may differ materially from the OTF's pinned-price NAV.
- Thin or manipulated pools may produce poor quotes even when the vault's oracle value is sound.
- A compromised approved trade adapter could spend its per-leg allowance incorrectly or attempt to retain funds.
- Router and adapter addresses are deployment-critical configuration; callers select only tokens with valid routes.
- Frontend quotes can become stale before inclusion.

The same router supports transaction-selected output-token exits. It first calls the vault's normal proportional
redemption with the user as share owner and the router as basket receiver, then sells only those
received constituents through approved adapters. Users authorize an exact OTF share amount and
set per-leg minimums, an aggregate minimum output, and a deadline. Output remains inside the
router until every leg succeeds, after which the exact aggregate is transferred to the selected
receiver. Failure reverts the share burn and all swaps.

Users therefore provide per-leg maximum inputs, an aggregate maximum settlement amount, and a
deadline. Unspent USDG is refunded atomically. The adapter allowlist is separate from the factory's
rebalance-adapter allowlist so approval for one authority does not silently grant the other.

For rebalance execution, any intermediate token may appear only inside the atomic router path. The
vault still requires both visible trade endpoints to be current constituents, and output returns
through the executor directly to the vault. No intermediate can remain as a new untracked portfolio
position through the typed trade call.

## Frontend Risks

The frontend is a convenience layer only. It must not be trusted for authorization, asset
validation, price-source validation, cooldown enforcement, fee math, or rebalance safety.
Asset verification status, catalog membership, and prefilled pricing configurations are derived
metadata only. They have no onchain counterpart and must be recomputed from live data.

Frontend-specific risks:

- Wrong RPC endpoint.
- Wrong chain.
- Misconfigured vault address.
- Wallet spoofing or injected-provider bugs.
- Misleading cached data.
- User signs a transaction on the wrong network.

The UI should always surface contract addresses, connected network state, transaction readiness, and risk limits before write actions.

## Rounding Risks

Minting rounds required deposits up. Redemption rounds outputs down. This favors vault solvency
over perfect user precision. A small, permanent share balance is locked inside every vault so
total supply cannot reach zero.

The Foundry suite exercises:

- Very small share amounts.
- Very large share amounts.
- Token decimals below 18.
- Token decimals above 18.
- Donated underlying assets.
- Low total supply.

Every supported asset transfer is also checked against sender and receiver balance deltas.
Fee-on-transfer, sender-taxed, and unexpectedly rebasing assets revert atomically.

## Fee Risks

Fees are minted as new shares using a composable fixed-point growth factor calibrated so the stated
annual rate is the exact full-year holder dilution. Deposits, mints, withdrawals, redemptions, and
fee-rate changes close the old interval before changing supply or rate. Fractional fee-share and
protocol-split remainders are retained, while long dormant intervals are processed without silently
discarding capped time. Fee-share tests cover:

- Long elapsed intervals.
- Near-zero supply.
- Zero fee rate.
- Manager/protocol split precision.
- Multiple accrual calls in the same block.
- Daily versus annual accrual cadence.
- Non-retroactive rate changes whose old-rate fee rounds below one share-wei.
- Challenge-window fee forfeiture.
- Caller reward claims for missed challenge deadlines.
- Timely challenge resolution and fee-withdrawal resumption.

The protocol share is a percentage of manager-selected fee shares. It is not a separate annual fee.
When enabled, the lesser of a vault's actual oracle-valued OTF weight and configured OTF target
weight reduces that protocol share linearly up to the factory-set full-rebate threshold. A missing
OTF constituent or failed weight read grants no discount. Protocol shares
held by `FeeCollector` can only be claimed by its configured treasury,
which can redeem those shares and perform any approved buybacks manually.

Rebate-policy changes use the latest configuration when an OTF next checkpoints fees; there is no
historical rebate-policy accounting. Strategy activation checkpoints the preceding fee interval
before replacing the active target weights.

Missed challenge-window fees are not transferred to the manager. The challenge caller can claim
50% of the escrowed OTF shares; the remaining 50% is transferred to `FeeCollector`.

## ERC-7621 Status

The contracts implement the function surface and interface identifier pinned from the
[official ERC-7621 draft assets](https://github.com/ethereum/ERCs/tree/2bc5bccf25aa06f98644c35fc92e6bf82947cfe2/assets/erc-7621),
ERC-173 ownership, and the exact `Contributed`, `Withdrawn`, and `Rebalanced` events. Custom
strategic, challenge, executor, and fee-state events are emitted alongside them.

The project claims interface compatibility with documented restrictions, not full or unconditional
ERC-7621 compliance. Contributions are intentionally restricted to the exact proportional live
basket, so arbitrary contribution vectors do not follow the draft's generalized monotonic
contribution and valuation behavior. Ownership renunciation is prevented, and constituents must be
at or below the documented raw-unit removal-dust bound before manager-directed pruning. Because the
draft `rebalance(address[],uint256[])` selector cannot carry pricing configuration, it cannot add a
previously unpriced asset; the explicit OTF extension must be used instead. ERC-7621 is a draft and
may change.

## Unsupported Token Donations

Unsupported tokens sent directly to a vault are not part of the tracked portfolio, NAV, minting, or redemption. The current MVP intentionally avoids rescue functions to prevent a manager withdrawal backdoor.

Users should avoid sending unsupported tokens to vault addresses.

Tracked assets sent directly to a vault become proportional backing for all shares. Such donations
can change displayed NAV and portfolio weights. Transaction callers must use `maxAmountsIn` and
`minAmountsOut`; previews are not price oracles.

## Audit Requirements Before Production

Before any production deployment:

- Complete professional smart-contract audits.
- Run Foundry unit, fuzz, and invariant tests.
- Add integration tests with real token and adapter behavior.
- Verify all Robinhood Chain addresses from official documentation.
- Verify every frontend-manifest Chainlink base/quote/feed relationship, explicit pricing source,
  `oraclePaused()` behavior, and staleness expectation.
- Verify the canonical V3 factory, WETH, USDG, exact constituent pools and fees, quote-token/USD
  feeds, observation cardinality, full TWAP history, and pricing/execution separation.
- Decide and test the Robinhood sequencer-uptime policy.
- Test direct/composed/no-fallback pricing and local/global deposit-pause composition.
- Verify frontend network switching and transaction simulation.
- Review every admin and manager permission.
- Publish deployed source and contract verification artifacts.

## Current Audit Status

Unaudited. Experimental. Local development only.
