import Link from "next/link";
import { BadgeCheck, CircleX, Clock3, ExternalLink, Layers3, LogIn, LogOut, PencilLine, ShieldAlert, UnlockKeyhole, Users, Vote } from "lucide-react";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { EligibilityAction } from "@/components/EligibilityGate";
import { DeleteProposalForm, type DeleteProposalState } from "@/components/DeleteProposalForm";
import { CompetitionCountdown } from "@/components/CompetitionCountdown";
import { Button, SectionCard, StatusBadge } from "@/components/ui";
import { XSignInButton } from "@/components/XSignInButton";
import { XProfileImage } from "@/components/XProfileImage";
import { auth, signOut } from "@/server/auth";
import { deleteProposal, expireProposalDrafts } from "@/server/actions";
import { getCompetition } from "@/server/data";
import { db } from "@/server/db";
import { ballotAllocations, ballots, proposals, users } from "@/server/db/schema";
import { getCompetitionTiming } from "@/lib/competition";
import { errorMessages } from "@/lib/errors";
import { getBallotSummary } from "@/server/ballot";
import { getParticipationEligibility } from "@/server/participation";
import { getVoterProposalPerformance } from "@/server/prices";
export const metadata = { title: "My profile" };

async function disconnectX() {
  "use server";
  await signOut({ redirectTo: "/" });
}

async function deleteOwnProposal(_state: DeleteProposalState, formData: FormData): Promise<DeleteProposalState> {
  "use server";
  const proposalId = formData.get("proposalId");
  const confirmationName = formData.get("confirmationName");
  if (typeof proposalId !== "string" || typeof confirmationName !== "string") return { error: errorMessages.INTERNAL_ERROR };
  try {
    await deleteProposal(proposalId, confirmationName);
  } catch (error) {
    const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
    if (!(code in errorMessages)) console.error("Failed to delete proposal", error);
    return { error: errorMessages[code] ?? errorMessages.INTERNAL_ERROR };
  }
  revalidatePath("/me");
  revalidatePath("/");
  revalidatePath("/leaderboard");
  revalidatePath("/vote");
  revalidatePath("/submit");
  return { error: null };
}

