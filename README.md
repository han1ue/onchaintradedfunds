# Onchain Traded Funds

Onchain Traded Funds (OTFs) are experimental ERC-20 basket vaults. This repository describes a
pre-mainnet, oracleless architecture: an OTF is weighted by market capitalization once, at
formation, and then holds a fixed ordered basket. It does not calculate NAV, refresh prices, or
rebalance from a runtime oracle.

The contracts are unaudited and are not production-ready. Do not deploy them to mainnet. The
active protocol is separate from `launch/`, which is a prelaunch competition and is not fund
governance.

Normative requirements are in [`docs/PROTOCOL_SECURITY_SPEC.md`](docs/PROTOCOL_SECURITY_SPEC.md).
Threats, trust assumptions, and unresolved production work are in [`SECURITY.md`](SECURITY.md).
The token and fee policy is in [`docs/OTF_TOKEN_AND_FEE_INCENTIVES.md`](docs/OTF_TOKEN_AND_FEE_INCENTIVES.md).

## Architecture

```text
AUTHORITY-signed, creator-bound formation snapshot
             |
             v
        OTFFactory ---- one-time clone ----> ManagedOTFVault
             |                                      |
             |                                      +-- fixed basket/share accounting
             |                                      +-- creator expense shares
             |                                      +-- FeeCollector protocol shares
             v
      OTFEntryExitRouter ---- typed, factory-authenticated Uniswap V3 swaps
```

### Formation

Formation is authority-attested and creator-submitted. The configured authority (an EOA or
ERC-1271 contract) authenticates one EIP-712 `FormationSnapshot` for a specific chain ID, factory,
intended creator, ordered constituent array, market-cap array, unit-price array, snapshot time,
expiry, calculation version, and nonce. An ordered token-decimals array is signed alongside the
constituents. The factory rejects a zero creator or any caller other than the signed creator before
the one-use nonce/digest can be consumed. It also checks the signature, expiry/domain, token
contracts, uniqueness, positive data, and that each live `decimals()` result exactly matches the
signed value and is at most 36. Relative quantities use the signed decimals. The signed creator
separately supplies unsigned name, symbol, beneficiary, and immutable
`annualCreatorExpenseRatioBps`; unsigned market data is never accepted.

The authority and data-provider arrangement is not yet a production configuration. The authority
must be independently controlled and the source, methodology, timestamp, and evidence for every
signed data set must be disclosed before deployment. A valid signature proves authorization of the
snapshot, not that market-cap or price data is economically correct.

The offline formation helper validates a fixture and emits relative quantities, typed data, and a
digest. It intentionally never accepts private-key material or signs. Production signing belongs in
the chosen Safe, HSM, MPC, or offline authority workflow.

Calculation version 1 derives the relative quantity for each asset for a $1 formation notional and
`1e18` fund shares:

```text
totalMarketCap = sum(marketCapUsdWad[i])
weightWad[i]   = floor(marketCapUsdWad[i] * 1e18 / totalMarketCap)
quantity[i]    = floor(weightWad[i] * 10**tokenDecimals[i] / unitPriceUsdWad[i])
```

The ordered quantities are persisted as formation metadata. Market-cap weights are not maintained
after formation; asset values can drift without an automatic rebalance.

## Vault accounting

- An OTF has at most 20 immutable constituents and 18-decimal shares. It is not ERC-4626.
- The first basket mint must be at least `1e18` shares. Later mint requirements round up
  pro-rata; redemption amounts round down pro-rata.
- Fee shares are checkpointed before supply math. `accountedBalance` is the vault's ledger, not a
  live valuation. Transfers that do not pass the exact balance-delta checks revert.
- Tracked-token donations are not added to the ledger and do not create a privileged claim. Normal
  mint/redeem uses accounted balances. After final shutdown, anyone may use the public in-kind
  emergency path: distributable backing is capped at `min(actual, accounted)`, so donations above
  the ledger are excluded and deficits cannot be overpaid.
