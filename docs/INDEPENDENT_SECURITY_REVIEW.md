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
- Constituent-token callbacks and donated tokens
- Predictable clone addresses
- The frontend and indexer

Treat these as explicitly trusted dependencies whose compromise remains a protocol risk:

- Asset-registry owner
- Oracle-registry owner and configured feeds
- Factory owner and approved adapter governance
- Fee collector treasury
- Supported token and approved adapter implementations

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
- Asset or adapter delisting while an OTF is active
- Inability to remove a constituent while any reserve remains
- Manager changes while fees are accrued or escrowed
- Registry, oracle, and adapter governance compromise

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
- Approved assets are assumed to have plain ERC-20 balance semantics.
- Oracle correctness and corporate-action handling remain external dependencies.
- The vault runtime is close to EIP-170; the gate blocks oversized builds, but headroom is limited.
- Unsupported tokens sent to an OTF are intentionally not manager-recoverable.
- A funded constituent cannot currently be removed until its tracked reserve is exactly zero.

## Suggested reviewer output

For every finding, report severity, exploit preconditions, exact file and line, violated property,
minimal attack sequence, impact, existing test coverage, and a narrowly scoped remediation.

Separate confirmed vulnerabilities from design tradeoffs, centralization risks, unavailable
external assumptions, and speculative concerns. Do not issue a numerical score without explaining
the scoring rubric and residual-risk assumptions.
