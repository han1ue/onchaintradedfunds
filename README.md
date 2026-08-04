# Onchain Traded Funds

Repository/package folder: `onchaintradedfunds`.

Onchain Traded Funds, abbreviated OTF, is an experimental MVP for permissionless onchain investment vaults backed by approved stock-token style ERC-20 assets. Each vault is an ERC-20 share token and a custodian of its own underlying basket. Managers can rebalance, but only through a narrow, safety-checked execution path.

This code is not audited, not production ready, and must not be deployed to mainnet.

The normative contract invariants and deployment gates are defined in
[`docs/PROTOCOL_SECURITY_SPEC.md`](./docs/PROTOCOL_SECURITY_SPEC.md). The threat model and known
limitations are documented in [`SECURITY.md`](./SECURITY.md). A reproducible outside-review scope
is available in
[`docs/INDEPENDENT_SECURITY_REVIEW.md`](./docs/INDEPENDENT_SECURITY_REVIEW.md).

## Current Scope

This repository currently implements the first MVP slice:

- Foundry-style Solidity project structure.
- Vault, factory, registry, oracle, executor, fee collector, and mock contracts.
- Fixed minimum rebalance cooldown model.
- Direct basket vault creation through the factory.
- Proportional mint and redeem logic.
- Optional atomic USDG-only entry through a separately allowlisted router and adapter.
- Lazy share-based management fee accrual.
- Onchain thesis history.
- Oracle-valued NAV and weight checks.
- Approved-adapter rebalance execution.
- Comprehensive Foundry unit, fuzz, and stateful invariant tests.
- Next.js app with RainbowKit, wagmi, viem, and TanStack Query.
- A DeFi-style vault dashboard that reads directly from vault contracts.

## Repository Layout

```text
/
|-- contracts/
|   |-- src/
|   |   |-- interfaces/
|   |   |-- libraries/
|   |   |-- mocks/
|   |   |-- ManagedOTFVault.sol
|   |   |-- OTFFactory.sol
|   |   |-- RebalanceExecutor.sol
|   |   |-- AssetRegistry.sol
|   |   |-- OracleRegistry.sol
|   |   |-- FeeCollector.sol
|   |   `-- VaultTypes.sol
|   |-- test/
|   `-- foundry.toml
|-- app/
|   |-- src/app/
|   |-- src/components/
|   `-- src/lib/
|-- packages/generated/
|-- scripts/
|-- README.md
`-- SECURITY.md
```

## Architecture

```mermaid
flowchart LR
  Creator[Creator / Manager] --> Factory[OTFFactory]
  Factory --> Clone[ManagedOTFVault clone]
  Clone --> Registry[AssetRegistry]
  Clone --> OracleRegistry[OracleRegistry]
  OracleRegistry --> Feeds[Chainlink-compatible feeds]
  Clone --> Executor[RebalanceExecutor]
  Executor --> Adapter[Approved trade adapter]
  Adapter --> Tokens[Underlying ERC-20 assets]
  Clone --> Collector[FeeCollector]
  User[Share holder] --> Clone
  User --> EntryRouter[OTFEntryRouter]
  EntryRouter --> EntryAdapter[Approved entry adapter]
  EntryAdapter --> Liquidity[Uniswap-compatible liquidity]
  EntryRouter --> Clone
  App[Next.js app] --> Factory
  App --> Clone
```

### Contracts

`OTFFactory`

- Deploys deterministic minimal-proxy vault clones.
- Rejects invalid implementations.
- Stores vault list and creator mapping.
- Reads the protocol treasury from the single authoritative `FeeCollector`.
- Stores globally approved trade adapters.
- Rejects any vault cooldown below seven days.
- Does not custody vault assets.

`ManagedOTFVault`

- ERC-20 vault-share token.
- Custodian of tracked underlying assets.
- Proportional mint and redemption engine.
- Manager-controlled rebalance engine with immutable safety bounds.
- Onchain metadata and thesis history source.
- No arbitrary manager call surface.
- Delegates strategy-only calls to a fixed `ManagedOTFVaultStrategy` module.

`ManagedOTFVaultStrategy`