- The creator can irreversibly shut down a sound vault. Any caller can do so when a readable
  constituent balance proves `actual < accounted`; a failed read or donation is not proof. Normal
  mint/redeem stops, and emergency in-kind redemption remains available.

## Creator expense and protocol token

`annualCreatorExpenseRatioBps` is immutable per vault, named exactly as in the ABI, and limited to
0..1000 bps. It mints shares to the fixed beneficiary (and, where configured, the protocol
collector's share) rather than transferring assets. The fee is lazy and cadence-independent. At
10% for one 365-day year, a pre-fee supply `S` mints approximately `S * 10% / 90%`, or 11.111%,
so existing holders retain 90% of the post-fee supply. Final shutdown stops further accrual.

`OTFToken` is a fixed 1 billion token supply with no privileged minter. `FeeCollector` holds
protocol fee shares and permits claims only by its treasury. The optional formation-allocation
rebate only reallocates protocol fee shares to the creator when the signed formation allocation is
covered by accounted OTF tokens; it never lowers the creator-selected fee paid by holders.

## Entry, exit, and routing

The permissionless router uses restricted basket mint/redemption primitives internally to mint
from one input token, redeem to one output token, or swap between OTF baskets. The application does
not expose a separate in-kind workflow. The offchain client compares only the direct and basket
routes it actually queries. Discovery and quote comparison are permissionless and offchain; the UI
does not claim global price optimality.

The onchain boundary is one immutable, typed Uniswap V3 factory/SwapRouter02 pair:

- packed V3 paths are parsed hop-by-hop, not treated as opaque commands;
- routes allow at most 40 legs and 3 hops per leg, with at most 20 vault constituents;
- every pool is authenticated against the configured V3 factory, token ordering, and fee;
- deadlines, per-leg minimums, aggregate minimums, exact sender/receiver balance deltas,
  temporary approvals, sender-only recipients/refunds, reentrancy protection, and atomic rollback
  are enforced;
- fee-on-transfer, rebasing, malicious callback, or otherwise non-exact tokens are rejected.

Production must use the four-field SwapRouter02 `exactInput` ABI and a factory/router/pool bytecode
family that agrees on the V3 pool init-code hash. Reported `factory()` equality alone is not enough;
funded fork smoke tests in both directions and through a multihop path are a deployment blocker.

There is no adapter registry or pool allowlist in this architecture. Uniswap V4 is not integrated:
there is no configured PoolManager. Pool fees belong to LPs; the creator makes no liquidity or
execution-price promise.

## Application and liquidity disclosures

The app's operating navigation is intended to map to `/` (Swap), `/otfs` (Funds),
`/otfs/<address>` (fund detail), `/create` (Create), `/verified` (Verified), and `/docs` (Docs).
There is no top-level Liquidity product. Wallet, quote, approval, simulation, submission, success,
and failure states should be shown explicitly; unavailable configuration must not look executable.

Pool creation and liquidity-position management happen on the external network venue. The app does
not custody LP positions or submit pool-management transactions. A leaving-app disclosure is
required. Mainnet USDG/OTF addresses, new production deployments, and the production typed quote
service remain unresolved. Synthra publishes no documented OTF/USDG pair-prefill URL, so
the testnet action opens its app without prefill. Testnet data must not be presented as a production
market.

## Repository layout

```text
contracts/src/       Solidity implementation
contracts/test/      Foundry tests and malicious-token fixtures
app/                  Operating UI and route disclosures
docs/                 Normative protocol and incentive specifications
SECURITY.md           Threat model and production blockers
```

## Verification

The Solidity workflow runs formatting, the contract security gate, the full Foundry suite, fuzz
and invariant campaigns where current test targets exist, and the advisory coverage summary. A
local or CI result is not an audit or a deployment approval. See the workflow and the protocol
specification for the exact gates.
