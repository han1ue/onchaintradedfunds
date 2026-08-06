# OTF Protocol Security Specification

Status: MVP security baseline

This document defines the required security properties of the Onchain Traded Funds contracts.
`MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative requirements.

The Solidity contracts and automated checks are authoritative when this document and deployed
bytecode differ. A deployment MUST NOT claim compliance with this specification unless every
required verification gate passes for the exact commit and compiler configuration being deployed.

## 1. Security objectives

An OTF MUST:

1. Hold only its tracked constituent portfolio as accounting backing.
2. Issue and redeem shares proportionally against that portfolio.
3. Separate strategy authority from constrained trade execution authority.
4. Prevent managers and executors from making arbitrary calls or transferring portfolio assets to
   arbitrary recipients.
5. Fail closed when required oracle data is missing, invalid, incomplete, future-dated, or stale.
6. Keep strategic target changes, partial trade execution, and rebalance completion as distinct
   state transitions.
7. Preserve deposits and proportional withdrawals during challenge and fee-suspension states.
8. Make the configured strategy module immutable for the lifetime of the vault implementation.
9. Keep the vault and strategy storage layouts identical by construction.

## 2. Contract architecture

### `ManagedOTFVault`

The vault is the custody and share-accounting boundary. It:

- Holds constituent tokens.
- Stores all mutable OTF state.
- Issues the ERC-20 OTF share.
- Handles proportional contribution and withdrawal.
- Accrues protocol and manager fee shares.
- Exposes ERC-7621-compatible views, actions, and events.
- Routes only an explicit set of state-changing and read-only strategy selectors to the fixed strategy module.

The vault fallback MAY delegate the explicitly allowlisted strategy-history views and MUST reject
every other unknown selector.

### `ManagedOTFVaultStrategy`

The strategy module contains:

- Manager fee-rate changes.
- Executor authorization changes.
- Weight-band changes.
- Strategy-rationale staging and version history.
- Manager fee withdrawal orchestration.
- Strategic target proposals.
- Constrained partial trade execution.
- Rebalance completion.
- Exact-zero retired-asset pruning.
- Challenge creation, resolution, and deadline synchronization.

The module executes using `delegatecall`, so it operates on the calling vault's storage and
preserves the original external caller.

The module MUST reject direct calls made against the module contract itself.

### `ManagedOTFVaultStorage`

This abstract contract is the sole canonical persistent-storage definition for both the vault and
strategy module.

- Both contracts MUST inherit it.
- Derived contracts MUST NOT declare additional non-immutable state.
- Existing fields MUST NOT be reordered, removed, or have their types changed.
- New persistent fields MUST be appended to this base only.
- Any storage-layout change requires a new security review and complete test run.

### `PortfolioCalculator`

The calculator is stateless. It MAY read token balances, token decimals, registries, and oracle
feeds. It MUST NOT transfer assets, approve spenders, or mutate vault state.

### `RebalanceExecutor`

The executor is a settlement boundary called only by factory-recognized OTFs. It:

- Verifies that the adapter is approved.
- Pulls the exact approved input amount.
- Calls the typed adapter swap function.
- Measures output by balance delta.
- Returns output to `msg.sender`, which MUST be the OTF.

It MUST NOT accept a caller-selected output recipient.

### `OTFEntryRouter` and entry adapters

The optional entry router converts a configured settlement token into the exact proportional
basket required to mint a requested number of OTF shares. It is outside the vault's custody and
strategy authority boundaries. It MUST:

- Accept only vaults registered by the configured factory.
- Preview and acquire the exact live basket in one atomic transaction.
- Use only entry adapters approved in the router's independent allowlist.
- Limit each adapter to an explicit maximum settlement input and clear approvals afterward.
- Verify adapter-reported input, observed input, and exact output balance deltas.
- Mint through the vault's proportional `mintWithBasket` function and verify returned amounts.
- Refund unused settlement tokens and retain no user-funded balance after successful entry.
- Redeem an exact approved share amount through the vault's proportional exit before performing any settlement swaps.
- Enforce per-leg and aggregate minimum settlement outputs for atomic settlement-token exits.
- Never change targets, fees, roles, challenge state, or rebalance state.

An entry adapter MAY use a multi-hop venue path. A rebalance adapter MAY similarly route through
USDG internally, but the vault-visible rebalance endpoints MUST remain active constituents and the
final output MUST return to the vault through `RebalanceExecutor`.

## 3. Delegatecall requirements

The strategy delegation boundary MUST satisfy all of the following:

1. The module is deployed in the vault implementation constructor.
2. The module address is stored as an immutable.
3. There is no setter, upgrade function, beacon, or governance replacement path.
4. The module's runtime code hash is captured as an immutable at construction.
5. Every delegated call verifies the current module code hash against the expected code hash.
6. The delegation target is never read from calldata or manager-controlled storage.
7. Only explicit vault wrapper functions may invoke delegation.
8. Revert data and return data are forwarded unchanged.
9. The module and vault use the same reentrancy slot from the canonical storage base.
10. Module-to-vault callbacks MUST require `msg.sender == address(this)`.

The following selectors are allowed to delegate:

| Selector | Required authority |
| --- | --- |
| `setNextStrategyRationale(string)` | Manager |
| `proposeStrategy(address[],uint256[],string)` | Manager |
| `setManagerFeeBps(uint16)` | Manager |
| `setExecutor(address,bool)` | Manager |
| `setWeightBands(uint16,uint16)` | Manager |
| `rebalance(address[],uint256[])` | Manager |
| `activatePendingStrategy()` | Manager |
| `cancelPendingStrategy()` | Manager |
| `executeRebalanceTrades(TradeInstruction[])` | Manager or authorized executor |
| `completeStrategicRebalance()` | Permissionless |
| `flagOutOfBand()` | Permissionless |
| `resolveOutOfBandChallenge()` | Permissionless |
| Strategy-history getters | Read-only |

No generic `execute(address,bytes)`, `delegate(address,bytes)`, or equivalent selector is allowed.

## 4. Authority model

### Protocol owner

The protocol owner MAY:

- Approve or remove supported assets.
- Configure price-feed mappings.
- Approve or remove trade adapters.
- Set the protocol-wide minimum target weight within its hard bounds.
- Transfer registry or factory ownership using their defined controls.

The protocol owner MUST NOT:

- Transfer assets from an OTF.
- bypass OTF share-holder redemption rules.
- shorten an existing OTF cooldown.
- replace an OTF's strategy module.

### Protocol treasury

`FeeCollector` is the sole source of truth for the protocol treasury. The factory MAY expose
collector-backed treasury views but MUST NOT maintain independent treasury-transfer state.
Treasury transfer MUST use the collector's two-step acceptance flow.

### Manager

Each OTF has exactly one manager. The manager MAY:

- Select constituents, target weights, and allowed weight bands.
- Change the manager fee within the protocol maximum.
- Add and remove authorized executors.
- Receive execution permission automatically, remove or restore their own permission, and execute
  constrained trades while authorized.
- Propose target changes with an inseparable strategy rationale.
- Start manager and fee-recipient transfers.

The manager MUST NOT:

- Make arbitrary external calls from the OTF.
- Transfer constituent assets to an arbitrary recipient.
- approve arbitrary spenders.
- use unsupported assets or adapters.
- bypass oracle, slippage, turnover, NAV-loss, or target-improvement checks.
- shorten the immutable target-change cooldown.

The manager remains accountable for challenge, forfeiture, and caller-reward outcomes regardless
of whether the manager or an executor submitted a trade.

### Authorized executor

The manager MUST be authorized automatically at OTF initialization and after manager transfer. The
manager MAY remove or restore their own executor permission and MAY authorize multiple additional
executors, subject to the protocol cap.

An executor MAY only call `executeRebalanceTrades` and permissionless functions available to any
address. It MUST NOT:

- Change constituents, weights, bands, fees, strategy rationale, manager, or fee recipient.
- Add or remove executors.
- choose a settlement recipient.
- withdraw OTF assets.
- make arbitrary calls or approvals.
- receive a bounty or reimbursement from OTF assets.

All prior executor authorizations MUST be cleared whenever the manager changes through either
ownership transfer path. The new manager MUST then become the sole authorized executor.

### Share holder

A share holder MAY:

- Contribute the exact proportional live basket.
- Transfer OTF shares.
- Withdraw the proportional live basket.

Contributions and withdrawals MUST remain enabled during active or overdue challenges.

## 5. Portfolio and trade invariants

For every successful constrained trade batch:

1. Every `tokenIn` and `tokenOut` is a current constituent.
2. Every asset remains approved by the asset registry.
3. Every adapter is approved by the factory.
4. The input amount is nonzero and input differs from output.
5. Required oracle prices are valid and fresh.
6. Batch oracle-valued turnover does not exceed `maxTurnoverBps`.
7. Explicit adapter output is at least `minAmountOut`.
8. Oracle-valued output loss does not exceed `maxNavLossBps`.
9. Total post-trade NAV loss does not exceed `maxNavLossBps`.
10. Total portfolio distance from target strictly decreases.
11. No individual constituent moves farther from its target.
12. Output returns to the OTF.
13. Temporary input approval is exact and is cleared after execution.
14. The executor and adapter retain no unintended portfolio balance.

If any final check fails, the complete transaction MUST revert, including token transfers and
approvals.

Multiple partial transactions MAY be used to reach one target. Each transaction MUST independently
satisfy every invariant above.

For every successful settlement-token entry:

1. The requested share amount and aggregate maximum input are nonzero.
2. The deadline has not expired.
3. The OTF is registered by the configured factory.
4. The swap array exactly matches the live constituent array.
5. Every non-settlement leg uses an independently approved entry adapter.
6. The sum of per-leg maximum inputs and direct settlement requirements does not exceed the user's aggregate maximum.
7. Every acquired constituent amount exactly equals the current `previewMint` requirement.
8. The deposited basket and minted share amount are atomic.
9. Temporary adapter and vault approvals are cleared after successful execution.
10. Unused settlement tokens are refunded to the payer.

AMM price and oracle NAV equality is intentionally NOT an invariant. The entrant selects maximum
pool execution cost; the vault protects existing holders by accepting only the exact proportional
basket.

For every successful settlement-token exit, the router MUST verify the OTF is factory-registered,
validate all adapters before burning shares, receive exactly the basket amounts reported by the
vault, return every swap output to itself, satisfy every per-leg minimum and the aggregate minimum,
and transfer the exact aggregate settlement output to the selected receiver. Any failure MUST
revert the share burn, basket transfers, swaps, and approvals atomically.

## 6. Strategy lifecycle

### Target proposal

`proposeStrategy(newTokens, newWeights, rationale)` records a pending target and rationale in one
call. Draft ERC-7621 callers MAY instead stage the rationale with `setNextStrategyRationale` and
consume it through `rebalance(newTokens, newWeights)`. Neither path changes the active target,
implies that trades ran, or implies that reserves match the proposed target.

A proposal requires:

- Manager authority.
- A non-empty rationale no longer than 2,048 bytes.
- A semantic constituent or weight change; identical and reorder-only targets MUST revert.
- The configured portfolio cooldown and fixed 14-day strategy cooldown to have elapsed.
- No active challenge.
- No unfinished strategic rebalance.
- The previous target's completion bands to be satisfied.
- Valid portfolio shape and approved assets.
- At least one constituent, with every included target at or above the factory's live protocol-wide minimum target weight. The factory owner MAY update that minimum within 1–10,000 basis points; the initial value is 100 basis points (1%). Changes apply only when an initial or proposed target is validated and MUST NOT invalidate an active portfolio or trigger a challenge retroactively.
- Any constituent omitted from the proposal remains tracked at a zero target until its reserve is
  liquidated exactly to zero after activation.
- Proposed turnover within the configured limit.

It locks the rationale, emits `TargetWeightsProposed`, and leaves canonical strategy history
unchanged. The standard `Rebalanced` event MUST NOT be emitted until the target becomes active.

### Delayed activation

The active constituents and target weights MUST remain unchanged for at least 48 hours after a
proposal. Deposits and proportional redemptions MUST remain available during this notice period.
After the deadline, only the manager MAY call `activatePendingStrategy()`. Activation MUST
revalidate asset approval, oracle freshness, portfolio shape, turnover, challenge state, fee state,
and completion bands before changing the active target. It emits the standard `Rebalanced` event
and `TargetWeightsActivated`, appends the canonical strategy version and target snapshot, but
performs no trades. Only the manager may cancel a pending proposal, and manager transfer MUST
cancel any proposal authored under the previous authority without appending history.

### Trade execution

The manager or an authorized executor MAY submit multiple constrained partial trade batches toward
the current target.

### Asset-revocation retirement

A registry revocation is a global, immediate signal and MUST NOT enter the manager's 48-hour
proposal delay. Every affected vault MUST treat the revoked asset's effective target as exactly
zero, renormalize the remaining approved positive targets proportionally to exactly 10,000 basis
points, and block all contribution and basket-mint paths, including previews. If no approved
positive-target constituent remains, every effective target is zero and the vault remains in a
deposit-blocked retirement state. Proportional
in-kind redemption and constrained sell-side wind-down MUST remain available; buy-side trades into
the revoked asset MUST remain forbidden. Any nonzero raw balance remains challengeable regardless
of percentage-band rounding. Once the exact balance reaches zero, the asset MUST be pruned and
primary deposits MAY resume if every remaining constituent is approved and has a positive target.

### Completion

`StrategicRebalanceCompleted` MUST be emitted only after actual oracle-valued portfolio weights are
inside every completion band and every zero-target constituent has an exact zero raw balance. A
successful strategic trade batch that reaches those conditions MUST prune retired constituents and
complete atomically after all final trade safety checks. Permissionless explicit completion remains
available when no trade is required or natural price movement restores the portfolio. Completion
marks the activated strategy version complete, resumes manager-fee withdrawals, and is the only
point that updates `lastCompletedStrategyTimestamp`;
proposals, failed trades, and partial trades MUST NOT update it.

## 7. Challenge and fee accountability

Anyone MAY flag a challenge only when fresh oracle-valued weights prove that at least one
constituent is outside its challenge band.

Every vault MUST configure a challenge grace period between five and thirty days. The five-day
minimum is intended to span scheduled equity-market weekends and holiday closures while preserving
a bounded response deadline.

```mermaid
stateDiagram-v2
    [*] --> Normal
    Normal --> Challenged: Fresh prices prove a challenge-band breach
    Challenged --> Normal: Timely restoration inside completion bands
    Challenged --> Overdue: Five-day minimum period expires
    Overdue --> Suspended: State change forfeits challenge-window fees once
    Suspended --> Normal: Late restoration inside completion bands
