# Onchain Traded Funds security review

## Review identity and working-tree state

- Review date: 2026-09-04.
- Audited commit: `87b01a6dc55515cf9b506430e640fc17c8980d97`.
- The working tree was clean at the start of the review: `git status --short` and the
  relevant diff were empty.
- This review added one isolated proof of concept,
  `test/audit/TeamVestingSpotManipulationPoC.t.sol`, and this report. No production contract
  was changed.
- The protocol is pre-mainnet and undeployed. This report is a code review of the supplied
  tree, not an independent audit, production sign-off, or guarantee that no other defect
  exists.

## Scope and exclusions

The review covered every production Solidity file under `contracts/src`:

- `OTFToken`, `OTFLaunchManager`, `OTFLaunchManagerDeployer`, `OTFLaunchRouter`, and
  `TeamMarketCapVesting`;
- `OTFFactory`, `ManagedOTFVault`, `ManagedOTFVaultStorage`, `OTFEntryExitRouter`,
  `UniswapV3Adapter`, and `UniswapV4Adapter`;
- `BuybackCollector`, `MerkleRewardsDistributor`, `VaultTypes`, all local interfaces, and all
  local libraries;
- `FakeETHUSDOracle`, treated as testnet-only code.

Security-relevant tests, compiler and coverage scripts, the Robinhood testnet deployment
script, generated ABIs, deployment configuration, and the Solidity CI workflow were also
reviewed. The review read `AGENTS.md`, `README.md`, `SECURITY.md`, `contracts/AUDIT.md`, and the
four requested protocol documentation pages before drawing conclusions.

OpenZeppelin and Uniswap source reached by production or integration code was inspected where
needed to confirm behavior. A complete audit of those upstream packages was outside scope. No
public RPC, deployed contract, block explorer, or other network service was used. Consequently,
the currently deployed Robinhood dependencies and their exact runtime ABIs were not verified.
Frontend behavior was outside scope except where generated ABIs and deployment configuration
affect contract integration.

## Commands and tools

All commands ran locally. The pinned Foundry executable was
`C:\Users\X1704\AppData\Local\Foundry\v1.7.1\forge.exe`.

| Check | Result |
|---|---|
| `git rev-parse HEAD` | `87b01a6dc55515cf9b506430e640fc17c8980d97` |
| `git status --short` and relevant diff at review start | Clean; no diff |
| `corepack pnpm contracts:solc` | Passed; compiled 28 production source files with solc 0.8.26 |
| `corepack pnpm contracts:security` | Passed for all production contracts and the testnet oracle |
| Default `forge test --summary` after adding the PoC | 129 passed, 0 failed; the configured 14 launch integration tests were skipped |
| `FOUNDRY_PROFILE=integration forge test --summary` | 143 passed, 0 failed, including all 14 real-V4 launch integration tests and the PoC |
| Focused `testFuzz` run with `--fuzz-runs 10000` | 2 tests passed with 10,000 cases each |
| `FOUNDRY_INVARIANT_RUNS=512`, `FOUNDRY_INVARIANT_DEPTH=128`, `--match-contract ProtocolInvariantTest` | 4 invariants passed; 512 runs and 65,536 calls per invariant, 0 reverts |
| Focused vault/factory tests | 52 passed, 0 failed |
| Focused router, adapter, collector, shutdown, and rewards tests | 47 passed, 0 failed |
| Merkle and deployment-configuration Node tests | 5 passed, 0 failed |
| `corepack pnpm contracts:coverage` | Passed; 143 tests ran under the coverage build |
| Generated ABI comparison | All 12 tracked generated exports matched fresh artifact ABI item sets |
| `forge fmt --check` and `git diff --check` after the PoC | Passed |

Advisory coverage was 87.89% of lines (1,597/1,817), 85.65% of statements
(1,987/2,320), 39.95% of branches (147/368), and 91.67% of functions (198/216). The
coverage script uses an `--ir-minimum` build and warns that its source maps are approximate.
Its instrumented code-size warnings do not describe the production artifacts. The production
security gate passed; the measured deployed sizes included 19,218 bytes for `ManagedOTFVault`
and 3,708 bytes for `OTFFactory`.

The bare `forge` command was not on `PATH`, so the pinned executable was invoked directly. This
was a tooling-path issue, not a failed test. Foundry 1.7.1 rejected an attempted
`--invariant-runs` command-line option before executing tests; the documented environment
variables were then used successfully. The security script printed a non-fatal update-check
error because network access was unavailable, but its local checks completed successfully. No
dependency was installed and no network access was requested.

