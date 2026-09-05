# Testnet routing validation, 5 September 2026

The corrected protocol passed four execution tests against the configured Robinhood testnet
dependencies on a local fork of chain `46630`. No transaction was broadcast. The protocol contracts
and synthetic basket assets were created inside the fork; the venue contracts retained their
deployed code and storage.

The successful run used block `113525256`, hash
`0x83ecbed3e847d8105eee56ed297c2f38be6b08a5c32856d5e34476cd849c060e`.
The [runtime manifest](../scripts/fixtures/robinhood-testnet-routing.json) records addresses and
code hashes for WETH, Permit2, the V3 factory and swap router, and V4 PoolManager, StateView,
PositionManager, and Universal Router. Both the runner and fork setup check all eight runtimes.

## Corrections established by dependency validation

The configured Universal Router's
[verified source](https://explorer.testnet.chain.robinhood.com/api/v2/smart-contracts/0x5274B13F0B60425f403A84Dc85b58951E880664c)
declares four fields in `IV4Router.ExactInputParams`: `currencyIn`, `path`, `amountIn`, and
`amountOutMinimum`. Its explorer runtime hash matched the RPC result. The manifest retains the
source URL, interface SHA-256, compiler version, and field order.

The adapter, collector, and application previously included a fifth field, `maxHopSlippage`.
Their encoding now matches this testnet runtime. The unit-test router decodes the installed
Uniswap interface independently, and application tests decode the four-field tuple directly.

The fork then exposed a separate adapter failure during approval cleanup: Permit2 stores the
current block timestamp when `approve` receives expiration zero. The adapter had required a stored
expiration of zero and reverted successful swaps. Its check now accounts for Permit2's documented
storage behavior while still requiring the exact approval amount, including zero on cleanup.
The Permit2 mock uses the same expiration semantics.

## Execution coverage

All four tests in [TestnetRouting.t.sol](test/fork/TestnetRouting.t.sol) passed:

- V3 basket entry and exit, followed by collector redemption settlement and a canonical V4 buyback.
- V4 basket entry and exit, followed by collector redemption settlement and a canonical V4 buyback.
- V4 basket entry and exit, followed by fee-share sale settlement and a canonical V4 buyback.
- An insufficient-output failure that restores balances, supply, and approvals.

Successful settlement checks the beneficiary's WETH receipt, fee-account clearing, OTF supply
reduction from burning, transient balances, and ERC-20 and Permit2 allowance cleanup. Every setup
also initializes and graduates the corrected launch manager through the deployed PositionManager
and PoolManager. V3 pool seeding uses the configured Synthra deployment's mint callback.

## Repeating validation

From the repository root, run:

```sh
corepack pnpm contracts:validate:testnet-routing
```

The runner selects one testnet block, verifies runtime hashes, and invokes Foundry with profile
`testnet`, `--match-contract TestnetRoutingTest`, `--rpc-url`, `--fork-block-number`,
`--fork-retries 5 --fork-retry-backoff 1000 --summary`. A successful run writes the block hash and
runtime bindings to `contracts/out/testnet-routing-validation.json`.

Set `TESTNET_RPC_URL` and `TESTNET_FORK_BLOCK` to replay a specific block with an archive-capable
endpoint. The public endpoint returned `metadata is not found` for older snapshots during this
validation. The runner fails if the selected state is unavailable; it does not substitute mocks.
Build scripts replace `contracts/out`, so retain validation receipts before rebuilding artifacts.

CI runs this command separately from local unit and V4 integration tests. The testnet deployment
script checks the same dependency bindings before deployment. A changed address or code hash
requires fresh source review and fork validation.

## Commands and results

Foundry was `v1.7.1`, using solc `0.8.26`, Cancun, optimizer runs `1`, and via IR. On this Windows
workspace, `forge` below means `C:/Users/X1704/AppData/Local/Foundry/v1.7.1/forge.exe`.

| Working directory | Command | Result |
| --- | --- | --- |
| Repository root | `corepack pnpm contracts:validate:testnet-routing` | Eight runtime checks and four fork tests passed at the block above. |
| `contracts` | `forge test --match-contract 'UniswapV4AdapterTest\|BuybackCollectorTest\|BuybackCollectorShutdownTest' --summary` | 20 passed, none failed or skipped. |
| `contracts` | `forge test --fuzz-seed 0x9f4f6d84b3d23c0d920c3ab72e86e10b72b65a10d6e2c4605aeb1ec8b337c921 --summary` | All 144 tests passed across 19 suites. |
| `contracts` | `forge fmt --check` | Passed. |
| Repository root | `corepack pnpm contracts:security` | Passed for all 13 production contracts, including Solhint, forced Foundry build, `forge lint src --deny warnings`, size, ABI, storage, and deployment checks. |
| Repository root | `node --test scripts/lib/testnet-routing.test.mjs` | Four passed. |
| Repository root | `node --test scripts/lib/deployment-config.test.mjs` | Three passed. |
| Repository root | `node --check scripts/verify-testnet-routing.mjs` | Passed. |
| Repository root | `node --check scripts/deploy-robinhood-testnet.mjs` | Passed. |
| `app` | `node node_modules/vitest/vitest.mjs run src/lib/canonical-v4-execution.test.ts` | Five passed. |
| `app` | `node node_modules/eslint/bin/eslint.js src/lib/canonical-v4-execution.ts src/lib/canonical-v4-execution.test.ts --max-warnings 0` | Passed. |
| Repository root | `corepack pnpm --filter @onchaintradedfunds/app typecheck` | Passed. |
| Repository root | `corepack pnpm contracts:solc` | Passed; regenerated artifacts from 29 production Solidity source files. |
| Repository root | `corepack pnpm contracts:abi` | Passed; generated 12 TypeScript ABI exports. |
| Repository root | `corepack pnpm --filter @onchaintradedfunds/generated typecheck` | Passed. |
| Repository root | `git diff --check` | Passed. |

The earlier H-01 run passed 23 local V4 integration tests and five launch invariants, covering both
currency orderings and graduation paths. Its exact commands and results are in the local
[H-01 validation log](h01-validation.log). The current full unit run includes all six hook
authorization tests.

An earlier full application test run passed 152 of 154 tests. Two UI-copy assertions in
`otf-page-wiring.test.ts` failed amid separate interface changes. The targeted routing tests pass;
this validation does not claim a clean full application suite.

Slopless checked the changed Markdown files and the two changed MDX pages through Markdown stdin.
The commands were `node node_modules/slopless/dist/cli.js contracts/TESTNET_ROUTING_VALIDATION.md contracts/SECURITY_REVIEW_2026-09-04.md contracts/AI_AUDIT_REPORT.md`
and `node node_modules/slopless/dist/cli.js --stdin --stdin-filename <page>.md`, with each MDX page
supplied on stdin. The report was checked again after revisions.
The new report, review follow-up, and MDX pages had no findings. Its ten findings in the historical
audit concerned unchanged technical terminology and a heading; those passages were retained.
Raw findings are under `.slopless/findings/2026-09-05--routing-*.json`.

## Remaining release work

The recorded live protocol deployment predates the hook, tuple, and Permit2 corrections. Redeploy
the protocol contracts and update application configuration before testing the corrected protocol
through a wallet. This fork validates the changed source against the selected venue runtimes;
it does not establish that the old live protocol contracts contain these fixes.

Mainnet configuration remains `configuration-required`. Mainnet addresses belong to their own
chain and cannot replace testnet dependencies. Before mainnet deployment, select and bind that
chain's runtimes and ABI, then repeat entry, exit, and settlement validation. These testnet results
do not cover production assets, market liquidity, oracle behavior, or operational routing quality.
