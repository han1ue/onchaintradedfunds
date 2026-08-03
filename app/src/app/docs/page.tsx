import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  Boxes,
  Braces,
  ChartPie,
  ChevronDown,
  Clock3,
  Coins,
  ExternalLink,
  FileCode2,
  Landmark,
  Menu,
  ReceiptText,
  Scale,
  ShieldCheck,
  Users,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Documentation | Onchain Traded Funds",
  description: "Protocol, vault, rebalance, and developer documentation for Onchain Traded Funds.",
};

type DocsSection = readonly [id: string, label: string];

type DocsSectionGroup = {
  readonly label: string;
  readonly sections: readonly DocsSection[];
};

const sectionGroups: readonly DocsSectionGroup[] = [
  {
    label: "Foundations",
    sections: [["overview", "Overview"], ["architecture", "Architecture"]],
  },
  {
    label: "Vault lifecycle",
    sections: [["creation", "Vault creation"], ["deposits", "Deposits"], ["redemptions", "Redemptions"]],
  },
  {
    label: "Portfolio",
    sections: [["portfolio-structure", "Constituents & weights"], ["valuation", "Valuation & NAV"]],
  },
  {
    label: "Management",
    sections: [
      ["target-proposals", "Target proposals"],
      ["trade-execution", "Trade execution"],
      ["challenges", "Challenge bands"],
      ["fee-accountability", "Fee accountability"],
      ["cooldown", "Cooldown"],
    ],
  },
  {
    label: "Controls",
    sections: [
      ["safety", "Safety limits"],
      ["management-fees", "Management fees"],
      ["roles", "Roles"],
      ["approval-scopes", "Approval scopes"],
    ],
  },
  {
    label: "Reference",
    sections: [["interfaces", "Contract interfaces"], ["developers", "Developer guide"]],
  },
];

const contractRows = [
  ["OTFFactory", "Creates deterministic vault clones, applies protocol-wide limits, and records vault ownership."],
  ["Strategy module", "Fixed delegate-called module for manager policy and constrained executor trades."],
  ["Portfolio calculator", "Stateless oracle valuation, weight, turnover, and challenge-band calculations."],
  ["ManagedOTFVault", "Custodies the portfolio, issues ERC-20 shares, accrues fees, and enforces portfolio rules."],
  ["RebalanceExecutor", "Restricts execution to typed swaps through approved adapters."],
  ["AssetRegistry", "Defines the asset universe a vault may hold."],
  ["OracleRegistry", "Maps approved assets to fresh, Chainlink-compatible price feeds."],
  ["FeeCollector", "Receives the protocol portion of creator-selected management fees."],
] as const;

