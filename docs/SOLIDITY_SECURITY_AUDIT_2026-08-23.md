# Solidity Security Audit

**Project:** Onchain Traded Funds  
**Audit date:** 2026-08-23  
**Reviewed contracts commit:** `7a2d86506ba4f059db1610f6a7a1413275024fdf`  
**Scope:** `contracts/src/**/*.sol`, `contracts/test/**/*.sol`, Foundry configuration, contract security gates, and the protocol security specifications  
**Audit-remediation status:** M-02, L-04, L-05, I-01, I-04, and I-05 are resolved; M-03 is accepted with a 20-asset frontend mitigation; L-02 and I-06 are partially resolved; L-03 is accepted.
**Overall status:** **Not production-ready until the Medium findings and documented deployment blockers are resolved and re-reviewed**

## Executive summary

The protocol has a materially stronger security baseline than a typical unaudited Solidity repository. Custody paths use reentrancy guards and exact balance-delta checks; deposits and withdrawals use conservative rounding; trade execution confines recipients and spenders; strategy and view modules are code-hash pinned; oracle reads validate answers, rounds, timestamps, freshness, and decimals; and the repository has unusually extensive fee, strategy, fuzz, and invariant tests.

No Critical or High-severity vulnerability was confirmed. The review identified:

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 5 |
| Informational / QA observations | 6 groups |

The most important unresolved risks are:

1. A thin or abandoned Uniswap V3 pool can continue producing a mechanically valid but attacker-controlled TWAP because liquidity is not checked.
2. At the reviewed commit, a public mempool attacker could pre-initialize the deterministic OTF V3 pool and censor vault creation. Current code removes this coupling and deterministic clone prediction.
3. The advertised 100-asset bound is not safely executable under Robinhood Chain's current 32,000,000 per-transaction gas cap.

Passing tests does not negate the unresolved findings. Continued fee accrual during an incomplete strategic rebalance remains explicitly tested behavior.

## Scope and methodology

The `contracts/` tree matched the reviewed commit at the start of the audit. Unrelated pre-existing changes under the application, README, and deployment scripts were not modified or included as audited Solidity.

The review covered:

- Vault share accounting, mint/redeem rounding, locked liquidity, donations, exact transfers, and fee growth.
- Factory initialization, clone deployment, limits, and privileged controls.
- Strategy proposal, activation, execution, completion, challenges, fee escrow, loss budgets, and role changes.
- Direct, composed, Robinhood, and Uniswap V3 pricing paths.
- Registry governance, route pinning, adapter execution, approval hygiene, and external-call boundaries.
- Delegatecall isolation, storage compatibility, runtime code-hash checks, ABI constraints, and bytecode limits.
- Unit, fuzz, invariant, lint, format, coverage, and CI posture.
- Current upstream Solidity, OpenZeppelin, Uniswap V3, and Robinhood Chain behavior relevant to the findings.

This was a source-level and local execution review. It was not formal verification, a legal opinion, or an audit of deployed bytecode, production addresses, governance signers, live oracle identities, or live market liquidity.

## Severity model

- **Critical:** Direct systemic asset loss or irreversible control compromise with broadly feasible preconditions.
- **High:** Major asset loss, permanent custody failure, or privileged takeover under realistic conditions.
- **Medium:** Material protocol-integrity, economic-security, or sustained availability failure with feasible preconditions.
- **Low:** Limited-impact correctness, operational-safety, or defense-in-depth weakness.
- **Informational:** Interface, documentation, testing, maintainability, licensing, or explicitly accepted economic-design concern without a direct runtime exploit.

## Findings summary

| ID | Severity | Title | Status |
| --- | --- | --- | --- |
| M-01 | Medium | Empty or thin V3 pools remain valid price oracles | Accepted |
| M-02 | Medium | Deterministic pool squatting could censor vault creation | Resolved |
| M-03 | Medium | The 100-asset bound is not safely executable on the target chain | Accepted with frontend mitigation |
| L-01 | Low | Absolute bands can treat a missing positive-target asset as compliant | Accepted |
| L-02 | Low | Activated strategies have no timeout or terminal recovery path | Partially resolved |
| L-03 | Low | Rebalance instructions have no expiry or strategy-version binding | Accepted |
| L-04 | Low | Manager, router, and adapter authority transfers are one-step | Resolved |
| L-05 | Low | OTF/USDG initialization assumed USDG was exactly $1 | Resolved |

