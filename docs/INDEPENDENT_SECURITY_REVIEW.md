# Independent Security Review Guide

This guide defines a reproducible scope for an independent human or AI review of the Onchain
Traded Funds contracts. Reviewers should treat implementation claims in project documentation as
hypotheses to verify, not evidence that a property holds.

## Review target

Review the exact Git commit, including:

- All production contracts, interfaces, libraries, types, mocks, and Foundry tests under
  `contracts`
- `contracts/foundry.toml`
- `scripts/check-contract-security.mjs`
- `docs/PROTOCOL_SECURITY_SPEC.md`

The frontend is not an authorization or accounting boundary and should be reviewed separately.

## Build assumptions

- Solidity compiler: exactly `0.8.30`
- IR pipeline: enabled
- Optimizer: enabled with one run
- EVM runtime limit: 24,576 bytes
- EVM initcode limit: 49,152 bytes
- Vaults: deterministic EIP-1167 minimal proxies
- Strategy module: fixed per implementation, used through explicit `delegatecall` wrappers

Do not review a different optimizer or compiler output as if it were the deployable artifact.

## Authority and trust model

Treat the following as untrusted:

- OTF share holders
- OTF managers and authorized executors
- Challenge callers and trade calldata
- User-supplied `AssetPricingConfig` values and explicit V3 execution paths/fee tiers
- Constituent-token callbacks and donated tokens
- Predictable clone addresses
- The frontend and indexer

Treat these as explicitly trusted dependencies whose compromise remains a protocol risk:

- Trusted Chainlink pair-map owner and configured base/quote/feed relationships
- Chainlink proxy implementations and Robinhood Stock Token `oraclePaused()` behavior
- Canonical V3 factory, WETH, USDG, selected pricing pools, and quote-token/USD feeds
- Factory owner and approved adapter governance
- Fee collector treasury
- Constituent-token and approved adapter implementations

`AssetRegistry` is not trusted: it is an optional ownerless discovery index and no vault may consult
it for authorization. Oracle and V3 registries validate a new selection only. Their later updates
must not redirect or disable a concrete source already pinned by an OTF. Chainlink's Robinhood Flags
registry can prove proxy authenticity/activity but not pair orientation; review the separate trusted
pair mapping accordingly.

For production, administrative roles should be separate multisigs or timelocked governance
contracts. An EOA-controlled registry, adapter allowlist, or treasury is not an acceptable
production configuration.

## Critical properties

Attempt to falsify each property:

1. No caller can extract tracked assets except through proportional withdrawal or constrained
   settlement that returns output to the OTF.
2. Minting cannot create an economically privileged claim through first-depositor, donation,
   rounding, zero-supply, prefunding, or pre-initialization attacks.
3. Redemption remains available without fresh oracles and during challenge or fee-suspension
   states.
4. A manager cannot make arbitrary calls, select arbitrary recipients or spenders, shorten
   cooldown, exceed fee caps, or bypass mandate limits.
5. An executor cannot mutate strategy or administration and cannot trade outside the manager's
   constrained path.
6. Every successful trade batch reduces target distance, moves no constituent farther from target,
   respects NAV-loss bounds, and leaves no temporary allowance.
7. Target proposal, partial execution, and completion remain separate state transitions with the
   required ERC-7621 and custom events.
8. Failed operations do not partially mutate balances, approvals, cooldowns, fee state, challenge
   state, or history.
9. Manager fee escrow is released only on timely compliance and burned after an observed missed
   deadline; suspended intervals are never accrued retroactively.
10. Vault and strategy storage layouts are identical and use the same reentrancy slot.
11. The strategy target and code hash cannot change, and direct module mutation cannot affect
    vault state.
12. A token callback during clone prefunding or initialization cannot mint shares or mutate state.
13. `FeeCollector` is the sole treasury authority; factory views cannot diverge from it.
14. OTF holding rebates scale the protocol portion only, use configured target weight, reach zero
    protocol share at the configured threshold, and fail closed to the base share on lookup failure.
15. The same mechanical asset rules apply without an administrator approval, quality, block,
    revocation, or removal state.