Manual review, targeted calculations, execution traces, local EVM disassembly, and a Shanghai
Anvil reproduction supplemented the repository checks. Scanner output was used only as a lead.

## Architecture and trust boundaries

### Components and assets

| Component | Role and assets | Security boundary |
|---|---|---|
| `OTFToken` | Mints the fixed original supply of 1 billion OTF to the deployment holder; holders may transfer or burn OTF | Deployment must allocate the entire original supply correctly |
| `OTFLaunchManagerDeployer` | Deploys the launch hook with CREATE2 | Salt and constructor dependencies determine the hook address and permissions |
| `OTFLaunchManager` | V4 bootstrap hook, launch state machine, bootstrap NFT owner, permanent-liquidity NFT owner, and holder of locked OTF/WETH dust | Authenticates PoolManager callbacks and binds PoolManager, StateView, PositionManager, Permit2, OTF, and WETH as immutables |
| `OTFLaunchRouter` | User entry point for bootstrap buys and sells; implements the V4 unlock callback | Must settle PoolManager deltas exactly and enforce recipient, deadline, phase, and price boundaries |
| `TeamMarketCapVesting` | Holds 100 million OTF and releases ten 10-million-OTF tranches | Trusts the launch pool price, ETH/USD oracle, and beneficiary; checkpoints are permissionless and irreversible |
| `MerkleRewardsDistributor` | Holds the 700-million-OTF cumulative rewards allocation | The owner controls roots; leaves bind chain, distributor, account, and cumulative entitlement |
| `OTFFactory` | Clones and registers basket vaults | A deployment configurator sets the canonical router exactly once; clone initialization and collector registration occur in one transaction |
| `ManagedOTFVault` and storage | ERC-20 basket share token; holds up to 20 constituent tokens and accounts for fee shares | Only the canonical router may use routed mint/redeem; in-kind redemption is public; the creator has the documented shutdown power |
| `OTFEntryExitRouter` | Orchestrates token/native entry, exit, vault-to-vault swaps, and collector share sales | Its owner manages the adapter allowlist; it snapshots raw balances, checks caller deltas, and closes transient balances after callbacks |
| V3 and V4 adapters | Execute an exact-input route for the canonical entry/exit router | V3 authenticates every pool against the bound factory; V4 binds Universal Router, Permit2, PoolManager, and each PoolId |
| `BuybackCollector` | Custodies creator and buyback fee shares, converts them to WETH, pays the beneficiary portion, buys OTF, and burns only acquired OTF | Factory and router are one-time configured; only registered vaults may record shares; only the recorded beneficiary may settle |
| Local libraries and interfaces | Fee growth, exact token calls, V3 path parsing, V4 price conversion, constants, and cross-contract ABI definitions | Arithmetic, token return behavior, path decoding, and ABI agreement are shared assumptions |
| `FakeETHUSDOracle` | Fixed-price oracle deployed by the Robinhood testnet script | It is unsuitable for production. The reviewed script is explicitly testnet-specific; no production fallback to it was found |

The deployment script assigns 100 million OTF to vesting, 200 million OTF to the launch system,
and 700 million OTF to rewards. These allocations reconcile to the original 1-billion-OTF
supply.

### State-changing entry points and call sequences

- `OTFToken` inherits ERC-20 transfers, approvals, `burn`, and `burnFrom`. Its local entry point
  is the `tokenURI` view.
- `OTFLaunchManagerDeployer.deploy` creates the hook. The manager exposes `initializeLaunch`,
  the `beforeInitialize` and `afterSwap` callbacks, permissionless `finalizeGraduation`, and
  launch-state views. Its phase moves one way through `NotInitialized`, `BootstrapActive`,
  `GraduationReady`, and `Graduated`.
- `OTFLaunchRouter` exposes WETH and native buys, OTF sales, and `unlockCallback`. A user call
  enters `PoolManager.unlock`; the callback swaps and settles; the outer call may finalize a
  completed launch.
- `TeamMarketCapVesting` exposes beneficiary-transfer initiation, cancellation, and acceptance,
  plus permissionless `checkpoint`, beneficiary-only `claim`, and price/progress views.
- `MerkleRewardsDistributor` exposes owner-only root publication, permissionless third-party
  claims paid only to the leaf account, and inherited two-step ownership transfer.
