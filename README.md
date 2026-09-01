# Onchain Traded Funds

Onchain Traded Funds (OTFs) are experimental ERC-20 basket vaults. A creator commits an ordered constituent list and immutable raw-token bootstrap units for one OTF. The application derives those units from a fixed `$1` target initial basket value based on current offchain prices—not a peg—and labels exact market-cap defaults or creator-modified tilts as informational creation methodology. Contracts never receive prices, market caps, the target, percentage weights, multipliers, or methodology and do not calculate runtime NAV or rebalance.

This repository contains the Solidity protocol, the operating application, and a separate prelaunch competition. The protocol is pre-mainnet, unaudited, and not production-ready.

Basket settlement uses a generic, ordered `SwapLeg[]` boundary. The owner-managed
`OTFEntryExitRouter` approves narrowly bound trade adapters. `UniswapV3Adapter` accepts only a
validated packed V3 path. `UniswapV4Adapter` accepts only bounded typed V4 pool keys, authenticates
them through StateView, and constructs its fixed Universal Router actions internally. Ordinary pool
swaps bypass the entry router. Production quotes use the same-origin Uniswap Trading API integration;
Robinhood testnet quotes currently use the configured Synthra V3 pools and Quoter. The recorded
testnet deployment binds both adapters to the generic router; V4 basket routing remains dormant
until supported V4 pool keys and liquidity are added to the route catalog.

The Swap product requires an OTF share on at least one side. It is not a general token-to-token
exchange: mainnet OTF routes use the Uniswap Trading API, while testnet OTF routes use Synthra V3.

`app/src/config/robinhood-testnet-assets.json` is the testnet routing catalog. It separates USDG and WETH
quote assets from the five supported fund constituents and records their active Synthra pools. The
constituent pools fund basket mint/burn routes and the testnet liquidity utility; they do not expose
constituent-to-quote swaps in the user-facing Swap product.
`app/src/config/assets.json` is a chain-indexed list of featured production assets for app discovery;
it is not an onchain allowlist and does not limit the permissionless protocol.