export default async function MePage() {
  const session = await auth();
  if (!session?.user?.id) return <div className="pageShell contentPage"><SectionCard className="emptyState"><LogIn size={30} /><h1>Sign in with X to view your activity</h1><p>Your proposals, vote distribution and proof history appear here.</p><XSignInButton redirectTo="/me" /></SectionCard></div>;
  const competition = await getCompetition();
  const currentTime = new Date();
  const performanceAsOf = new Date(Math.min(currentTime.getTime(), new Date(competition.endsAt).getTime()));
  if (db) await expireProposalDrafts(competition.id, session.user.id, currentTime);
  const [identityRows, ownProposals, ownVoteAllocations, votePerformance] = db ? await Promise.all([
    db.select().from(users).where(eq(users.id, session.user.id)).limit(1),
    db.select({
      id: proposals.id,
      slug: proposals.slug,
      name: proposals.name,
      ticker: proposals.ticker,
      status: proposals.status,
      draftExpiresAt: proposals.draftExpiresAt,
      createdAt: proposals.createdAt,
      votes: sql<number>`coalesce((
        select sum(${ballotAllocations.votes}) from ${ballotAllocations}
        join ${ballots} on ${ballots.id} = ${ballotAllocations.ballotId}
        where ${ballotAllocations.proposalId} = ${proposals.id} and ${ballots.status} = 'valid'
      ), 0)::int`,
    }).from(proposals).where(and(eq(proposals.competitionId, competition.id), eq(proposals.creatorUserId, session.user.id), ne(proposals.status, "deleted"))).orderBy(desc(proposals.createdAt)),
    db.select({
      proposalId: proposals.id,
      proposalName: proposals.name,
      proposalSlug: proposals.slug,
      proposalTicker: proposals.ticker,
      proposalStatus: proposals.status,
      votes: ballotAllocations.votes,
      updatedAt: ballotAllocations.updatedAt,
    }).from(ballotAllocations)
      .innerJoin(ballots, eq(ballotAllocations.ballotId, ballots.id))
      .innerJoin(proposals, eq(ballotAllocations.proposalId, proposals.id))
      .where(and(eq(ballots.competitionId, competition.id), eq(ballots.voterUserId, session.user.id), eq(ballots.status, "valid")))
      .orderBy(desc(ballotAllocations.updatedAt)),
    getVoterProposalPerformance(competition.id, session.user.id, performanceAsOf),
  ]) : [[], [], [], []];
  const identity = identityRows[0];
  const timing = getCompetitionTiming(competition, currentTime);
  const [eligibility, ballot] = await Promise.all([
    getParticipationEligibility(session.user, competition),
    getBallotSummary(competition.id, session.user.id),
  ]);
  const votePosts = ballot?.votePosts ?? [];
  const meetsFollowerRequirement = identity ? identity.followersCount >= eligibility.minFollowers : false;
  const verificationLabel = identity ? (identity.verified ? "X verified" : "Not verified") : "Status unavailable";
  const username = session.user.xUsername ?? session.user.name ?? "X user";
  const confirmedProposalCount = ownProposals.filter((proposal) => proposal.status === "confirmed").length;
  const proposalLimit = competition.rules.maxProposalsPerAccount;
  const votesAllocated = ownVoteAllocations.reduce((sum, allocation) => sum + allocation.votes, 0);
  const performanceByProposal = new Map(votePerformance.map((performance) => [performance.proposalId, performance]));
  return <div className="pageShell contentPage">
    <header className="pageHeader accountHeader">
      <div className="accountTitle">
        <XProfileImage src={identity?.profileImageUrl ?? session.user.image} username={username} size={46} />
        <h1>@{username}</h1>
      </div>
      <div className="accountControls"><div className="accountIdentitySummary" aria-label="X account details">
        <div className={`accountFollowerCount ${meetsFollowerRequirement ? "eligible" : "underMinimum"}`}><Users size={17} aria-hidden="true" /><span><strong>{identity ? identity.followersCount.toLocaleString() : "—"}</strong> followers</span></div>
        <span className={`accountVerificationStatus ${identity?.verified ? "verified" : "unverified"}`}>{identity?.verified ? <BadgeCheck size={17} aria-hidden="true" /> : <CircleX size={17} aria-hidden="true" />}<span>{verificationLabel}</span></span>
      </div><form className="accountHeaderActionForm" action={disconnectX}><Button type="submit" variant="ghost" className="disconnectButton"><LogOut size={15} /> Disconnect X</Button></form></div>
    </header>
    {!eligibility.eligible && <SectionCard className="contentCard accountEligibilityPrompt"><ShieldAlert size={22} aria-hidden="true" /><strong>Eligible X account required</strong><p>Your account needs to be verified, public, and have at least {eligibility.minFollowers.toLocaleString()} followers.</p><EligibilityAction eligibility={eligibility} action="submit" callbackUrl="/me">{eligibility.connected ? "Use another X account" : "Sign in with an eligible account"}</EligibilityAction></SectionCard>}
    <div className="accountMetrics">
      <SectionCard><Layers3 size={19} /><span>Confirmed proposals</span><strong>{confirmedProposalCount} / {proposalLimit ?? "∞"}</strong></SectionCard>
      <SectionCard><UnlockKeyhole size={19} /><span>Votes unlocked</span><strong>{timing.unlockedVotes}</strong></SectionCard>
      <SectionCard><Vote size={19} /><span>Votes allocated</span><strong>{votesAllocated}</strong></SectionCard>
    </div>
    {timing.stage === "submissions" && <SectionCard className="accountVotingGate"><Clock3 size={24} aria-hidden="true" /><div className="accountVotingGateCopy"><strong>Voting opens in</strong><CompetitionCountdown target={timing.votingStartsAt.toISOString()} currentTime={currentTime.toISOString()} /><p>Your first {competition.rules.initialVotes} votes unlock when submission week ends.</p></div><Button href="/vote" variant="secondary">View voting</Button></SectionCard>}
    <SectionCard className="contentCard accountSubmissions"><div className="accountSectionHeading"><h2>Your submissions</h2>{timing.submissionsOpen && <Button href="/submit" variant="secondary">Submit OTF</Button>}</div>{ownProposals.length ? <div className="submissionList">{ownProposals.map((proposal) => {
      const badgeTone = proposal.status === "confirmed" ? "positive" : proposal.status === "expired" ? "danger" : "warning";
      const expiry = proposal.draftExpiresAt ? new Date(proposal.draftExpiresAt) : null;
      const detail = proposal.status === "draft" && expiry
        ? <>Draft · expires <time dateTime={expiry.toISOString()}>{expiry.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></>
        : proposal.status === "expired"
          ? "Expired · name and ticker released"
          : `${proposal.votes.toLocaleString()} votes`;
      const identity = <><strong>{proposal.name}</strong><small>${proposal.ticker} · {detail}</small></>;
      const deleteDisabledReason = proposal.status === "confirmed" && !timing.submissionsOpen ? errorMessages.COMPETITION_NOT_OPEN : undefined;
      return <div className="submissionRow" key={proposal.id}><div className="submissionIdentity">{proposal.status === "confirmed" ? <Link href={`/otfs/${proposal.slug}`}>{identity}</Link> : identity}</div><div className="submissionRowActions"><StatusBadge tone={badgeTone}>{proposal.status}</StatusBadge>{proposal.status === "draft" && timing.submissionsOpen && <Button href={`/submit?draft=${proposal.id}`} variant="ghost" className="resumeDraftButton"><PencilLine size={14} /> Resume</Button>}<DeleteProposalForm proposalId={proposal.id} proposalName={proposal.name} voteCount={proposal.votes} action={deleteOwnProposal} disabledReason={deleteDisabledReason} /></div></div>;
    })}</div> : <p>{timing.submissionsOpen ? <>No submissions yet. <Link className="inlineLink" href="/submit">Create an OTF</Link>.</> : "You did not submit an OTF before the competition closed."}</p>}</SectionCard>
    {(timing.stage === "voting" || timing.stage === "review" || timing.stage === "final" || timing.stage === "cancelled") && <><SectionCard className="contentCard accountVotes"><div className="accountSectionHeading"><div><h2>OTFs you voted on</h2><p>Vote performance is quantity-weighted from each batch’s entry price checkpoint.</p></div></div>{ownVoteAllocations.length ? <div className="votePerformanceTableWrap"><table className="votePerformanceTable"><thead><tr><th scope="col">OTF</th><th scope="col">Votes</th><th scope="col">Vote performance</th><th scope="col">Last voted</th></tr></thead><tbody>{ownVoteAllocations.map((allocation) => {
      const performance = performanceByProposal.get(allocation.proposalId);
      const performanceLabel = allocation.proposalStatus === "deleted" ? "Excluded" : performance?.returnPct == null ? "Pending" : `${performance.returnPct > 0 ? "+" : ""}${performance.returnPct.toFixed(2)}%`;
      const performanceTone = allocation.proposalStatus === "deleted" ? "excluded" : performance?.returnPct == null ? "pending" : performance.returnPct > 0 ? "positive" : performance.returnPct < 0 ? "negative" : "flat";
      return <tr key={allocation.proposalId}><td><div className="votePerformanceIdentity"><span className="activityIcon vote" aria-hidden="true"><Vote size={16} /></span><div className="activityCopy">{allocation.proposalStatus === "confirmed" ? <Link href={`/otfs/${allocation.proposalSlug}`}><strong>{allocation.proposalName}</strong></Link> : <strong>{allocation.proposalName}</strong>}<small>${allocation.proposalTicker}{allocation.proposalStatus === "deleted" ? " · unavailable" : ""}<span className="votePerformanceMobileDate"> · {allocation.updatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></small></div></div></td><td className="votePerformanceVotes">{allocation.votes}</td><td><span className={`votePerformanceValue ${performanceTone}`} title={performance?.latestCheckpointAt ? `Latest price checkpoint: ${new Date(performance.latestCheckpointAt).toLocaleString("en-US")}` : undefined}>{performanceLabel}</span></td><td className="votePerformanceDate"><time dateTime={allocation.updatedAt.toISOString()}>{allocation.updatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</time></td></tr>;
    })}</tbody></table></div> : <p>You haven’t voted on any OTFs yet. <Link className="inlineLink" href="/vote">Cast your unlocked votes</Link>.</p>}</SectionCard>
    <SectionCard className="contentCard accountVoteHistory"><div className="accountSectionHeading"><div><h2>Voting post history</h2><p>Keep every post public and unchanged until final results are published. An invalid voting post voids that batch without restoring its spent votes.</p></div></div>{votePosts.length ? <ol className="votePostList">{votePosts.map((post, index) => {
      const label = `Vote post ${index + 1}`;
      const statusTone = post.status === "valid" ? "positive" : post.status === "invalid" ? "danger" : "warning";
      return <li className="votePostRow" key={post.evidenceId}><div className="votePostHeader"><div className="votePostIdentity"><a className="votePostLink" href={post.postUrl} target="_blank" rel="noreferrer" aria-label={`${label} on X (opens in a new tab)`}>{label}<ExternalLink size={13} aria-hidden="true" /></a><StatusBadge tone={statusTone}>{post.status}</StatusBadge></div><time dateTime={post.acceptedAt}>{new Date(post.acceptedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</time></div><ul className="voteTrancheList" aria-label={`Votes verified by ${label}`}>{post.tranches.map((tranche) => <li className="voteTrancheRow" key={tranche.id}><div>{tranche.proposalStatus === "confirmed" ? <Link href={`/otfs/${tranche.proposalSlug}`}>{tranche.proposalName}</Link> : <span>{tranche.proposalName}</span>}<small>${tranche.proposalTicker}{tranche.proposalStatus === "deleted" ? " · unavailable" : ""}</small></div><strong>{tranche.votes} {tranche.votes === 1 ? "vote" : "votes"}</strong></li>)}</ul></li>;
    })}</ol> : <p>No voting posts yet. Your verified voting batches will appear here.</p>}</SectionCard></>}
  </div>;
}
