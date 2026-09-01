# Security

The project security policy, threat model, trust assumptions, and production blockers are maintained in the [documentation site](https://docs.onchaintradedfunds.com/security) and its [source document](docs/content/security.mdx).

The adapter manager and every approved adapter are explicit settlement trust boundaries. The
current Robinhood testnet deployment uses the generic adapter architecture and its recorded router,
adapter, and factory bindings have been verified onchain. The 30 August 2026 review snapshot does
not cover this change; fresh review is required before any production use.
