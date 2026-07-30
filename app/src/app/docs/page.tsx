import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  Boxes,
  Braces,
  Clock3,
  Coins,
  ExternalLink,
  FileCode2,
  Landmark,
  Scale,
  ShieldCheck,
  Users,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Documentation | Onchain Traded Funds",
  description: "Protocol, vault, rebalance, and developer documentation for Onchain Traded Funds.",
};

const sections = [
  ["overview", "Overview"],
  ["architecture", "Architecture"],
  ["vault-lifecycle", "Vault lifecycle"],
  ["portfolio", "Portfolio model"],
  ["rebalancing", "Rebalancing"],
  ["cooldown", "Cooldown"],
  ["safety", "Safety limits"],
  ["fees", "Fees and roles"],
  ["interfaces", "Contract interfaces"],
  ["developers", "Developer guide"],
] as const;

const contractRows = [
  ["OTFFactory", "Creates deterministic vault clones, applies protocol-wide limits, and records vault ownership."],
  ["ManagedOTFVault", "Custodies the portfolio, issues ERC-20 shares, accrues fees, and enforces portfolio rules."],
  ["RebalanceExecutor", "Restricts execution to typed swaps through approved adapters."],
  ["AssetRegistry", "Defines the asset universe a vault may hold."],
  ["OracleRegistry", "Maps approved assets to fresh, Chainlink-compatible price feeds."],
  ["FeeCollector", "Receives the protocol portion of creator-selected management fees."],
] as const;

const safetyRows = [
  ["Approved assets", "Every target asset must be present in the protocol asset registry."],
  ["Portfolio turnover", "The oracle-valued amount traded cannot exceed the vault's immutable limit."],
  ["NAV loss", "Post-trade NAV cannot fall beyond the configured maximum loss."],
  ["Target deviation", "Final actual weights must remain within the configured target tolerance."],
  ["Asset count", "Portfolios cannot exceed the configured number of constituents."],
  ["Individual weights", "Maximum and minimum nonzero weights prevent invalid concentration and dust positions."],
  ["Oracle freshness", "Every valuation used for a rebalance must be recent enough for the vault's staleness bound."],
  ["Execution", "Trades are atomic, use approved adapters, and grant only exact temporary approvals."],
] as const;

