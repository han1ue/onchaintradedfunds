# Solidity security review, 4 September 2026

Review baseline: `df910e3411e41fc1bb6a4259e33a8d3349c32ec7`, with a clean working tree at the start.

One High-severity availability defect should block mainnet deployment. A Low-severity preview
inconsistency also needs correction. The findings below come from static inspection of the current
contracts and pinned dependencies; neither finding was reproduced through an attack transaction.

## H-01: Permanent-liquidity capacity is not protected before graduation

Severity: High, affecting launch completion and canonical-pool availability. Confidence: high
from source review, independently checked by two reviewers. No theft of vault backing was established.

`OTFLaunchManager.finalizeGraduation()` must mint a fixed permanent position at its fixed full-range
endpoints (`src/OTFLaunchManager.sol:294-303`). Uniswap V4 limits the aggregate gross liquidity at each
tick, across all positions. Its pinned implementation rejects a liquidity addition that exceeds
either endpoint's limit (`../node_modules/@uniswap/v4-core/src/libraries/Pool.sol:159-171`).

The launch hook enables only initialization and swap callbacks (`src/OTFLaunchManager.sol:51-55`).
It leaves external liquidity additions unrestricted before graduation. Consequently, the capacity
required by the permanent position can be unavailable when finalization runs. Removing the bootstrap
position does not release capacity at the permanent position's different endpoints.

The resulting permanent mint reverts. The dedicated launch router rolls back its boundary purchase
if finalization fails. If the pool reached `GraduationReady` independently, it remains in that state
and the hook rejects subsequent swaps (`src/OTFLaunchManager.sol:250-251`). Recovery depends on
external position owners releasing the conflicting capacity. The manager cannot remove their
positions or select another permanent range. Canonical-pool buybacks also depend on trading being
available.

Protect the required capacity throughout initialization, bootstrap, and finalization. A concrete
design is a `beforeAddLiquidity` gate that permits only authenticated manager-initiated position
additions until graduation. Authenticate the PoolManager, pool, active internal mint operation,
and expected position parameters. Allowing the shared PositionManager address alone is insufficient:
other users also submit positions through it. Normal external additions can resume after the
permanent position exists. Uniswap documents this callback and the address-encoded permission
requirement in its [hook documentation](https://developers.uniswap.org/docs/protocols/v4/concepts/hooks).

This patch changes the hook permission mask. Update CREATE2 address derivation, deployment checks,
the security specification, generated artifacts, and affected tests together. Keep permanent
liquidity locked.

Required defensive validation: finalization must remain available despite unrelated liquidity
positions; a third-party mint through the shared PositionManager must not satisfy internal mint
authorization. Cover both currency orderings and both graduation entry paths. The existing external
liquidity test (`test/OTFLaunchV4Integration.t.sol:579`) uses a small position and removes it before
finalization, so it does not establish this property.

## L-01: Redemption preview checks supply after subtracting the fee

Severity: Low, affecting quote correctness. Confidence: high from source comparison.

`previewRedeem()` passes fee-net shares to `_previewRedeemWithSupply()`
(`src/ManagedOTFVault.sol:332-335`). That helper checks the supplied amount against effective supply
(`src/ManagedOTFVault.sol:566-568`). Execution instead rejects the original requested shares when
they exceed supply (`src/ManagedOTFVault.sol:452-454`). With a nonzero redeem fee, the preview can
therefore quote a request that execution must reject. This does not bypass execution's balance or
supply checks.

Validate the original requested shares against effective supply before deducting the fee in
`previewRedeem()`. Check preview/execution agreement at the supply boundary with zero and nonzero
fees, including pending expense fees and shutdown.

## Production dependency validation remains incomplete

The V4 adapter and collector encode a five-field exact-input tuple, including `maxHopSlippage`
(`src/interfaces/IUniswapV4.sol:13-20`). The installed `@uniswap/v4-periphery` 1.0.3 interface has
four fields. Current [upstream Uniswap source](https://github.com/Uniswap/v4-periphery/blob/main/src/interfaces/IV4Router.sol)
has five, so the local version difference alone does not prove that the intended production router
is incompatible.

The V4 adapter tests decode the project's own tuple in a mock. The real V4 launch tests exercise
PoolManager and PositionManager, but do not validate the adapter or collector against Universal
Router. The V3 protocol integration suite also uses a mocked swap router.

Before deployment, bind the exact production router bytecode and ABI, then verify successful basket
entry, exit, and collector settlement against those runtimes. The mainnet protocol configuration
still says `configuration-required`. This is a release validation gap, not a confirmed contract
vulnerability.

## Existing risks and previous findings

Team vesting still uses instantaneous pool price for irreversible milestone unlocks
(`src/TeamMarketCapVesting.sol:120-169`). Only the beneficiary can now checkpoint. This resolves the
old permissionless checkpoint path but does not establish a manipulation-resistant milestone.
Current security documentation explicitly accepts this beneficiary trust. If the intended product
promise is an independently enforced market-cap lock, replace the spot observation with a reviewed
price-observation and milestone-confirmation design before launch.

The reward publisher can allocate the distributor's remaining balance through a valid root; the
schedule and allocation buckets are offchain policy. Expense beneficiaries control settlement
execution quality, and the adapter manager controls trusted adapters. These are documented powers,
not newly discovered access-control bypasses.

One accounting clarification remains: skipping an asset removes its ledger entitlement while
leaving its physical balance (`src/ManagedOTFVault.sol:464-470`). Under deficient backing, later
holders may receive some of that forfeited backing. The comment promising unaccounted excess is
too broad for this case. Clarify deficit semantics or introduce explicit forfeiture accounting if
such backing must remain excluded. No unauthorized withdrawal was established.

`AI_AUDIT_REPORT.md` describes an older commit. Its permissionless checkpoint description and CI
integration-gap finding no longer match the current source. CI now has explicit real V4 integration
and launch invariant jobs. Its conditional Shanghai/Cancun concern is not treated as a current
finding without evidence of the selected production chain's opcode support.

## Scope and verification

The review covered the 12 production contracts, vault storage and shared types, local libraries
and interfaces, and the testnet oracle boundary. Reviewers inspected relevant tests, specifications,
deployment configuration, security tooling, and pinned OpenZeppelin/Uniswap code where needed.
The focus was accounting, authorization, external-call boundaries, launch transitions, and pricing.

Production contracts were not changed. No public deployment was exercised and no exploit proof was
created or run. Exact production dependency runtimes and live-chain behavior remain unverified.

| Check | Result |
| --- | --- |
| `node scripts/check-contract-security.mjs` | Passed: production compilation, Solhint, Foundry build/lint, and the repository's security assertions |
| Production compiler | 28 Solidity source files compiled with solc 0.8.26, Cancun, optimizer run 1, and IR |
| Default `forge test --offline --no-match-path 'test/audit/*' --summary` | 136 passed, 0 failed across 17 suites |
| Vault invariants within that run | Four passed; each ran 128 campaigns and 8,192 handler calls, with no reverts |
| Fuzz tests within that run | Two passed with 1,000 cases each |
| Slopless on this report | No findings |
| Contract-source diff and whitespace checks | No production contract changes; checks passed |

Foundry 1.7.1 ran from the installed local toolchain. It printed warnings while probing optional
invariant-discovery functions; the four vault invariants subsequently executed their handler calls
and passed. The default profile excludes the separate real V4 launch integration and invariant
files. Those files were inspected but not executed in this review. The audit proof-of-concept
directory was excluded from test execution. Passing the existing suite does not validate a fix for
H-01 or L-01; both remain unpatched.