- `OTFFactory` exposes one-time router configuration, permissionless `createVault`, and registry
  views. Creation clones the disabled implementation, initializes the clone, records it, and
  registers it with the collector atomically.
- `ManagedOTFVault` exposes one-time initialization, fee checkpointing, routed mint/redeem,
  public in-kind redemption, emergency shutdown, policy/accounting views, and inherited ERC-20
  share operations. Its lifecycle is uninitialized, active, then terminally shut down.
- `OTFEntryExitRouter` exposes owner-only adapter approval, token/native mint and redemption,
  vault-to-vault basket swaps, collector-only fee-share sales, a WETH-only native receive path,
  and inherited two-step ownership transfer. Adapter calls occur inside a router reentrancy
  boundary.
- Each adapter exposes `executeSwap` only to its immutable router. The V3 path calls
  SwapRouter02. The V4 path gives exact temporary approvals to Permit2 and the Universal Router,
  executes a V4 command, checks deltas, and clears approvals.
- `BuybackCollector` exposes one-time factory/router configuration, factory-only registration,
  vault-only fee accounting, and beneficiary-only settlement by redemption or share sale.
  Settlement consumes pending accounting inside one transaction; any downstream revert restores
  it.

External trust boundaries include arbitrary constituent ERC-20 implementations, approved
adapters, swap venues and their callbacks, WETH, Permit2, the ETH/USD oracle, user-supplied
receivers, and the deployment-selected dependency addresses and code hashes.

### Privileged roles

- The initial deployment/configuration account selects immutable dependencies and performs the
  one-time factory, collector, and router wiring. An incorrect selection cannot be upgraded in
  place.
- The adapter manager can add an arbitrary adapter that runs during routed operations. This is
  an intended trusted role; revocation is immediate.
- A vault creator fixes basket constituents, bootstrap units, fees, beneficiary, and thesis at
  creation, and may activate the documented terminal shutdown.
- Each expense beneficiary decides when and how to settle that vault's accrued fee shares.
- The rewards publisher can replace the cumulative Merkle root and therefore controls rewards
  eligibility, subject to existing claimed amounts.
- The team beneficiary controls beneficiary succession and receives unlocked team tokens, but
  cannot directly set the recorded milestone.

## Security invariants reviewed

1. **Supply and allocation:** OTF has no mint path after construction; burns only reduce live
   supply; the deployment allocation equals the original supply.
2. **Launch initialization:** only the canonical hook address and dependencies are used; the
   launch consumes no more than its fixed OTF budget; phase transitions are monotonic; PoolManager
   callbacks cannot be spoofed.
3. **Launch settlement:** each swap settles its exact V4 currency deltas; finalization occurs only
   at the exact terminal price and permanently accounts for the bootstrap position, permanent
   position, refunds, and burned OTF.
4. **Vesting:** a tranche becomes claimable only after the corresponding economically meaningful
   FDV milestone has been reached; an observation that exists only during an atomic manipulation
   must not create an irreversible unlock.
5. **Vault solvency:** accounted constituent balances never exceed actual balances; donations do
   not dilute or enrich share operations; transfer-tax, rebasing, and callback behavior cannot
   silently alter accounting.
6. **Share accounting:** mint and redeem previews match execution with the documented rounding;
   fee-share dilution is conserved between beneficiary and buyback accounts; shutdown and skipped
   assets cannot strand a claim that the implementation promises to preserve.
7. **Routing:** only a caller's declared input and the transaction's transient outputs are spent;
   pre-existing router dust is preserved; each adapter leg consumes and produces its reported
   exact delta; only the declared output may remain before refund and closure.
8. **Native routing:** `msg.value`, WETH wrapping/unwrapping, native refunds, and the native balance
   baseline reconcile exactly; unsolicited or forced ETH cannot be attributed to a caller.
9. **Adapters:** only the canonical router can call an adapter; paths begin and end at declared
   tokens; every pool and external dependency is authenticated; temporary allowances are cleared.
10. **Fee settlement:** only registered vault shares enter accounting; pending creator and buyback
    shares are neither duplicated nor lost; WETH splitting is proportional; only OTF acquired in
    the current buyback is burned.
11. **Rewards:** a proof cannot be replayed across accounts, distributors, or chains; cumulative
    claims cannot be paid twice or redirected by a third-party caller.
12. **Deployment:** compiler output, generated ABIs, configured hardfork, external runtime ABI,
    code hashes, and target-chain opcode support must agree before funds are accepted.

## Finding counts and overall assessment

