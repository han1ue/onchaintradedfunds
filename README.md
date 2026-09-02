# Onchain Traded Funds

Onchain Traded Funds (OTFs) are experimental ERC-20 basket vaults on Robinhood Chain. Each vault has an ordered constituent list, fixed bootstrap units, immutable fee rates, and an immutable expense beneficiary. The contracts do not use prices, calculate net asset value, or rebalance.

The protocol is pre-mainnet, unaudited, and not ready to hold value. Its contracts have not been deployed on Robinhood Chain Testnet or Mainnet.

## How an OTF works

The creation application starts with a `$1` target basket value and current offchain asset data. It converts the creator's final percentages into raw token units for `1e18` vault shares. The target and weighting method describe initialization only; they are neither an onchain price nor a peg. The contract receives the ordered constituents, raw units, fund thesis, beneficiary, and fee rates.

The first depositor supplies the bootstrap basket in proportion to the shares requested. Later deposits and redemptions use the vault's accounted constituent balances. Donations do not enter that ledger. A redemption that leaves fewer than `0.01` shares permanently shuts down the vault, although remaining holders can still exit in kind.

Annual expense, mint, and redeem fees accrue as vault shares. `BuybackCollector` records the creator and buyback portions when a fee is charged. The beneficiary can settle the complete pending account through an approved route to WETH. The collector pays the creator portion in WETH, buys OTF with the rest through the canonical pool, and burns the purchased OTF.

`OTFEntryExitRouter` handles routed basket entry and exit through approved, router-bound trade adapters. Native ETH exists only at this boundary: the router wraps it to canonical WETH before basket execution and unwraps transient WETH output on native redemption. Vaults, adapters, pools, and buybacks use ERC-20 tokens only.

## Protocol token

`OTFToken` issues one billion OTF once. The deployment allocation is:

| Destination | OTF |
| --- | ---: |
| Team market-cap vesting | 100,000,000 |
| V4 launch manager | 200,000,000 |
| Cumulative rewards distributor | 700,000,000 |

The launch manager uses 150 million OTF for one-sided bootstrap liquidity and reserves 50 million OTF for permanent post-graduation liquidity. The canonical OTF/WETH V4 pool starts at a 20 ETH reference FDV and targets 180 ETH using fixed Uniswap ticks. See [OTF token economics](docs/content/token-and-fee-incentives.mdx) for the exact ticks, prices, and graduation mechanics.

## Repository layout

| Path | Contents |
| --- | --- |
| `contracts/` | Solidity protocol, tests, and security gates |
| `app/` | Main creation, trading, and fund-inspection application |
| `docs/` | Nextra protocol documentation |
| `launch/` | Separate prelaunch competition application |
| `packages/brand/` | Shared product marks and favicon assets |
| `scripts/` | Compilation, deployment, verification, and rewards tooling |

The launch competition does not govern the protocol or its vaults.

## Development

Install the workspace dependencies:

```bash
corepack pnpm install
```

Common checks:

```bash
corepack pnpm contracts:solc
corepack pnpm contracts:security
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
```

Run the main application or documentation site with `corepack pnpm --filter @onchaintradedfunds/app dev` and `corepack pnpm docs:dev`. The launch application has separate setup instructions in [`launch/README.md`](launch/README.md).

## Further reading

- [Protocol overview](docs/content/overview.mdx)
- [Protocol security specification](docs/content/protocol-security-spec.mdx)
- [Security and trust assumptions](docs/content/security.mdx)
- [Deployment status](docs/content/deployment-addresses.mdx)
- [Contract review status](contracts/AUDIT.md)
