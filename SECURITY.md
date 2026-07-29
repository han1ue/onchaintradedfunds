# Security

This MVP is not production ready and has not been audited.

## Responsible Disclosure

Report suspected vulnerabilities privately before public disclosure. Include reproduction steps, affected contracts, and the expected impact.

## Powers

The factory owner can approve or remove trade adapters for future rebalances and transfer factory ownership or treasury control through two-step flows. These powers cannot transfer vault assets.

Vault managers can amend thesis text, submit bounded atomic rebalances through approved adapters, and start two-step manager or fee-recipient transfers. Managers cannot make arbitrary vault calls, withdraw assets directly, shorten rebalance cooldowns, increase fees, or bypass immutable vault safety limits.

## Known Risks

Oracle correctness, stale data, adapter behavior, token issuer behavior, rounding, liquidity, and corporate-action handling remain critical risks. Proportional redemption intentionally does not depend on oracle reads. Unsupported token donations are not part of tracked NAV or redemption.

## Deployment Warning

Do not deploy to mainnet without professional audits, verified Robinhood Chain integration addresses, and additional integration testing against real adapters and price feeds.

