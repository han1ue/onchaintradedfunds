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
- Revoking any retained constituent places the vault in a fail-closed inflow quarantine until
  registry governance explicitly reapproves it, even after its target and balance reach zero.
- Redemption does not depend on oracle health.
- The frontend is never a security boundary.

## Admin Powers

The factory owner can:

- Approve or remove trade adapters for vault rebalances.
- Change the protocol-wide minimum target weight for future portfolio proposals; the default is 1%.
- Start and complete ownership transfer.

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

## Manager Powers

A vault manager can:

- Stage a rationale for the next draft ERC-7621 proposal.
- Propose constituents and target weights with a required rationale while strategy is unlocked.
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

The manager is automatically recorded as an authorized executor and can remove or restore that
permission. Additional authorized executors use the same constrained partial-trade path. They
cannot change strategy, fees, ownership, recipients, adapters, or executor permissions. Manager
transfer clears the previous executor set and records the new manager as the sole executor.

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
is too high, an oracle is invalid, the cumulative execution loss would exceed the current
seven-day epoch budget, or the batch moves any holding farther from target, that transaction
reverts while the activated strategic target remains active. Positive execution does not restore
loss capacity already consumed in the epoch.

Changing the protocol-wide minimum target weight is not retroactive: it does not invalidate an
active portfolio or create a challenge. Existing and new vaults apply the live minimum when they
validate a new target proposal.

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
oracle-valued weights are inside every completion band. Natural price movement can instead be
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

Oracle-dependent views and actions may revert when data is invalid or stale. This is intentional. Failing closed is safer than allowing stale-price rebalances.

Risk cases:

- Stale price feed.
- Nonpositive price.
- Incomplete round.
- Incorrect feed mapping.
- Oracle decimals not handled as expected.
- Corporate-action handling mismatch in the upstream feed.

Robinhood Stock Token price feeds are expected to include corporate-action multipliers. The vault must not multiply by a separate UI multiplier.

## Token Risks

The MVP assumes plain ERC-20 behavior for approved assets.

Unsupported or dangerous token behaviors include:

- Fee-on-transfer tokens.
- Rebasing tokens.
- Tokens with blacklist or pause mechanics.
- Tokens with callbacks that enable reentrancy.
- Tokens with nonstandard decimals or metadata behavior.

Approved asset registries should exclude tokens with behavior that violates vault accounting assumptions.

## Adapter Risks

Adapters are powerful integration points. Even though the vault does not call arbitrary manager-selected targets, an approved adapter can still create risk if implemented incorrectly.

Adapter review should verify:

- It never keeps vault funds unintentionally.
- It enforces minimum output.
- It cannot redirect output to an attacker.
- It has no hidden privileged behavior.
- It handles token approvals safely.
- It does not depend on centralized offchain promises for correctness.

### Settlement entry adapters

`OTFEntryRouter` is an optional convenience layer for acquiring an exact proportional basket with
USDG. It is not part of vault custody or valuation. The router accepts only factory-registered
OTFs, requires an independently approved entry adapter for every non-settlement constituent,
checks observed token deltas against adapter return values, uses exact temporary approvals, and
mints shares only after every exact-output purchase succeeds.

The entry path still inherits liquidity and integration risks:

- AMM execution prices may differ materially from Chainlink-priced OTF NAV.
- Thin or manipulated pools may produce poor quotes even when the vault's oracle value is sound.
- A compromised approved entry adapter could spend its per-leg allowance incorrectly or attempt to retain funds.
- Router, adapter, settlement-token, and venue addresses are deployment-critical configuration.
- Frontend quotes can become stale before inclusion.

The same router supports settlement-token exits. It first calls the vault's normal proportional
redemption with the user as share owner and the router as basket receiver, then sells only those
received constituents through approved adapters. Users authorize an exact OTF share amount and
set per-leg minimums, an aggregate minimum USDG output, and a deadline. Output remains inside the
router until every leg succeeds, after which the exact aggregate is transferred to the selected
receiver. Failure reverts the share burn and all swaps.

Users therefore provide per-leg maximum inputs, an aggregate maximum settlement amount, and a
deadline. Unspent USDG is refunded atomically. The adapter allowlist is separate from the factory's
rebalance-adapter allowlist so approval for one authority does not silently grant the other.

For rebalance execution, USDG may appear only as an internal adapter route hop. The vault still
requires both visible trade endpoints to be current constituents, and output returns through the
executor directly to the vault. The adapter cannot use USDG as an arbitrary recipient or leave it
as a new untracked portfolio position through the typed trade call.

## Frontend Risks

The frontend is a convenience layer only. It must not be trusted for authorization, asset validation, cooldown enforcement, fee math, or rebalance safety.

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
Protocol shares held by `FeeCollector` can only be claimed by its configured treasury.

Missed challenge-window fees are not minted to the manager. The challenge caller can claim 50% as
OTF shares; the remaining 50% is skipped rather than minted and burned.

## ERC-7621 Status

The contracts implement the function surface and interface identifier pinned from the
[official ERC-7621 draft assets](https://github.com/ethereum/ERCs/tree/2bc5bccf25aa06f98644c35fc92e6bf82947cfe2/assets/erc-7621),
ERC-173 ownership, and the exact `Contributed`, `Withdrawn`, and `Rebalanced` events. Custom
strategic, challenge, executor, and fee-state events are emitted alongside them.

The project claims interface compatibility with documented restrictions, not full or unconditional
ERC-7621 compliance. Contributions are intentionally restricted to the exact proportional live
basket, so arbitrary contribution vectors do not follow the draft's generalized monotonic
contribution and valuation behavior. Ownership renunciation is prevented, and constituents must be
at or below the documented raw-unit retiring-dust bound before removal. If no approved
positive-target constituent remains, the vault enters irreversible terminal shutdown rather than a
normal challenge. ERC-7621 is a draft and may change.

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
- Verify oracle feed behavior and staleness expectations.
- Verify frontend network switching and transaction simulation.
- Review every admin and manager permission.
- Publish deployed source and contract verification artifacts.

## Current Audit Status

Unaudited. Experimental. Local development only.
