# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are investors evaluating, acquiring, monitoring, and redeeming positions in transparent onchain portfolios backed by tokenized stock assets. They need to understand what each OTF owns, how it has performed, what rules constrain it, who manages it, whether its oracle data is healthy, and when its portfolio may next change.

The secondary users are creators and managers who launch and operate OTFs. They need to define an initial thesis and allocation, configure policy-bounded safety limits, monitor their products, accrue fees, and propose target changes with a rationale that satisfies the protocol's rules.

## Product Purpose

Onchain Traded Funds is an experimental protocol for creating and using managed, tokenized-stock portfolio products onchain. Each OTF holds its own basket of mechanically valid 18-decimal ERC-20 assets with pinned pricing and issues fungible shares representing proportional ownership of that basket.

The product should let investors inspect a fund's portfolio, valuation, manager, thesis, operating rules, oracle state, and portfolio-change history before acting. It should let managers exercise portfolio judgment without gaining an unrestricted path to withdraw assets or bypass the mandate.

For the MVP, success means making the complete OTF lifecycle understandable and usable on Robinhood Chain Testnet: discovery, inspection, wallet connection, creation, proportional deposits and redemptions, manager operations, and safety-checked rebalancing.

## Positioning

OTF combines human portfolio management with enforceable onchain limits. Managers may change a portfolio only through a narrow atomic rebalance path constrained by current constituents and approved adapters, fresh per-OTF pinned prices, factory-policy-bounded weight bands, NAV-loss protection, target-weight checks, and a minimum cooldown. Strategy turnover is recorded for disclosure rather than capped.

This makes each managed portfolio independently inspectable and mechanically bounded. The protocol's position is evolutionary: it rebuilds familiar fund ownership and management mechanics as transparent, programmable onchain infrastructure rather than presenting itself as an attack on traditional ETFs.

## Operating Context

Investors use the web application with an EVM wallet to:

- Discover available OTFs and distinguish live protocol data from unavailable networks or preview states.
- Inspect NAV, NAV per share, portfolio allocation, target and actual weights, oracle freshness, creator fees, strategy history, safety limits, cooldown state, and return history.
- Review their OTF share positions and inspect the protocol's supported RWA catalog separately.
- Enter by supplying the exact proportional RWA basket, buying shares from the OTF/USDG market, or routing a fixed USDG amount through constituent pools with minimum-share protection.
- Exit by receiving the proportional RWA basket, selling shares into the OTF/USDG market, or routing a redemption through constituent pools with minimum-USDG protection.
- Obtain supported testnet assets from the Robinhood Chain Testnet faucet.

Creators and managers use the application to:

- Create an OTF with a name that ends in ` OTF`, a freely chosen ticker, initial thesis, manager, fee recipient, mechanically valid assets, exact pricing configurations, target weights, creator fee, and policy-bounded safety limits.
- Open the immutable official OTF/USDG pool and add wallet-funded liquidity without using portfolio assets.
- Find OTFs managed by the connected wallet.
- Propose target changes with a required rationale that becomes permanent when the strategy activates.
- Accrue creator fees without counting the action as a portfolio change.
- Build, simulate, and submit a strategy proposal with a public rationale, then execute its constrained rebalance.

The current supported environment is Robinhood Chain Testnet. Robinhood Chain Mainnet is visible as a network choice but has no supported assets, OTF deployments, or product availability yet.

## Capabilities and Constraints

- Each OTF is an ERC-20 share token and custodian of its own underlying basket. Its ERC-1046 metadata uses the canonical dark OTF SVG image.
- OTF creation is permissionless within factory-level mechanical validation and enforceable safety constraints.
- The investor frontend exposes exactly three entry paths—direct RWA basket, official OTF/USDG market, and fixed-USDG constituent routing—and exactly three corresponding exit paths.
- Every OTF factory transaction atomically creates or adopts one immutable official OTF/USDG Uniswap V3 pool at the 0.05% fee tier. Existing initialized canonical pools are adopted unchanged; the association cannot be removed, replaced, or changed by the manager.
- Any wallet may add liquidity without using OTF-held portfolio assets and owns the resulting Uniswap position.
- The direct secondary-market route remains disabled while the official pool reports zero active liquidity.
- Proportional redemptions remain a contract-level primitive and do not depend on oracle availability.
- A manager may irreversibly sunset an OTF after its strategy cooldown finishes and while no
  challenge, proposal, or rebalance is active. Sunset
  checkpoints fees once, permanently closes deposits and portfolio management, and leaves share
  transfers and proportional redemptions available for an orderly wind-down.
