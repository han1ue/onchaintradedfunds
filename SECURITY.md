# Security

The protocol is pre-mainnet and unaudited. Do not deploy it to mainnet or use it with assets of value.

The current threat model, trust assumptions, and production blockers are maintained in the [security documentation](https://docs.onchaintradedfunds.com/security) and its [source file](docs/content/security.mdx). The normative contract invariants are in the [protocol security specification](docs/content/protocol-security-spec.mdx).

Important trust boundaries include the reward-root publisher, each vault's immutable expense beneficiary, the entry-router adapter manager, approved adapters and trading venues, and the production ETH/USD oracle used for team vesting. Native ETH is accepted only by explicit entry and exit functions and is converted to canonical WETH before it reaches vault or adapter logic.

Report vulnerabilities privately to the maintainers. Do not test against public deployments with real user funds.
