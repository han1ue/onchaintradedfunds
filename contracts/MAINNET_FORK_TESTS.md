# Robinhood mainnet fork tests

Run `corepack pnpm contracts:validate:mainnet-routing` from the repository root.
The runner forks Robinhood mainnet (chain 4663), selecting one block 64 blocks
behind the current tip. It checks eight dependency runtime hashes at that block
before running Foundry against the same state.
Tests execute locally and do not broadcast transactions.

The fixture is `scripts/fixtures/robinhood-mainnet-routing.json`. Its addresses
come from the official [Uniswap V3 deployment list](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments),
[V4 deployment list](https://developers.uniswap.org/docs/protocols/v4/deployments),
and [Robinhood token contracts](https://docs.robinhood.com/chain/contracts/).
Runtime hashes identify the observed bytecode; they do not replace source review.

Set `RH_MAINNET_RPC_URL` to use another RPC with historical state. Set
`MAINNET_FORK_BLOCK` to replay a specific block with the same dependency hashes.
The fixture records reference block 55357373 and its hash; replaying that block
also checks its identity. The public RPC stopped serving that state during validation,
so historical replay requires an archive RPC. A successful run writes
`contracts/out/mainnet-routing-validation.json`; starting another run removes the
previous report so a failed run cannot leave a stale success result. The report
records the selected block number and hash for later replay.

## Coverage

The eight tests in `test/fork/MainnetRouting.t.sol` cover:

| Flow | Assertions |
| --- | --- |
| V3 and V4 basket entry, partial exit, and fee redemption | Share backing, WETH payouts, OTF buyback burn, cleared fee accounts |
| V3 and V4 native ETH entry and exit | Wrapping, unwrapping, and the caller's received ETH |
| Mixed V3/V4 basket | Both adapters in one mint and redemption |
| V4 fee-share sale | Sale proceeds, creator payout, and canonical-pool buyback burn |
| V3 and V4 minimum-output failure | Restored input balance, no minted shares, and cleared transient balances and approvals |

Each setup deploys the protocol, initializes its launch, and buys through
graduation using the deployed mainnet PoolManager, PositionManager, and WETH.
The tests also use the deployed StateView, Universal Router, Permit2, V3 factory,
and V3 router. They create mock constituent tokens and seed new pools locally.
They do not test existing stock-token markets or production liquidity depth.

The Solidity security workflow runs this suite on pushes and pull requests that
match its path filters, plus manual runs. Default unit tests and the integration
profile remain independent of RPC access. The V4 integration and invariant suites
deploy Uniswap locally; they are not fork tests.

## Router compatibility

The first mainnet run exposed a V4 encoding mismatch. The historical testnet
Universal Router accepts four fields in `ExactInputParams`. The mainnet router
requires five, including a per-hop array between the path and input amount.
The V4 adapter and buyback collector now encode that array as empty and retain
the caller's aggregate minimum output. All eight fork tests pass with this encoding.

The already deployed testnet contracts retain their four-field encoding.
The testnet deployment script stops before compilation or wallet setup because
the pinned testnet venue is incompatible with current source. Replacing that
venue requires a separate review and deployment. Historical testnet receipts,
runtime verification, and scripts for inspecting the existing deployment remain
available; they are not mainnet deployment evidence.

## Remaining deployment coverage

Prioritize a complete deployment rehearsal with the intended deployer, CREATE2
salt, multisig, beneficiary, and token allocations. This suite uses local test
deployment helpers rather than the production deployment procedure.

Then test the selected real constituent tokens and existing pools: token decimals,
transfer restrictions, multi-hop routes, realistic trade sizes, and direct in-kind
redemption when swap routes are unavailable. Add a vesting flow using the selected
mainnet ETH/USD oracle and the canonical OTF pool. These dependencies and operating
conditions remain outside the current fork suite.
