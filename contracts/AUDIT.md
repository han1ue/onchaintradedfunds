# Contract review status

The previous review report covered a superseded architecture and is no longer applicable.
That architecture and its custody model were removed rather than migrated.

The current fee-settlement v3 scope includes:

- `OTFToken`, `OTFLaunchManager`, and `OTFLaunchManagerDeployer`;
- `TeamMarketCapVesting`, `BuybackCollector`, and `MerkleRewardsDistributor`;
- `OTFFactory`, `ManagedOTFVault`, `OTFEntryExitRouter`, and both typed trade adapters.

This scope has not received an independent audit. Compiler, lint, unit, integration, fuzz/invariant,
deployment-rehearsal, bytecode-binding, and frontend checks in this repository are engineering gates,
not substitutes for an audit. See `docs/content/security.mdx` and
`docs/content/protocol-security-spec.mdx` for the current trust model and normative invariants.

The entry/exit-router review scope includes its immutable canonical-WETH boundary, exact-value
native minting, atomic WETH redemption and payout, donation preservation, callback/reentrancy rules,
checked native sends, and the invariant that native markers never enter `SwapLeg[]` adapter routes.
The collector review scope includes factory-only vault registration, accrual-time creator/buyback
accounting, beneficiary-only atomic settlement, exact WETH payment, canonical-pool buyback, and burn.
