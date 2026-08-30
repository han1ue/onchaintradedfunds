# OTF Protocol Smart Contract Security Review

**Review date:** 30 August 2026  
**Repository revision:** `07e41f2f593901c54a45c830c4cc539f82098b4a` with uncommitted changes  
**Production-source snapshot SHA-256:** `a0e59c34586281fafa753f3e1b65182abe097b7c948719526c77ce43aa84a08d`  
**Compiler target:** Solidity 0.8.36, Shanghai EVM, optimizer enabled, `viaIR`  
**Assessment type:** Manual adversarial review, automated checks, unit/fuzz/invariant testing

## Executive summary

The review covered the complete OTF smart-contract implementation under `contracts/src`, together
with the Foundry configuration, tests, and mocks under `contracts`. The exact working tree was
reviewed rather than the clean Git revision because the contract architecture has material
uncommitted changes.

No critical or high-severity asset-theft, unauthorized-mint, privilege-escalation, reentrancy, or
router-dust extraction path was identified. The accounting and router boundaries are notably
defensive: tracked-token donations do not inflate entitlement, settlement uses exact balance
deltas, V3 paths are fully parsed and authenticated, temporary approvals are cleared, and
cross-token callbacks are checked after the complete operation.

The protocol is nevertheless **not recommended for mainnet deployment in its current form**. Three
medium-severity liveness issues can strand otherwise recoverable backing:

1. The residual-supply floor is permissionlessly griefable with unreachable dust shares.
2. A solvent vault has no holder-accessible in-kind exit when external liquidity disappears.
3. One failing constituent can prevent recovery of every healthy constituent, even after shutdown.

The second and third issues are documented trust assumptions, but they remain unresolved risks,
not mitigations. One informational event-integrity defect was also found in `FeeCollector`.

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 3 |
| Low | 0 |
| Informational | 1 |

## Scope

### Production contracts

| Component | Files reviewed |
| --- | --- |
| Vault | `ManagedOTFVault.sol`, `ManagedOTFVaultStorage.sol`, `VaultTypes.sol` |
| Factory and routing | `OTFFactory.sol`, `OTFEntryExitRouter.sol` |
| Protocol custody/token | `FeeCollector.sol`, `OTFToken.sol` |
| Libraries | `FeeGrowthMath.sol`, `ProtocolConstants.sol`, `SafeTransferLib.sol`, `UniswapV3Path.sol` |
| Interfaces | `IERC20.sol`, `IOTFSettlement.sol`, `IUniswapV3Factory.sol`, `IUniswapV3SwapRouter.sol` |

All 18 Solidity test and mock files and `foundry.toml` were reviewed as assurance material. Test
contracts and mocks are not treated as deployable production code.

The source snapshot hash above is calculated over sorted `contracts/src/**/*.sol` relative paths
and file contents. It identifies the reviewed dirty-tree source independently of the Git revision.

### Out of scope and assumptions

- Frontends, quote services, deployment scripts, governance operations, and offchain bootstrap data.
- The correctness of deployed OpenZeppelin, Uniswap V3 factory/router/pool, and constituent-token
  implementations beyond the interfaces exercised by OTF.
- A specific chain deployment, bytecode/address verification, live liquidity, MEV conditions, and
  production key management.
- Economic suitability or market value of creator-selected basket units.
- Formal verification and an independent second audit.

## Architecture and trust model

- `OTFFactory` permanently binds one entry/exit router and permissionlessly deploys EIP-1167 vault
  clones.
- A vault fixes its creator, beneficiary, constituents, bootstrap units, fee ratio, router, and fee
  collector at initialization.
- Vault entitlement uses `accountedBalance`, not raw token balances; unsolicited donations are
  deliberately excluded.
- Normal settlement is exclusive to the canonical router. The router acquires or liquidates baskets
  through typed, authenticated Uniswap V3 paths.
- The creator may irreversibly shut down a solvent vault. Anyone may trigger shutdown only after a
  readable constituent balance proves a deficit.
- Emergency redemption distributes `min(actual, accounted)` pro rata, but processes the basket
  atomically.
