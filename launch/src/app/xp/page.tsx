import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock3, LockKeyhole, Scale, ShieldCheck, TrendingUp, Users, Vote } from "lucide-react";
import { Callout } from "@/components/ui";

export const metadata = { title: "XP allocation" };

const pools = [
  { key: "poolVerified", label: "Verified performance", value: "3,500,000", share: "35%" },
  { key: "poolNonVerified", label: "Non-verified performance", value: "1,750,000", share: "17.5%" },
  { key: "poolParticipation", label: "Participation", value: "2,750,000", share: "27.5%" },
  { key: "poolCreator", label: "Creator", value: "2,000,000", share: "20%" },
] as const;

export default function XpPage() {
  return <div className="pageShell pointsPage">
    <header className="pointsExplainerHeader">
      <div>
        <h1>How XP will be allocated</h1>
        <p>Exactly 10,000,000 XP will be distributed after the competition closes and the final audit is complete. No XP balance or ranking is calculated while the competition is active.</p>
      </div>
      <div className="xpTotal" aria-label="Ten million total XP">
        <strong>10,000,000</strong>
        <span>XP after the final audit</span>
      </div>
    </header>

    <section className="xpAllocationOverview" aria-labelledby="allocation-heading">
      <div className="xpSectionHeading">
        <div><h2 id="allocation-heading">One fixed pool, four allocations</h2><p>The percentages are fixed. Final participant amounts depend on the complete set of valid votes, eligible proposals, and final portfolio performance.</p></div>
        <Scale size={22} aria-hidden="true" />
      </div>
      <figure className="xpAllocationFigure">
        <div className="xpAllocationBar" role="img" aria-label="XP pool: 35 percent verified performance, 17.5 percent non-verified performance, 27.5 percent participation, and 20 percent creator">
          {pools.map((pool) => <span className={`xpAllocationSegment ${pool.key}`} key={pool.key}><b>{pool.share}</b></span>)}
        </div>
        <figcaption className="xpAllocationLegend">
          {pools.map((pool) => <div key={pool.key}><span className={`xpLegendSwatch ${pool.key}`} aria-hidden="true" /><div><strong>{pool.label}</strong><small>{pool.value} XP · {pool.share}</small></div></div>)}
        </figcaption>
      </figure>
    </section>

    <section className="xpTimingSection" aria-labelledby="timing-heading">
      <div className="xpSectionHeading">
        <div><h2 id="timing-heading">XP becomes final in three steps</h2><p>Competition activity is recorded now. Allocation happens once, after every required input is available.</p></div>
        <Clock3 size={22} aria-hidden="true" />
      </div>
      <ol className="xpFinalizationFlow">
        <li><span><Vote size={18} aria-hidden="true" /></span><div><strong>During the competition</strong><p>Valid votes create immutable participation and performance records. No provisional XP is published.</p></div></li>
        <li><span><LockKeyhole size={18} aria-hidden="true" /></span><div><strong>At competition close</strong><p>Final provider prices are captured and evidence, eligibility, votes, and proposals are audited.</p></div></li>
        <li><span><CheckCircle2 size={18} aria-hidden="true" /></span><div><strong>After the final audit</strong><p>All four pools are allocated as exact integers and committed as one final snapshot.</p></div></li>
      </ol>
    </section>

    <section className="xpFormulaSection" aria-labelledby="formula-heading">
      <div className="xpSectionHeading">
        <div><h2 id="formula-heading">What determines each allocation</h2><p>Each pool rewards a different kind of contribution. XP never affects OTF launch rank.</p></div>
        <ShieldCheck size={22} aria-hidden="true" />
      </div>
      <div className="xpFormulaRows">
        <article>
          <TrendingUp size={20} aria-hidden="true" />
          <div><h3>Performance · 5,250,000 XP</h3><p>Each vote tranche is scored by vote quantity, its OTF&apos;s relative portfolio return, and how long the tranche was active. Verified and non-verified OTFs compete in separate pools.</p></div>
          <code>votes × percentile² × maturity</code>
        </article>
        <article>
          <Vote size={20} aria-hidden="true" />
          <div><h3>Participation · 2,750,000 XP</h3><p>Distributed in direct proportion to valid vote units cast. Follower count and the number of different OTFs supported do not change this allocation.</p></div>
          <code>your valid votes ÷ all valid votes</code>
        </article>
        <article>
          <Users size={20} aria-hidden="true" />
          <div><h3>Creator · 2,000,000 XP</h3><p>Distributed to proposal creators in direct proportion to the valid votes their accepted OTFs receive.</p></div>
          <code>votes received ÷ all votes received</code>
        </article>
      </div>
    </section>

    <div className="xpAuditNote">
      <ShieldCheck size={20} aria-hidden="true" />
      <div><strong>Final allocation is deterministic</strong><p>If a performance pool has no eligible score, that pool rolls into participation. Integer rounding uses a deterministic largest-remainder method, and the final 10,000,000 XP snapshot receives a canonical hash.</p></div>
    </div>

    <Callout tone="warning"><span>XP has no guaranteed monetary value. It remains separate from competition ranking and launch order. <Link className="inlineLink" href="/rules#xp-allocation">Read the complete XP rules <ArrowRight size={14} /></Link></span></Callout>
  </div>;
}