export default function DocsPage() {
  return (
    <div className="docsPage">
      <header className="docsHeader">
        <div className="docsHeaderInner">
          <Link className="docsBrand" href="/">
            <span className="docsLogo">OTF</span>
            <span>
              <strong>Onchain Traded Funds</strong>
              <small>Documentation</small>
            </span>
          </Link>
          <div className="docsHeaderActions">
            <Link href="/">
              <ArrowLeft size={14} />
              Back to app
            </Link>
            <a href="https://github.com/han1ue/onchaintradedfunds" target="_blank" rel="noreferrer">
              Source
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
      </header>

      <div className="docsLayout">
        <aside className="docsSidebar">
          <div className="docsSidebarTitle">
            <BookOpen size={15} />
            Protocol guide
          </div>
          <nav aria-label="Documentation sections">
            {sections.map(([id, label]) => (
              <a href={`#${id}`} key={id}>
                {label}
              </a>
            ))}
          </nav>
          <div className="docsStatus">
            <span />
            <div>
              <strong>MVP documentation</strong>
              <small>Robinhood Testnet</small>
            </div>
          </div>
        </aside>

        <main className="docsContent">
          <section className="docsIntro" id="overview">
            <span className="docsEyebrow">Protocol documentation</span>
            <h1>Onchain funds with legible portfolios and bounded management.</h1>
            <p>
              Onchain Traded Funds is an experimental protocol for managed ERC-4626-style portfolio
              vaults. A vault owns a basket of approved tokenized assets, issues transferable shares,
              and allows its manager to update the portfolio only through a narrow, safety-checked
              rebalance path.
            </p>
            <div className="docsNotice">
              <ShieldCheck size={17} />
              <div>
                <strong>Experimental and unaudited</strong>
                <span>
                  This MVP is testnet software. It is not production-ready, does not represent a
                  regulated ETF product, and should not be used with assets of real value.
                </span>
              </div>
            </div>
            <div className="docsPillars">
              <article>
                <Boxes size={17} />
                <strong>Portfolio custody</strong>
                <span>Each vault directly holds its tracked assets.</span>
              </article>
              <article>
                <Coins size={17} />
                <strong>Programmable shares</strong>
                <span>Deposits and redemptions follow the live basket proportionally.</span>
              </article>
              <article>
                <Scale size={17} />
                <strong>Bounded management</strong>
                <span>Managers act within immutable portfolio and execution limits.</span>
              </article>
            </div>
          </section>

          <section className="docsSection" id="architecture">
            <div className="docsSectionHeading">
              <Landmark size={18} />
              <div>
                <span>System design</span>
                <h2>Architecture</h2>
              </div>
            </div>
            <p>
              The factory creates minimal-proxy vaults. Each vault reads asset eligibility and
              oracle prices from registries, routes typed trades through a dedicated executor, and
              sends the protocol share of accrued fees to the fee collector. The factory and
              registries never custody a vault&apos;s portfolio.
            </p>
            <div className="docsFlow" aria-label="Protocol architecture">
              <span>Creator</span>
              <b>Factory</b>
              <b>Managed vault</b>
              <span>Registries</span>
              <span>Executor</span>
              <span>Fee collector</span>
            </div>
            <div className="docsTableWrap">
              <table className="docsTable">
                <thead>
                  <tr>
                    <th>Contract</th>
                    <th>Responsibility</th>
                  </tr>
                </thead>
                <tbody>
                  {contractRows.map(([contract, responsibility]) => (
                    <tr key={contract}>
                      <td><code>{contract}</code></td>
                      <td>{responsibility}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="docsSection" id="vault-lifecycle">
            <div className="docsSectionHeading">
              <Boxes size={18} />
              <div>
                <span>From creation to redemption</span>
                <h2>Vault lifecycle</h2>
              </div>
            </div>
            <h3>Creation</h3>
            <p>
              The creator selects a manager, fee recipient, approved assets, target weights, fee,
              rebalance cooldown, and permanent safety limits. The factory validates these
              parameters, deploys a deterministic clone, transfers the exact initial basket, and
              initializes the vault. Target weights must total <code>10,000 bps</code>.
            </p>
            <ol className="docsSteps">
              <li><span>01</span><div><strong>Validate</strong><p>Factory hard caps, approved assets, weight bounds, and cooldown are checked.</p></div></li>
              <li><span>02</span><div><strong>Fund</strong><p>The exact initial constituent balances move into the new vault.</p></div></li>
              <li><span>03</span><div><strong>Initialize</strong><p>Rules, thesis version zero, and the creation-time cooldown baseline are stored.</p></div></li>
              <li><span>04</span><div><strong>Issue</strong><p>Initial vault shares are minted to the manager.</p></div></li>
            </ol>
            <h3>Deposits and redemptions</h3>
            <p>
              New shares require a proportional deposit of every current constituent. Required
              inputs round up to protect existing holders. Redemptions burn shares for a
              proportional basket and round outputs down. These operations do not reset the
              rebalance cooldown, and redemptions remain available if oracle-dependent actions are
              unavailable.
            </p>
          </section>

          <section className="docsSection" id="portfolio">
            <div className="docsSectionHeading">
              <Coins size={18} />
              <div>
                <span>Assets, weights, and valuation</span>
                <h2>Portfolio model</h2>
              </div>
            </div>
            <p>
              A portfolio stores its tracked asset addresses and target weights. Actual weights are
              derived from current balances and fresh oracle prices. NAV is the sum of each
              constituent&apos;s oracle-valued balance; NAV per share divides that value by the
              fee-adjusted share supply.
            </p>
            <pre><code>{`asset value = token balance x oracle price
portfolio NAV = sum(asset values)
actual weight = asset value / portfolio NAV
NAV per share = portfolio NAV / total share supply`}</code></pre>
            <p>
              Portfolio reads make targets, actual weights, balances, prices, and feed freshness
              independently inspectable. A thesis is versioned onchain metadata; amending it does
              not alter assets and does not count as a portfolio change.
            </p>
          </section>

          <section className="docsSection" id="rebalancing">
            <div className="docsSectionHeading">
              <Braces size={18} />
              <div>
                <span>One atomic state transition</span>
                <h2>Rebalancing</h2>
              </div>
            </div>
            <p>
              Only the manager can call <code>rebalance</code>. The call includes the complete
              target portfolio, target weights, typed trade instructions, minimum outputs, and an
              onchain rationale. The vault exposes no arbitrary manager call surface.
            </p>
            <pre><code>{`rebalance(
  address[] targetAssets,
  uint16[] targetWeightsBps,
  TradeInstruction[] trades,
  string rationale
)`}</code></pre>
            <p>
              Each trade names an approved adapter, input asset, output asset, exact input amount,
              minimum output, and adapter-specific data. Temporary approvals are exact and cleared
              after execution. If any trade or final check fails, the entire transaction reverts.
            </p>
          </section>

          <section className="docsSection" id="cooldown">
            <div className="docsSectionHeading">
              <Clock3 size={18} />
              <div>
                <span>Minimum seven days</span>
                <h2>Rebalance cooldown</h2>
              </div>
            </div>
            <p>
              Every vault has a creation-time cooldown of at least seven days. A creator may select
              a longer duration, but the protocol rejects a shorter one and provides no manager
              setter after deployment.
            </p>
            <pre><code>{`MIN_REBALANCE_COOLDOWN = 7 days
nextRebalanceTime =
  lastRebalanceTimestamp + rebalanceCooldown

canRebalance =
  block.timestamp >= nextRebalanceTime`}</code></pre>
            <ul className="docsChecklist">
              <li>The first rebalance waits from the vault creation timestamp.</li>
              <li>Later rebalances wait from the last successful portfolio change.</li>
              <li>The timestamp updates only after execution and every final safety check pass.</li>
              <li>Failed rebalances, fee accrual, thesis amendments, and role transfers do not reset it.</li>
            </ul>
          </section>

          <section className="docsSection" id="safety">
            <div className="docsSectionHeading">
              <ShieldCheck size={18} />
              <div>
                <span>Managed by people, bounded by code</span>
                <h2>Safety limits</h2>
              </div>
            </div>
            <p>
              Vault-level limits are chosen during creation and become part of the vault&apos;s
              mandate. Rebalances are checked before, during, and after trade execution.
            </p>
            <div className="docsTableWrap">
              <table className="docsTable">
                <thead>
                  <tr>
                    <th>Protection</th>
                    <th>Enforcement</th>
                  </tr>
                </thead>
                <tbody>
                  {safetyRows.map(([protection, enforcement]) => (
                    <tr key={protection}>
                      <td>{protection}</td>
                      <td>{enforcement}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="docsSection" id="fees">
            <div className="docsSectionHeading">
              <Users size={18} />
              <div>
                <span>Authority and incentives</span>
                <h2>Fees and roles</h2>
              </div>
            </div>
            <h3>Management fee</h3>
            <p>
              Fees accrue lazily as new shares rather than by removing portfolio assets. Accrual is
              realized when a state-changing vault operation runs. Fee accrual does not count as a
              rebalance and cannot change <code>lastRebalanceTimestamp</code>.
            </p>
            <h3>Roles</h3>
            <div className="docsRoleGrid">
              <article><strong>Manager</strong><span>Updates the thesis and submits bounded rebalances.</span></article>
              <article><strong>Fee recipient</strong><span>Receives the creator portion of accrued fee shares.</span></article>
              <article><strong>Factory owner</strong><span>Administers protocol registries, adapters, treasury, and hard caps.</span></article>
              <article><strong>Share holder</strong><span>Deposits, holds transferable vault shares, and redeems the proportional basket.</span></article>
            </div>
            <p>
              Manager and fee-recipient transfers use a two-step pending/acceptance flow. Neither
              transfer changes the portfolio or its cooldown.
            </p>
          </section>

          <section className="docsSection" id="interfaces">
            <div className="docsSectionHeading">
              <FileCode2 size={18} />
              <div>
                <span>Useful public reads</span>
                <h2>Contract interfaces</h2>
              </div>
            </div>
            <pre><code>{`function nextRebalanceTime() external view returns (uint256);
function canRebalance() external view returns (bool);
function totalAssets() external view returns (uint256);
function portfolioAssets() external view returns (address[] memory);
function currentThesis() external view returns (string memory);
function accrueFees() external;`}</code></pre>
            <p>
              The generated workspace package exposes the application ABI and addresses. Frontend
              reads use wagmi and viem; writes should simulate first, request wallet confirmation,
              and track the submitted transaction through finality.
            </p>
          </section>

          <section className="docsSection" id="developers">
            <div className="docsSectionHeading">
              <Braces size={18} />
              <div>
                <span>Local workspace</span>
                <h2>Developer guide</h2>
              </div>
            </div>
            <p>
              The repository is a pnpm workspace containing the Next.js application, Solidity
              contracts, and generated contract bindings.
            </p>
            <pre><code>{`corepack pnpm install
corepack pnpm --filter @onchaintradedfunds/app dev
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm contracts:solc`}</code></pre>
            <div className="docsRepoTree">
              <span><code>app/</code> Next.js interface</span>
              <span><code>contracts/</code> Solidity sources and tests</span>
              <span><code>packages/generated/</code> ABI and deployment bindings</span>
              <span><code>scripts/</code> workspace build utilities</span>
            </div>
            <div className="docsNext">
              <div>
                <strong>Continue exploring</strong>
                <span>Open the application to browse vaults and inspect the manager workflow.</span>
              </div>
              <Link href="/">
                Open app
                <ExternalLink size={12} />
              </Link>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