| Severity | Count |
|---|---:|
| Critical | 0 |
| High | 1 |
| Medium | 0 |
| Low | 0 |
| Informational | 2 |

The review confirmed one High-severity design vulnerability: an atomic, zero-fee V4 round trip
can satisfy the spot-price vesting check and unlock the entire 100-million-OTF team allocation
for rounding dust. The executable PoC uses the repository's real V4 PoolManager and launch
contracts. It is not a hypothetical oracle concern.

No other exploitable contract vulnerability was confirmed. The two Informational items are a
deployment-target mismatch and a CI coverage gap. A separate V4 Universal Router ABI discrepancy
could be material, but the exact configured router runtime was unavailable locally; it is kept as
an open question rather than presented as a vulnerability.

| ID | Severity | Confidence | Component | Title |
|---|---|---|---|---|
| H-01 | High | High | Team vesting / V4 launch pool | Zero-fee atomic spot round trip bypasses every team market-cap milestone |
| I-01 | Informational | High, conditional on the stated Shanghai target | Compiler and deployment tooling | Production artifacts target Cancun despite the stated Shanghai deployment target |
| I-02 | Informational | High | Solidity CI | The "Run full Foundry suite" step skips the real-V4 launch integration suite |

## H-01: Zero-fee atomic spot round trip bypasses every team market-cap milestone

1. **Title, severity, and confidence**

   Zero-fee atomic spot round trip bypasses every team market-cap milestone. Severity: High.
   Confidence: High.

2. **Affected files, functions, and exact lines**

   - `contracts/src/TeamMarketCapVesting.sol:113-115`, `currentOtfPriceWethWad`, reads the current
     V4 `slot0` price.
   - `contracts/src/TeamMarketCapVesting.sol:139-143`, `liveFdvUsdWad`, multiplies that spot price
     by live total supply and ETH/USD.
   - `contracts/src/TeamMarketCapVesting.sol:146-153`, `checkpoint`, permissionlessly and
     irreversibly records all milestones implied by the instantaneous value.
   - `contracts/src/TeamMarketCapVesting.sol:160-166`, `claim`, transfers the recorded allocation
     to the beneficiary.
   - `contracts/src/OTFLaunchManager.sol:35` fixes the canonical pool LP fee at zero.
   - `contracts/test/audit/TeamVestingSpotManipulationPoC.t.sol:59-105` implements the atomic
     forward swap, checkpoint, reverse swap, and net settlement. Lines 168-197 set up and assert
     the exploit.

3. **Violated invariant**

   A permanent team-token unlock must represent a sustained, economically meaningful market-cap
   milestone. A price that exists only between two swaps in one V4 unlock callback must not unlock
   any tranche.

4. **Root cause**

   The vesting contract treats one permissionless observation of the canonical pool's
   instantaneous `slot0` as sufficient evidence. `unlockedAmount` is monotonic, so a transient
   observation cannot be corrected after the pool returns to its prior price. The launch pool has
   a zero LP fee, and V4 flash accounting lets a callback defer settlement until after it has
   performed both swaps. The attacker therefore pays only rounding loss rather than maintaining
   the manipulated price or supplying the forward-swap notional up front.

   The documentation explicitly describes use of spot price rather than a TWAP. This is therefore
   a vulnerable design requirement as well as an implementation issue.

5. **Attacker model and prerequisites**

   The canonical OTF/WETH pool must be graduated, the vesting contract must hold team OTF, and the
   ETH/USD oracle must return a valid, fresh answer. Any contract can call the permissionless
   checkpoint while inside its V4 unlock callback. An arbitrary actor can force the unlock for the
   beneficiary; the beneficiary or a cooperating actor can then claim it. The attacker does not
   need control of the ETH/USD oracle, PoolManager, or vesting contract.

6. **Step-by-step exploit sequence**

   1. The attacker enters `PoolManager.unlock` with a callback that targets the canonical pool.
   2. Inside the callback, it swaps 100 WETH of transiently accounted input for OTF, moving the
      spot price past all ten USD-FDV milestones.
   3. Before settling the PoolManager currency deltas, it calls `TeamMarketCapVesting.checkpoint`.
   4. `checkpoint` observes the temporary `slot0`, calculates at least $10 million FDV, and sets
      `unlockedAmount` to 100 million OTF.
   5. The callback reverses the swap with the OTF credit from step 2 and returns the pool to its
      prior region.
   6. It settles only the net round-trip delta. The tested path costs 198 wei of WETH and no OTF.
   7. The beneficiary calls `claim` and receives the complete team allocation even though the
      post-transaction FDV is below the first $1 million milestone.