```

During a challenge:

- Target changes are locked.
- Manager-fee withdrawals are locked while the challenge is active.
- Corrective constrained trades remain available and MUST resolve the challenge atomically when
  their final fresh oracle-valued weights are inside every completion band.
- Natural price recovery MAY restore compliance.
- Contributions and withdrawals remain available.

Starting a challenge MUST first crystallize the entire valid fee interval through the challenge
start timestamp. This applies whether `flagOutOfBand()` or a manager fee-withdrawal attempt detects
the breach. Previously earned or minted fees MUST NOT be included in later challenge forfeiture.

If the portfolio is restored inside every completion band on or before the deadline, the challenge
caller MUST receive no reward. The manager receives the full unminted fee interval from challenge
start through timely resolution, and the fee timestamp MUST prevent any interval from being minted
twice.

If the grace deadline is observed after expiry:

- Manager fees from the challenge window are forfeited.
- 50% of the forfeited amount becomes a claimable reward for the challenge caller.
- The remaining 50% is never minted.

Forfeiture and reward balances update only when a state-changing transaction first processes an
overdue challenge; they do not increase automatically with wall-clock time. The forfeiture interval
MUST end at the recorded deadline, and processing MUST be an idempotent one-time transition for the
active challenge. `claimChallengeReward()` MAY process that transition before reading the caller's
reward balance. It MUST checkpoint any normally accruing fee interval against the pre-reward share
supply before minting the full reward balance and resetting it to zero. Later calls and other
accrual paths MUST NOT increase either the forfeiture total or the caller reward for the same
challenge. No separate deadline-synchronization entry point is required.

Restoration to completion bands resumes only future manager-fee accrual.

Executors receive no protocol-funded compensation. A manager MAY compensate an executor outside
the OTF from the manager's own assets or fee revenue.

## 8. Share-accounting invariants

1. Every operational state-changing entry point MUST revert before successful initialization.
2. Initialization MUST be non-reentrant.
3. Constituent-token callbacks during factory prefunding MUST NOT mint shares, change roles, or
   mutate strategy state at the clone's predicted address.
4. Initial supply MUST exceed the permanently locked minimum-liquidity shares.
5. Total supply MUST never return to zero.
6. Contributions MUST be proportional to current reserves and supply.
7. Contribution requirements round up.
8. Withdrawal outputs round down.
9. User-specified maximum inputs and minimum outputs MUST be enforced.
10. Sender and receiver balance deltas MUST equal expected amounts.
11. Fee-on-transfer, sender-taxed, and incompatible rebasing behavior MUST revert.
12. Tracked-asset donations become backing for all shares and MUST NOT create privileged claims.
13. Unsupported-token donations are excluded from accounting and cannot be rescued by the manager.
14. Fee growth MUST compose across time partitions so discretionary checkpoint cadence cannot
    materially change total fee dilution.
15. The configured annual rate MUST equal holder dilution over one full 365-day fee year.
16. Contributions, basket mints, withdrawals, redemptions, and reward mints MUST checkpoint normally
    accruing fees against the pre-change supply.
17. Fee-rate changes MUST close the old-rate interval at the transaction timestamp even if the
    resulting fee is less than one share-wei; the new rate MUST apply only to future time.
18. Fractional fee-share and protocol-split remainders MUST be retained across ordinary checkpoints.
19. Fee calculations MUST NOT cap elapsed time and then advance past an unprocessed remainder.

## 9. Oracle requirements

Every security-sensitive valuation MUST reject:

- Missing feeds.
- Nonpositive answers.
- Zero or future timestamps.
- Incomplete rounds.
- Answers older than `maxOracleStaleness`.
- Unsupported token or feed decimals.

The factory MUST reject a per-vault `maxOracleStaleness` above one hour. The value is fixed when
the vault is created.

The frontend MUST NOT substitute cached or offchain prices for onchain enforcement.

## 10. ERC-7621 status

The conformance baseline is the official Ethereum ERCs repository:

- [ERC-7621 draft specification](https://github.com/ethereum/ERCs/blob/2bc5bccf25aa06f98644c35fc92e6bf82947cfe2/ERCS/erc-7621.md)
- [Official draft interface and reference assets](https://github.com/ethereum/ERCs/tree/2bc5bccf25aa06f98644c35fc92e6bf82947cfe2/assets/erc-7621)

The pinned upstream snapshot is commit `2bc5bccf25aa06f98644c35fc92e6bf82947cfe2`.
ERC-7621 remains a draft, so any upstream change requires a new compatibility review.

The OTF exposes the pinned draft ERC-7621 function surface, interface ID `0xc9c80f73`,
ERC-173 ownership surface, and exact standard events:

- `Contributed`
- `Withdrawn`
- `Rebalanced`

Custom events supplement rather than replace standard events.

The implementation intentionally restricts contributions to an exact proportional live basket.
Increasing only one constituent can therefore make a contribution invalid instead of producing
monotonically non-decreasing shares. `totalBasketValue` reports a decimal-normalized sum of current
reserves, while contribution previews use proportional reserve-to-supply accounting rather than a
generalized valuation of arbitrary contribution vectors. These are intentional behavioral
deviations from the current draft.

The implementation also prevents ownership renunciation, as the draft expressly permits to avoid
permanent management lockout, and requires a constituent reserve to reach zero before removal.
Factory initialization always establishes nonzero locked liquidity before public contributions.

The project MUST describe itself as ERC-7621 interface-compatible with documented restrictions and
MUST NOT claim full or unconditional ERC-7621 compliance.

## 11. Required verification gates

Before deployment, the exact commit MUST pass:

```bash
corepack pnpm contracts:security
cd contracts
forge fmt --check
forge build
forge test
forge test --match-contract ProtocolFuzzTest -vv
forge test --match-contract ProtocolInvariantTest -vv
```

`contracts:security` MUST verify:

- Production Solidity passes Foundry lint with warnings denied and the independent Solhint
  security rules with zero findings.
- Vault storage equals the canonical storage-base layout.
- Strategy storage equals the canonical storage-base layout.
- Every production runtime is at most 24,576 bytes.
- Every production initcode is at most 49,152 bytes.
- The vault ABI has no generic `execute`.
- The strategy ABI has no initializer or upgrade surface.
- The local ERC-7621 function selectors, interface ID, events, and errors match the pinned official
  draft, and the vault ABI contains every required item.
- Module identity and code-hash views remain exposed.

The full suite MUST include deterministic, fuzz, invariant, malicious-token, executor-boundary,
delegatecall-context, oracle, challenge, fee-state, and ERC-7621 event tests.

## 12. Deployment and change control

Every deployment record SHOULD include:

- Git commit.
- Solidity compiler version.
- Optimizer and IR settings.
- Chain ID.
- Factory, implementation, strategy module, calculator, executor, registry, and treasury addresses.
- Runtime code hashes.
- Test and security-command results.
- Independent audit report references.

For production, factory, registry, and treasury authority MUST be assigned to reviewed multisig or
timelocked governance contracts rather than EOAs. Operational and treasury signers SHOULD be
separated, and all pending administrative changes MUST be monitored.

Any change to storage, delegation, authorization, token movement, fee math, oracle validation,
adapter execution, or challenge logic requires a fresh security review.

Passing this specification and its automated checks reduces known implementation risk. It does not
replace an independent professional audit, deployment review, monitoring, incident procedures, or
economic analysis.
