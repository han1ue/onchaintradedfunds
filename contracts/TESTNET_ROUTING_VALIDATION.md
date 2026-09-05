# Uniswap V3 replacement on Robinhood testnet

This is a historical testnet report. The maintained Foundry fork suite now targets
Robinhood mainnet; see [mainnet fork tests](MAINNET_FORK_TESTS.md). Current source
uses the mainnet V4 router encoding and cannot be redeployed against the old testnet router.

All six pools and the complete fresh protocol are live on chain 46630. The previous V3 adapter
is revoked, and the application configuration targets the new contracts. Live receipts, local checks, and
fork simulations are recorded below. This task created no Git commit.

## Dependency authentication

All four supplied V3 contracts match the published Uniswap creation artifacts byte for byte,
with the supplied constructor arguments. Runtime comparison checks every byte, including metadata,
and permits only the constructor's immutable operands. RPC runtime bytes also match the explorer.
The [authentication manifest](../scripts/fixtures/robinhood-testnet-v3.json) records package versions,
constructor arguments, immutable offsets, runtime hashes, and the reference block.

- UniswapV3Factory uses @uniswap/v3-core 1.0.1.
- NonfungiblePositionManager and QuoterV2 use @uniswap/v3-periphery 1.4.4.
- SwapRouter02 uses @uniswap/swap-router-contracts 1.3.1.

SwapRouter02 uses the four-field exactInput tuple. QuoterV2 returns the amount, post-swap square-root
prices, crossed-tick counts, and gas estimate. Factory and WETH9 getters match the constructor
bindings. SwapRouter02's V2 factory and the position manager's NFT descriptor are zero. Liquidity
operations work without the descriptor; NFT tokenURI rendering is unavailable with this binding.

## WETH decision

Protocol WETH remains 0x33e4191705c386532ba27cBF171Db86919200B94. It is an ordinary ERC-20 in V3
pools. The OTF entry/exit router wraps and unwraps this contract. The canonical OTF/WETH pool,
launch router, V4 dependencies, collector, and Permit2 flows retain the same WETH binding.

The replacement V3 periphery binds a different WETH9, 0x0dd1df4fdd55808c9d530c9599bea5107f6b9b4e.
V3 swaps and liquidity mints send zero native value and use ERC-20 transfers. They never call the
periphery's native wrapping or unwrapping helpers. Its runtime is pinned separately; this WETH
contract is not a published Uniswap V3 package artifact. The two WETH contracts are not treated
as interchangeable.

## Pool prices and approved funding

Prices were read from the application's existing initialized test markets during the authentication
run that began at block 113589461.
These are test-market ratios, not real equity valuations. The retained
[price snapshot](../scripts/fixtures/robinhood-testnet-v3-prices.json) includes token ordering,
square-root prices, source pools, and fees. The script verifies token decimals onchain.

The five constituent tiers remain 0.3%. The supporting WETH/USDG pool uses 0.05% because the
replacement factory does not enable the previous 0.01% tier. This connecting pool is required
for WETH/native basket entry, exit, and collector settlement.

| Pool | Initial USDG per asset | Maximum asset deposit | Maximum USDG deposit | Fee |
| --- | ---: | ---: | ---: | ---: |
| WETH/USDG | 1576.422935062981 | 0.031717376655651361 WETH | 50 | 0.05% |
| TSLA/USDG | 2.008202174385 | 4.979578315145678112 TSLA | 10 | 0.3% |
| AMZN/USDG | 2.791067037612 | 3.582859123496957887 AMZN | 10 | 0.3% |
| PLTR/USDG | 1.083163495307 | 9.23221659825719528 PLTR | 10 | 0.3% |
| NFLX/USDG | 1.055229261355 | 9.476613629111568542 NFLX | 10 | 0.3% |
| AMD/USDG | 1.879728729349 | 5.31991656235438698 AMD | 10 | 0.3% |

The approved limits total 100 USDG and the listed asset amounts. Native wrapping is capped at
0.031717376655651361 ETH. The wallet already holds enough USDG and constituents.
Gas spending is capped separately at 0.001 ETH for seeding and 0.001 ETH for deployment, with
20,000,000 wei/gas as the maximum gas price. The observed gas price was 10,000,000 wei/gas.
The user authorized the [budget file](../scripts/fixtures/robinhood-testnet-v3-budget.json) in this task.

