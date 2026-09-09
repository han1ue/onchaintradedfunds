# Solidity properties and campaign replay

These tests follow `docs/content/protocol-security-spec.mdx`.

| Property | Test or harness |
| --- | --- |
| Handler assertions and unexpected reverts fail; rejected calls match full error data | `InvariantSensitivity.t.sol`, `ActionAccounting._rejected`, both profiles use `fail_on_revert = true` |
| Three active holders plus collector; independent backing, deposits, withdrawals, donations, forfeitures and losses | `ProtocolInvariant.t.sol`: `invariantIndependentLedger` |
| OTF fee benefit, mixed 6/8/18 decimals, unequal quantities, 2/3/20 constituents, zero/one/max fees | Minimum, Protocol, Maximum and Active vault fixtures |
| Pending fees before economic actions, independent annual-growth bound, exact creator remainder, transfers and owner exemptions | `VaultInvariantHandler._pending`, `mint`, `redeem`, `checkPreview` |
| Deficits, creator or deficit-authorized shutdown, permanent shutdown and final recoverable unwind | Vault handler actions and `afterInvariant`; `testFuzzMinimumSupplyTransitionAndUnwind` |
| Actual factory, vaults, router and collector; two beneficiaries and changing accounted OTF benefits; token/native entry and exit; basket conversion | `ComposedProtocolInvariant.t.sol`: `invariantFeeIsolationAndOperationBalances`, `testReachableLifecycle` |
| Stored fee accounts, both settlement methods, repeated settlement, shutdown settlement, payout/burn deltas, unsolicited shares, preserved balances and cleared allowances | `ComposedProtocolHandler.settle`, `rejectRepeatedSettlement`, `rejectSettlement`, `assertModel` |
| Max-mint affordability/maximality, execution agreement, clone runtime/configuration and rejected creation rollback | `ArithmeticAndFactoryProperties.t.sol` |
| Independent fee growth and identical economic schedules with different checkpoint cadence | `testFuzzFeeGrowthIndependentReference`, `testFeeGrowthTimeAndRateEdges`, `testFuzzCheckpointCadenceIdenticalEconomicSchedule` |
| V3/V4 batches, shared intermediates, independent pairs, repeated tokens, native boundaries, invalid amounts and atomic rollback | `UniswapUniversalRouterAdapter.t.sol`; real pools in `test/fork/MainnetMarkets.t.sol` and `MainnetRouting.t.sol` |
| Real V4, both currency orders, several payers/recipients, native-output sells and router balance baselines | `OTFLaunchV4Invariant.t.sol` |
| Reachable bootstrap, ready and graduated phases; locked permanent position; external LP authorization | Launch phase fixtures, setup reachability assertions and `testBootstrapActionsAreReachable` |
| Generated 4/8/16-leaf trees, skipped publications, cumulative claims, recipients, chain/distributor domains and funding rollback | `MerkleRewardsDistributor.t.sol` generated properties |
| Spot-price vesting, current supply, oracle decimals 0–18, freshness boundaries, cumulative unlocks, claims and successor authority | `TeamVestingSequencePropertiesTest` |

The vault ledger calculates asset and transaction-fee arithmetic independently. It compares annual shares against a 36-decimal Taylor reference before accepting the preview's integer fee count into the exact share ledger. Its tolerance is `epochSupply * 128 / 1e18 + 2` share wei: the growth tolerance plus at most one carried fractional share and integer rounding. The separate growth test allows 128 WAD wei over rates 0–1,000 bps and elapsed times up to ten years, then 1e-15 relative tolerance plus 128 wei through 100 years. Both the series tail and reference rounding are below one WAD wei on that domain. Checkpoint cadence tests require exact equality, including fee splits, while keeping mint and redemption timestamps identical.

Shutdown-capable campaigns can spend much of a sequence after shutdown. The Active vault fixture excludes deliberate shutdown and loss actions to preserve useful active-accounting coverage. The launch fixtures establish their starting phase explicitly; a short random sequence need not graduate. The initial exact reference price can sit outside the tick-derived liquidity edge. The launch boundary invariant distinguishes that initial state from prices reached through swaps.

Run from the repository root:

```text
node scripts/check-invariant-sensitivity.mjs
node scripts/run-solidity-campaign.mjs
node scripts/check-contract-security.mjs
node scripts/check-contract-coverage.mjs
```

`run-solidity-campaign.mjs` generates a seed unless `CAMPAIGN_SEED` is set. Set `CAMPAIGN_PROFILE` to `default` or `integration` to replay one profile; `CAMPAIGN_MATCH_PATH` can restrict default tests. `CAMPAIGN_RUNS`, `CAMPAIGN_DEPTH` and `CAMPAIGN_FUZZ_RUNS` override campaign size. Default settings are 128 invariant runs at depth 64, with 1,000 default fuzz cases and 64 integration fuzz cases. The integration campaign selects `OTFLaunchV4*.t.sol` and uses real V4 contracts. Default campaigns exclude the separate audit reproduction directory; fork rehearsals remain in their existing mainnet gate.

Each campaign writes a manifest and full Forge log under `test-results/campaign/`. The manifest records the seed before execution, Forge version, Git revision, a source/dependency fingerprint, exact arguments/environment, runtime, exit status, observed fuzz/invariant runs and selector counts. Forge's selector table aggregates attempted calls and reverts. Solidity counters report successful calls, expected failures and no-ops for the final sequence, including fixture calls and final unwind; they are not campaign-wide totals. Replay requires the same source tree and dependencies. The scheduled/manual workflow uploads logs and Forge's failure cache even if a campaign fails.

The PR workflow retains its fixed seed and removes redundant large fixed-seed sweeps. The changing-seed workflow runs twice weekly or on demand. Campaign sizes should be adjusted using measured execution cost and action reachability.

Coverage is advisory. `check-contract-coverage.mjs` writes LCOV for locating unvisited production lines and a summary using `--ir-minimum`; those source mappings are approximate. Test failures now fail the coverage command. Inspect missed functions and branches against the property map rather than treating a percentage as a correctness claim. Its fixed-seed defaults are 64 fuzz cases and 8 invariant runs at depth 32. `COVERAGE_SEED`, `FOUNDRY_FUZZ_RUNS`, `FOUNDRY_INVARIANT_RUNS` and `FOUNDRY_INVARIANT_DEPTH` override these settings. Default coverage omits real V4 tests, matching the default Foundry profile. Use `COVERAGE_PROFILE=integration` with `COVERAGE_MATCH_PATH=contracts/test/OTFLaunchV4*.t.sol` for a separate real V4 pass; `COVERAGE_REPORT_FILE` preserves a separate report.

Remaining limits: The adapter suite uses the pinned Universal Router with deterministic V3 pools and real V4 pools. Mainnet fork tests retain deployed venue code and real stock liquidity. Finite adapter amounts are bounded to uint128; the uint256 maximum is reserved for the current operation's entire token balance. The stateful vault clock stops at ten years. Arithmetic reference checks extend to 100 years; zero-rate checks span uint64 timestamps, and positive rates reject an unrepresentable uint64-max horizon. Representable nonzero-rate horizons beyond 100 years remain outside the reference campaign.

Rewards tests cover onchain cumulative claims; the publisher's emissions schedule, eligibility and allocation policy remain offchain. Vesting properties follow spot-price semantics. The composed fee ledger uses the vault's annual-fee preview, which the separate vault and arithmetic suites check against the independent reference.
