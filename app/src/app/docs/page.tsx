import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  ChevronDown,
  Coins,
  ExternalLink,
  Landmark,
  RotateCcw,
  Scale,
  ShieldCheck,
} from "lucide-react";
import { DocsNavigation } from "./DocsNavigation";

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
    label: "OTF lifecycle",
    sections: [["lifecycle", "OTF lifecycle"], ["creation", "OTF creation"], ["deposits", "Deposits"], ["redemptions", "Redemptions"]],
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
  ["Portfolio calculator", "Stateless oracle valuation, portfolio-band checks, and cadence-independent fee-growth calculations."],
  ["ManagedOTFVault", "Custodies the portfolio, issues ERC-20 shares with ERC-1046 SVG metadata, accrues fees, and enforces portfolio rules."],
  ["RebalanceExecutor", "Restricts execution to typed swaps through approved adapters."],
  ["OTFEntryRouter", "Atomically converts a fixed USDG input into the largest proportional OTF basket, with minimum-share protection and slippage-protected USDG refunds."],
  ["Uniswap V3 adapter", "Executes explicit exact-input paths for entry, redemption, and rebalancing; caller contracts enforce the permitted endpoints."],
  ["AssetRegistry", "Optional permissionless discovery index; vault eligibility never depends on it."],
  ["Pricing resolver", "Mechanically validates creator-selected Chainlink, Chainlink Composed, or canonical Uniswap V3 TWAP routes and resolves the normalized feed and parameters pinned by one OTF."],
  ["FeeCollector", "Receives the protocol portion of creator-selected management fees."],
] as const;

