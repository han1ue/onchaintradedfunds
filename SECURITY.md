# Security

The protocol is pre-mainnet. Do not deploy it to mainnet or use it with assets of value.

The [security documentation](https://docs.onchaintradedfunds.com/security) covers the threat model, trust assumptions, and production blockers ([source](docs/content/security.mdx)). The [protocol security specification](docs/content/protocol-security-spec.mdx) defines the required contract invariants.

The protocol trusts the reward-root publisher, each vault's fixed expense beneficiary, the entry-router adapter manager, approved adapters and trading venues, and the ETH/USD oracle for team vesting. Explicit entry and exit functions handle native ETH; vaults and adapters use canonical WETH.

Report vulnerabilities privately to the maintainers. Do not test against public deployments with real user funds.
