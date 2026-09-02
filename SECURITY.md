# Security

The project security policy, threat model, trust assumptions, and production blockers are maintained in the [documentation site](https://docs.onchaintradedfunds.com/security) and its [source document](docs/content/security.mdx).

The root-publishing multisig, buyback route executor, adapter manager, production ETH/USD oracle,
approved adapters, and configured Uniswap deployments are explicit trust boundaries. The current v2
scope is unaudited and deployed only on testnet. Fresh independent review is required before any
production use. Native ETH is accepted only by explicit entry/exit endpoints, normalized to the
router's immutable canonical WETH, and never passed to a vault or adapter leg.
