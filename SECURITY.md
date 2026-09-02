# Security

The project security policy, threat model, trust assumptions, and production blockers are maintained in the [documentation site](https://docs.onchaintradedfunds.com/security) and its [source document](docs/content/security.mdx).

The root-publishing multisig, adapter manager, production ETH/USD oracle, approved adapters, and
configured Uniswap deployments are explicit trust boundaries. Each immutable expense beneficiary
chooses its own settlement routes, minimums, and deadline; there is no trusted buyback route
executor. The current v3 scope is unaudited and requires a fresh testnet deployment and independent
review before use. Native ETH is accepted only by explicit entry/exit endpoints, normalized to the
router's immutable canonical WETH, and never passed to a vault or adapter leg.
