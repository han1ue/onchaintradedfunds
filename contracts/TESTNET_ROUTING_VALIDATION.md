# Robinhood testnet routing validation

The application reads chain 46630 contracts from `app/src/config/robinhood-testnet.json`. Asset and pool records come from the database registry, filtered by chain ID.

The Universal Router adapter uses the pinned 2.1.1 source release. V3 command inputs include `minHopPriceX36`; V4 exact-input parameters include the same per-hop field. Routes carry a `0x03` V3 or `0x04` V4 discriminator. The entry router submits consecutive trades for the same adapter as one batch.

Protocol WETH is `0x33e4191705c386532ba27cBF171Db86919200B94`. Entry, exit, V3 swaps, V4 swaps, and buybacks use this token. The V3 Quoter and position manager have a separate WETH9 binding; their native payment helpers do not define the protocol's WETH.

## Verification

From the repository root:

```powershell
corepack pnpm contracts:solc
corepack pnpm contracts:abi
corepack pnpm contracts:security
corepack pnpm contracts:verify:testnet-routing
node --test scripts/lib/*.test.mjs
corepack pnpm --filter @onchaintradedfunds/app test
corepack pnpm --filter @onchaintradedfunds/app typecheck
corepack pnpm --filter @onchaintradedfunds/app lint
```

The read-only verifier checks the configured router against the pinned source, dependency bindings, the approved adapter, factory and vault bindings, and registered V3 pool identities and liquidity. Router verification stays in memory; its configuration contains only its address.

For deployment rehearsal, start a local Anvil fork of the testnet RPC on port 8555 and run `corepack pnpm contracts:deploy:testnet-routing`. The default mode accepts only a local RPC. It configures the affected immutable contract graph and exercises five-asset entry and exit, native flows, collector settlement, minimum outputs, and allowance cleanup using existing pools.

`DEPLOYMENT_MODE=broadcast` selects the configured testnet RPC and requires the configured testnet signer. The script rejects other chains. It updates application addresses only after checking the new bindings. Routing remains disabled if configuration is incomplete.

To repeat the flow checks against active contracts on a fresh local fork, run `node scripts/validate-uniswap-v3-testnet-flows.mjs`. Its transactions revert to a snapshot after validation.

Mainnet compatibility is checked separately on a local fork; see [mainnet fork tests](MAINNET_FORK_TESTS.md).