## Owner disposition

The project owner recorded the following decisions after reviewing the findings. "Accepted" means
the identified risk is knowingly retained; it does not mean the audit considers the issue resolved.

| Finding | Owner disposition |
| --- | --- |
| M-01 | Accepted with frontend trust labeling and monitoring; direct onchain callers remain exposed to the retained oracle dependency |
| M-02 | Fixed by removing pool handling from vault creation and removing deterministic clone prediction |
| M-03 | Accepted with a lower frontend cap and transaction gas estimation; the contract still accepts the documented upper bound |
| L-01 | Accepted; a positive target at or below the absolute deviation may intentionally have a zero lower bound |
| L-02 | Partially remediated by allowing unchallenged completion inside the wider challenge bands; no timeout or forced terminal state was added |
| L-03 | Accepted; trade deadlines and strategy-version binding were intentionally not added |
| L-04 | Fixed with two-step ownership for the router, adapter, and clone-compatible vault manager flow |
| I-01 | Fixed by explicitly rejecting historical round requests in normalized route feeds |
| I-02 | Accepted as an intentional economic-policy design |
| I-03 | Fixed by upgrading the exact compiler pin to Solidity 0.8.36, retaining OpenZeppelin Contracts 5.6.1, and rerunning release gates |
| I-04 | Fixed by correcting the SPDX identifier and Uniswap TickMath/OracleLibrary attribution; executable math is unchanged |
| I-05 | Fixed by aligning the normative V3 quote-token requirement and deployment evidence with enabled owner-registered quote tokens |
| I-06 | Partially fixed with stronger invariants, independent differentials, adversarial-token tests, and pinned Linux CI; live canonical/fork coverage remains open |

---

## M-01 — Empty or thin V3 pools remain valid price oracles

**Severity:** Medium  
**Category:** Oracle manipulation / economic security  
**Affected code:**

- `contracts/src/AssetMarketRegistry.sol:328-365`
- `contracts/src/UniswapV3RoutePriceFeed.sol:126-142`
- `contracts/src/UniswapV3RoutePriceFeed.sol:190-203`
- `contracts/test/PermissionlessAssetMarkets.t.sol:414-433`

### Description

V3 market registration verifies the canonical factory, pair, fee tier, initialization, observation cardinality, and availability of a full one-hour observation. It does not verify current liquidity or time-weighted liquidity. Both the registry and the route feed discard the `secondsPerLiquidityCumulativeX128s` values returned by `observe()`.

