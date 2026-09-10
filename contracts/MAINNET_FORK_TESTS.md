# Robinhood mainnet fork tests

Run `corepack pnpm contracts:validate:mainnet-routing` from the repository root.
The runner forks Robinhood mainnet (chain 4663), selecting one block 64 blocks
behind the current tip. It checks the pinned dependency runtime hashes at that block
before running Foundry against the same state.
The V4 Quoter check also verifies its PoolManager binding.
Tests execute locally and do not broadcast transactions.

The fixtures are `scripts/fixtures/robinhood-mainnet-routing.json` and
`scripts/fixtures/robinhood-mainnet-rehearsal.json`. Their addresses
come from the official [Uniswap V3 deployment list](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments),
[V4 deployment list](https://developers.uniswap.org/docs/protocols/v4/deployments),
and [Robinhood token contracts](https://docs.robinhood.com/chain/contracts/).
Runtime hashes identify the observed bytecode; they do not replace source review.

Set `RH_MAINNET_RPC_URL` to use another RPC with historical state. Set
`MAINNET_FORK_BLOCK` to replay a specific block with the same dependency hashes.
The fixture records reference block 55357373 and its hash; replaying that block
also checks its identity. The public RPC stopped serving that state during validation,
so historical replay requires an archive RPC. The runner prints the selected
block and test results without writing a report.

## Coverage

The eight tests in `test/fork/MainnetRouting.t.sol` cover:

| Flow | Assertions |
| --- | --- |
| V3 and V4 basket entry, partial exit, and fee redemption | Share backing, WETH payouts, OTF buyback burn, cleared fee accounts |
| V3 and V4 native ETH entry and exit | Wrapping, unwrapping, and the caller's received ETH |
| Mixed V3/V4 basket | Both versions through one adapter in a mint and redemption |
| V4 fee-share sale | Sale proceeds, creator payout, and canonical-pool buyback burn |
| V3 and V4 minimum-output failure | Restored input balance, no minted shares, and cleared transient balances and approvals |

Each setup deploys the protocol, initializes its launch, and buys through
graduation using the deployed mainnet PoolManager, PositionManager, and WETH.
The tests also use the deployed StateView, Universal Router, Permit2, and V3 factory. They create mock constituent tokens and seed new pools locally.
The separate market suite below uses existing stock-token markets and liquidity.

`MainnetDeployment.t.sol` adds three deployment rehearsal tests. They deploy the
complete protocol with distinct, ETH-funded deployer, administrator, beneficiary,
and investor accounts. Assertions cover CREATE addresses, the mined CREATE2 hook
salt and permissions, constructor bindings, adapter approvals, and the full
200m launch / 100m team / 700m rewards allocation. The launch test reconciles supply
after graduation and checks the permanent position's owner and liquidity. A third
test completes an administrator handoff and a Merkle rewards claim.

`MainnetMarkets.t.sol` adds four tests using real TSLA, AMZN, PLTR, NFLX, and AMD
tokens, USDG, and six existing V3 pools. The token addresses come from Robinhood's
[asset registry](https://api.robinhood.com/rhj/assets). Each market is checked
against the mainnet factory, token identities, fee tier, runtime hash, and active
liquidity. No stock balances or pool liquidity are created with cheatcodes.

Market entries spend 0.001 or 0.01 WETH per stock through WETH–USDG–stock paths;
exits reverse those paths. Each leg requires at least 99% of its live QuoterV2
quote. The suite also covers native ETH entry/exit, direct in-kind redemption
after the adapter is revoked, and fee redemption through all five markets
followed by an OTF buyback and burn. Transfers exercise the tokens' current
mainnet rules; the tests do not impersonate issuers to change those rules.

`MainnetVesting.t.sol` adds three tests against the real ETH/USD proxy and its
pinned aggregator. They check price normalization and canonical-pool FDV at
initialization and graduation, checkpoint and claim after a funded market
purchase, and acceptance at the maximum oracle age followed by rejection one
second later. The tests do not replace oracle responses or overwrite pool state.

`MainnetOtfQuoter.t.sol` checks the deployed V4 Quoter against a canonical pool
created during the local deployment rehearsal. It rejects an uninitialized pool
and quotes OTF basket entry and exit during bootstrap and after graduation.
Each round trip re-quotes the padded buy amount before execution and checks the
sale proceeds together with the basket's separate WETH constituent.

The Solidity security workflow runs this suite on pushes and pull requests that
match its path filters, plus manual runs. Default unit tests and the integration
profile remain independent of RPC access. The V4 integration and invariant suites
deploy Uniswap locally; they are not fork tests.

## Router compatibility

The verifier compares the configured mainnet Universal Router with pinned release
2.1.1, including its required immutable dependencies. V3 exact-input commands
include six fields; V4 exact-input parameters include five. Both include the
per-hop price array, encoded as empty while retaining aggregate minimum outputs.

The same adapter and command encoding apply on testnet, with dependencies read
from the chain-46630 configuration. The testnet Universal Router uses protocol
WETH and the configured V3 factory.

## Oracle age and rehearsal limits

Chainlink's [reference directory](https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json)
lists an 86,400-second heartbeat for the selected ETH/USD feed. The rehearsal uses
90,000 seconds: that heartbeat plus a one-hour buffer. This is an application
freshness policy, not a default imposed by `AggregatorV3Interface`. The suite
checks that the live answer satisfies it before testing the expiry boundary.

The deployment rehearsal uses local accounts as authorized for testing. It does
not validate final production addresses, multisig signatures, transaction fee
budgets, or a broadcast deployment script. Token proxy hashes alone do not authenticate
future implementation upgrades. Existing market liquidity, issuer restrictions,
and oracle availability can change; rerun the suite before deployment.