Pool addresses in the asset catalog match their CREATE2 predictions and live factory lookups.
Each seed transaction rechecks factory lookup and spacing, reuses an existing matching pool,
and rejects a price more than 1% from the proposal. Full-range endpoints are rounded inward to
valid ticks. Position mint simulation supplies nonzero liquidity and rounded token amounts;
the mint uses 1% minimum-amount tolerances. Exact approvals are cleared afterward.

## Fresh protocol deployment

The H-01 hook correction requires a new launch manager with mask 0x2840. Its immutable OTF binding
requires a fresh token and launch system. The V4 tuple and Permit2 corrections require new adapter
and collector deployments. The collector, factory, and entry router have immutable or one-time
bindings, so the script deploys the complete protocol with fresh allocations and both adapters.
There are no compatibility aliases or alternate venue callbacks.

The script approves the replacement adapters and revokes the previous V3 adapter on its original
router. It checks the new adapter's router, factory, and SwapRouter02 bindings before publishing
configuration. Existing launch positions stay untouched. No withdrawal, transfer, or recovery
method is added to the locked launch position.

The app quote planner authenticates V3 runtimes and adapter bindings before quoting. It verifies
factory pool identities and rejects missing or empty connecting pools. The liquidity page uses
the same venue checks. Testnet liquidity links open the application's own /liquidity interface.

## Validation receipts

- The replacement dependency fork passed six protocol tests at block 113593057: V3 and V4 basket
  entry/exit, collector redemption settlement and canonical buyback, V4 fee-share settlement,
  native V3 basket entry/exit, and minimum-output rollback with allowance cleanup.
- The seed simulation initializes all six configured markets, mints positions through the actual
  NonfungiblePositionManager, obtains QuoterV2 quotes, and executes SwapRouter02 swaps in both
  directions. Swap smoke tests are reverted inside the local fork after verification.
- The full application suite passed 165 tests. Two stale UI assertions were updated to the
  existing interface. Workspace typechecks passed.
- The fresh protocol deployment simulation passed, including both adapter approvals and previous
  V3 adapter revocation. It used 27,391,158 gas. The six seeds used 32,356,752 gas; at the observed
  gas price, the combined cost is approximately 0.00059748 ETH, below the proposed 0.002 ETH cap.
- A second local simulation used all five real constituents and the WETH/USDG market for USDG
  basket entry/exit, native entry/exit, collector settlement and canonical OTF burning, allowance
  cleanup, and minimum-output rejection. Those five checks passed and their transactions were
  reverted afterward.
- Foundry passed 143 unit and invariant tests across 18 suites. The contract security runner
  passed compilation, Solhint, Solidity lint, runtime size, ABI, storage, and deployment checks
  for all 13 production contracts. Workspace lint and formatting checks passed.

Exact command output is under test-results/v3-auth. Liquidity simulation receipts include each
pool address, position ID, actual amounts, active liquidity, quotes, and local transaction hashes.

## Commands

From the repository root:

```powershell
node scripts/verify-uniswap-v3-testnet.mjs
node scripts/verify-testnet-routing.mjs
$env:TESTNET_RPC_URL='http://127.0.0.1:8547'
$env:LIQUIDITY_MODE='simulate'
node scripts/seed-uniswap-v3-testnet.mjs
$env:RH_TESTNET_RPC_URL='http://127.0.0.1:8547'
$env:DEPLOYMENT_MODE='simulate'
node scripts/deploy-robinhood-testnet.mjs
node scripts/validate-uniswap-v3-testnet-flows.mjs
node scripts/check-contract-security.mjs
node scripts/generate-contract-abis.mjs
node --test scripts/lib/*.test.mjs
corepack pnpm --filter @onchaintradedfunds/app test
corepack pnpm -r lint
corepack pnpm -r typecheck
```

Start Anvil with chain ID 46630 and the public Robinhood testnet RPC as its fork source.
Simulation scripts reject nonlocal RPC URLs and non-Anvil clients. Live scripts require an
explicitly authorized budget. The seed runner retains transaction receipts and refuses to repeat
a live funding run without reconciliation. Deployment writes a transaction journal.