- Expense fees are inflationary vault shares split between a fixed beneficiary and `FeeCollector`.
  The collector treasury is mutable through a two-step handoff.

Users consequently trust the one-time router configurator, each vault creator, the fee-collector
treasury, every constituent implementation/admin, the configured V3 venue, and their own slippage
limits. The contracts do not authenticate prices, weights, NAV, or the advertised initial dollar
value.

## Severity methodology

- **Critical:** Practical systemic theft, permanent protocol takeover, or irrecoverable loss of most
  protocol assets.
- **High:** Practical material loss or permanent freezing requiring limited preconditions.
- **Medium:** Conditional material loss/freeze, permissionless griefing, or a significant trust and
  availability failure.
- **Low:** Limited impact, difficult preconditions, or defense-in-depth weakness.
- **Informational:** Correctness, observability, or assurance improvement without a material asset
  impact.

## Findings

### OTF-01 — Dust-share fragmentation can block nearly all normal redemption

**Severity:** Medium  
**Status:** Open  
**Affected code:** `src/ManagedOTFVault.sol:249-280`, `309-310`, `397-407`, `416-425`, `325-343`

The first mint must be at least `1e18` shares, but later mints may be any nonzero size and inherited
ERC-20 transfers may fragment shares arbitrarily. Redemption then rejects every burn that would
leave a positive supply below `1e18`:

```solidity
uint256 residualSupply = supply - shares;
if (residualSupply != 0 && residualSupply < MINIMUM_SHARE_SUPPLY) {
    revert ResidualSupplyTooSmall(residualSupply, MINIMUM_SHARE_SUPPLY);
}
```

This invariant makes a tiny unreachable share position disproportionately powerful.

#### Exploit sequence

1. A victim owns a bootstrapped `1e18`-share vault.
2. An attacker acquires a dust share position or mints one at the current pro-rata basket cost,
   subject to ceiling-rounding to raw token units.
3. The attacker transfers those shares to the vault itself or another address that cannot spend
   them.
4. The victim's full-balance redemption leaves only attacker dust and reverts.
5. The victim can redeem at most the amount above the `1e18` floor. Once supply reaches exactly
   `1e18`, every remaining partial redemption reverts and no holder can burn the full supply.

The attacker can therefore lock approximately one full OTF unit of backing while sacrificing only
the dust position. Minting that position may cost at least one raw unit of each constituent, so the
attack economics vary with token granularity; the value locked is not bounded onchain. Expense-fee
issuance can create the same fragmentation without an attacker: after a minimum-size bootstrap,
fee shares belong to the
beneficiary and collector, so the original holder cannot exit fully unless those parties redeem or
transfer first.

An honest creator can activate irreversible shutdown and permit emergency exits, but a lost or
hostile creator leaves a sound vault indefinitely locked. Even an honest creator can be cheaply
forced to degrade the vault to emergency-only operation.

#### Recommendation

Remove the positive residual-supply restriction and re-evaluate the rounding invariant with
property tests. If the floor is indispensable, permit any holder to transition the vault to an
in-kind emergency mode when a redemption is blocked solely by the floor. Restricting small mints is
not sufficient because transfers, lost keys, and fee-share issuance can still fragment supply.

Add a regression test that mints dust, transfers it to the vault, and proves all other holders can
still recover their pro-rata backing without creator cooperation.

### OTF-02 — Solvent vaults can become permanently illiquid without a normal in-kind exit

**Severity:** Medium  
**Status:** Open; documented limitation  
**Affected code:** `src/ManagedOTFVault.sol:249-253`, `284-320`, `325-343`;
`src/OTFEntryExitRouter.sol:245-275`, `633-640`

Holders cannot invoke normal basket redemption directly because `routerRedeem` is router-only. The
router's public sell path requires every non-output constituent to be completely liquidated before
the transaction can close. If liquidity for one standard constituent is removed, exhausted, or no
longer reachable through an allowed path, the complete redemption reverts despite the vault being
fully backed.

Emergency redemption would return the basket in kind, but a non-creator cannot shut down a sound
vault. A lost or hostile creator plus one unavailable external route therefore strands all holders
indefinitely. This does not require a malicious or nonstandard ERC-20.

