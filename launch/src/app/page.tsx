import Link from "next/link";
import { ArrowRight, FileCheck2, History, Layers3 } from "lucide-react";
import { HowItWorks } from "@/components/HowItWorks";
import { CompetitionTimeline } from "@/components/CompetitionTimeline";
import { ResponsiveLeaderboard } from "@/components/Leaderboard";
import { Button, Callout, SectionCard, StatusBadge } from "@/components/ui";
import { auth } from "@/server/auth";
import { getAssetRegistry, getCompetition, getLeaderboard } from "@/server/data";
import { getParticipationEligibility } from "@/server/participation";
import { getCompetitionStatus } from "@/lib/competition";
import { authErrorMessages } from "@/lib/errors";
import { selectRecentProposals } from "@/lib/recent-activity";

function daysRemaining(endsAt: string) { return Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000)); }

export default async function HomePage({ searchParams }: { searchParams: Promise<{ voteError?: string; authError?: string }> }) {
  const currentTime = new Date();
  const { voteError, authError } = await searchParams;
  const [competition, leaderboard, assets, session] = await Promise.all([getCompetition(), getLeaderboard(), getAssetRegistry(), auth()]);
  const verifiedAssetCount = assets.filter((asset) => asset.verified).length;
  const eligibility = await getParticipationEligibility(session?.user, competition);
  const status = getCompetitionStatus(competition, currentTime);
  const preview = competition.id.startsWith("preview");
  const leaderboardPreview = leaderboard.slice(0, 5);
  const recentProposals = selectRecentProposals(leaderboard);
  const authFailure = authError ? authErrorMessages[authError] ?? authErrorMessages.x_signin_failed : null;
  return <div className="pageShell homePage">
    <section className="competitionHero compactHero">
      <div><h1>Launch Competition</h1><div className="competitionStatus"><StatusBadge tone={status.tone}>{status.label}</StatusBadge>{preview && <span>Preview data · not final</span>}</div></div>
      <div className="heroSummaryCard">
        <div className="heroDeadline"><span>{status.deadlineLabel}</span><strong>{status.deadlineAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</strong><small>{daysRemaining(status.deadlineAt.toISOString())} days remaining</small></div>
        <span className="heroSummaryDivider" aria-hidden="true" />
        <dl className="heroStats">
          <div className="heroStat"><dt>Votes cast</dt><dd>{competition.voteCount.toLocaleString()}</dd></div>
          <div className="heroStat"><dt>OTF proposals</dt><dd>{competition.proposalCount.toLocaleString()}</dd></div>
          <div className="heroStat heroStatInteractive"><dt>Verified assets</dt><dd>{verifiedAssetCount.toLocaleString()}</dd><Link className="heroStatHitArea" href="/assets" aria-label={`View ${verifiedAssetCount.toLocaleString()} verified assets in the asset registry`} /></div>
        </dl>
      </div>
    </section>
    {authFailure && <Callout tone={authError === "x_signin_cancelled" ? "warning" : "danger"}><strong>{authFailure.title}</strong> <span>{authFailure.detail}</span></Callout>}
    {(voteError === "PROPOSAL_POST_NOT_FOUND" || voteError === "PROPOSAL_NOT_FOUND") && <Callout tone="danger"><strong>Your votes were not cast.</strong> A selected OTF no longer has its required X post and was removed from the competition.</Callout>}
    <CompetitionTimeline competition={competition} />
    <div className="boardGrid">
      <SectionCard className="leaderboardCard"><div className="cardHeading"><span>OTF Leaderboard</span>{status.submissionsOpen && leaderboardPreview.length > 0 && <Button href="/submit" variant="secondary" className="leaderboardSubmitButton">Create OTF</Button>}</div>
        <ResponsiveLeaderboard entries={leaderboardPreview} submissionsOpen={status.submissionsOpen} />
        <div className="cardFooter leaderboardPreviewFooter"><span>{preview ? "Preview data shown — not final." : `Last updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</span><Link href="/leaderboard">See full leaderboard <ArrowRight size={14} /></Link></div>
      </SectionCard>
      <HowItWorks eligibility={eligibility} rules={competition.rules} votingOpen={status.votingOpen} votingStartsAt={status.votingStartsAt.toISOString()} currentTime={currentTime.toISOString()} />
    </div>
    <div className="lowerGrid">
      <SectionCard className="rulesPanel"><div className="cardHeading"><span>Competition rules</span><FileCheck2 size={18} /></div><ul><li>Use a verified, public X account with at least {competition.rules.minFollowers.toLocaleString()} followers.</li><li>Confirm up to {competition.rules.maxProposalsPerAccount} OTF proposals per account; deleting one frees its slot.</li><li>Voting starts after the {competition.rules.submissionOnlyDays}-day submission week with {competition.rules.initialVotes} unlocked votes.</li><li>{competition.rules.votesPerUnlock} vote unlocks every {competition.rules.voteUnlockIntervalDays} voting days, up to {competition.rules.totalVotes}; cast votes are final.</li><li>Each voting action requires a new public X post, and one post can verify several votes.</li></ul><Link href="/rules">View all rules <ArrowRight size={14} /></Link></SectionCard>
      <SectionCard className="activityPanel"><div className="cardHeading"><span>Recent activity</span><History size={18} /></div><div className="participationActivity">{recentProposals.length ? recentProposals.map((proposal) => <div key={proposal.id}><Layers3 size={16} /><span className="activitySentence"><a href={`https://x.com/${encodeURIComponent(proposal.creator.username)}`} target="_blank" rel="noreferrer">@{proposal.creator.username}</a><span>proposed</span><Link href={`/otfs/${proposal.slug}`}>{proposal.name}</Link></span></div>) : <div><Layers3 size={16} /><span>No recent proposals yet.</span></div>}</div></SectionCard>
    </div>
  </div>;
}
