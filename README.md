# Onchain Traded Funds

Onchain Traded Funds (OTFs) are experimental ERC-20 basket vaults. A creator commits an ordered constituent list and immutable raw-token bootstrap units for one OTF. The application derives those units from a fixed `$1` target initial basket value based on current offchain prices—not a peg—and labels exact market-cap defaults or creator-modified tilts as informational creation methodology. Contracts never receive prices, market caps, the target, percentage weights, multipliers, or methodology and do not calculate runtime NAV or rebalance.

This repository contains the Solidity protocol, the operating application, and a separate prelaunch competition. The protocol is pre-mainnet, unaudited, and not production-ready.

Basket settlement uses a generic, ordered `SwapLeg[]` boundary. The owner-managed
`OTFEntryExitRouter` approves narrowly bound trade adapters and exposes explicit native-ETH mint and
redeem endpoints. Native ETH is wrapped to its immutable canonical WETH at the user boundary; every
vault, adapter leg, pool, buyback, and accounting path remains ERC-20/WETH-only. `UniswapV3Adapter` accepts only a
validated packed V3 path. `UniswapV4Adapter` accepts only bounded typed V4 pool keys, authenticates
them through StateView, and constructs its fixed Universal Router actions internally. Ordinary pool
swaps bypass the entry router. Production quotes use the same-origin Uniswap Trading API integration;
Robinhood testnet quotes currently use the configured Synthra V3 pools and Quoter. The recorded
testnet deployment binds both adapters to the generic router; V4 basket routing remains dormant
until supported V4 pool keys and liquidity are added to the route catalog.

The protocol token is issued once at one billion OTF. Its live supply falls when holders or the
buyback collector burn tokens. A canonical 0%-fee OTF/WETH V4 pool launches with 150 million OTF
one-sided liquidity and graduates at its final tick into permanently locked full-range liquidity.
The launch manager also reserves 50 million OTF, team spot-FDV vesting holds 100 million, and the
cumulative Merkle distributor holds 700 million.

Each fund has immutable annual, mint, and redeem rates. Accounted OTF held as a real constituent
changes only the creator-versus-buyback split, from 50/50 up to 90/10 at 10 million OTF. The
buyback collector redeems fee shares through typed adapter routes, converts proceeds to WETH, buys
only through the canonical pool, and burns the purchased OTF.

The shared Swap product requires a fund share or the protocol OTF token on at least one side. It is
not a general token-to-token exchange. ETH and WETH are distinct selectable boundary assets; ETH is
wrapped or unwrapped atomically without a separate user action. The `/token` page embeds this same
Swap implementation and defaults to the configured protocol OTF token rather than maintaining a
second execution flow.

`app/src/config/robinhood-testnet-assets.json` is the testnet routing catalog. It separates USDG and WETH
quote assets from the five supported fund constituents and records their active Synthra pools. The
constituent pools fund basket mint/burn routes and the testnet liquidity utility; they do not expose
constituent-to-quote swaps in the user-facing Swap product.
`app/src/config/assets.json` is a chain-indexed list of featured production assets for app discovery;
it is not an onchain allowlist and does not limit the permissionless protocol.

The active Robinhood testnet v2 addresses, dependency hashes, setup transactions, and allocations
are recorded in `app/src/config/robinhood-testnet.json`.
