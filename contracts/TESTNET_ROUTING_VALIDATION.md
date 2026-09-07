# Robinhood testnet routing validation

The protocol and six RWA pools are live on Robinhood Chain Testnet (chain ID 46630). Current contract addresses and receipts are listed in [deployment addresses](../docs/content/deployment-addresses.mdx).

## Dependency authentication

The configured Uniswap V3 contracts match the published creation artifacts and constructor arguments. Runtime comparison covers metadata and permits only constructor immutable values. RPC runtime bytes also match the explorer. The [authentication manifest](../scripts/fixtures/robinhood-testnet-v3.json) records package versions, constructor arguments, immutable offsets, runtime hashes, and the reference block.

- UniswapV3Factory uses `@uniswap/v3-core` 1.0.1.
- NonfungiblePositionManager and QuoterV2 use `@uniswap/v3-periphery` 1.4.4.
- SwapRouter02 uses `@uniswap/swap-router-contracts` 1.3.1.

SwapRouter02 uses the four-field `exactInput` tuple. QuoterV2 returns the amount, post-swap square-root prices, crossed-tick counts, and gas estimate. The factory and WETH9 getters match their constructor bindings. SwapRouter02's V2 factory and the position manager's NFT descriptor are zero. Liquidity operations work without the descriptor, but NFT `tokenURI` rendering is unavailable.

Testnet V4 uses the configured PoolManager, StateView, PositionManager, Quoter, Universal Router, and Permit2 contracts. Their runtime hashes and address bindings are pinned for chain 46630. Routing uses the five-field exact-input tuple.

## WETH bindings

Protocol WETH is `0x33e4191705c386532ba27cBF171Db86919200B94`. The entry/exit router wraps and unwraps this contract. V3 and V4 routes, the launch router, and buybacks use the same token.

The V3 periphery binds WETH9 at `0x0dd1df4fdd55808c9d530c9599bea5107f6b9b4e`. V3 swaps and liquidity mints send zero native value and use ERC-20 transfers, so they do not call the periphery's native wrapping helpers. The two WETH contracts are not interchangeable.

## Pools and funding limits

The five constituent pools charge 0.3%. WETH/USDG uses 0.05%. The app requires the WETH/USDG pool for native basket entry, exit, and collector settlement.

| Pool | Initial USDG per asset | Maximum asset deposit | Maximum USDG deposit | Fee |
| --- | ---: | ---: | ---: | ---: |
| WETH/USDG | 1576.422935062981 | 0.031717376655651361 WETH | 50 | 0.05% |
| TSLA/USDG | 2.008202174385 | 4.979578315145678112 TSLA | 10 | 0.3% |
| AMZN/USDG | 2.791067037612 | 3.582859123496957887 AMZN | 10 | 0.3% |
| PLTR/USDG | 1.083163495307 | 9.23221659825719528 PLTR | 10 | 0.3% |
| NFLX/USDG | 1.055229261355 | 9.476613629111568542 NFLX | 10 | 0.3% |
| AMD/USDG | 1.879728729349 | 5.31991656235438698 AMD | 10 | 0.3% |

The funding budget caps deposits at 100 USDG plus the listed asset amounts. Native wrapping is capped at 0.031717376655651361 ETH. Seeding and protocol deployment each have a 0.001 ETH gas cap and a maximum gas price of 20,000,000 wei.

Pool addresses match their CREATE2 predictions and live factory lookups. The seed runner checks factory identity, tick spacing, price tolerance, minimum amounts, and allowance cleanup.

## Current protocol deployment

The deployment creates a fresh token, launch system, vesting contract, rewards distributor, oracle, vault implementation, factory, entry router, collector, and both trade adapters. It approves only the adapters owned by that deployment. The launch manager uses hook mask `0x2840`.

The current deployment record contains 25 transactions using 32,908,717 gas, or 0.00032908717 ETH at 10,000,000 wei/gas. The live verifier checks twelve protocol runtimes, six owned liquidity positions, adapter bindings, allowance cleanup, and funding caps.

The app authenticates V3 runtimes, adapter bindings, factory pool identities, and connecting-pool liquidity before quoting. The `/liquidity` page uses the same venue checks.

## Commands

Run these commands from the repository root:

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

Start Anvil with chain ID 46630 and the public Robinhood testnet RPC as its fork source. Simulation scripts accept only a local Anvil RPC. Live scripts require an authorized budget and write a transaction journal.

The maintained Foundry fork suite targets Robinhood mainnet; see [mainnet fork tests](MAINNET_FORK_TESTS.md). Testnet validation does not establish production readiness.
