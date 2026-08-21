# OTF Protocol Token and Fee Incentives

Status: implementation-ready, not approved for production deployment.

This design adds a fixed-supply `OTF` protocol token and a linear protocol-fee incentive for OTFs
that target an allocation to it. Token distribution, launch valuation, liquidity provisioning, and governance are
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
change `protocolTokenFullRebateBps` from the current `minTargetWeightBps` to 10,000 BPS; setting it
to zero disables the incentive. An enabled threshold cannot be below the mutable constituent
minimum, and that minimum cannot be raised above an enabled threshold.

For each fee accrual, a vault reads both the OTF token's oracle-valued actual weight and configured
target weight. If:

- `A` is the actual OTF weight in BPS,
- `G` is the configured OTF target weight in BPS,
- `W = min(A, G)` is the rebate weight in BPS,
- `T` is the admin-set full-rebate threshold in BPS, and
- `P` is the normal protocol share of the manager's AUM fee,

then the effective protocol share is:

```text
effective protocol share = P * max(T - W, 0) / T
```

This means a vault at half of the threshold pays half of the normal protocol share, and a vault at
or above the threshold pays none of it. All fee shares not sent to the protocol remain with the
manager's configured fee recipient; the investor's total manager-selected AUM fee does not change.

The target caps the rebate, while the actual oracle-valued weight proves the corresponding OTF tokens
are held. OTF follows the same `minTargetWeightBps` rule as every other constituent. If OTF is not a
constituent, the threshold is disabled, or its actual weight cannot be read safely, the vault charges
the normal protocol share. The incentive therefore fails closed when a required portfolio oracle is
unavailable.

### Treasury fee claims and manual buybacks

Protocol fees continue to arrive in `FeeCollector` as shares of many different OTF vaults, not as
one cash token. The existing contracts support a treasury-controlled manual buyback flow:

1. The treasury calls `FeeCollector.claim` or `claimAll` for a vault share token.
2. The treasury redeems those shares into the corresponding basket assets.
3. The treasury performs any approved OTF purchases through its normal multisig execution process.

No dedicated buyback contract or automatic fee allocation is required.

## Admin and operating model

- Factory owner: identifies OTF once, controls the full-rebate threshold, and can set the protocol
  share of manager fees from 0% to 100% for all existing and future OTFs.
- Protocol treasury: claims protocol fee shares and controls any manual redemption or buyback.

Threshold changes affect an OTF when its fees are next checkpointed. The latest threshold and active
target are intentionally applied to the entire uncheckpointed interval; the protocol does not keep
historical rebate-policy intervals. Strategy activation checkpoints fees before replacing the
active target weights.

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
