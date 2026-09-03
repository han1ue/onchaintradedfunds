# Contract review status

These contracts have not received an independent audit. A previous report covered different contracts and a different custody model, so it does not apply to this codebase.

The review scope includes:

- `OTFToken`, `OTFLaunchManager`, `OTFLaunchManagerDeployer`, and `OTFLaunchRouter`;
- `TeamMarketCapVesting`, `BuybackCollector`, and `MerkleRewardsDistributor`;
- `OTFFactory`, `ManagedOTFVault`, and `OTFEntryExitRouter`;
- `UniswapV3Adapter` and `UniswapV4Adapter`.

Repository checks cover compilation, linting, unit and integration tests, fuzz and invariant tests, deployment rehearsal, bytecode binding, and frontend integration. These checks are engineering controls, not an audit.

Reviewers should pay particular attention to:

- canonical-WETH handling, native refunds, checked ETH sends, and callback reentrancy in the entry router;
- accounted-balance settlement, shutdown redemption, and fee-share rounding in vaults;
- factory-only fee-account registration and beneficiary-controlled atomic settlement in the collector;
- bootstrap-corridor enforcement, partial-fill settlement and refunds, atomic graduation, and permanently locked liquidity;
- spot-FDV vesting, oracle freshness, and beneficiary succession;
- adapter path validation, transient-balance isolation, and allowance cleanup.

See [`docs/content/security.mdx`](../docs/content/security.mdx) for the trust model and [`docs/content/protocol-security-spec.mdx`](../docs/content/protocol-security-spec.mdx) for normative invariants.
