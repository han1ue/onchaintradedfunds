# OTF Protocol Token and Fee Incentives

Status: implementation-ready, not approved for production deployment.

This design adds a fixed-supply `OTF` protocol token and a linear protocol-fee incentive for OTFs
that hold it. Token distribution, launch valuation, liquidity provisioning, and governance are
intentionally outside the contract defaults and must be decided before deployment.

## Contracts

### `OTFToken`

- Standard 18-decimal ERC-20 named `Onchain Traded Funds` with symbol `OTF`.
- Mints the fixed 1 billion OTF supply once to the constructor-supplied treasury or distribution
  address.
- Has no privileged minter, inflation switch, transfer tax, blacklist, or upgrade hook.
- Exposes ERC-1046 `tokenURI()` metadata containing the onchain OTF SVG.

The initial holder can retain undistributed supply in a treasury or timelock and fund distribution
contracts later. A Merkle distributor does not need to exist when OTF is deployed: once an airdrop
snapshot and allocation are approved, the treasury can deploy the distributor and transfer only
that allocation into it. Team or contributor allocations should similarly be transferred into
vesting contracts rather than being held by recipients without restrictions.

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

### Treasury fee claims and manual buybacks

Protocol fees continue to arrive in `FeeCollector` as shares of many different OTF vaults, not as
one cash token. The existing contracts support a treasury-controlled manual buyback flow:

1. The treasury calls `FeeCollector.claim` or `claimAll` for a vault share token.
2. The treasury redeems those shares into the corresponding basket assets.
3. The treasury performs any approved OTF purchases through its normal multisig execution process.

No dedicated buyback contract or automatic fee allocation is required.

## Admin and operating model

- Factory owner: identifies OTF once and controls the full-rebate threshold.
- Protocol treasury: claims protocol fee shares and controls any manual redemption or buyback.

Threshold changes affect the next lazy fee accrual using the weight observed at that accrual. Before
changing a live threshold, operations should checkpoint affected vaults so an unaccrued historical
interval is not evaluated entirely under the new setting.

## Launch gates

Before mainnet deployment, the protocol should complete all of the following:

- Publish token supply, distribution, vesting, liquidity, and treasury-recipient decisions.
- Decide whether purchased tokens are held, streamed, or sent to an irrecoverable burn vault.
- Establish liquid, manipulation-resistant OTF price markets and oracle configuration.
- Put factory and collector ownership behind an appropriate timelock or multisig.
- Define treasury procedures and transaction-level slippage policy for redemptions and buys.
- Model whether the rebate creates circular demand, concentration, or manager gaming risks.
- Obtain an independent security and economic review of the final configuration.

These contracts remain covered by the repository-wide warning: they are experimental and not
production ready.