From contracts, Foundry checks use forge test --no-match-path 'test/audit/*' --summary and
forge fmt --check. Foundry is v1.7.1; compilation uses solc 0.8.26, Cancun, via IR, and optimizer runs 1.

Production dependency validation is pending. Mainnet configuration lacks the required protocol
and venue bindings. Production checks must use a mainnet fork; these testnet results provide
no mainnet validation.

## Completed live operations

The user approved the exact seed amounts and 0.002 ETH combined gas cap. All 31 seed transactions
and 22 deployment/setup transactions succeeded. Actual gas spending was 0.00062198386 ETH: 0.00032661645 ETH for seeding and 0.00029536741 ETH for deployment.

| Pool | Asset deposited | USDG deposited | Position | Mint transaction |
| --- | ---: | ---: | ---: | --- |
| WETH/USDG | 0.03171737665564484 | 50 | 19 | [Receipt](https://explorer.testnet.chain.robinhood.com/tx/0x7a9948ea3ebd35b7d9d9173ad13b9431bc34e342b22f3035fc0d70e768fab028) |
| TSLA/USDG | 4.979578315145363692 | 10 | 20 | [Receipt](https://explorer.testnet.chain.robinhood.com/tx/0x6a71fe67de017b592a97102440c32f26262e1fb14e22c3a1cfe33b5f36ad4736) |
| AMZN/USDG | 3.582859123496871992 | 10 | 21 | [Receipt](https://explorer.testnet.chain.robinhood.com/tx/0x19b8c6b27422ba9f4612b67bbd5b47767038e0bfa4f6b04f9e02fbd328397ee2) |
| PLTR/USDG | 9.232216598256974875 | 10 | 22 | [Receipt](https://explorer.testnet.chain.robinhood.com/tx/0xa3b4e9b120f9a796b5c8f7dc5dae49c52039ec0d98349dffb35c8100c2bc5ffb) |
| NFLX/USDG | 9.476613629110974434 | 10 | 23 | [Receipt](https://explorer.testnet.chain.robinhood.com/tx/0xe6d858ae7f0d168e07c1206305787b3a9cb0f69eabcef7a1031a88d7fc833fe4) |
| AMD/USDG | 5.319916562353929505 | 10 | 24 | [Receipt](https://explorer.testnet.chain.robinhood.com/tx/0x6d76a3bfe3d9ebfccf0e4da8c1642414d10b75e1c69b702318a93be194f463b4) |

- OTF token: `0xDdc627874CA2B28F13031B31C45E9d5ea7A705ab`, [deployment receipt](https://explorer.testnet.chain.robinhood.com/tx/0x29eb85efbf5e6c06d0c76f24f7eac4ad6c9539a40f462794a521d86082f30c4f).
- Launch manager: `0xdeAdc1F7542f404A8548AF28659771c1ebbFa840`, [deployment receipt](https://explorer.testnet.chain.robinhood.com/tx/0xad9b1a4daea1ebf71e5840ce9ebccdbaf2b1b23874efa50078a0ea521fe528e2).
- Launch router: `0xa4EdB977c64a178F91ab2d1d59f9EC207a375023`, [deployment receipt](https://explorer.testnet.chain.robinhood.com/tx/0xef4bcccca1e46ba5f95ba06144ccbd62f2ee94e0707f1b3a87dca93951bd160a).
- Team vesting: `0x048b33F6469D8A0A439E6D5d9BBD36db61E30BfB`, [deployment receipt](https://explorer.testnet.chain.robinhood.com/tx/0x6e7d57a0e3427db159d5efff55abaa7e66e2bfea7173c8514594d6b4a51b7c12).
- Buyback collector: `0xFE4e62782AEDe67Dc0C4e0c9BcDbDa4769e08BbC`, [deployment receipt](https://explorer.testnet.chain.robinhood.com/tx/0x5e8a052485097271cab1bc95e62111eec65e8f1e27cf842e958a38f16f3924e6).
- Merkle rewards distributor: `0xBc1be2e0Cce2F48485e801d7188FC6D633EaFc8B`, [deployment receipt](https://explorer.testnet.chain.robinhood.com/tx/0xd27ec6c5537296a9b08317669abfbb8da86902c8eb660dbc48a15d4c4a076b2e).
- Testnet ETH/USD oracle: `0xDE1e4B0f8f0B8BD67D51354766fD8D9b48706B67`, [deployment receipt](https://explorer.testnet.chain.robinhood.com/tx/0xcf130789615d05e2aa83d51394ef7cf21d50c0ff92ee09353aa586db95e1e71c).
- Vault implementation: `0x59B5923264e22c04CFc57F787ADDD53b48A3D84c`, [deployment receipt](https://explorer.testnet.chain.robinhood.com/tx/0x1e7b0b6c63f7c2982f2bdbe81397f0368702acfbe447d5e42a3be5dc5bafff3e).
- Factory: `0x7619eB1Ec1302e6f9E1a618D875B05dCF5EcFE34`, [deployment receipt](https://explorer.testnet.chain.robinhood.com/tx/0xbdd2ac32f3c16c72bc39eb28664744a85521337cc048eaad127dfe550f05ff12).
- Entry/exit router: `0xFBeEDD9dA3c34339C513fd9fA6a24AD4B92a9DC2`, [deployment receipt](https://explorer.testnet.chain.robinhood.com/tx/0xf2c586f4c59db957ec541068a03859ffa2b5e205dd3054774ea7cf2bd71a3aa5).
- Uniswap V3 adapter: `0x8AcBE3dE5d585F2f7BBc1342c103dB1F5077CFa5`, [deployment receipt](https://explorer.testnet.chain.robinhood.com/tx/0xe8c38546f9a1cdde97b8aa274d529c782a22947ebb32ba8f59af11b0b225fd19).
- Uniswap V4 adapter: `0x72bB9e0AD6ee8845C13749BD7F8D1b27033B6Ba4`, [deployment receipt](https://explorer.testnet.chain.robinhood.com/tx/0x6076d2219a9c99472de0841cc001fae7c5327e5df597fbe8a0a51ebfc2b4be05).

The previous adapter was revoked in [this receipt](https://explorer.testnet.chain.robinhood.com/tx/0x519fe70a3ee1c911efefddd08d42e78f04a9e2aead3cb85f4dc7a6b79126b59a). No transaction targeted an existing locked launch position.

The [live liquidity journal](../deployments/robinhood-testnet-v3-liquidity.json), [deployment journal](../deployments/robinhood-testnet-v3-journal.json), and [verification record](../deployments/robinhood-testnet-v3-verification.json) contain transaction hashes, amounts, runtime pins, owners, and gas spending. The live readback verified twelve protocol runtimes, six wallet-owned positions, active liquidity, zero remaining position-manager approvals, the 0x2840 launch hook, and adapter revocation.

A fresh fork of the actual live deployment passed the five real-asset flow checks again. Those basket, native, and collector transactions ran only in the fork and were reverted afterward. Live operations were pool creation, initialization, funding, protocol deployment, and configuration; no live basket trades were broadcast.

Final commands include `node scripts/verify-live-uniswap-v3-testnet.mjs`, `FLOW_DEPLOYMENT_FILE=app/src/config/robinhood-testnet.json node scripts/validate-uniswap-v3-testnet-flows.mjs` on the local fork, and `corepack pnpm --filter @onchaintradedfunds/app build`. The application production build passed.

Application changes and generated configuration are in the repository. This task did not publish
or verify a hosted frontend deployment.

The final rebuild initially failed on a missing generated Next.js page. Clearing app/.next and
rerunning the same build command passed; output is in test-results/v3-auth/app-final-clean-build.log.

The CREATE2 launch-manager deployer is `0x4017f98bD801fDEE082d2190432a2cB5c3AFf150`, deployed in [this receipt](https://explorer.testnet.chain.robinhood.com/tx/0x9e4e867f63c305d5ab94a031b537db531174923757ecb2ab7692385b17bba732). It is recorded separately under deploymentTools in the application manifest.

The in-app browser confirmed active WETH/USDG and TSLA/USDG liquidity at the configured pool
addresses. Pool switching now waits for the selected pool's details before displaying a verification
failure. The documentation production build and Pagefind index also passed with
`corepack pnpm --filter @onchaintradedfunds/docs build`.