7. **Concrete impact**

   The economic lock on 100 million OTF, 10% of the original supply, can be bypassed in one
   transaction for negligible cost. The beneficiary receives and can transfer or sell the full
   allocation without the intended market-cap conditions ever persisting. The attack does not
   redirect the allocation to an unrelated caller, but it defeats the protocol's entire team
   vesting restriction and can expose other holders to an unplanned supply release.

8. **Severity justification**

   High is appropriate because a core, irreversible distribution control over a substantial
   allocation is completely bypassed, with demonstrated negligible cost and no privileged oracle
   access. It is not Critical because the payout remains restricted to the designated beneficiary
   and the PoC does not steal unrelated user assets or make the protocol insolvent.

9. **Evidence or executable PoC**

   Run from `contracts`:

   ```powershell
   $env:FOUNDRY_PROFILE='integration'
   & 'C:\Users\X1704\AppData\Local\Foundry\v1.7.1\forge.exe' test --match-path test/audit/TeamVestingSpotManipulationPoC.t.sol -vvv
   ```

   Result: 1 passed, 0 failed; test gas was 3,899,764. The forward swap, checkpoint, reverse swap,
   and settlement occur in one transaction. The assertions establish that:

   - `unlockedAmount() == 100_000_000 ether`;
   - the attacker's WETH cost is exactly 198 wei;
   - the attacker's OTF cost is zero;
   - the post-transaction live FDV is below $1 million; and
   - a subsequent call by the beneficiary can immediately claim 100 million OTF.

   The PoC uses the pinned Uniswap V4 PoolManager, StateView, PositionManager, and Permit2 code.
   `FakeETHUSDOracle` supplies a deterministic ETH/USD value only; its trust properties are not
   used by the exploit.

10. **Minimal remediation**

    Do not make an irreversible unlock from a same-block pool spot observation. Replace the spot
    input with a manipulation-resistant price process and require the threshold to persist before
    finalization. A clean pre-mainnet design is a two-stage milestone process: record a candidate
    from a sufficiently long, liquidity-qualified time-weighted or independent price source, then
    finalize only after a delay using a second valid observation. Bind and validate every oracle
    dependency at construction.

    A pool-unlocked check, a different caller restriction, or a nonzero fee alone is insufficient.
    Flash liquidity can bracket two completed swaps around a checkpoint, and a beneficiary-only
    checkpoint would merely give the beneficiary exclusive access to the same bypass.

11. **Regression test**

    Keep the supplied PoC as a negative regression: the forward-swap/checkpoint/reverse-swap
    transaction must not increase `unlockedAmount`. Add a second test with two externally funded
    swaps bracketing the checkpoint, and tests showing that a threshold held for the full required
    observation period unlocks exactly one intended cumulative amount in both currency orderings.

12. **Residual risk**

    Any market-cap vesting mechanism retains oracle, market-liquidity, and governance risk. The
    chosen observation window and minimum-liquidity rules must be calibrated against the actual
    OTF markets. A long-window single-pool TWAP can still be manipulated if the pool is thin, so
    the production design should document its cost-of-manipulation analysis and response to oracle
    downtime.

## I-01: Production artifacts target Cancun despite the stated Shanghai deployment target

1. **Title, severity, and confidence**

   Production artifacts target Cancun despite the stated Shanghai deployment target. Severity:
   Informational. Confidence: High if the target still exposes only Shanghai opcodes; current
   Robinhood hardfork support was not checked over a network.

2. **Affected files, functions, and exact lines**

   - `contracts/foundry.toml:15-20` selects solc 0.8.26, Cancun, optimizer run 1, and IR for the
     default build.
   - `scripts/compile-contracts.mjs:31-50` independently selects Cancun for generated deployment
     artifacts.
   - `scripts/compile-contracts.mjs:89-96` omits compiler settings and metadata from the artifact,
     so later tooling cannot verify the intended EVM target from the file.
   - `scripts/deploy-robinhood-testnet.mjs:22-26` always invokes that compiler before deployment.
   - `scripts/deploy-robinhood-testnet.mjs:158-167` then connects those artifacts to the Robinhood
     testnet chain.

3. **Violated invariant**

   Creation and runtime bytecode sent by deployment tooling must contain only opcodes supported by
   the selected chain.

