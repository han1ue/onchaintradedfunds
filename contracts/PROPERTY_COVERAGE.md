# Solidity properties and campaign replay

These tests follow `docs/content/protocol-security-spec.mdx`. Production contracts are unchanged.

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
| Generated one/two/three-hop V3/V4 paths, intermediate-asset permutations, exact/all-balance leg modes, input boundaries and second-leg rollback | `TypedUniswapV3Venue.t.sol`, `UniswapV4Adapter.t.sol` generated route properties |
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

The final replay used seed `0x84c148f2f5c58c812b23255eee6e842609cd0b8f1a404b8078209e57aa591762`. Its [manifest](../test-results/campaign/2026-09-06T22-48-00-441Z-84c148f2/manifest.json) records the final source fingerprint and complete command arguments. Set `CAMPAIGN_SEED` to this value and run `node scripts/run-solidity-campaign.mjs` to replay both profiles.

| Command/check | Observed result |
| --- | --- |
| `node scripts/run-solidity-campaign.mjs`, default | 194 passed; 21 fuzz properties at 1,000 runs; six invariants at 128 runs, 8,192 calls, depth 64 and zero unexpected reverts each. 348.83 seconds, including 320.06 seconds compiling. |
| Same command, integration | 46 passed; two fuzz properties at 64 runs; 15 invariants at 128 runs, 8,192 calls, depth 64 and zero unexpected reverts each. 219.18 seconds, including 193.66 seconds compiling. |
| `node scripts/check-invariant-sensitivity.mjs` | Both handler assertion and unexpected-revert sentinels made Forge exit 1 in both profiles: four confirmed failures. |
| `node scripts/check-contract-security.mjs` | Passed solhint, compilation, static checks and size checks. The local Foundry build used `FOUNDRY_TEST=src`; tests ran separately above. |
| `node scripts/generate-contract-abis.mjs`; generated-package typecheck | Twelve ABI exports generated; `corepack pnpm --filter @onchaintradedfunds/generated typecheck` passed. |
| `node --test scripts/lib/testnet-routing.test.mjs scripts/lib/mainnet-routing.test.mjs` | 21 passed. |
| `node scripts/verify-mainnet-routing.mjs` | 23 runtime checks and 18 fork tests passed at block 56,320,801. [Pinned block and dependency report](../test-results/mainnet-validation.json). |
| `forge fmt --root contracts --check`; Node syntax and workflow YAML checks | Passed. |

For example, the final composed campaign attempted each of its nine selectors 874–931 times. Its final 64-call sequence recorded 25 successful operations, six expected rejections and 33 no-ops. The deterministic lifecycle separately required four repeated-settlement rejections, covering both vaults before and after shutdown. These observations support retaining the measured 128 × 64 size; they also show why increasing attempts alone would overstate useful state transitions.

Coverage is advisory. `check-contract-coverage.mjs` writes LCOV for locating unvisited production lines and a summary using `--ir-minimum`; those source mappings are approximate. Test failures now fail the coverage command. Inspect missed functions and branches against the property map rather than treating a percentage as a correctness claim. Its fixed-seed defaults are 64 fuzz cases and 8 invariant runs at depth 32. `COVERAGE_SEED`, `FOUNDRY_FUZZ_RUNS`, `FOUNDRY_INVARIANT_RUNS` and `FOUNDRY_INVARIANT_DEPTH` override these settings. Default coverage omits real V4 tests, matching the default Foundry profile. Use `COVERAGE_PROFILE=integration` with `COVERAGE_MATCH_PATH=contracts/test/OTFLaunchV4*.t.sol` for a separate real V4 pass; `COVERAGE_REPORT_FILE` preserves a separate report.

The final default coverage pass executed 194 tests successfully in 189.70 seconds, including 180.13 seconds of compilation. Its [LCOV report](../test-results/solidity-coverage.lcov) identifies unvisited metadata entry points (`tokenURI`, `otfTokenURI`) and `TeamMarketCapVesting.nextMilestone`. Flagged guard branches include malformed dependency responses, reentrancy guards, unusual approval/transfer behavior and some router settlement-delta mismatches. These combinations remain gaps in the generated properties.

The separate [real V4 coverage report](../test-results/solidity-v4-coverage.lcov) executed 46 tests successfully in 380.05 seconds, including 320.75 seconds compiling. It records calls to all launch router and deployer functions. Launch manager reporting helpers `currentOtfPriceWethWad`, `currentLaunchReferenceFdvWeth` and `bootstrapProgress` remain unvisited. Read the two reports together: each selects different tests. Some individual IR lines, including the bootstrap-position burn call, show zero hits despite successful graduation assertions; their source mappings cannot establish an omission by themselves.

Remaining limits: venue mocks authenticate route structure and model endpoint settlement at a fixed rate; they do not model real multi-hop market pricing. The launch suite supplies the real V4 coverage, while existing V3 integration and mainnet fork suites cover separate venue assumptions. Generated V3 amounts stop at uint128-max; wider uint256 inputs remain outside this campaign. The stateful vault clock stops at ten years. Arithmetic reference checks extend to 100 years; zero-rate checks span uint64 timestamps, and positive rates reject an unrepresentable uint64-max horizon. Representable nonzero-rate horizons beyond 100 years remain outside the reference campaign.

Rewards tests cover onchain cumulative claims; the publisher's emissions schedule, eligibility and allocation policy remain offchain. Vesting properties follow spot-price semantics. The composed fee ledger uses the vault's annual-fee preview, which the separate vault and arithmetic suites check against the independent reference.
