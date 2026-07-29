# Security

This repository contains unaudited experimental financial software. Do not deploy it to mainnet.

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
- Managers cannot increase management fee rates after deployment.
- Rebalances fail atomically when any safety check fails.
- Reverted rebalances do not reset cooldowns.
- Redemption does not depend on oracle health.
- The frontend is never a security boundary.

## Admin Powers

The factory owner can:

- Approve or remove trade adapters for vault rebalances.
- Start and complete ownership transfer.
- Start protocol treasury transfer.

The factory owner cannot:

- Transfer vault assets.
- Change an already deployed vault's cooldown.
- Change an already deployed vault's creator fee.
- Bypass vault rebalance safety limits.
- Block proportional in-kind redemption.

## Manager Powers

A vault manager can:

- Append thesis amendments.
- Submit atomic rebalance transactions.
- Begin manager transfer.
- Accept manager transfer when pending manager.
- Begin fee-recipient transfer.

A vault manager cannot:

- Transfer underlying assets directly.
- Call arbitrary targets from the vault.
- Shorten rebalance cooldown.
- Increase creator fee.
- Change protocol fee share.
- Weaken safety limits.
- Edit or delete historical thesis entries.
- Rescue unsupported tokens from the vault.

## Rebalance Risks

Rebalancing depends on:

- Approved adapter correctness.
- Token behavior.
- Available liquidity.
- Oracle freshness.
- Final NAV and target-weight validation.

Every rebalance is atomic. If a trade fails, slippage is too high, an oracle is invalid, NAV loss exceeds the cap, or final weights are outside tolerance, the whole transaction reverts.

The vault grants exact temporary approvals to the executor and clears them after each trade. This reduces approval exposure but does not remove adapter-integration risk.

## Cooldown Risks

The MVP uses a fixed minimum cooldown of seven days, with optional longer per-vault cooldowns.

Security intent:

- The first rebalance cannot happen immediately after vault creation.
- Successful portfolio changes cannot happen back to back.
- Failed rebalances do not alter the cooldown.
- Non-portfolio updates do not alter the cooldown.

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

Minting rounds required deposits up. Redemption rounds outputs down. This favors vault solvency over perfect user precision.

Rounding should be fuzz tested across:

- Very small share amounts.
- Very large share amounts.
- Token decimals below 18.
- Token decimals above 18.
- Donated underlying assets.
- Low total supply.

## Fee Risks

Fees are minted as new shares. Fee-share math should be reviewed for:

- Long elapsed intervals.
- Near-zero supply.
- Zero fee rate.
- Creator/protocol split precision.
- Multiple accrual calls in the same block.

The protocol share is a percentage of creator-selected fee shares. It is not a separate annual fee.

## Unsupported Token Donations

Unsupported tokens sent directly to a vault are not part of the tracked portfolio, NAV, minting, or redemption. The current MVP intentionally avoids rescue functions to prevent a manager withdrawal backdoor.

Users should avoid sending unsupported tokens to vault addresses.

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