const safetyRows = [
  ["Approved assets", "Every target asset must be present in the protocol asset registry."],
  ["Portfolio turnover", "The oracle-valued amount in each partial batch cannot exceed the vault limit."],
  ["NAV loss", "Post-trade NAV cannot fall beyond the configured maximum loss."],
  ["Weight bands", "Wider challenge bands trigger accountability; narrower completion bands prove restoration."],
  ["Asset count", "Portfolios cannot exceed the configured number of constituents."],
  ["Individual weights", "Maximum and minimum nonzero weights prevent invalid concentration and dust positions."],
  ["Oracle freshness", "Every valuation used for a rebalance must be recent enough for the vault's staleness bound."],
  ["Execution", "Every partial batch is atomic, uses approved adapters, clears exact approvals, and must reduce target distance."],
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
            Documentation index
          </div>
          <nav className="docsDesktopNav" aria-label="Documentation sections">
            {sectionGroups.map((group) => (
              <div className="docsNavGroup" key={group.label}>
                <span className="docsNavGroupLabel">{group.label}</span>
                {group.sections.map(([id, label]) => (
                  <a href={`#${id}`} key={id}>{label}</a>
                ))}
              </div>
            ))}
          </nav>
          <div className="docsStatus">
            <span />
            <div>
              <strong>MVP documentation</strong>
              <small>Robinhood Testnet</small>
            </div>
          </div>
          <details className="docsMobileMenu">
            <summary>
              <Menu size={16} />
              <span>Documentation index</span>
              <ChevronDown size={15} />
            </summary>
            <nav aria-label="Documentation sections">
              {sectionGroups.map((group) => (
                <div className="docsNavGroup" key={group.label}>
                  <span className="docsNavGroupLabel">{group.label}</span>
                  {group.sections.map(([id, label]) => (
                    <a href={`#${id}`} key={id}>{label}</a>
                  ))}
                </div>
              ))}
            </nav>
          </details>
        </aside>

        <main className="docsContent">
          <section className="docsIntro" id="overview">
            <span className="docsEyebrow">Protocol documentation</span>
            <h1>Onchain funds with legible portfolios and bounded management.</h1>
            <p>
              Onchain Traded Funds is an experimental protocol for managed multi-asset basket
              vaults. An OTF owns approved tokenized assets, issues transferable proportional
              shares, and allows its manager to update the portfolio only through a narrow,
              safety-checked strategic and execution paths. OTFs are not ERC-4626 vaults. They
              expose the current draft ERC-7621 basket interface and exact standard events, with
              stricter proportional-contribution and ownership rules documented below.
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

          <section className="docsSection" id="creation">
            <div className="docsSectionHeading">
              <Boxes size={18} />
              <div>
                <span>Configuration and funding</span>
                <h2>Vault creation</h2>
              </div>
            </div>
            <p>
              The creator selects a manager, fee recipient, approved assets, target weights, fee,
              target-change cooldown, challenge and completion bands, grace period, and safety
              limits. The factory validates these
              parameters, deploys a deterministic clone, transfers the exact initial basket, and
              initializes the vault. Target weights must total <code>10,000 bps</code>.
            </p>
            <ol className="docsSteps">
              <li><span>01</span><div><strong>Validate</strong><p>Factory hard caps, approved assets, weight bounds, and cooldown are checked.</p></div></li>
              <li><span>02</span><div><strong>Fund</strong><p>The exact initial constituent balances move into the new vault.</p></div></li>
              <li><span>03</span><div><strong>Initialize</strong><p>Rules, thesis version zero, and the creation-time cooldown baseline are stored.</p></div></li>
              <li><span>04</span><div><strong>Issue</strong><p>Initial vault shares are minted to the manager.</p></div></li>
            </ol>
          </section>

          <section className="docsSection" id="deposits">
            <div className="docsSectionHeading">
              <ArrowDownToLine size={18} />
              <div>
                <span>Proportional entry</span>
                <h2>Deposits</h2>
              </div>
            </div>
            <p>
              New shares require a proportional deposit of every current constituent. Required
              inputs round up to protect existing holders. Before depositing, the holder approves
              each constituent for the selected vault. Deposits transfer the basket directly into
              that vault and mint the corresponding vault shares.
            </p>
          </section>

          <section className="docsSection" id="redemptions">
            <div className="docsSectionHeading">
              <ArrowUpFromLine size={18} />
              <div>
                <span>Proportional exit</span>
                <h2>Redemptions</h2>
              </div>
            </div>
            <p>
              Redemptions burn vault shares and return a proportional amount of every current
              constituent. Outputs round down to protect remaining holders. Redemptions do not
              reset the rebalance cooldown and remain available when oracle-dependent management
              actions are unavailable.
            </p>
          </section>

          <section className="docsSection" id="portfolio-structure">
            <div className="docsSectionHeading">
              <Coins size={18} />
              <div>
                <span>The live basket</span>
                <h2>Constituents and weights</h2>
              </div>
            </div>
            <p>
              A portfolio stores its tracked asset addresses and target weights. Actual weights are
              derived from current balances and fresh oracle prices. Portfolio reads expose the
              targets, actual weights, token balances, prices, and feed freshness independently.
              A thesis is versioned onchain metadata; amending it does not alter constituents or
              count as a portfolio change.
            </p>
          </section>

          <section className="docsSection" id="valuation">
            <div className="docsSectionHeading">
              <ChartPie size={18} />
              <div>
                <span>Oracle-denominated accounting</span>
                <h2>Valuation and NAV</h2>
              </div>
            </div>
            <p>
              NAV is the sum of every constituent&apos;s oracle-valued balance. NAV per share divides
              that value by the fee-adjusted share supply. Valuation-dependent actions require a
              positive answer from an approved feed within the vault&apos;s freshness bound.
            </p>
            <pre><code>{`asset value = token balance x oracle price
portfolio NAV = sum(asset values)
actual weight = asset value / portfolio NAV
NAV per share = portfolio NAV / total share supply`}</code></pre>
          </section>

          <section className="docsSection" id="target-proposals">
            <div className="docsSectionHeading">
              <Braces size={18} />
              <div>
                <span>Strategic changes</span>
                <h2>Target proposals</h2>
              </div>
            </div>
            <p>
              Only the manager can call the standard <code>rebalance</code> function. It updates
              and locks constituents and target weights but executes no trades. The standard
              <code>Rebalanced</code> event describes this target change, not successful
              restoration.
            </p>
            <pre><code>{`rebalance(address[] newTokens, uint256[] newWeights)`}</code></pre>
          </section>

          <section className="docsSection" id="trade-execution">
            <div className="docsSectionHeading">
              <Scale size={18} />
              <div>
                <span>Constrained restoration</span>
                <h2>Trade execution and completion</h2>
              </div>
            </div>
            <pre><code>{`executeRebalanceTrades(TradeInstruction[] trades)

completeStrategicRebalance()`}</code></pre>
            <p>
              The manager or an authorized executor may submit multiple partial trade batches.
              Every batch uses current constituents and approved adapters, returns output directly
              to the vault, satisfies oracle-valued slippage, turnover, NAV-loss, and exposure
              limits, and must move every constituent closer to target. Temporary approvals are
              exact and cleared after execution. A final successful trade batch automatically
              completes the strategic rebalance when all weights enter their completion bands.
              Explicit permissionless completion remains available when no trade is needed or
              prices naturally restore the portfolio.
            </p>
          </section>

          <section className="docsSection" id="challenges">
            <div className="docsSectionHeading">
              <Scale size={18} />
              <div>
                <span>Permissionless accountability</span>
                <h2>Weight bands and challenges</h2>
              </div>
            </div>
            <p>
              Each constituent has a wider challenge band and a narrower completion band around
              its active target. Anyone may call <code>flagOutOfBand()</code>, but fresh approved
              prices must prove a real challenge-band breach. Invalid challenges revert.
            </p>
          </section>

          <section className="docsSection" id="fee-accountability">
            <div className="docsSectionHeading">
              <ReceiptText size={18} />
              <div>
                <span>Consequences and recovery</span>
                <h2>Fee accountability</h2>
              </div>
            </div>
            <pre><code>{`Accruing
  -> valid challenge or strategic target
Escrowed
  -> timely restoration: release manager shares
  -> missed deadline: burn escrow
Suspended
  -> later restoration: resume only future fees`}</code></pre>
            <p>
              Deposits and proportional withdrawals stay enabled throughout. Natural price
              recovery and constrained manager or executor trades can both restore the basket.
              Target redefinition, ownership transfer, or delayed fee crystallization cannot
              recover forfeited fees.
            </p>
          </section>

          <section className="docsSection" id="cooldown">
            <div className="docsSectionHeading">
              <Clock3 size={18} />
              <div>
                <span>Minimum seven days</span>
                <h2>Strategy-change cooldown</h2>
              </div>
            </div>
            <p>
              Every vault waits at least seven days after a successfully completed strategic
              rebalance before another target proposal. Partial maintenance trades and completion
              remain available while the cooldown runs.
            </p>
            <pre><code>{`MIN_REBALANCE_COOLDOWN = 7 days
nextRebalanceTime =
  lastRebalanceTimestamp + rebalanceCooldown

canRebalance =
  block.timestamp >= nextRebalanceTime`}</code></pre>
            <ul className="docsChecklist">
              <li>The first target proposal waits from the vault creation timestamp.</li>
              <li>Later proposals wait from the last successful strategic completion.</li>
              <li>Failed proposals, failed trades, and partial trades do not update the timestamp.</li>
              <li>Challenges, fees, thesis amendments, and role transfers do not reset it.</li>
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
              Protocol-bounded controls become part of the vault&apos;s mandate. Target proposals
              and every partial trade batch are independently checked.
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

          <section className="docsSection" id="management-fees">
            <div className="docsSectionHeading">
              <ReceiptText size={18} />
              <div>
                <span>Share-based accrual</span>
                <h2>Management fees</h2>
              </div>
            </div>
            <p>
              Fees accrue lazily as shares rather than by removing portfolio assets. Manager
              shares are delivered normally, escrowed during unfinished strategic work or
              challenges, and burned if a challenge deadline is missed. Suspended intervals never
              accrue retroactively.
            </p>
          </section>

          <section className="docsSection" id="roles">
            <div className="docsSectionHeading">
              <Users size={18} />
              <div>
                <span>Authority and responsibility</span>
                <h2>Protocol roles</h2>
              </div>
            </div>
            <div className="docsRoleGrid">
              <article><strong>Manager</strong><span>Controls strategy, bounded fees, executors, and constrained trades.</span></article>
              <article><strong>Executor</strong><span>May only perform constrained partial trades toward the active target.</span></article>
              <article><strong>Fee recipient</strong><span>Receives released manager-fee shares.</span></article>
              <article><strong>Factory owner</strong><span>Administers protocol registries, adapters, treasury, and hard caps.</span></article>
              <article><strong>Share holder</strong><span>Deposits, holds transferable vault shares, and redeems the proportional basket.</span></article>
            </div>
            <p>
              ERC-173 ownership transfer and the pending-manager extension both clear all
              authorized executors. Fee-recipient transfer remains two-step. Role transfer cannot
              cancel a challenge, recover forfeited fees, or change the cooldown.
            </p>
          </section>

          <section className="docsSection" id="approval-scopes">
            <div className="docsSectionHeading">
              <ShieldCheck size={18} />
              <div>
                <span>Who may transfer each token</span>
                <h2>Approval scopes</h2>
              </div>
            </div>
            <p>
              Vault creation approvals are granted to the factory so it can transfer the seed
              basket during deployment. Deposit approvals are granted to the specific vault that
              receives the assets. The interface supports approving all required constituents or
              reviewing and approving them one by one; there is no single global approval shared
              by every vault.
            </p>
            <p>
              During rebalance execution, the vault grants exact temporary token approvals to the
              approved executor path and clears them after the call.
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
            <pre><code>{`function getConstituents() external view returns (address[] memory, uint256[] memory);
function getReserve(address token) external view returns (uint256);
function currentWeight(address token) external view returns (uint256);
function getWeightBands(address token) external view returns (uint256, uint256, uint256, uint256);
function isWithinTargetBands() external view returns (bool);
function challengeTimeRemaining() external view returns (uint256);
function feeState() external view returns (FeeState);
function canProposeTargetWeights() external view returns (bool);`}</code></pre>
            <p>
              The contract emits the exact draft ERC-7621 <code>Contributed</code>,
              <code>Withdrawn</code>, and <code>Rebalanced</code> events alongside richer OTF
              events. OTF does not claim unconditional compliance: contributions must match the
              live basket proportionally, ownership cannot be renounced, and a constituent must
              have zero reserve before removal.
            </p>
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