4. **Root cause**

   Commit `9c3f61f` changed both production compilers from Shanghai to Cancun and removed the
   compile-script comment that the Robinhood testnet rejected Cancun-only `MCOPY`. The integration
   profile legitimately needs Cancun for V4 transient-storage tests, but the same target is now
   used for deployable protocol artifacts.

5. **Attacker model and prerequisites**

   No attacker is required. The condition occurs when deployment or a user transaction sends
   current Cancun bytecode to an EVM that has not activated Cancun.

6. **Step-by-step failure sequence**

   1. The deployment script recompiles production contracts with `evmVersion: "cancun"`.
   2. solc 0.8.26 emits `MCOPY` on reachable code paths in several contracts.
   3. The deployment sends those artifacts to the stated Shanghai target.
   4. Contract creation or a later call reaches `MCOPY`; the EVM reports an unactivated opcode and
      reverts.

7. **Concrete impact**

   A deployment can fail, or a deployed contract can revert on otherwise valid calls. Local
   reproduction showed this for a routed adapter call and `OTFToken.tokenURI`. No asset loss was
   demonstrated, and the protocol is not deployed.

8. **Severity justification**

   Informational is appropriate because this is a pre-deployment compatibility and release
   engineering defect, not an attacker-controlled asset-loss path. It can still block a launch or
   make deployed interfaces unusable if the stated chain target remains Shanghai-only.

9. **Evidence or executable reproduction**

   Disassembly found `MCOPY` in the current deployed runtimes for `OTFToken`, `BuybackCollector`,
   `OTFFactory`, `ManagedOTFVault`, `UniswapV3Adapter`, and `UniswapV4Adapter`. On local
   `anvil --hardfork shanghai --port 8549`, a current `UniswapV3Adapter.executeSwap` transaction
   reverted with status 0 and `EvmError: NotActivated` at the runtime `MCOPY` at program counter
   `0x5b5`, before the mock V3 venue was called. Balance and allowance changes rolled back.
   Calling the current `OTFToken.tokenURI` bytecode on the same hardfork also failed with
   `NotActivated`.

10. **Minimal remediation**

    Confirm the target chain's active hardfork. If it remains Shanghai, restore Shanghai for the
    default Foundry profile and `compile-contracts.mjs`; retain Cancun only for the V4 integration
    profile. Record the compiler settings, including EVM version, in generated deployment
    artifacts and have the deployment script reject a mismatched target.

11. **Regression test**

    Add a release job that compiles exactly the deployment artifacts, deploys them to an Anvil node
    configured for the target hardfork, and calls representative dynamic-memory paths such as
    `tokenURI` and adapter execution. The job should also assert the recorded artifact EVM target.

12. **Residual risk**

    An Anvil hardfork test does not prove a particular live chain has matching semantics. Pin and
    record the chain's announced fork level for each deployment, and repeat the smoke test whenever
    the chain or compiler version changes.

## I-02: The "Run full Foundry suite" CI step skips the real-V4 launch integration suite

1. **Title, severity, and confidence**

   The "Run full Foundry suite" CI step skips the real-V4 launch integration suite. Severity:
   Informational. Confidence: High.

2. **Affected files, functions, and exact lines**

   - `contracts/foundry.toml:22` skips `test/OTFLaunchV4Integration.t.sol` in the default profile.
   - `contracts/foundry.toml:35-38` removes the skip only in the integration profile.
   - `.github/workflows/solidity-security.yml:98-118` runs the full, fuzz, and invariant commands
     without selecting the integration profile.

3. **Violated invariant**

   The CI step described as the full Foundry suite should execute the safety-critical integration
   tests that exercise the launch against the real pinned V4 implementation.

4. **Root cause**

   The default profile intentionally skips the expensive integration file, but the workflow has no
   separate step using `FOUNDRY_PROFILE=integration`.

5. **Attacker model and prerequisites**

   There is no direct attacker. A launch regression must be introduced in a change that continues
   to satisfy the mocked or unit-tested paths.

6. **Step-by-step failure sequence**

   1. A change breaks behavior specific to real PoolManager, PositionManager, Permit2, hook flags,
      or transient accounting.
   2. Pull-request CI invokes the default profile for every Forge command.
   3. Foundry honors the skip and never executes the 14 integration tests.
   4. The workflow remains green despite the untested regression.

7. **Concrete impact**

   CI can merge a launch or V4 integration regression that the repository already has tests to
   detect. This review's manual integration run passed all 14 tests, so no present contract defect
   follows from the gap.