const safetyRows = [
  ["Asset quality", "High and normal are frontend-only metadata labels. They never gate onchain inclusion, submissions, or rewards."],
  ["Pinned pricing", "Each OTF pins exactly one validated Chainlink, Chainlink Composed, or Uniswap V3 TWAP route per constituent, with no fallback."],
  ["Portfolio turnover", "Each completed strategy records its oracle-valued turnover for disclosure; turnover is not capped."],
  ["NAV loss", "Execution loss accumulates against a seven-day budget; gains do not restore consumed capacity."],
  ["Weight bands", "Wider challenge bands trigger accountability; narrower completion bands prove restoration."],
  ["Target weights", "Every included asset must meet the live protocol-wide minimum, initialized at 1% and adjustable by the factory owner; there is no maximum target weight."],
  ["Oracle freshness", "Every Chainlink leg must satisfy its own enforced staleness and pause rules; V3 pricing uses the fixed protocol TWAP window plus a pinned quote-token/USD feed."],
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
              GitHub
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
      </header>

      <div className="docsLayout">
        <DocsNavigation groups={sectionGroups} />

        <main className="docsContent">
          <section className="docsIntro" id="overview">
            <h1>Onchain funds with legible portfolios and bounded management.</h1>
            <p>
              Onchain Traded Funds is an experimental protocol for managed, multi-asset baskets.
              Each OTF holds mechanically valid tokenized assets, pins one pricing route per asset,
              and issues transferable proportional shares. Its manager can update the portfolio
              only through narrow, safety-checked strategy and execution paths. OTFs are not
              ERC-4626 vaults: they expose the current draft ERC-7621 basket interface and exact
              standard events, with the stricter contribution and ownership rules documented below.
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
                <span>Managers act within enforceable portfolio and execution limits.</span>
              </article>
            </div>
          </section>

          <section className="docsSection" id="architecture">
            <div className="docsSectionHeading">
              <h2>Architecture</h2>
            </div>
            <p>
              The factory creates minimal-proxy vaults. Each vault values its constituents through
              immutable per-OTF pinned feeds, routes typed trades independently through a dedicated executor, and
              sends the protocol share of accrued fees to the fee collector. The factory and
              registries never custody a vault&apos;s portfolio.
            </p>
            <figure className="docsArchitecture" aria-labelledby="architecture-caption">
              <div className="docsArchitecturePath">
                <article>
                  <span>Configuration</span>
                  <strong>Creator</strong>
                  <small>Defines the basket, manager, pricing, fees, and permanent limits.</small>
                </article>
                <div className="docsArchitectureArrow" aria-hidden="true">
                  <span>submits to</span>
                  <ArrowRight size={16} />
                </div>
                <article>
                  <span>Deployment</span>
                  <strong>Factory</strong>
                  <small>Validates the configuration and creates the minimal-proxy OTF.</small>
                </article>
                <div className="docsArchitectureArrow" aria-hidden="true">
                  <span>creates</span>
                  <ArrowRight size={16} />
                </div>
                <article className="portfolioOwner">
                  <span>Portfolio owner</span>
                  <strong>Managed OTF</strong>
                  <small>Holds every constituent, issues shares, and enforces portfolio rules.</small>
                </article>
              </div>
              <div className="docsArchitectureServices">
                <p>Connected contracts support the OTF without holding its portfolio:</p>
                <div>
                  <span><strong>Registries</strong> validate pricing and protocol rules.</span>
                  <span><strong>Executor</strong> routes typed trades through approved adapters.</span>
                  <span><strong>Fee collector</strong> receives the protocol share of accrued fees.</span>
                </div>
              </div>
              <figcaption id="architecture-caption">
                “Portfolio owner” is a custody label, not an admin role. Only the managed OTF holds
                the basket; the factory and registries never do.
              </figcaption>
            </figure>
            <details className="docsDisclosure">
              <summary>
                Contract responsibilities
                <span><ChevronDown size={14} aria-hidden="true" />{contractRows.length} contracts</span>
              </summary>
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
            </details>
          </section>

          <section className="docsSection" id="lifecycle">
            <div className="docsSectionHeading">
              <h2>OTF lifecycle</h2>
            </div>
            <p>
              An OTF begins with an active initial strategy, waits through a fixed 14-day strategy
              cooldown, and then permits a new target proposal. Every accepted proposal remains
              visible for a separate 48-hour holder exit window before activation. Rebalance
              execution begins after activation and completes only when the portfolio returns
              inside its completion bands. A valid out-of-band challenge can interrupt this path
              and starts its own seven-day response window.
            </p>
            <figure className="otfLifecycleFigure" aria-labelledby="otf-lifecycle-caption">
              <ol className="otfStateFlow" aria-label="Main OTF strategy state flow">
                <li>
                  <span>Active strategy</span>
                  <div><strong>Portfolio operates</strong><small>Creation records strategy version zero and activates its targets.</small></div>
                </li>
                <li>
                  <span>14-day cooldown</span>
                  <div><strong>Targets stay fixed</strong><small>The wait starts at creation or the last completed rebalance.</small></div>
                </li>
                <li>
                  <span>Proposal eligible</span>
                  <div><strong>Current basket must be in band</strong><small>No active challenge or strategy change may exist.</small></div>
                </li>
                <li>
                  <span>48-hour notice</span>
                  <div><strong>Proposed targets are visible</strong><small>Current targets remain active and holders may redeem.</small></div>
                </li>
                <li>
                  <span>Rebalance active</span>
                  <div><strong>Activation switches the targets</strong><small>Constrained trades continue until every asset enters its completion bands.</small></div>
                </li>
                <li>
                  <span>Complete</span>
                  <div><strong>The cycle restarts</strong><small>Completion starts a new 14-day cooldown.</small></div>
                </li>
              </ol>
              <aside className="otfChallengeBranch" aria-label="Conditional challenge state">
                <div>
                  <span>Can interrupt any live state</span>
                  <strong>Out-of-band challenge</strong>
                  <small>Fresh oracle prices must prove that a constituent crossed its wider challenge band.</small>
                </div>
                <div className="otfChallengeOutcomes">
                  <span><ShieldCheck size={14} aria-hidden="true" /><b>Restored within 7 days</b>Held-back fees are preserved.</span>
                  <span><Scale size={14} aria-hidden="true" /><b>Still out of band after 7 days</b>Fees remain suspended until recovery.</span>
                </div>
              </aside>
              <figcaption id="otf-lifecycle-caption">
                The main flow repeats after every completed strategy. Challenge timing is separate
                because it depends on portfolio state, not a scheduled day.
              </figcaption>
            </figure>
          </section>

          <section className="docsSection" id="creation">
            <div className="docsSectionHeading">
              <h2>OTF creation</h2>
            </div>
            <p>
              The creator selects a manager, fee recipient, constituent assets, an exact supported pricing configuration for each asset, target weights, fee,
              challenge and completion bands, and safety
              limits. The factory validates these
              parameters, deploys a deterministic clone, transfers the exact initial basket, and
              initializes the vault. Target weights must total <code>10,000 bps</code>.
            </p>
            <ol className="docsSteps">
              <li><span>01</span><div><strong>Validate</strong><p>Factory hard caps, exact 18-decimal constituents, mechanically valid Chainlink feeds or canonical V3 history, weight bounds, and cooldown are checked.</p></div></li>
              <li><span>02</span><div><strong>Fund</strong><p>The exact initial constituent balances move into the new vault.</p></div></li>
              <li><span>03</span><div><strong>Initialize</strong><p>Rules, completed strategy version zero, its target snapshot, and the creation-time cooldown baseline are stored.</p></div></li>
              <li><span>04</span><div><strong>Issue</strong><p>Initial vault shares are minted to the manager.</p></div></li>
            </ol>
          </section>

          <section className="docsSection" id="deposits">
            <div className="docsSectionHeading">
              <h2>Deposits</h2>
            </div>
            <p>
              New shares require a proportional deposit of every current constituent. Required
              inputs round up to protect existing holders. Before depositing, the holder approves
              each constituent for the selected vault. Deposits transfer the basket directly into
              that vault and mint the corresponding vault shares.
            </p>
            <p>
              Direct deposits stop permanently when a manager sunsets an OTF. The factory owner
              can pause new OTF creation and deposits across every OTF as a reversible precaution, while a separate factory-controlled local pause can stop deposits into one OTF. Neither
              control blocks proportional redemptions or standard share transfers; buying existing
              shares from an independent liquidity pool is secondary-market trading, not a vault deposit.
            </p>
            <div className="docsNotice">
              <Landmark size={17} />
              <div>
                <strong>Three ways to enter</strong>
                <span>
                  Supply the proportional RWA basket, buy existing shares from the OTF/USDG pool,
                  or supply a fixed USDG or WETH amount through its settlement router. Routed entry
                  shows estimated shares and a slippage-protected minimum before signing.
                </span>
              </div>
            </div>
            <pre><code>{`enterWithSettlement(
  vault,
  settlementIn,
  minShares,
  receiver,
  deadline,
  swaps
)`}</code></pre>
          </section>

          <section className="docsSection" id="redemptions">
            <div className="docsSectionHeading">
              <h2>Redemptions</h2>
            </div>
            <p>
              Redemptions burn vault shares and return a proportional amount of every current
              constituent. Outputs round down to protect remaining holders. Redemptions do not
              reset the rebalance cooldown and remain available when oracle-dependent management
              actions are unavailable.
            </p>
            <div className="docsNotice">
              <Landmark size={17} />
              <div>
                <strong>Three ways to exit</strong>
                <span>
                  Receive the proportional RWA basket, sell shares into the OTF/USDG pool, or redeem
                  through the settlement router for USDG. Routed redemption enforces per-leg and
                  aggregate slippage minimums and reverts every action if a leg fails.
                </span>
              </div>
            </div>
          </section>

          <section className="docsSection" id="portfolio-structure">
            <div className="docsSectionHeading">
              <h2>Constituents and weights</h2>
            </div>
            <p>
              A portfolio stores its tracked asset addresses and target weights. Actual weights are
              derived from current balances and fresh oracle prices. Portfolio reads expose the
              targets, actual weights, token balances, prices, and feed freshness independently.
              Strategy history permanently pairs each activated target snapshot with the
              manager&apos;s locked rationale and later records when the portfolio reaches its bands.
            </p>
          </section>

          <section className="docsSection" id="valuation">
            <div className="docsSectionHeading">
              <h2>Valuation and NAV</h2>
            </div>
            <p>
              NAV is the sum of every constituent&apos;s oracle-valued balance. NAV per share divides
              that value by the fee-adjusted share supply. Valuation-dependent actions require a
              positive answer from that OTF&apos;s pinned feed within its enforced freshness bound. For
              Chainlink routes validate every creator-selected leg independently against its pinned
              staleness limit and required pause behavior. V3 routes use the immutable protocol TWAP
              window. A stale or invalid source makes oracle-dependent actions revert; the vault never
              substitutes another feed or pool.
            </p>
            <pre><code>{`asset value = token balance x oracle price
portfolio NAV = sum(asset values)
actual weight = asset value / portfolio NAV
NAV per share = portfolio NAV / total share supply`}</code></pre>
          </section>

          <section className="docsSection" id="target-proposals">
            <div className="docsSectionHeading">
              <h2>Target proposals</h2>
            </div>
            <p>
              Every target proposal requires a non-empty rationale and a real constituent or
              weight change. The application submits both atomically through <code>proposeStrategy</code>.
              Draft ERC-7621 callers may stage a rationale and then call the standard
              <code>rebalance</code> selector. The locked proposal leaves the active basket unchanged
              for 48 hours, giving holders time to redeem. Activation revalidates every safety rule,
              makes the targets active, and creates the permanent strategy-history entry without
              implying that trades have completed.
            </p>
            <pre><code>{`proposeStrategy(address[] newTokens, uint256[] newWeights, string rationale)
setNextStrategyRationale(string rationale)
rebalance(address[] newTokens, uint256[] newWeights)
activatePendingStrategy()`}</code></pre>
          </section>

          <section className="docsSection" id="trade-execution">
            <div className="docsSectionHeading">
              <h2>Trade execution and completion</h2>
            </div>
            <pre><code>{`executeRebalanceTrades(TradeInstruction[] trades)

completeStrategicRebalance()`}</code></pre>
            <p>
              The manager is added to the executor allowlist automatically and may remove or
              restore their own execution permission. Any authorized executor may submit multiple partial trade batches.
              Every batch uses current constituents and approved adapters, returns output directly
              to the vault, satisfies oracle-valued slippage and NAV-loss limits, and
              must move every constituent closer to target. Temporary approvals are
              exact and cleared after execution. A final successful trade batch automatically
              completes the strategic rebalance when all weights enter their completion bands.
              Explicit permissionless completion remains available when no trade is needed or
              prices naturally restore the portfolio.
            </p>
          </section>

          <section className="docsSection" id="challenges">
            <div className="docsSectionHeading">
              <h2>Weight bands and challenges</h2>
            </div>
            <p>
              Each constituent has a wider challenge band and a narrower completion band around
              its active target. Anyone may call <code>flagOutOfBand()</code>, but fresh pinned
              prices must prove a real challenge-band breach. Invalid challenges revert.
            </p>
            <figure className="challengeLifecycle" aria-labelledby="challenge-lifecycle-caption">
              <div className="challengeLifecycleTrack">
                <div className="challengeLifecycleNode">
                  <span>Normal</span>
                  <strong>Fees accruing</strong>
                  <small>Portfolio monitored against the wider challenge bands.</small>
                </div>
                <ArrowRight aria-hidden="true" />
                <div className="challengeLifecycleNode active">
                  <span>Challenged</span>
                  <strong>Seven-day response</strong>
                  <small>Older valid fees are crystallized; corrective trades remain available.</small>
                </div>
                <ArrowRight aria-hidden="true" />
                <div className="challengeLifecycleNode overdue">
                  <span>Overdue</span>
                  <strong>Fees suspended</strong>
                  <small>Challenge-window fees are forfeited once; later fees stay suspended.</small>
                </div>
              </div>
              <div className="challengeLifecycleReturns">
                <span><RotateCcw size={14} aria-hidden="true" />Timely restoration returns held-back fees</span>
                <span><RotateCcw size={14} aria-hidden="true" />Late restoration resumes only future fees</span>
              </div>
              <figcaption id="challenge-lifecycle-caption">
                Both restoration paths require fresh prices and weights inside the narrower completion bands.
              </figcaption>
            </figure>
          </section>

          <section className="docsSection" id="fee-accountability">
            <div className="docsSectionHeading">
              <h2>Fee accountability</h2>
            </div>
            <p>
              Deposits and proportional withdrawals stay enabled during ordinary weight
              challenges. If a zero-target asset is being retired, primary
              deposits pause until its exact balance reaches zero and it is removed. Its former
              weight is redistributed proportionally across the remaining targets, with integer
              rounding assigned deterministically so the remaining targets still total exactly 100%.
              Withdrawals remain available. Natural price recovery and constrained manager or executor trades
              can restore the basket. Target redefinition, ownership transfer, or delayed fee
              crystallization cannot recover forfeited fees.
            </p>
            <ul className="docsChecklist">
              <li>Opening a challenge first crystallizes every valid fee earned before the challenge start, so older fees cannot disappear.</li>
              <li>Before the deadline, timely restoration releases the full challenge-period fee interval to the manager and gives the challenger no reward.</li>
              <li>After the deadline, the first accrual path processes a one-time forfeiture capped at the recorded challenge deadline.</li>
              <li>Half of the forfeited challenge-window fees is credited to the original challenger as claimable reward shares.</li>
              <li>Later claims and accrual paths cannot increase the forfeiture or reward for the same challenge.</li>
              <li>No separate deadline-finalization transaction is required before the challenger claims.</li>
            </ul>
          </section>

          <section className="docsSection" id="cooldown">
            <div className="docsSectionHeading">
              <h2>Strategy timing</h2>
            </div>
            <p>
              Deployment records the initial rationale and targets as completed strategy version zero,
              starting the first 14-day cooldown immediately. A manager can later propose new
              target weights only after 14 days have passed since the previous rebalance completed
              inside its target bands. The portfolio must still be
              inside those bands, with no active challenge or strategy change. A valid proposal
              then remains pending for a separate 48-hour holder exit window. Returning in-band
              early never shortens the cooldown: both the full 14 days and the in-band check must
              pass when the proposal is submitted.
            </p>
            <pre><code>{`STRATEGY_CHANGE_COOLDOWN = 14 days
STRATEGY_ACTIVATION_DELAY = 48 hours

nextStrategyChangeTime =
  lastCompletedStrategyTimestamp + STRATEGY_CHANGE_COOLDOWN

canProposeStrategy =
  block.timestamp >= nextStrategyChangeTime`}</code></pre>
            <ul className="docsChecklist">
              <li>The first target proposal waits 14 days from OTF creation.</li>
              <li>Later proposals wait 14 days from successful rebalance completion.</li>
              <li>Being in-band before that deadline does not make an early proposal valid.</li>
              <li>Active challenges and out-of-band portfolios block proposals.</li>
              <li>Current targets remain active throughout the 48-hour notice period.</li>
              <li>Failed proposals, failed trades, and partial trades do not update the timestamp.</li>
              <li>Challenges, staged rationales, fees, and role transfers do not reset it.</li>
              <li>A manager may permanently sunset only after the strategy cooldown finishes and with no active challenge, proposal, or rebalance.</li>
              <li>Sunset checkpoints fees once, then disables deposits, future fees, challenges, strategy changes, and rebalance trades while keeping redemptions open.</li>
            </ul>
          </section>

          <section className="docsSection" id="safety">
            <div className="docsSectionHeading">
              <h2>Safety limits</h2>
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
              <h2>Management fees</h2>
            </div>
            <p>
              Fees accrue lazily as shares rather than by removing portfolio assets. The growth
              formula is cadence-independent and calibrated to the displayed annual dilution.
              Deposits, redemptions, and fee changes settle the preceding interval first, so a new
              fee rate never applies retroactively. Missed challenge-window fees are skipped rather
              than minted; suspended intervals never accrue later. The protocol rebate uses the
              lesser of the live oracle-valued $OTF weight and the manager&apos;s active $OTF target
              allocation; failed live-weight reads receive no rebate. Protocol rebate parameter
              changes use the latest setting when this OTF next checkpoints fees;
              they do not create historical rebate-policy intervals.
            </p>
          </section>

          <section className="docsSection" id="roles">
            <div className="docsSectionHeading">
              <h2>Protocol roles</h2>
            </div>
            <div className="docsRoleGrid">
              <article><strong>Manager</strong><span>Controls strategy, bounded fees, the executor allowlist, and the irreversible OTF sunset action; starts with execution permission.</span></article>
              <article><strong>Executor</strong><span>May only perform constrained partial trades toward the active target.</span></article>
              <article><strong>Fee recipient</strong><span>Receives released manager-fee shares.</span></article>
              <article><strong>Factory owner</strong><span>Administers protocol registries, adapters, treasury, hard caps, and the reversible protocol-wide deposit pause.</span></article>
              <article><strong>Share holder</strong><span>Deposits, holds transferable vault shares, and redeems the proportional basket.</span></article>
            </div>
            <p>
              ERC-173 ownership transfer takes effect immediately, clears the previous executor
              set, and authorizes the new manager as the sole executor. Fee-recipient updates are also immediate. Role changes cannot cancel a
              challenge, recover forfeited fees, or change the cooldown.
            </p>
          </section>

          <section className="docsSection" id="approval-scopes">
            <div className="docsSectionHeading">
              <h2>Approval scopes</h2>
            </div>
            <p>
              OTF creation approvals are granted to the factory so it can transfer the seed
              basket during deployment. Deposit approvals are granted to the specific vault that
              receives the assets. The interface supports approving all required constituents or
              reviewing and approving them one by one; there is no single global approval shared
              by every vault.
            </p>
            <p>
              During rebalance execution, the vault grants exact temporary token approvals to the
              configured executor path and clears them after the call.
            </p>
          </section>

          <section className="docsSection" id="interfaces">
            <div className="docsSectionHeading">
              <h2>Contract interfaces</h2>
            </div>
            <pre><code>{`function getConstituents() external view returns (address[] memory, uint256[] memory);
function getReserve(address token) external view returns (uint256);
function currentWeight(address token) external view returns (uint256);
function getWeightBands(address token) external view returns (uint256, uint256, uint256, uint256);
function isWithinTargetBands() external view returns (bool);
function challengeTimeRemaining() external view returns (uint256);
function feeState() external view returns (FeeState);
function canProposeStrategy() external view returns (bool);`}</code></pre>
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
              <h2>Developer guide</h2>
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