The existing test `testRedeemToTokenRejectsIncompleteLiquidation` correctly demonstrates that the
router fails closed; the missing control is an independent custody exit.

#### Recommendation

Expose a holder-accessible, pro-rata in-kind redemption path using the vault's existing backing and
exact-delta protections. DEX routing should be an optional convenience after custody is released,
not a prerequisite for releasing custody. A weaker alternative is a time-delayed permissionless
shutdown, although it introduces additional griefing and timing design work.

### OTF-03 — One failing constituent atomically locks every healthy constituent

**Severity:** Medium  
**Status:** Open; documented token-trust limitation  
**Affected code:** `src/ManagedOTFVault.sol:60-70`, `299-318`, `354-386`, `506-513`, `532-537`,
`584-594`

Vault creation verifies only that each constituent is a unique, nonzero contract with nonzero
bootstrap units. A constituent may later pause, blacklist the vault or router, upgrade, rebase, or
start reverting from `balanceOf` or `transfer`.

Every normal and emergency redemption reads and transfers the complete constituent array in one
atomic transaction. If one asset fails, the transaction rolls back transfers of all healthy assets.
Shutdown does not solve this condition: `emergencyRedeem` performs the same unguarded basket-wide
balance reads and transfers.

The existing `testUnreadableOnlyFailureNeedsCreatorAndCanBlockExit` reproduces the strongest form:
the creator successfully shuts down the vault, yet an unreadable asset still prevents the holder
from claiming any constituent.

#### Recommendation

Before production, define and enforce a reviewed constituent policy covering proxy upgrades,
pausing, blacklists, rebasing, transfer fees, hooks, and balance semantics. UI labels alone must not
be treated as enforcement.

For resilient recovery, redesign shutdown claims so a holder can settle or record entitlement once
and claim each constituent independently. A failure in one asset must not roll back claims on
healthy assets. If arbitrary mutable constituents remain intentional, retain this issue as an
explicit production blocker and communicate that healthy backing can be permanently trapped.

### OTF-04 — A callback-driven treasury handoff can misattribute `TokenClaimed`

**Severity:** Informational  
**Status:** Open  
**Affected code:** `src/FeeCollector.sol:44-55`, `58-81`

`_claimExact` caches the current treasury as the transfer receiver. During the external token
transfer, a callback can cause the already nominated pending treasury to call the unguarded
`acceptTreasuryTransfer`. Exact-delta checks still validate the cached old treasury and funds are
not lost, but the outer function emits `TokenClaimed(token, treasury, amount)` using the new live
treasury. The event can therefore name an address that did not receive the claimed tokens.

This requires a previously authorized pending treasury and does not permit unauthorized claims. It
can nevertheless break indexer, accounting, and incident-response reconciliation.

#### Recommendation

Cache the receiver in `claim`/`claimAll`, pass it to `_claimExact`, and emit that same address.
Alternatively, place treasury transitions under the same reentrancy lock and require the treasury
to remain unchanged for the duration of a claim.

## Validated security properties

The following high-risk paths were traced and exercised without finding a practical bypass:

- **Clone initialization:** The implementation disables initializers; factory clone creation and
  initialization are atomic. Unregistered third-party clones are rejected by the canonical router.
- **Share accounting:** Bootstrap mints round input up, redemptions round output down, full
  redemption empties accounted backing, and direct donations do not change entitlement.
- **Fee accounting:** Fees checkpoint before normal settlement; cumulative epoch math and split
  remainders avoid checkpoint-cadence extraction in the tested range.
- **Deficits:** Normal settlement fails closed when actual backing is below accounted backing;
  emergency payout is capped by `min(actual, accounted)`.
- **Reentrancy and callbacks:** Vault, router, and collector state-changing asset flows are guarded.
  Final whole-basket, router, receiver, and caller checks catch later cross-token mutation.
- **Router custody:** A leg can spend only transient balance above the snapshot. Pre-existing router
  dust cannot fund a route or be refunded to the caller.
- **V3 authentication:** Path shape and hop limits are checked, every token is tracked, and every
  pool is authenticated against the immutable factory, sorted pair, and fee.