- Separates strategy and constrained trade logic from custody and share accounting.
- Is created with each vault implementation and cannot be replaced after deployment.
- Executes with the vault storage through `delegatecall`, preserving manager and executor identity.
- Cannot expose a generic call path or select arbitrary trade recipients.

`PortfolioCalculator`

- Statelessly normalizes oracle values and evaluates portfolio weights and challenge bands.
- Cannot transfer tokens, approve spenders, or mutate vault state.

`RebalanceExecutor`

- Verifies caller is a factory-created vault.
- Verifies adapter is globally approved.
- Executes typed adapter swaps only.
- Prevents arbitrary manager-supplied target calls from the vault.

`OTFEntryRouter`

- Lets a user request an exact number of OTF shares while supplying only the configured settlement token, initially USDG.
- Buys the exact proportional basket through independently approved entry adapters, deposits it atomically, and refunds unused settlement tokens.
- Lets a share holder atomically redeem the proportional basket, sell each constituent through approved adapters, and receive only USDG.
- Accepts only factory-created OTFs and never changes portfolio targets or custody rules.

`UniswapV2Adapter`

- Implements exact-input rebalance swaps and exact-output settlement entry against a configurable Uniswap V2-compatible router.
- Validates route endpoints, limits callers, returns output to the protocol caller, and clears temporary router approvals.
- May route a rebalance internally through USDG while the vault-visible input and output remain active RWA constituents.

`AssetRegistry`

- Onchain allowlist for approved assets in local development.
- Production integration point for an official Robinhood Chain stock-token registry.

`OracleRegistry`

- Maps approved assets to Chainlink-compatible price feeds.
- Lets vaults evaluate NAV, turnover, and post-trade weight deviation.

`FeeCollector`

- Receives the protocol portion of manager-selected fee shares.
- Allows only the configured treasury to claim those shares.
- Uses a two-step treasury transfer.

### Basket Share Safety

OTFs are multi-asset basket vaults, not ERC-4626 implementations. Users mint an explicit number of
shares by supplying every tracked asset proportionally. Required deposits round up and redemption
outputs round down.

Each OTF permanently locks `1_000_000` share wei inside itself at initialization. This prevents
total supply from reaching zero and keeps minting operational after every circulating share has
been redeemed. Initial share supply must be greater than the locked amount.

Factory seeding, basket minting, redemption, and rebalance execution verify exact token balance
deltas for both sender and receiver. Fee-on-transfer, sender-taxed, and unexpectedly rebasing
assets therefore revert atomically. Assets with nonstandard transfer accounting must not be
approved.

Direct donations of tracked assets become backing for every share. A donation can change NAV,
weights, and required mint amounts, but `maxAmountsIn` and `minAmountsOut` protect users from stale
previews. Prefunding a predicted vault address is treated as additional backing and cannot block
factory creation.

### Draft ERC-7621 Compatibility