- The factory owner may reversibly pause new OTF creation and deposits across all
  factory-created OTFs without pausing redemptions, transfers, or secondary-market share trading.
- Only the configured manager may stage a rationale or submit a strategy proposal; rationales cannot be appended independently.
- The manager has no arbitrary call or asset-withdrawal surface.
- Rebalances use current constituents and one approved generic V3 adapter, exact temporary approvals,
  fresh pinned onchain prices, and atomic execution. Explicit execution paths may use arbitrary
  intermediate tokens without changing the OTF's pinned pricing configuration.
- Portfolio changes are bounded by enforceable limits covering NAV loss and target-weight deviation. Managers may update completion and challenge bands within the factory owner's live protocol-wide policy. Every included asset must meet the live minimum target weight, initialized at 1%, with no separate asset-count, maximum-target, or turnover limit.
- Every OTF uses a fixed seven-day challenge grace period. Oracle freshness and corporate-action pause checks are selected per leg by the creator, mechanically validated, and pinned while the asset remains tracked. Fully pruning an asset clears its pricing state so a later strategy can reintroduce it with a newly validated source. Robinhood equity feeds publish 24/5; the frontend currently suggests a 25-hour limit measured from each feed's latest update, so oracle-priced actions can continue into a weekend before pausing until fresh prices arrive.
- Every OTF uses one fixed 14-day strategy cooldown that starts when a rebalance completes inside its target bands. Active challenges and out-of-band portfolios block new strategy proposals.
- Failed rebalances, staged rationales, fee accrual, role transfers, deposits, and redemptions do not reset the cooldown.
- Strategy history permanently pairs each activated rationale with its complete target snapshot and completion state.
- Creator fees accrue as shares and split between the configured recipient and protocol collector according to contract rules.
- The frontend offers a convenient testnet metadata catalog and editable pricing suggestions; mechanically valid unindexed assets remain usable and the catalog is not an authorization source.
- Mainnet product support is explicitly unavailable until real assets, adapters, oracle feeds, contracts, and deployment evidence exist.
- The MVP is experimental, unaudited, and not production ready. It must not imply regulatory status, guaranteed returns, real Mainnet availability, audited safety, or historical performance that is not backed by live data.
- “OTF” means “Onchain Traded Fund.” User-facing product terminology should use OTF rather than vault except where contract-level documentation requires the technical term.

## Brand Commitments

- The official product name is **Onchain Traded Funds** and the abbreviation is **OTF**.
- The square `OTF` mark is the primary product symbol, including application identity and favicon use.
- Product language should be precise, restrained, and legible to both finance-oriented and crypto-native users.
- The core message is transparent managed funds with people making portfolio decisions and code enforcing the limits.
- The product should describe the fund model as being rebuilt onchain without claiming that an OTF is a regulated ETF product.
- Experimental and unaudited status must remain clear wherever users could mistake preview or testnet behavior for a production financial product.

## Evidence on Hand

- Protocol scope, architecture, lifecycle, and cooldown behavior: `../README.md`.
- Security assumptions and non-production warning: `../SECURITY.md`.
- Contract implementation and enforcement: `../contracts/src/`.
- Cooldown boundary and non-reset tests: `../contracts/test/RebalanceCooldown.t.sol`.
- Generated contract interfaces: `../packages/generated/src/index.ts`.
- Current product workflows and application copy: `src/components/RebalanceCooldownPanel.tsx`.
- Landing-page narrative and interaction: `src/components/LandingPage.tsx` and `src/components/ETFChainScene.tsx`.
- Network configuration: `src/lib/chains.ts`.
- Wallet integration: `src/lib/wagmi.ts` and `src/app/providers.tsx`.
- Protocol documentation presented in the product: `src/app/docs/page.tsx`.

There are no audited-production claims, regulated-product approvals, customer testimonials, verified Mainnet deployments, or independently validated performance records on hand. Future work must not fabricate them.

## Product Principles

1. **Make the portfolio legible.** Investors should be able to understand holdings, valuation, rules, risks, and change history before connecting capital.
2. **Keep management bounded.** Human judgment is valuable, but every manager action must remain inside visible and enforceable protocol limits.
3. **Show evidence, not assurances.** Prefer live contract state, oracle status, transaction history, and explicit unavailable states over unsupported confidence claims.
4. **Separate roles without fragmenting the product.** Investor workflows should remain approachable while manager controls expose the detail required for responsible operation.
5. **Treat testnet truthfully.** Make the MVP useful and convincing without disguising previews, mocks, unavailable Mainnet functionality, or unaudited software as production reality.