8. **Severity justification**

   Informational is appropriate because this is a test-coverage defect with no demonstrated
   production exploit or current failing integration behavior.

9. **Evidence or executable reproduction**

   The default run reported 129 passing tests and skipped the integration file. Running
   `FOUNDRY_PROFILE=integration forge test --summary` reported 143 passing tests, a difference of
   exactly the 14 tests in `OTFLaunchV4Integration.t.sol`.

10. **Minimal remediation**

    Add a dedicated CI step that selects the integration profile and runs
    `test/OTFLaunchV4Integration.t.sol`. Keeping the default skip for faster unit and invariant
    campaigns is reasonable.

11. **Regression test**

    Make the integration step required and confirm its log contains the integration suite and its
    14 test cases. A small workflow check may also fail if the default skip exists without a
    corresponding integration-profile invocation.

12. **Residual risk**

    Local integration contracts still do not establish that live external addresses, bytecode,
    ABI versions, code hashes, or chain configuration match the test fixtures. Deployment smoke
    tests remain necessary.

## Open questions and assumptions requiring confirmation

### Universal Router V4 exact-input ABI

Follow-up, 5 September 2026: the configured testnet runtime uses four fields. Encoding and Permit2
cleanup corrections now have tests against the deployed venue contracts on a local fork. See
[testnet routing validation](TESTNET_ROUTING_VALIDATION.md). Mainnet runtime validation remains open;
the original assessment below describes the audit baseline.

This is not a confirmed finding. The local production interface declares a five-field
`UniswapV4ExactInputParams` with `maxHopSlippage` at
`contracts/src/interfaces/IUniswapV4.sol:13-20`. The V4 adapter and collector encode that type at
`contracts/src/UniswapV4Adapter.sol:168-178` and `contracts/src/BuybackCollector.sol:395-410`.
The installed `@uniswap/v4-periphery` source instead declares a four-field `ExactInputParams` at
`node_modules/@uniswap/v4-periphery/src/interfaces/IV4Router.sol:26-32`.

Tests use a mock that decodes the same custom five-field type. The real-V4 launch integration does
not instantiate the Universal Router, and local configuration binds the intended router by address
and code hash without including its verified source or ABI. A conditional decode of representative
five-field data as the installed four-field tuple changed `amountIn = 1 ether` into `416` and
`amountOutMinimum = 1 ether`; that route would be expected to revert rather than execute as
intended. Before deployment, obtain the verified source and ABI for the exact configured router
code hash and execute both adapter and collector routes against that runtime. Until that binding is
available, treating this mismatch as a vulnerability would be speculative.

### Chain and oracle assumptions

- Confirm whether the current Robinhood target has activated Cancun and `MCOPY`. I-01 is based on
  the stated Shanghai target and a deterministic Shanghai EVM reproduction, not a live RPC query.
- Confirm the production ETH/USD feed's `answeredInRound` semantics and whether the target chain
  requires a sequencer-uptime check. The present contract validates answer sign and timestamp but
  does not consume those additional signals. No incompatibility was established for the intended
  feed.
- Select and document the production OTF price source, observation duration, liquidity threshold,
  and milestone finalization process used to remediate H-01.
- Confirm the production multisig, adapter manager, team beneficiary, WETH, venue, Permit2, oracle,
  and code-hash values through an independent deployment review. They are intended trust inputs,
  not values this offline review could authenticate.

The Robinhood script deliberately deploys `FakeETHUSDOracle` at
`scripts/deploy-robinhood-testnet.mjs:265`. It writes a testnet-specific configuration and no
production deployment script or fallback was found. A future production deployment process should
require an explicit external oracle address and reject the fake oracle's runtime code hash.

## Untested or unreachable areas

- No public deployment, RPC fork, explorer source, or live dependency was used. Calls into the
  exact configured Universal Router and Robinhood runtime were therefore unreachable.
- No key-bearing deployment rehearsal or transaction against a public network was performed.
- Formal verification and symbolic execution were not performed.
- The complete suite exercises malicious, fee-on-transfer, rebasing, callback, and rejecting-token
  mocks, but it cannot cover every nonstandard ERC-20 implementation.
- Worst-case end-to-end gas for a 20-constituent vault with 40 routed legs was not measured against
  a target-chain block limit.

## Test, CI, and deployment gaps

- Branch coverage is 39.95%. Notable low-coverage areas include `OTFLaunchManager` at 25% branch
  coverage and `FeeGrowthMath` at 0% branch coverage under the advisory coverage build. The
  targeted fuzz and invariant campaigns cover their principal properties, but additional boundary
  tests would improve regression detection.