16. A direct Chainlink route matches exact asset/USD; a composed route matches both exact legs;
    spoofed and reversed relationships fail without consulting `description()`.
17. Every constituent pins its concrete normalized feed or canonical V3 wrapper, registry changes
    cannot redirect it, and no source falls back automatically.
18. V3 pricing accepts only the canonical factory's exact asset/WETH or asset/USDG pool and fee after
    initialization, observation-capacity, and full-history checks; V4 is absent.
19. Pricing and execution are independent: adapter data is an explicit path, not a market ID, and
    may use different pools and fees while preserving endpoints, settlement, deltas, and allowances.
20. Global and local deposit pauses compose correctly, reject non-factory local targets, affect
    direct and routed deposits only, and do not stop withdrawals, strategy operations, or fees.

## Delegatecall review

Trace every path to `_delegateStrategy` and verify:

- The target is an immutable, never caller-selected calldata or storage.
- Runtime code hash is checked before every delegation.
- No fallback delegates unknown selectors.
- Every delegated selector has the specified authority.
- The module cannot be initialized, upgraded, or called directly to mutate meaningful state.
- Vault and module declare no persistent state outside `ManagedOTFVaultStorage`.
- Revert and return data forwarding cannot convert failure into success.
- Module callbacks to the vault are callable only by the vault itself.

## Economic review

Analyze more than Solidity control flow:

- Fee-share dilution and long-dormancy behavior
- Rounding at low reserves and supply
- Oracle decimal combinations and low-value truncation
- Price manipulation within configured staleness
- Donation-driven weight changes and challenge griefing
- Repeated partial trades near the NAV-loss limit
- Adapter delisting while an OTF is active
- Inability to remove a constituent while any reserve remains
- Manager changes while fees are accrued or escrowed
- Trusted-pair-map compromise before a new selection, Chainlink Flags inactivity, and the fact that
  existing pins must not silently change
- Composed-route precision/staleness, Robinhood `oraclePaused()` handling, and missing sequencer
  uptime enforcement
- V3 observation-history readiness and manipulation within the TWAP window
- Divergence between pinned pricing venues and independently chosen execution routes
- Local-pause censorship and event/monitoring failure

## Required commands

Run from the repository root:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm contracts:security
corepack pnpm contracts:solc
cd contracts
forge fmt --check
forge test
forge test --match-contract ProtocolFuzzTest --fuzz-runs 10000
```

Run the stateful campaign with environment overrides:

```bash
FOUNDRY_INVARIANT_RUNS=512 FOUNDRY_INVARIANT_DEPTH=128 \
  forge test --match-contract ProtocolInvariantTest
```

Coverage under `via_ir` may produce imprecise source-anchor warnings. Use it to find missing test
areas, not as proof of safety.

## Known limitations

- The contracts are unaudited and must not be represented as production safe.
- ERC-7621 remains a draft; the project documents intentional compatibility deviations.
- Governance timelocks and multisigs are deployment requirements, not contracts in this repository.
- Constituents are restricted to mechanically checked, exact-transfer, exactly-18-decimal ERC-20
  balance semantics. Frontend quality labels do not relax or enforce this requirement.
- Oracle correctness and corporate-action handling remain external dependencies.
- Runtime and initcode sizes must be recalculated from the reviewed commit. The security gate blocks
  deployment whenever a production artifact exceeds the EIP-170 or EIP-3860 limit.
- Robinhood has no documented pair-addressed Chainlink Feed Registry; semantic pair verification is
  required for new Chainlink selections. Runtime Flags and sequencer checks are not implemented.
- Robinhood testnet synthetic feeds are noncanonical integration fixtures.
- Unsupported tokens sent to an OTF are intentionally not manager-recoverable.
- A funded constituent cannot currently be removed until its tracked reserve is exactly zero.

## Suggested reviewer output

For every finding, report severity, exploit preconditions, exact file and line, violated property,
minimal attack sequence, impact, existing test coverage, and a narrowly scoped remediation.

Separate confirmed vulnerabilities from design tradeoffs, centralization risks, unavailable
external assumptions, and speculative concerns. Do not issue a numerical score without explaining
the scoring rubric and residual-risk assumptions.
