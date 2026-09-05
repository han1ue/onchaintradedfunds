# Onchain Traded Funds

Onchain Traded Funds (OTFs) are experimental ERC-20 basket vaults on Robinhood Chain. Each vault holds a fixed list of tokens and issues shares in that basket. The contracts do not use prices, calculate net asset value, or rebalance.

The protocol is deployed on Robinhood Chain Testnet. It is pre-mainnet and not ready to hold value.

## How an OTF works

The creator chooses the basket, allocation percentages, fund thesis, fee beneficiary, and fee rates. The application uses offchain prices and a `$1` target to calculate the initial token quantities per share. The vault stores those quantities; the target is not a price guarantee or peg.

Deposits enter through `OTFEntryExitRouter`. The first mint uses the initial basket quantities; later mints and redemptions use the vault's accounted balances. Direct token donations do not enter that ledger. A redemption that leaves fewer than `0.01` shares permanently shuts down the vault. Remaining holders can still redeem for basket tokens.

Annual expense, mint, and redeem fees accrue as vault shares. `BuybackCollector` records the creator and buyback portions when each fee is charged. The beneficiary settles the pending fees to WETH: the creator portion goes to the beneficiary, and the rest buys OTF through the canonical pool for burning.

The entry/exit router uses approved trade adapters for swaps and handles ETH wrapping and unwrapping. Vaults hold ERC-20 tokens. Holders can also redeem directly from a vault without swap liquidity. See the [protocol overview](docs/content/overview.mdx) for accounting, shutdown, and routing details.

## Protocol token

`OTFToken` issues one billion OTF once. The deployment allocation is:

| Destination | OTF |
| --- | ---: |
| Team market-cap vesting | 100,000,000 |
| V4 launch manager | 200,000,000 |
| Cumulative rewards distributor | 700,000,000 |

The four-year rewards program allocates 650 million OTF to depositors and 50 million to fund creators. Weekly emissions start at 14 million OTF, decline by about 1.97% per week, and stop after week 208. The publisher calculates rewards offchain; the distributor verifies claims but does not enforce this schedule.

The launch manager uses up to 150 million OTF for the initial sale and up to 50 million for permanent liquidity. The pool starts at a 15 ETH reference fully diluted valuation (FDV) and graduates at about 135 ETH. Graduation replaces the launch position with full-range liquidity and burns unused OTF. See [OTF token economics](docs/content/token-and-fee-incentives.mdx) for exact launch parameters, vesting, and reward formulas.

## Repository layout

| Path | Contents |
| --- | --- |
| `contracts/` | Solidity protocol, tests, and security gates |
| `app/` | Main creation, trading, and fund-inspection application |
| `docs/` | Nextra protocol documentation |
| `packages/brand/` | Shared product marks and favicon assets |
| `scripts/` | Compilation, deployment, verification, and rewards tooling |

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

Run the main application with `corepack pnpm --filter @onchaintradedfunds/app dev`, or the documentation site with `corepack pnpm docs:dev`.

## Further reading

- [Protocol overview](docs/content/overview.mdx)
- [Protocol security specification](docs/content/protocol-security-spec.mdx)
- [Security and trust assumptions](docs/content/security.mdx)
- [Deployment status](docs/content/deployment-addresses.mdx)
- [Contract review status](contracts/AUDIT.md)