- **Slippage:** Per-leg and aggregate minimums, caller maxima, route availability, and deadlines are
  enforced atomically.
- **Approvals:** Router approvals are set exactly, verified, and cleared after each use.
- **Unsupported token behavior:** Fee-on-transfer, rebasing, lying approvals, and callback mutation
  fail closed in tested cases. OTF-03 describes the resulting liveness consequence.
- **Protocol token:** `OTFToken` has fixed constructor issuance and exposes no privileged mint path.
- **Storage:** OpenZeppelin's namespaced ERC-20 storage does not collide with linear vault storage;
  EIP-1167 clones have no upgrade path.

## Verification results

### Automated checks

| Check | Result |
| --- | --- |
| Foundry unit/fuzz/invariant suite | 71 passed, 0 failed, 0 skipped |
| Fuzzing | 2 tests × 1,000 runs |
| Invariants | 4 properties × 128 runs × 64 calls; all passed |
| Solhint | Passed with zero allowed warnings |
| Forge source lint | Passed with warnings denied |
| Repository ABI/storage/security boundary checks | Passed |
| Advisory coverage | 86.24% lines, 84.51% statements, 36.47% branches |

The maximum synthetic route test completed at approximately 12.7 million gas under the production
build. This is evidence for the configured test environment, not a guarantee for a particular
chain, token set, or live Uniswap route.

### Production bytecode sizes

| Contract | Init bytes | Runtime bytes | Limit status |
| --- | ---: | ---: | --- |
| `ManagedOTFVault` | 16,424 | 16,217 | Within limits |
| `OTFFactory` | 3,390 | 3,071 | Within limits |
| `OTFEntryExitRouter` | 16,946 | 16,410 | Within limits |
| `FeeCollector` | 1,964 | 1,772 | Within limits |
| `OTFToken` | 3,864 | 2,819 | Within limits |

All production runtimes are below the 24,576-byte EIP-170 limit and initcode is below the
49,152-byte EIP-3860 limit. Coverage instrumentation produces non-production size warnings and is
not used for this conclusion.

## Assurance gaps and recommended tests

- Run funded direct-buy, direct-sell, basket-cross, and multihop fork tests against the exact
  production factory, SwapRouter02, pools, and chain configuration.
- Add a stateful router invariant suite covering transient balances, approval cleanup, callbacks,
  and rollback. The current invariants cover ordinary vault accounting only.
- Add shutdown/deficit/donation/mutable-token actions to invariant testing and separately classify
  expected reverts instead of relying on `fail_on_revert = false`.
- Differentially test `FeeGrowthMath` against a high-precision reference across 0, 1, 999, and 1,000
  bps, second/year boundaries, repeated supply-changing epoch resets, and near-boundary supplies.
- Add direct `SafeTransferLib` tests for no return data, `false`, malformed lengths, invalid Boolean
  values, oversized return data, reverts, and non-contract targets.
- Add direct `OTFToken` constructor, fixed-supply, metadata, transfer, and allowance tests; advisory
  coverage currently reports 0% for this simple contract.
- Ensure the deployment pipeline runs `forge test` explicitly. Artifact/security checks and
  advisory coverage are not substitutes for a failing test gate.

The fee exponentiation routine has a finite mathematical domain and would begin reverting after
roughly 1,284 years of uninterrupted 10% annual accrual. This is not a practical present-day
vulnerability, but a future implementation should avoid coupling emergency activation to fee math
that can revert.

## Final assessment

The reviewed implementation has strong anti-theft accounting and router isolation, and the test
suite meaningfully exercises adversarial token behavior. Its dominant residual risk is liveness:
share-floor fragmentation, mandatory DEX liquidation, and atomic basket recovery can each separate
holders from otherwise valid backing.

Resolve OTF-01 before deployment. OTF-02 and OTF-03 require an explicit protocol-level decision;
documentation alone does not make their permanent-lock outcomes acceptable. After remediation,
repeat this review against the final source, exact deployment configuration, and funded production
venue forks.

This review reduces risk but is not a guarantee that the code is free of vulnerabilities.
