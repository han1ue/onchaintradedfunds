# OTF Protocol Token and Fee Incentives

Status: implementation-ready, not approved for production deployment.

This design adds a fixed-supply `OTF` protocol token, a linear protocol-fee incentive for OTFs
that hold it, and an auditable path for allocating a percentage of protocol AUM-fee revenue to
token buybacks. Token distribution, launch valuation, liquidity provisioning, and governance are
intentionally outside the contract defaults and must be decided before deployment.

## Contracts

### `OTFToken`

- Standard 18-decimal ERC-20 named `Onchain Traded Funds` with symbol `OTF`.
- Mints the entire chosen genesis supply once to the constructor-supplied distribution address.
- Has no privileged minter, inflation switch, transfer tax, blacklist, or upgrade hook.

### `OTFFactory` policy

The factory owner can permanently identify one protocol-token address. The identity cannot later be
replaced, preventing an admin from redirecting the incentive to an unrelated asset. The owner can
change `protocolTokenFullRebateBps` from 0 to 10,000 BPS; setting it to zero disables the incentive.

For each fee accrual, a vault measures the OTF token's live share of oracle-valued NAV. If:

- `W` is the live OTF weight in BPS,
- `T` is the admin-set full-rebate threshold in BPS, and
- `P` is the normal protocol share of the manager's AUM fee,

then the effective protocol share is:

```text
effective protocol share = P * max(T - W, 0) / T
```

This means a vault at half of the threshold pays half of the normal protocol share, and a vault at
or above the threshold pays none of it. All fee shares not sent to the protocol remain with the
manager's configured fee recipient; the investor's total manager-selected AUM fee does not change.

The calculation uses actual holdings rather than declared target weights. If OTF is not a
constituent, the threshold is disabled, or any required oracle read fails, the vault charges the
normal protocol share. The rebate lookup therefore grants no rebate and introduces no new revert
when pricing is unavailable. Other vault workflows may independently require fresh oracles for
their existing portfolio-band checks; the incentive does not weaken or bypass those checks.

### `FeeCollector` allocation

The treasury can configure `buybackAllocationBps` and a buyback recipient. On each treasury claim,
the collector transfers that percentage of the claimed protocol fee asset to the buyback recipient
and the remainder to the treasury. A zero allocation preserves the original collector behavior.

Protocol fees arrive as shares of many different OTF vaults, not as one cash token. The allocation
therefore earmarks fee assets; it does not pretend those assets have already been sold.

### `OTFBuyback`

The buyback contract completes the conversion in explicit, auditable steps:

1. An approved operator redeems allocated OTF vault fee shares into the corresponding basket.
2. The operator swaps each resulting asset for OTF through an owner-approved typed trade adapter,
   with a nonzero minimum output chosen for that transaction.
3. Anyone can release purchased OTF to the immutable recipient configured at deployment, such as a
   treasury timelock, emissions vault, or irrecoverable burn vault.

The buyback has no arbitrary call function. A trade must use an approved adapter and must output the
configured OTF token. Operators cannot choose a different recipient for purchased tokens.

## Admin and operating model

- Factory owner: identifies OTF once and controls the full-rebate threshold.
- Protocol treasury: controls the percentage of claimed AUM-fee assets allocated to buybacks.
- Buyback owner: approves operators and narrowly scoped trade adapters.
- Buyback operators: redeem allocated vault shares and execute slippage-bounded OTF purchases.

Threshold changes affect the next lazy fee accrual using the weight observed at that accrual. Before
changing a live threshold, operations should checkpoint affected vaults so an unaccrued historical
interval is not evaluated entirely under the new setting.

## Launch gates

Before mainnet deployment, the protocol should complete all of the following:

- Publish token supply, distribution, vesting, liquidity, and treasury-recipient decisions.
- Decide whether purchased tokens are held, streamed, or sent to an irrecoverable burn vault.
- Establish liquid, manipulation-resistant OTF price markets and oracle configuration.
- Put factory, collector, and buyback ownership behind an appropriate timelock or multisig.
- Define keeper cadence and transaction-level slippage policy for redemptions and buys.
- Model whether the rebate creates circular demand, concentration, or manager gaming risks.
- Obtain an independent security and economic review of the final configuration.

These contracts remain covered by the repository-wide warning: they are experimental and not
production ready.