This distinction is security-critical. Uniswap V3's canonical oracle advances `tickCumulative` with the current tick regardless of liquidity. When liquidity is zero, only the separate seconds-per-liquidity accumulator reflects that fact. `observe()` can also counterfactually extend the newest tick without requiring another swap. See Uniswap's canonical [Oracle.sol](https://github.com/Uniswap/v3-core/blob/main/contracts/libraries/Oracle.sol). Uniswap's own [OracleLibrary](https://github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/OracleLibrary.sol) returns both arithmetic-mean tick and harmonic-mean liquidity.

An attacker can therefore:

1. Add minimal in-range liquidity to a thin or abandoned selected pool.
2. Move the pool to an extreme tick at a cost proportional to that small liquidity.
3. Remove liquidity, leaving the manipulated tick in place.
4. Wait for enough of the one-hour window to reflect the manipulated tick.
5. Obtain a fresh, mechanically valid price even though the pool has no meaningful economic depth.

The manipulated price is consumed by NAV and weight views, strategy proposal and activation checks, per-trade oracle slippage, NAV-loss and target-improvement protections, fee policy, and permissionless challenges. Proportional minting and redemption remain oracle-independent.

Market deactivation is not an emergency control for an already-pinned vault. The normalized wrapper does not consult current market activity, and the existing test suite explicitly confirms that deprecation does not disable an existing feed.

The repository documents selected pricing pools as trusted economic dependencies and acknowledges TWAP-window manipulation. Accordingly, this is a Medium economic/design risk rather than an unconditional High-severity drain. It nevertheless weakens the mechanical protections that are intended to constrain an otherwise untrusted manager or executor.

### Impact

- Cheap false out-of-band challenges and manager-fee griefing on abandoned pools.
- Incorrect NAV, weights, strategy state, and fee-rebate calculations.
- A colluding manager/executor can use a false valuation to make a value-losing trade appear to satisfy target-improvement and NAV-loss constraints.
- Existing non-upgradeable pinned wrappers cannot be repaired through registry deactivation alone.

### Recommendation

- Consume both arrays returned by `observe()` and enforce a pair-specific minimum harmonic-mean liquidity across the entire TWAP window.
- Add a nonzero current-liquidity check, but do not rely on it alone because it can be flash-provided.
- Add a deviation bound against an independent reference oracle where one exists.
- Make pool economic-security parameters governance-reviewed, delayed, monitored, and visible to investors.
- Add a canonical Uniswap V3 proof test that manipulates a thin pool, removes liquidity, advances time, and demonstrates fail-closed pricing.
- Treat the remediation as a fresh-deployment change for already-created immutable route wrappers.

---

## M-02 — Deterministic pool squatting could censor vault creation

**Severity:** Medium  
**Category:** Availability / front-running  
**Status:** Resolved after the reviewed commit
**Originally affected code:**

- `contracts/src/OTFFactory.sol:195-219`
- `contracts/src/OTFFactory.sol:491-498`
- The removed factory-to-market-registry integration

### Description

The creator address, creator nonce, deployment parameters, deterministic salt, predicted clone address, and canonical `vault/USDG/500` pool are derivable from public `createVault` calldata. Canonical Uniswap V3 pool creation and initialization are permissionless, and the factory does not require either token address to contain code.

Under the original implementation, a mempool observer could calculate the predicted vault, create its canonical pool, initialize it at any valid price, and make `OTFFactory.createVault()` revert.

The original regression test proved the atomic revert and confirmed that the creator nonce rolled back. Address rerolling permitted another attempt, but an observer could repeat the attack against each public attempt. The result was targeted, repeatable creation censorship; no creator funds were lost because the transaction reverted atomically.

### Recommendation

Do not require a pristine, correctly initialized pool as a precondition for vault creation.

- Keep market creation and initialization in a separate, optional post-creation transaction.
- Treat any existing Uniswap pool as permissionless market state, not a trusted NAV source.
- Do not expose deterministic vault prediction unless a concrete consumer requires it.

The implemented resolution removes market-registry coupling from `OTFFactory`, deploys clones with `CREATE` rather than salted `CREATE2`, and removes the prediction API and creator nonce. The frontend discovers supported markets independently. A third party may still initialize a pool at any price, so liquidity providers must inspect the current price; this no longer affects OTF creation or custody.

---

## M-03 — The 100-asset bound is not safely executable on the target chain

**Severity:** Medium  
**Status:** Accepted with frontend mitigation
**Category:** Gas-bound liveness  
**Affected code:**

- `contracts/src/libraries/ProtocolConstants.sol:5`
- `contracts/src/ManagedOTFVaultStrategy.sol:270-330`
- `contracts/src/ManagedOTFVaultStrategy.sol:650-665`
- `contracts/src/AssetPricingResolver.sol:100-142`
- `contracts/src/OTFEntryRouter.sol:279-331`
- `contracts/test/RebalanceSafety.t.sol:23-73`

### Description

`MAX_TRACKED_ASSETS` is 100. The boundary test proves that a 100-asset tracked union can be proposed, but it does not activate that proposal. Activation loops over pending assets, validates and pins pricing, replaces portfolio storage, and writes strategy history. Composed Chainlink and V3 sources also deploy a normalized wrapper for every newly introduced asset during activation.

A targeted local gas measurement using the accepted 100-asset union from the existing boundary test found:

- 99 positive targets plus one retiring asset.
- Direct mock Chainlink feeds only; no wrapper deployment.
- `activatePendingStrategy()` consumed **31,670,133 gas**.

At audit time, the Robinhood Chain ArbGasInfo precompile returned a per-transaction maximum of **32,000,000 gas** on both mainnet and testnet:

```text
cast call 0x000000000000000000000000000000000000006C \
  "getMaxTxGasLimit()(uint256)" \
  --rpc-url <Robinhood RPC>

32000000
```

The mainnet observation was recorded at block `44,312,948`. The direct-feed case leaves only about 330,000 gas of headroom before transaction overhead, dependency variance, or future changes. A proposal containing multiple composed or V3 routes will exceed the cap materially below 100 assets because each route deploys a contract.

The optional entry router compounds the problem by repeatedly calling an O(asset count) `previewMint()` inside a raw-share binary search. A normal two-asset route required approximately 65 previews in a trace; this does not scale safely to the advertised maximum.

Failed activation is atomic and the manager can cancel the pending proposal, so existing funds and targets remain safe. The issue is that a configuration accepted by protocol validation cannot reliably reach its advertised terminal state on the target chain.

### Recommendation

- Replace the single asset-count limit with conservative, source-specific caps derived from worst-case gas on the target chain and real dependencies.
- Keep a substantial safety margin; do not use a limit that consumes approximately 99% of the chain cap in mocks.
- Add a permissionless resolver cache or preparation phase that deploys and validates normalized wrappers before atomic strategy activation. Activation should only bind previously prepared immutable results.
- If staging vault state, use bounded batches and do not change effective targets until every staged item is committed and revalidated.
- Replace the entry router's repeated full previews with a direct bound plus a small, fixed number of correction previews.
- Add gas-regression tests for direct, Robinhood, composed, and V3 portfolios against a configured percentage of the live `getMaxTxGasLimit()` value.

The accepted remediation leaves the Solidity maximum at 100 and adds a frontend-only maximum of 20
tracked assets. Creation rejects more than 20 assets. Strategy proposals count the unique union of
currently tracked and proposed assets, including existing zero-target retiring assets, and block
simulation and submission above 20. This materially reduces risk for frontend users but does not
remove the accepted onchain liveness risk for direct callers.

---

## L-01 — Absolute bands can treat a missing positive-target asset as compliant

**Severity:** Low  
**Category:** Mandate correctness  
**Affected code:**

- `contracts/src/PortfolioCalculator.sol:249-260`
- `contracts/src/PortfolioCalculator.sol:396-406`
- `contracts/src/ManagedOTFVaultStrategy.sol:270-330`
- `contracts/src/ManagedOTFVaultStrategy.sol:476-486`
- `contracts/src/ManagedOTFVault.sol:486-512`
- `contracts/src/ManagedOTFVault.sol:704-733`

### Description

Weight bands are absolute percentage-point deviations. `_preciseBand()` clamps the lower bound to zero whenever `targetWeightBps <= deviationBps`, and comparisons are inclusive.

For example, all currently permitted parameters can produce this sequence:

1. The vault holds only B with target `B=10,000`.
2. Completion deviation is 1,000 BPS and challenge deviation is 2,500 BPS.
3. The new target is `B=9,000`, `A=1,000`.
4. Actual weights remain `B=10,000`, `A=0` after activation.
5. Both actual weights are inside their completion bands, so the strategy can complete without acquiring A.
6. Zero A also remains inside its challenge band, so the missing exposure is unchallengeable.
7. Proportional deposits require zero A because its reserve is zero, perpetuating the state.

The parameters and actual holdings are public and holders receive the activation delay, which limits severity. However, a completed positive target can represent no actual exposure.

### Recommendation

- Prefer relative per-target bands, or explicitly require each positive target to exceed the applicable absolute deviation.
- At minimum, make `target > 0 && reserve == 0` fail completion and count as a challenge breach.
- Define a dust-aware minimum exposure so a negligible reserve cannot satisfy the positive-target invariant indefinitely.
- Validate the relationship when creating a vault, proposing a strategy, and changing bands.
- Add regression and invariant tests for `target == deviation`, `target < deviation`, zero reserve, immediate completion, challenge behavior, and later proportional deposits.

---

## L-02 — Activated strategies have no timeout or terminal recovery path

**Severity:** Low  
**Status:** Partially resolved after the reviewed commit
**Category:** Governance liveness / fee alignment  
**Affected code:**

- `contracts/src/ManagedOTFVaultStorage.sol:259`
- `contracts/src/ManagedOTFVaultStrategy.sol:133-180`
- `contracts/src/ManagedOTFVaultStrategy.sol:215-228`
- `contracts/src/ManagedOTFVaultStrategy.sol:298-330`
- `contracts/src/ManagedOTFVaultStrategy.sol:476-526`
- `contracts/src/ManagedOTFVaultStrategy.sol:588-603`
- `contracts/test/ChallengeAndFeeState.t.sol:72-110`

### Description

At the reviewed commit, a dedicated rebalance-start timestamp was recorded but never used as a
deadline. Phase 4 removed that redundant field; the strategy version's `activatedAt` remains the
canonical historical timestamp. A portfolio can remain outside completion bands but inside the
wider challenge bands indefinitely. In that state:

- Completion reverts.
- A challenge cannot start.
- New strategies, band changes, fee-rate changes, rationale staging, and sunset are locked.
- Manager fees continue accruing normally.

An oracle failure, frozen constituent, or unavailable market can also make the intended maintenance-trade recovery path impossible. Holder share transfers and oracle-independent proportional redemption remain available while token transfers remain functional, which materially reduces severity.

### Recommendation

- Enforce a maximum strategic-rebalance duration using the existing timestamp.
- After expiry, suspend manager fees and permit a permissionless terminal transition.
- Prefer a forced-sunset or explicitly incomplete terminal state over blindly rolling back targets after assets, pricing, or retiring balances may have changed.
- Test that every activated strategy has a terminal path and cannot earn fees indefinitely while incomplete.

The agreed remediation reduces the reachable incomplete region without adding a timeout. An
unchallenged strategy can now complete inside the wider challenge bands through activation, a
successful trade, or the permissionless completion function. An active challenge still requires the
tighter completion bands. Deposits and proportional redemptions remain independent of completion
and oracle availability. The original frozen-market, invalid-oracle, or outside-wider-band timeout
risk remains; this finding is therefore only partially resolved.

---

## L-03 — Rebalance instructions have no expiry or strategy-version binding

**Severity:** Low  
**Status:** Accepted
**Category:** Stale intent  
**Affected code:**

- `contracts/src/VaultTypes.sol:40-47`
- `contracts/src/ManagedOTFVaultStrategy.sol:350-428`
- `contracts/src/RegisteredUniswapV3Adapter.sol:72-102`

### Description

An authorized manager/executor transaction can remain pending and execute later if its adapter minimum, current oracle valuation, current target-improvement, and NAV-loss checks still pass. Those fresh checks prevent a direct safety-bound bypass, but a stale transaction can execute against a later strategy if it happens to improve that strategy too.

### Recommendation

Add both:

- A transaction `deadline` checked against `block.timestamp`.
- An `expectedStrategyVersion` or `expectedRebalanceId` checked before any transfer or approval.

The version binding is stronger than a deadline alone. Add expired and wrong-version rollback tests.

---

## L-04 — Manager, router, and adapter authority transfers are one-step

**Severity:** Low  
**Status:** Resolved after the reviewed commit
**Category:** Operational access control  
**Affected code:**

- `contracts/src/ManagedOTFVaultStrategy.sol:57-80`
- `contracts/src/OTFEntryRouter.sol:129-134`
- `contracts/src/RegisteredUniswapV3Adapter.sol:65-70`

### Description

Each transfer immediately assigns control to the supplied address. A typo, wrong network address, or contract unable to operate the role can permanently lose management or administration. Vault redemption remains available after manager loss, limiting impact.

The factory, market registry, and fee collector already use safer two-step flows. OpenZeppelin likewise recommends two-step ownership acceptance for avoiding transfer to an address that cannot operate the contract; see [OpenZeppelin access control](https://docs.openzeppelin.com/contracts/5.x/access-control).

### Recommendation

Use `pendingOwner` / `pendingManager` plus explicit acceptance and cancellation. For manager transfer, preserve the current manager and executor configuration until acceptance, then perform executor cleanup atomically. Any vault storage change must pass the existing canonical layout checks and requires fresh review.

`OTFEntryRouter` and `RegisteredUniswapV3Adapter` now use OpenZeppelin `Ownable2Step` while preserving
constructor owner initialization. The clone vault appends `pendingManager` to canonical storage and
implements nomination, zero-address cancellation, replacement, and pending-manager-only acceptance.
Acceptance checkpoints fees, clears manager-specific pending strategy and rationale state, replaces
the executor set with the new manager, and emits the ownership and manager-transfer events atomically.

---

## L-05 — OTF/USDG initialization assumed USDG was exactly $1

**Severity:** Low  
**Category:** Market initialization  
**Status:** Resolved after the reviewed commit
**Originally affected code:**

- The removed market-registry initializer
- `contracts/src/PortfolioCalculator.sol:312-316`

### Description

`navPerShare()` is denominated in USD, but the old pool initializer converted the USD value directly into USDG raw units. It never divided by a current USDG/USD price.

If NAV were $100 and USDG worth $0.80, fair value would be 125 USDG, while the old code initialized at 100 USDG. No protocol liquidity was added and the pool was not used for vault NAV, so the error did not directly affect custody. A first LP or trader could nevertheless have been exposed to immediate arbitrage.

### Recommendation

The contract initializer was deleted with the market registry. The frontend does not implement pool creation, initial-price selection, or position management; it links users to Synthra on testnet and Uniswap on mainnet. Existing permissionlessly initialized pools remain untrusted market state.

## Informational and QA observations

### I-01 — `getRoundData()` ignores the requested round

**Status:** Fixed
`ChainlinkRoutePriceFeed` and `UniswapV3RoutePriceFeed` now revert every `getRoundData(uint80)` call
with `HistoricalRoundDataUnsupported(requestedRound)`. `latestRoundData()` remains unchanged and its
price, timestamp, round-completeness, and staleness validation is covered by focused regressions.

### I-02 — Challenge rewards are capturable by a manager affiliate by design

The challenge caller is unrestricted, the manager can self-flag, and a Sybil restriction cannot be enforced permissionlessly. A late challenge sends 50% of challenge-window fee shares to the caller and 50% to `FeeCollector`, regardless of the normal effective protocol fee share. Existing tests and the security specification intentionally encode this behavior.

This is an economic-policy disclosure rather than a Solidity authorization vulnerability. If governance does not intend a manager affiliate to recover half the forfeiture—or to receive value that would normally be protocol-attributable at a high protocol split—preserve the protocol entitlement first and apply the bounty only to the would-be manager portion, or fund a capped watcher bounty separately.

### I-03 — Compiler, dependency, and code-size release hygiene

**Status:** Fixed
The repository now exactly pins Solidity 0.8.36 while retaining Shanghai, the existing optimizer
settings, and `via_ir`. OpenZeppelin Contracts remains exactly pinned to 5.6.1: npm release metadata
checked on 2026-08-24 reported 5.6.1 as `latest` and 5.7.0 as `dev`, so no prerelease dependency was
adopted. The lockfile and pinned CI compiler assertion were refreshed.

The Solidity 0.8.36 security build produced these runtime sizes against the 24,576-byte EIP-170
limit:

| Production contract | Runtime bytes | Remaining margin |
| --- | ---: | ---: |
| `AssetMarketRegistry` | 5,925 | 18,651 |
| `AssetPricingResolver` | 18,702 | 5,874 |
| `AssetRegistry` | 501 | 24,075 |
| `ChainlinkRoutePriceFeed` | 2,513 | 22,063 |
| `FeeCollector` | 1,253 | 23,323 |
| `ManagedOTFVault` | 21,991 | 2,585 |
| `ManagedOTFVaultStrategy` | 24,501 | 75 |
| `ManagedOTFVaultView` | 16,353 | 8,223 |
| `OTFFactory` | 10,984 | 13,592 |
| `OTFEntryRouter` | 9,813 | 14,763 |
| `OTFToken` | 2,898 | 21,678 |
| `PortfolioCalculator` | 7,900 | 16,676 |
| `RegisteredUniswapV3Adapter` | 2,813 | 21,763 |
| `RebalanceExecutor` | 3,092 | 21,484 |
| `UniswapV3RoutePriceFeed` | 5,197 | 19,379 |

All 15 production runtime and initialization bytecodes passed the existing EIP-170 and EIP-3860
gates without raising or bypassing a limit. `ManagedOTFVaultStrategy` has only 75 bytes of runtime
margin and remains a significant release constraint.

### I-04 — Uniswap-derived source has inconsistent licensing metadata

**Status:** Fixed  
`contracts/src/libraries/UniswapV3TwapMath.sol` now uses the `GPL-2.0-or-later` SPDX identifier and attributes the current Uniswap V3 [TickMath](https://github.com/Uniswap/v3-core/blob/main/contracts/libraries/TickMath.sol) and [OracleLibrary](https://github.com/Uniswap/v3-periphery/blob/main/contracts/libraries/OracleLibrary.sol) provenance. Executable math was not changed. This remains a provenance record rather than a security finding; distribution obligations should continue to receive appropriate legal review.

### I-05 — Normative V3 quote-token requirement and implementation diverge

**Status:** Fixed  
`docs/PROTOCOL_SECURITY_SPEC.md` now permits any enabled owner-registered quote token whose `allowV3Twap` permission is true, matching `AssetMarketRegistry` and the existing tests. The specification also records the broader governance dependency and corresponding deployment evidence requirements.

### I-06 — Test assurance has important blind spots

**Status:** Partially fixed  
The following assurance gaps were remediated after the review:

- Eligible invariant actions now have asserted success/rejection counters, so unexpected caught reverts fail an invariant. A deterministic transition test proves the critical counters and paths are non-vacuous.
- Proposal, activation, progressive trade, and completion are separate handler actions. Pending and active states can now be interleaved with minting, redemption, fee accrual, challenges, stale-oracle rejection, and paused-oracle rejection.
- Independent fee-growth tests use a 36-decimal rational square-root model rather than production `FeeGrowthMath.powWad`.
- Full-domain bounded fuzzing compares tick and quote outputs with a test-only canonical Uniswap V3 reference and checks boundary vectors and monotonicity.
- Adversarial-token tests cover sender overdebit, touched-balance rebase mutation, false returns, no returns, malformed returns, pull paths, push paths, and atomic rollback.
- A pinned, read-only Ubuntu CI workflow runs formatting, the security gate, the full suite, 10,000-case fuzzing, 512-by-128 invariants, and a fail-closed coverage wrapper.

The remaining gaps are:

- The named Uniswap integration suite is still mock-based. Add tests using canonical factory/pool/router bytecode and target-chain forks with representative live tokens and feeds.
- Thin-liquidity manipulation and malicious callback/token behavior are not yet part of the stateful invariant world; the latter is covered by focused unit tests only.
- Numeric coverage still requires the first successful Linux CI run. Ordinary non-IR coverage hits stack-too-deep, and the pinned Foundry/Solar version does not resolve this project's imports reliably on Windows. No numeric coverage claim is made here.

## Verification results

| Check | Result |
| --- | --- |
| Forge version | 1.7.1 |
| Compiler | Solidity 0.8.36, exact pin, optimizer, `via_ir`, Shanghai |
| Full suite | 287 / 287 passed; 0 failed; 0 skipped |
| Strong fuzz | 12 tests × 10,000 runs passed |
| Strong invariants | 9 invariants × 512 runs × depth 128; 589,824 handler actions passed |
| Solhint | Passed with zero warnings |
| `forge lint src --deny warnings` | Passed |
| Full formatting | Passed |
| Storage layouts | 72 canonical entries match across vault, strategy, and view modules |
| ABI / ERC-7621 security assertions | Passed |
| Bytecode gates | All 15 production contracts passed EIP-170 and EIP-3860 limits; smallest runtime margin is 75 bytes |
| Coverage | Pinned fail-closed Linux command added; first CI result pending, so no numeric claim is made |
| Advanced analyzers | Slither, Aderyn, Mythril, Echidna, Medusa, Certora, Halmos, and Semgrep were unavailable |

## Strong practices observed

- Checks-effects-interactions ordering on custody paths, with pull-before-mint and burn-before-push.
- Reentrancy protection across vault, factory creation, executor, registry, router, and adapter token-moving flows.
- Exact sender and receiver balance-delta enforcement rejects fee-on-transfer, sender-taxed, and unexpected rebasing behavior at runtime.
- Contribution requirements round up; redemptions round down; user maximums and minimums are enforced.
- Locked minimum liquidity prevents supply from returning to zero.
- Temporary approvals are zeroed before and after use; adapters have fixed recipients and reconciled outputs.
- No generic manager `execute`; trades use typed instructions, approved adapters, tracked endpoints, and fixed vault settlement.
- Strategy and view delegatecall targets are immutable and code-hash checked; direct module mutation is blocked.
- Canonical storage-layout and ABI gates substantially reduce delegatecall regression risk.
- Chainlink reads fail closed on missing code, nonpositive answers, invalid/future timestamps, incomplete rounds, excessive staleness, and unsupported decimals.
- Robinhood direct pricing checks `oraclePaused()` and does not reapply `uiMultiplier()`.
- Rebalance batches enforce per-leg oracle value, batch NAV loss, per-asset target improvement, and a rolling cumulative loss budget.
- Fee calculations retain fractional remainders and close rate-change intervals without retroactive application.
- Factory, market registry, and fee collector use two-step ownership/treasury transfers.
- Deployment artifacts omit compiler metadata hashes, and compiler/settings are pinned for reproducibility.

## Documented residual risks and production blockers

These are already substantially disclosed by the repository, but they remain part of the production security decision:

- No runtime Chainlink Flags validation and no L2 sequencer-uptime/grace-period check. The repository itself identifies this as a blocker or an explicit fresh-review exception.
- Managers are trusted for semantic asset/feed/pool pair selection; contracts prove mechanics, not economic meaning or pair orientation.
- Quote-registry governance can replace a quote/USD feed used by existing composed and V3 routes. This requires delayed multisig governance and monitoring.
- Factory and adapter governance can change fee shares, rebates, allowlists, and deposit pauses. Production EOAs are not acceptable.
- A frozen or blacklisting constituent can make atomic basket redemption fail even though redemption does not require an oracle.
- Unsupported-token donations are intentionally unrecoverable; retiring dust can be written off; supported constituents must preserve exact 18-decimal transfer accounting.
- The fixed challenge reward, protocol-fee rebate, and manager behavior need independent economic modeling.
- Code-hash pinning does not detect implementation changes behind a proxy module. Deployment must prove modules are direct, non-upgradeable contracts with matching calculators.
- No production address, feed identity, pool liquidity, governance signer, timelock, or deployed bytecode was verified by this source review.

## Remediation priority

1. Fix M-01 and add a real Uniswap manipulation regression before permitting any V3 pricing source.
2. Re-review the resolved factory/market decoupling before deployment.
3. Treat M-03 as retained for direct onchain callers; the 20-asset frontend cap is a mitigation, not a protocol-level resolution.
4. Resolve or formally accept the remaining L-02 timeout/terminal-state risk. The wider unchallenged completion rule reduces, but does not eliminate, the incomplete-strategy region.
5. Treat L-03 trade expiry/version binding as an accepted stale-intent risk unless the owner disposition changes.
6. Run the pinned Linux Solidity CI and retain its coverage evidence; add canonical/fork integration tests and stateful thin-liquidity/callback models.
7. Resolve or formally accept the Flags/sequencer, governance, token-freeze, and economic-model risks.
8. Commission a focused independent re-review of every remediation before mainnet deployment, with particular attention to the 75-byte strategy runtime margin.

## Final assessment

The contracts demonstrate thoughtful custody controls, constrained execution, fail-closed oracle validation, careful fee math, two-step administrative transfers, and unusually strong local testing. The compiler and release gates are current, but the code is not yet using the best available practices in V3 oracle economic security, target-chain gas-bound design, or strategy terminal-state handling. The strategy module's 75-byte EIP-170 margin also leaves very little room for future changes.

The current code should not be represented as production-safe. After the Medium findings and deployment blockers are resolved, the project should undergo a focused remediation review plus live dependency and deployment verification.
