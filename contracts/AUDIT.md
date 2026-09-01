# Contract review status

The previous review report covered the superseded pre-v2 architecture and is no longer applicable.
That architecture and its custody model were removed rather than migrated.

The current token-economics v2 scope includes:

- `OTFToken`, `OTFLaunchManager`, and `OTFLaunchManagerDeployer`;
- `TeamMarketCapVesting`, `BuybackCollector`, and `MerkleRewardsDistributor`;
- `OTFFactory`, `ManagedOTFVault`, `OTFEntryExitRouter`, and both typed trade adapters.

This scope has not received an independent audit. Compiler, lint, unit, integration, fuzz/invariant,
deployment-rehearsal, bytecode-binding, and frontend checks in this repository are engineering gates,
not substitutes for an audit. See `docs/content/security.mdx` and
`docs/content/protocol-security-spec.mdx` for the current trust model and normative invariants.
