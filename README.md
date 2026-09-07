# Onchain Traded Funds

Onchain Traded Funds lets anyone create an ERC-20 basket fund on Robinhood Chain. Each fund holds its assets in a vault and issues shares that holders can trade or redeem for basket tokens, after fees. The vault keeps a fixed token list and does not rebalance as prices change.

The protocol is deployed on Robinhood Chain Testnet. It is pre-mainnet and not ready to hold value.

## How an OTF works

The creator chooses the assets, allocation percentages, fund thesis, fee beneficiary, and fee rates. The application uses offchain prices and a `$1` target to calculate the initial token quantities per share. The contract stores those quantities without a price oracle or net asset value calculation. The target is not a price guarantee or peg.

Deposits enter through `OTFEntryExitRouter`. The first mint uses the initial basket quantities; later mints and redemptions use the vault's accounted balances. Direct token donations do not enter that ledger. A redemption that leaves fewer than `0.01` shares permanently shuts down the vault. Remaining holders can still redeem for basket tokens.

Fees are paid in fund shares. Annual expense dilutes existing holders, mint fees increase the assets needed for new shares, and redeem fees reduce the assets returned. `BuybackCollector` records a creator portion and a buyback portion. The beneficiary settles both to WETH (wrapped ETH), receives the creator portion, and the rest buys protocol OTF for burning.

The entry/exit router uses approved trade adapters for swaps and handles ETH wrapping and unwrapping. Vaults hold ERC-20 tokens. Holders can also redeem directly from a vault without swap liquidity. See the [protocol overview](docs/content/overview.mdx) for accounting, shutdown, and routing details.

## Protocol token

Protocol OTF is separate from the share token issued by each fund. It funds rewards and is purchased and burned through fee buybacks. `OTFToken` issues one billion OTF once, allocated as follows:

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

### Basket quote configuration

Testnet basket quotes use the configured V3 pools and the canonical V4 OTF/WETH pool for protocol OTF constituents. Mainnet quotes use `UNISWAP_API_KEY` to request independent V3/V4 routes for each constituent. Mint quotes request exact output, then budget exact-input adapter swaps to cover those amounts. Burn quotes request exact input. The planner translates split routes and mixed V3/V4 paths into approved adapter calls, with ETH wrapping and unwrapping in the basket router.

Mainnet basket quotes require deployment addresses in `app/src/config/robinhood-mainnet.json`: `protocolContracts.factory.address`, `protocolContracts.entryRouter.address`, `protocolContracts.uniswapV3Adapter.address`, and `protocolContracts.uniswapV4Adapter.address`. The `externalContracts` section must identify `uniswapV3Factory`, `uniswapV3SwapRouter02`, `uniswapV4PoolManager`, and `uniswapV4StateView`. Universal Router and Permit2 come from `uniswapTradingApi`; WETH comes from the production asset catalog. Protocol deployment addresses are not populated yet.

The V4 adapter accepts ERC-20 and native-ETH pool hops. It unwraps canonical WETH for native input and wraps native output before returning it to the basket router. Route data encodes `abi.encode(address currencyIn, PathKey[])`, with address zero representing ETH inside the V4 path. The planner compares WETH and native-ETH endpoint quotes and preserves hook data when supplied; otherwise it uses empty bytes. If a hook needs data the API does not supply, simulation rejects the route. Mixed-protocol boundaries cannot consume a token reserved for another basket constituent.

Set `RH_MAINNET_RPC_URL` to an RPC supporting `eth_simulateV1`; otherwise the app uses its configured mainnet RPC. Before returning an executable quote, the server checks deployment bindings and simulates approvals followed by the entire basket transaction using the caller's actual balances. Unsupported simulation or a reverted call makes the quote unavailable. The wallet repeats preflight after approval and before submission.

### Mainnet preparation

The mainnet manifest records the external Uniswap contracts and ETH/USD oracle. Protocol contracts remain undeployed. Both the initial protocol administrator and team vesting beneficiary resolve to the deployer; an administrator handoff can follow later. Set `DEPLOYER_ADDRESS` to the public address when preparing a concrete deployment plan.

Run these commands from the repository root:

```sh
node scripts/prepare-mainnet.mjs
node --env-file=app/.env.local scripts/check-mainnet-services.mjs
node scripts/verify-mainnet-routing.mjs
```

Store `UNISWAP_API_KEY` in the ignored `app/.env.local`. Optionally set `RH_MAINNET_RPC_URL` in the process environment to override the public RPC for these commands. Preparation verifies 23 pinned external runtimes and writes the role plan to `test-results/mainnet/preparation.json`. The service check tests RPC simulation support, oracle freshness, stock identities and Uniswap buy/sell quotes. Missing credentials or a failed service check produce a nonzero exit. Reports under `test-results/mainnet/` are ignored by Git.

The service checker sends Uniswap requests sequentially with a 1.1-second pause. The app spaces provider requests by at least 210 milliseconds per server process, honors `Retry-After` on HTTP 429, and makes at most three attempts. This pacing does not coordinate separate Vercel instances sharing the API key. Sustained traffic across instances needs a shared rate limiter or a higher provider quota; exhausted retries return `PROVIDER_RATE_LIMITED`.

The fork rehearsal creates contracts and exercises V3/V4 routing, stock baskets, launch graduation, vesting and administrator handoff on a local copy of mainnet state. These commands do not broadcast transactions. `deploymentPolicy.broadcastEnabled` stays false during preparation.

The app selects protocol addresses and rewards timing by network. Mainnet fund creation and discovery stay disabled until the manifest records deployed contracts and approved adapters. Creation previews use Robinhood identities for the five rehearsed stocks and Yahoo prices and market caps; assets with a changed share multiplier or missing pricing are omitted. This catalog does not add mainnet pricing routes to the verification registry.

After deployment, record the confirmed protocol addresses, rewards deployment block and timestamp, and approved adapters. Initialize the canonical OTF pool and check live basket quotes and simulations before setting routing ready. A successful stock quote or local fork rehearsal does not prove that the Trading API can discover the future OTF pool.

## Further reading

- [Protocol overview](docs/content/overview.mdx)
- [Protocol security specification](docs/content/protocol-security-spec.mdx)
- [Security and trust assumptions](docs/content/security.mdx)
- [Deployment status](docs/content/deployment-addresses.mdx)
- [Contract review status](contracts/AUDIT.md)