The basket implements the function surface pinned from the
[official ERC-7621 draft assets](https://github.com/ethereum/ERCs/tree/2bc5bccf25aa06f98644c35fc92e6bf82947cfe2/assets/erc-7621),
ERC-165 detection, ERC-173 ownership, and the exact standard `Contributed`, `Withdrawn`, and
`Rebalanced` events.
`Rebalanced(newTokens, newWeights)` means that target composition changed. It does not imply that
trades ran or reserves reached the target.

OTF emits richer strategic, maintenance-trade, challenge, and fee-state events alongside the
standard events. Target proposal, trade execution, and completion are separate transitions.

The implementation is ERC-7621 interface-compatible with documented restrictions; it does not
claim full or unconditional compliance. It intentionally accepts only exact proportional basket
contributions, prevents ownership renunciation, and stages constituent removal until its reserve is
zero. The proportional-only contribution behavior differs from the draft's generalized monotonic
contribution and valuation requirements.

## Portfolio And Strategy Timing

The rolling 30-day rebalance counter has been removed. There is no `maxRebalancesPer30Days`, timestamp circular buffer for monthly limits, `rebalancesInLast30Days()`, or `remainingRebalancesInWindow()`.

Each vault stores:

```solidity
uint256 public constant MIN_REBALANCE_COOLDOWN = 7 days;
uint256 public constant STRATEGY_CHANGE_COOLDOWN = 14 days;
uint256 public constant STRATEGY_ACTIVATION_DELAY = 48 hours;
uint64 public lastRebalanceTimestamp;
uint64 public lastStrategyChangeTimestamp;
uint32 public rebalanceCooldown;
```

The factory and vault both reject cooldowns shorter than seven days:

```solidity
if (params.rebalanceCooldown < MIN_REBALANCE_COOLDOWN) {
    revert RebalanceCooldownTooShort();
}
```

Both timestamps are initialized at creation. A target proposal must satisfy the configured
portfolio cooldown and the fixed strategy cooldown:

```text
lastRebalanceTimestamp + rebalanceCooldown
lastStrategyChangeTimestamp + 14 days
```

The manager's valid proposal is stored as pending and leaves the current target untouched. It can
only be activated after the holder notice window:

```solidity
pendingStrategyActivationTime = block.timestamp + 48 hours;
```

`lastStrategyChangeTimestamp` updates on activation. `lastRebalanceTimestamp` updates only when a
strategic rebalance successfully completes inside every final completion band. Pending proposals,
cancelled proposals, failed trades, and partial trades do not update either completion timestamp.

The following operations do not count as portfolio rebalances and do not update `lastRebalanceTimestamp`:

- Thesis amendments.
- Fee accrual.
- Immediate manager transfer.
- Immediate fee-recipient update.
- Proportional minting.
- Proportional redemption.
- Partial maintenance trades.
- Challenge creation, synchronization, and resolution.

The manager cannot shorten the cooldown after deployment. The MVP intentionally provides no setter for `rebalanceCooldown`.

## Vault Lifecycle

### Creation

The creator approves initial underlying assets to the factory. The factory:

1. Validates factory-level hard caps.
2. Computes a deterministic clone salt from creator, nonce, and initialization parameters.
3. Deploys the clone.
4. Transfers exact initial assets to the clone.
5. Calls `initialize`.
6. Records the vault and emits `VaultCreated`.

The vault initializer:

- Validates manager and fee recipient.
- Validates initial thesis byte length.
- Validates approved assets and no duplicates.
- Validates weight totals equal 10,000 bps.
- Validates min, max, and count constraints.
- Validates exact initial balances arrived.
- Sets creation-time cooldown baseline.
- Stores thesis version zero.
- Mints initial shares to the manager.

### Minting

Anyone can mint new vault shares by depositing the current proportional basket. The vault uses current raw balances and total supply:

```text
required amount of asset i =
shares requested * current vault balance of asset i / total share supply
```

The implementation rounds required inputs up. This protects existing holders from under-deposits caused by truncation.

Minting:

- Accrues fees first.
- Rejects zero shares.
- Rejects bad array lengths.
- Enforces caller-provided max inputs.
- Does not use oracles.
- Is blocked while a rebalance is executing.

### USDG-only entry

Direct proportional basket deposits remain the base minting primitive. An optional
`OTFEntryRouter` convenience path lets a user request an exact amount of OTF shares and set a
maximum USDG spend. The router previews the exact constituent amounts, buys each amount through
approved exact-output adapters, calls `mintWithBasket`, and refunds unspent USDG in the same
transaction. Any failed swap, stale quote protection, insufficient output, deposit mismatch, or
share mint failure reverts the entire operation.

The cost shown by a Uniswap pool is not the OTF's accounting NAV. OTF NAV uses approved Chainlink
feeds, while entry cost depends on available AMM liquidity and price impact. The frontend displays
both values and the difference; users protect execution with per-leg maximum inputs, an aggregate
maximum USDG amount, and a deadline. This route does not subsidize entry from existing OTF assets.

The router and adapter are separate contracts so future RFQ, proprietary AMM, or order-book
liquidity can be integrated behind additional typed adapters without adding an arbitrary-call path
to the vault. See Robinhood's documented
[liquidity-source categories](https://docs.robinhood.com/chain/building-with-stock-tokens/#liquidity-sources).

### Redemption

Share holders redeem proportionally for the tracked underlying basket:

```text
asset output i =
shares burned * current vault balance of asset i / total share supply
```

The implementation rounds outputs down. This prevents redemption from transferring more than the redeemer's proportional claim.

Redemption:

- Accrues fees first.
- Supports allowance-based redemption.
- Enforces min outputs.
- Does not use oracles.
- Remains available when oracle-dependent actions fail.

An optional settlement exit lets a holder redeem to USDG in one transaction. The holder approves
the exact OTF share amount to `OTFEntryRouter`; the router burns those shares through the normal
proportional `redeem` path, sells each received constituent through an approved adapter, enforces
per-leg and aggregate minimum USDG outputs plus a deadline, and transfers the resulting USDG to the
chosen receiver. Pool proceeds may differ from the Chainlink-priced basket value, and the frontend
shows that difference before signing. A failed leg or insufficient aggregate output reverts the
share burn and every swap atomically.

## Strategic Rebalancing

Only the manager changes constituents and targets through the draft ERC-7621 function:

```solidity
function rebalance(
    address[] calldata newTokens,
    uint256[] calldata newWeights
) external;
```

This call validates and records a pending strategic target and emits `TargetWeightsProposed`. The
active target and ERC-7621 constituent views remain unchanged for 48 hours so holders can redeem
against the current basket. A new target cannot be proposed while the old portfolio is outside
completion bands, during a challenge, while another proposal is pending, or while an earlier
strategic target remains unfinished.

After the notice period, `activatePendingStrategy()` revalidates assets, prices, turnover, fee and
challenge state, makes the target active, and emits the standard
`Rebalanced(newTokens, newWeights)` plus `TargetWeightsActivated`. Activation performs no trades.
Anyone may activate the already-authorized proposal; only the manager may cancel it. Manager
transfer automatically cancels a pending proposal.

The manager or an authorized executor performs one or more partial batches through:

```solidity
function executeRebalanceTrades(TradeInstruction[] calldata trades) external;
```

Each trade is typed:

```solidity
struct TradeInstruction {
    address adapter;
    address tokenIn;
    address tokenOut;
    uint256 amountIn;
    uint256 minAmountOut;
    bytes adapterData;
}
```

The vault grants exact temporary approvals to `RebalanceExecutor`, clears them after each trade,
and receives output directly. There is no generic target/calldata execution function.

Every partial batch must use current constituents and approved adapters, satisfy explicit and
oracle-valued slippage, stay within turnover and NAV-loss bounds, avoid worsening any constituent,
and strictly reduce total distance from the active target.

When a successful strategic trade batch brings every constituent inside the narrower completion
bands, the vault completes the strategic rebalance atomically, emits
`StrategicRebalanceCompleted`, updates `lastRebalanceTimestamp`, and resumes fee withdrawals.
Anyone may still call `completeStrategicRebalance()` when no trade is needed or
natural price movement reaches the bands.

Retained rebalance protections:

- Approved assets only.
- Approved trading adapters only.
- Maximum portfolio turnover.
- Maximum NAV loss.
- Narrow completion bands and wider challenge bands.
- Maximum number of assets.
- Maximum individual-asset weight.
- Minimum nonzero asset weight.
- Fresh onchain prices.
- Atomicity of each partial trade transaction.
- No arbitrary manager calls.
- Exact temporary approvals cleared after execution.

### Strategy And Execution Authority

The manager alone controls constituents, targets, bands, fee rate, ownership, and the executor
allowlist. A manager is automatically added to that allowlist and may authorize multiple additional
executor addresses. The manager may also remove or restore their own trade-execution permission.

Executors can only call the constrained trade-batch function. They cannot change strategy,
permissions, fees, ownership, or adapters and cannot direct assets to arbitrary recipients.
All executor authorizations are cleared on manager transfer, then the new manager is added as the
sole authorized executor. Executors receive no bounty or
reimbursement from vault assets.

### Weight Bands And Challenges

Each target has a wider challenge band and a narrower completion band. Anyone may call
`flagOutOfBand()`, but fresh approved prices must prove a real challenge-band breach.

A valid challenge locks target changes and manager-fee withdrawals while the configured grace
period runs. The protocol enforces a minimum of five days and the frontend uses that minimum by
default so scheduled market weekends and holiday closures do not consume the entire response
window. All valid fees earned before the challenge start are crystallized first and cannot be
forfeited later. Natural price movement and constrained trades can both restore the basket. If the
manager stops the challenge before the deadline, accrued fees are withdrawn normally. If the
deadline is missed, manager fees from the challenge window are forfeited: 50% becomes a claimable
reward for the challenge caller and the remaining 50% is never minted. Deposits and proportional
withdrawals remain enabled.

## NAV And Weight Math

Asset values are normalized to 18-decimal USD units:

```text
asset value =
raw token balance
* oracle price
/ 10 ** token decimals
* 1e18
/ 10 ** oracle decimals
```

The vault rejects:

- Missing oracle feeds.
- Nonpositive prices.
- Zero update timestamps.
- Future update timestamps.
- Incomplete rounds.
- Stale prices.
- Unsupported token or oracle decimals.

Each vault fixes its oracle freshness threshold at creation. The factory caps that threshold at
one hour; the frontend defaults to 30 minutes.

Current weights:

```text
asset value * 10,000 / NAV
```

NAV views can revert when oracle data is invalid. Redemption does not depend on NAV and should remain available.

## Turnover

Turnover measures how much of the portfolio is changing:

```text
turnover = 0.5 * sum(abs(currentWeight_i - targetWeight_i))
```

The implementation evaluates the union of current and target assets. Removed assets contribute their current weight. New assets contribute their target weight.

## Management Fees

The only annual vault fee is the manager-selected fee, bounded by the protocol maximum. The
protocol does not add a separate annual fee.

Fee accrual is lazy and share based. For elapsed time:

```text
growth = (1 / (1 - annual fee rate)) ^ (elapsed / 365 days)
fee shares = supply * (growth - 1)
```

The growth rule is composable: processing one interval at once or dividing it across deposits,
redemptions, and explicit accrual calls produces the same economic fee, subject only to fixed-point
and indivisible share-wei rounding. Fractional share-wei and protocol-split remainders are retained
for later checkpoints rather than discarded. A configured 10% rate therefore produces exactly 10%
holder dilution after one full 365-day year with no intervening supply change.

Every contribution, basket mint, withdrawal, and redemption checkpoints fees before changing share
supply. A fee-rate update first closes the old-rate interval at the transaction timestamp, including
when it has accrued less than one share-wei, and only future time uses the new rate.

New fee shares are split between:

- Manager fee recipient.
- Protocol fee collector.

Manager shares follow the fee state:

- `Accruing`: manager shares are delivered normally.
- `Escrowed`: a strategy challenge is active and manager-fee withdrawals are locked.
- `Suspended`: the challenge deadline has passed and challenge-window fees are forfeitable.

Timely restoration lets the manager stop the challenge and withdraw accrued fees. Missing the
deadline credits 50% of the lost challenge-window fees to the caller and skips minting the rest.
Fee-rate changes are allowed only while strategy is unlocked and the portfolio is inside completion
bands, and never apply retroactively.

## Onchain Thesis

The initial thesis is stored in contract storage as thesis version zero.

Managers can append amendments. They cannot edit or delete historical versions. A thesis amendment is descriptive only and does not weaken enforced safety parameters.

Each thesis version stores:

```solidity
struct ThesisVersion {
    uint64 timestamp;
    address author;
    bytes32 portfolioHash;
    string text;
}
```

Each thesis text is capped at 2,048 bytes.

## Frontend

The frontend is a Next.js App Router application using:

- TypeScript strict mode.
- RainbowKit.
- wagmi.
- viem.
- TanStack Query.
- Direct RPC contract reads.

The current dashboard shows:

- Vault name and symbol.
- Vault address state.
- Wallet connection state.
- Target-proposal readiness and cooldown.
- Last and next strategic target proposal times.
- Completion-band, strategic-rebalance, and challenge status.
- Fee state, forfeited manager fees, and claimable challenge rewards.
- Authorized executor count.
- Share supply.
- Manager fee.
- Protocol share of fee shares.
- Target asset allocation.
- Thesis text.
- Manager and fee recipient.
- Immutable safety limits.
- Manager action readiness.

The UI deliberately follows common DeFi product patterns:

- Wallet connection is in the top-right operational area.
- Readiness and risk state appear above actions.
- Portfolio and safety constraints are adjacent.
- Disabled manager actions explain eligibility through state.
- The page remains usable in demo mode without a deployed address.

References used for UI direction:

- Uniswap app and support docs: https://app.uniswap.org and https://support.uniswap.org
- Uniswap protocol docs: https://docs.uniswap.org
- Aave app and help docs: https://app.aave.com and https://aave.com/help
- Aave developer docs: https://aave.com/docs

The practical takeaway for this MVP is not to copy another protocol's visuals. It is to adopt the useful UX posture: wallet state is obvious, risk state is near actions, transaction constraints are visible before signing, and the screen is built for repeated operational use.

## Environment Variables

```text
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
NEXT_PUBLIC_RH_RPC_URL=
NEXT_PUBLIC_RH_TESTNET_RPC_URL=
```

These optional values configure wallet connectivity and RPC endpoints. Contract and token addresses
are not environment variables. The frontend and deployment utilities share the checked-in
`app/src/config/robinhood-testnet.json` file. The frontend reads `allVaults()` from the factory
recorded there; individual OTF addresses are discovered from the factory.

Robinhood testnet deployment requires only the private signer as secret configuration:

```text
DEPLOYER_PRIVATE_KEY=
```

Keep that value in the ignored `.env.deploy.local` file. Never add it to the address JSON. The
deployment script reads its chain, treasury, approved assets, price feeds, and external protocol
addresses from `app/src/config/robinhood-testnet.json`. It rejects an empty protocol catalog unless
`ALLOW_EMPTY_PROTOCOL_CONFIG=true` is set explicitly.

`USDG_ADDRESS` and all four Uniswap V3 addresses are required because every new OTF receives an
official OTF/USDG pool during its factory transaction. `UNISWAP_V2_ROUTER_ADDRESS` remains
optional. When present, the deployment script deploys `UniswapV2Adapter` and `OTFEntryRouter`, approves the
adapter for both trade and entry use, authorizes the executor and entry router as adapter callers,
and writes all public addresses into the shared address JSON. No testnet liquidity address is guessed or
hardcoded; verify both values against the intended deployment before running the script.

The script deploys `OTFV3MarketRegistry`, permanently configures it on the factory before the first
OTF can be created, and writes the registry, swap-router, and quoter addresses into the shared JSON.
OTF creation creates or adopts the canonical Uniswap V3 OTF/USDG pool at the fixed 0.05% fee tier,
initializes a new pool from NAV per share, and records it as the immutable official pool. No
liquidity is taken from the OTF. The manager adds liquidity separately and owns the resulting
Uniswap position; the pool association cannot be removed or replaced.

Robinhood Chain Testnet does not currently publish official Chainlink equity-feed proxies. For
development, deploy the protocol with `ALLOW_EMPTY_PROTOCOL_CONFIG=true`, compile the current
artifacts, then configure the five UI catalog assets with self-updating synthetic USD feeds:

```bash
corepack pnpm contracts:solc
corepack pnpm contracts:configure:robinhood-testnet-mocks
```

Each feed derives a deterministic synthetic path from chain time: a `$1.00` baseline, `+5` bps of
daily drift, and bounded `+/-50` bps pseudo-random movement that changes every five minutes. Every
read reports the current block timestamp as `updatedAt`, so testnet OTF operations do not depend on
an owner, keeper, cron job, or manual refresh transaction. The answer remains stable within a
timestamp, and the owner-only `setAnswer` function is retained solely as an optional baseline
reset.

The configurator records every deployment and registry transaction in
`app/src/config/robinhood-testnet.json`. It automatically replaces legacy version-1 manually updated
feeds and retains version-2 self-updating feeds on later runs. The synthetic path is intentionally
predictable from public chain data; these feeds are UI and integration fixtures, not Chainlink,
market data, or suitable adversarial-test price sources.

Robinhood Chain Mainnet uses the official Chainlink proxy directory instead. Its tokenized-equity
answers already include the Stock Token `uiMultiplier()` for dividends, splits, and other
corporate actions; consumers must not multiply by `uiMultiplier()` again. See the
[Chainlink Robinhood tokenized-equity documentation](https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood).

No production Robinhood Chain addresses are hardcoded. Any production address must be verified against official Robinhood Chain documentation before use.

## Local Development

Install dependencies:

```bash
corepack pnpm install
```

Compile Solidity with the local solc-js fallback:

```bash
corepack pnpm contracts:solc
```

Run app checks:

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
```

Run the frontend:

```bash
cd app
corepack pnpm dev --hostname 127.0.0.1 --port 3000
```

Foundry commands:

```bash
corepack pnpm contracts:security
cd contracts
forge fmt --check
forge build
forge test
forge test --match-contract ProtocolFuzzTest -vv
forge test --match-contract ProtocolInvariantTest -vv
forge coverage --report summary
```

`contracts:security` forces a clean production build and enforces warning-free Foundry and Solhint
security lint, canonical vault/module storage, deployable bytecode sizes, and restricted
delegation surfaces.

## Tests

The Solidity suite contains broad deterministic, fuzz-property, and stateful invariant coverage.
Default settings in `contracts/foundry.toml` run every fuzz property 1,000 times and each invariant
through 128 sequences of 64 generated actions.

Deterministic coverage includes:

- First rebalance before seven days reverts.
- First rebalance exactly seven days after creation succeeds.
- Second rebalance before another seven days reverts.
- Second rebalance exactly seven days later succeeds.
- A failed rebalance does not reset the cooldown.
- A thesis amendment does not reset the cooldown.
- Fee accrual does not reset the cooldown.
- The manager cannot shorten the cooldown.
- A vault may be created with a cooldown longer than seven days.
- The factory rejects a cooldown shorter than seven days.
- Factory clone prediction, enumeration, ownership, treasury transfers, global bounds, and
  atomic creation rollback.
- Proportional basket minting and redemption, delegated redemption, fee dilution, fee splits,
  role transfers, and thesis history.
- Oracle price validity, timestamps, round completeness, staleness, and missing feeds.
- Asset, weight, count, turnover, NAV-loss, target-deviation, adapter, trade, approval-clearing,
  and atomic rollback protections.
- Draft ERC-7621 views, previews, actions, interface detection, ownership, and exact events.
- Challenge breaches, natural and traded recovery, deadline forfeiture, caller rewards,
  fee resumption, and deposits and withdrawals during challenge states.
- Authorized executor success, strategy isolation, unsupported-token and adapter rejection,
  trade-size enforcement, recipient confinement, and executor clearing on manager transfer.
- Atomic USDG-only entry, unused-input refunds, entry-adapter authorization, exact-output bounds,
  expired entry rejection, and Uniswap-compatible direct and USDG-hop adapter behavior.
- Atomic USDG redemption, exact share approval, per-leg and aggregate minimum outputs, deadline
  enforcement, and complete rollback when an exit adapter or quote is invalid.
- Canonical vault/module storage, immutable module identity, runtime code-hash integrity,
  direct-module-call rejection, and callback isolation.

Fuzz properties cover arbitrary valid and invalid cooldowns, target weights, basket share
amounts, fee rates and elapsed time, oracle prices, share transfers, and manager addresses.

The stateful handler mixes basket mints, redemptions, share transfers, fee accrual, thesis
amendments, valid rebalances, and intentionally invalid rebalances. Invariants continuously
assert share-supply accounting, valid mandate weights, positive backing and NAV, cleared
executor approvals and balances, cooldown/history consistency, append-only administrative
history, and immutable factory provenance.

## Known Limitations

- No production Robinhood Chain addresses are verified or configured.
- A Uniswap V2-compatible adapter and USDG entry router are implemented but remain undeployed until verified testnet addresses are supplied.
- RFQ, proprietary AMM, and order-book adapters are not implemented.
- USDG entry currently quotes direct USDG-to-constituent pools; more advanced route discovery is not implemented.
- The generated ABI package is currently a hand-maintained MVP subset.
- The contracts are intentionally compact for MVP exploration and have not been gas optimized.
- ERC-7621 remains a draft and its interface may change.

## Next Safest Milestone

The next safest milestone is an independent smart-contract audit, followed by a testnet
deployment rehearsal with verified Robinhood Chain addresses, live oracle feeds, and an
approved adapter integration.