- Add focused negative factory tests for malformed configurations and implementation locking, plus
  the maximum-constituent gas case.
- I-02 describes the missing integration-profile CI invocation.
- I-01 describes the missing target-hardfork deployment gate and artifact EVM metadata.
- Record the exact Universal Router ABI and verified source alongside its pinned code hash, then add
  exact-runtime adapter and collector tests.
- The repository has testnet deployment tooling but no reviewed production deployment procedure.
  Production should require explicit dependencies, reconcile balances after every allocation, and
  reject test doubles.

## Significant hypotheses investigated and rejected

The following were investigated but are not findings:

- **Clone capture or reinitialization:** the implementation disables initializers, and the factory
  clones, initializes, records, and registers each vault in one reverting transaction. No external
  initialization window was found.
- **CREATE2 hook address capture:** deploying different code at the predicted address is prevented
  by the init-code hash. A same-code front run can at most consume the salt and cause deployment
  denial; it does not redirect assets or obtain configuration control. A predicted no-code hook
  cannot pass PoolManager's hook-permission callback behavior.
- **Vault donation inflation:** mint, redemption, and fee math use accounted balances. Raw donations
  are excluded, and exact pre/post checks reject transfer-tax, rebasing, and callback-induced
  discrepancies.
- **First-mint, rounding, fee, and low-supply extraction:** directional rounding, fee-share
  dilution, remainder handling, full redemption, automatic shutdown, and repeated checkpoint
  sequences were tested. The measurable annual-fee reset approximation was about 120,377 raw share
  units in a one-day 1e18-supply, 10%-annualized example, roughly 1.2e-13 share, and did not create
  a credible extraction path.
- **Skipped-constituent theft:** skipped assets remain accounted for later claims; masks and route
  legs are validated, and shutdown behavior is explicit. No caller could redirect another holder's
  skipped backing.
- **Router dust theft or callback mutation:** operations snapshot every tracked token, reconcile
  caller debits and credits, require exact adapter deltas, allow only the declared output, and run a
  second closure pass after refunds. Forced ETH and pre-existing WETH remain outside caller credit.
- **Malicious approved adapter:** an approved adapter is a documented trusted boundary, but router
  balance and caller-delta checks still prevented the tested attempts to consume pre-existing dust,
  falsify outputs, retain allowances, or leave undeclared tokens.
- **V3 or V4 pool spoofing:** V3 paths authenticate factory pools and immutables. V4 paths bind
  PoolManager and recompute PoolIds from the decoded keys. No path to substitute an unbound venue
  survived these checks.
- **Collector accounting loss or fake vault settlement:** factory registration, vault identity,
  beneficiary checks, atomic pending-account consumption, proportional WETH splitting, and
  delta-only OTF burning held under revert and donation tests.
- **Launch boundary, refund, or NFT extraction:** exact price bounds, oversized partial fills,
  both currency orderings, graduation finalization, bootstrap refunds, permanent-liquidity sizing,
  unsolicited token balances, NFT custody, and locked dust were exercised against real V4 code.
  No asset extraction or stuck-state path was confirmed.
- **Merkle replay or redirection:** leaves are double-hashed and bind chain ID, distributor,
  account, and cumulative entitlement. Anyone may relay a valid claim, but payment goes only to the
  bound account. Root-publisher control is explicit, not a privilege escalation.
- **Fake oracle leakage:** the fake oracle is compiled and deployed by the named testnet script, but
  no automatic production fallback to it exists in the reviewed tree.
- **Documented administrative powers:** adapter approval, reward-root publication, creator
  shutdown, expense settlement, and one-time deployment wiring were treated as trust assumptions.
  No path granting those powers to an unauthorized caller was found.

## Prioritized remediation

1. Replace same-block spot-price vesting and make the H-01 PoC fail before allocating team tokens.
2. Resolve the Universal Router ABI question against the exact pinned runtime and add adapter and
   collector integration tests for it.
3. Confirm the deployment chain's hardfork, compile production artifacts for that target, and add
   the Shanghai/Cancun release gate described in I-01.
4. Run the existing real-V4 integration profile in required CI as described in I-02.
5. Measure the maximum vault/route gas case and add the highest-value uncovered branch and factory
   negative tests.
6. Perform a separate production deployment review covering roles, code hashes, external ABIs,
   oracle behavior, allocation reconciliation, and smoke calls before accepting funds.
