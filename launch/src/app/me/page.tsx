import Link from "next/link";
import { BadgeCheck, CircleX, Clock3, ExternalLink, Layers3, LogIn, LogOut, ShieldAlert, UnlockKeyhole, Users, Vote } from "lucide-react";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { EligibilityAction } from "@/components/EligibilityGate";
import { DeleteProposalForm, type DeleteProposalState } from "@/components/DeleteProposalForm";
import { CompetitionCountdown } from "@/components/CompetitionCountdown";
import { Button, SectionCard, StatusBadge } from "@/components/ui";
import { XSignInButton } from "@/components/XSignInButton";
import { XProfileImage } from "@/components/XProfileImage";
import { auth, signOut } from "@/server/auth";
import { deleteProposal } from "@/server/actions";
import { getCompetition } from "@/server/data";
import { db } from "@/server/db";
import { ballotAllocations, ballots, proposals, users } from "@/server/db/schema";
import { COMPETITION_RULES, getCompetitionTiming } from "@/lib/competition";
import { errorMessages } from "@/lib/errors";
import { getBallotSummary } from "@/server/ballot";
import { getParticipationEligibility } from "@/server/participation";
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
    if (code === "PROPOSAL_HAS_VOTES") {
      revalidatePath("/me");
      return { error: null, disabledReason: errorMessages.PROPOSAL_HAS_VOTES };
    }
    if (!(code in errorMessages)) console.error("Failed to delete proposal", error);
    return { error: errorMessages[code] ?? errorMessages.INTERNAL_ERROR };
  }
  revalidatePath("/me");
  revalidatePath("/");
  revalidatePath("/leaderboard");
  return { error: null };
}

export default async function MePage() {
  const session = await auth();
  if (!session?.user?.id) return <div className="pageShell contentPage"><SectionCard className="emptyState"><LogIn size={30} /><h1>Sign in with X to view your activity</h1><p>Your proposals, vote distribution and proof history appear here.</p><XSignInButton redirectTo="/me" /></SectionCard></div>;
  const [identityRows, ownProposals, ownVoteAllocations] = db ? await Promise.all([
    db.select().from(users).where(eq(users.id, session.user.id)).limit(1),
    db.select({
      id: proposals.id,
      slug: proposals.slug,
      name: proposals.name,
      ticker: proposals.ticker,
      status: proposals.status,
      createdAt: proposals.createdAt,
      votes: sql<number>`coalesce((
        select sum(${ballotAllocations.votes}) from ${ballotAllocations}
        join ${ballots} on ${ballots.id} = ${ballotAllocations.ballotId}
        where ${ballotAllocations.proposalId} = ${proposals.id} and ${ballots.status} = 'valid'
      ), 0)::int`,
    }).from(proposals).where(and(eq(proposals.creatorUserId, session.user.id), ne(proposals.status, "draft"))).orderBy(desc(proposals.createdAt)),
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
      .where(and(eq(ballots.voterUserId, session.user.id), eq(ballots.status, "valid")))
      .orderBy(desc(ballotAllocations.updatedAt))
  ]) : [[], [], []];
  const identity = identityRows[0];
  const competition = await getCompetition();
  const currentTime = new Date();
  const timing = getCompetitionTiming(competition, currentTime);
  const [eligibility, ballot] = await Promise.all([
    getParticipationEligibility(session.user, competition),
    getBallotSummary(competition.id, session.user.id),
  ]);
  const votePosts = ballot?.votePosts ?? [];
  const meetsFollowerRequirement = identity ? identity.followersCount >= eligibility.minFollowers : false;
  const verificationLabel = identity ? (identity.verified ? "X verified" : "Not verified") : "Status unavailable";
  const username = session.user.xUsername ?? session.user.name ?? "X user";
  const proposedOtfCount = ownProposals.filter((proposal) => proposal.status !== "deleted").length;
  const votesAllocated = ownVoteAllocations.reduce((sum, allocation) => sum + allocation.votes, 0);
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
      <SectionCard><Layers3 size={19} /><span>OTF proposals</span><strong>{proposedOtfCount}</strong></SectionCard>
      <SectionCard><UnlockKeyhole size={19} /><span>Votes unlocked</span><strong>{timing.unlockedVotes}</strong></SectionCard>
      <SectionCard><Vote size={19} /><span>Votes allocated</span><strong>{votesAllocated}</strong></SectionCard>
    </div>
    {!timing.votingOpen && <SectionCard className="accountVotingGate"><Clock3 size={24} aria-hidden="true" /><div className="accountVotingGateCopy"><strong>Voting opens in</strong><CompetitionCountdown target={timing.votingStartsAt.toISOString()} currentTime={currentTime.toISOString()} /><p>Your first {COMPETITION_RULES.initialVotes} votes unlock when submission week ends.</p></div><Button href="/vote" variant="secondary">View voting</Button></SectionCard>}
    <SectionCard className="contentCard accountSubmissions"><div className="accountSectionHeading"><h2>Your submissions</h2>{timing.submissionsOpen && <Button href="/submit" variant="secondary">Submit OTF</Button>}</div>{ownProposals.length ? <div className="submissionList">{ownProposals.map((proposal) => {
      const badgeTone = proposal.status === "confirmed" ? "positive" : proposal.status === "deleted" ? "danger" : "warning";
      const identity = <><strong>{proposal.name}</strong><small>${proposal.ticker} · {proposal.votes.toLocaleString()} votes</small></>;
      return <div className="submissionRow" key={proposal.id}><div className="submissionIdentity">{proposal.status === "confirmed" ? <Link href={`/otfs/${proposal.slug}`}>{identity}</Link> : identity}</div><div className="submissionRowActions"><StatusBadge tone={badgeTone}>{proposal.status}</StatusBadge>{proposal.status !== "deleted" && <DeleteProposalForm proposalId={proposal.id} proposalName={proposal.name} action={deleteOwnProposal} disabledReason={!timing.submissionsOpen ? errorMessages.COMPETITION_NOT_OPEN : proposal.votes > 0 ? errorMessages.PROPOSAL_HAS_VOTES : undefined} />}</div></div>;
    })}</div> : <p>{timing.submissionsOpen ? <>No submissions yet. <Link className="inlineLink" href="/submit">Create an OTF</Link>.</> : "You did not submit an OTF before the competition closed."}</p>}</SectionCard>
    {timing.votingOpen && <><SectionCard className="contentCard"><h2>OTFs you voted on</h2>{ownVoteAllocations.length ? <div className="activityList">{ownVoteAllocations.map((allocation) => <div className="activityRow" key={allocation.proposalId}><span className="activityIcon vote" aria-hidden="true"><Vote size={16} /></span><div className="activityCopy">{allocation.proposalStatus === "confirmed" ? <Link href={`/otfs/${allocation.proposalSlug}`}><strong>{allocation.proposalName}</strong></Link> : <strong>{allocation.proposalName}</strong>}<small>${allocation.proposalTicker} · {allocation.votes} locked {allocation.votes === 1 ? "vote" : "votes"}{allocation.proposalStatus === "deleted" ? " · unavailable" : ""}</small></div><time dateTime={allocation.updatedAt.toISOString()}>{allocation.updatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</time></div>)}</div> : <p>You haven’t voted on any OTFs yet. <Link className="inlineLink" href="/vote">Cast your unlocked votes</Link>.</p>}</SectionCard>
    <SectionCard className="contentCard accountVoteHistory"><div className="accountSectionHeading"><div><h2>Voting post history</h2><p>Each post records one batch of newly allocated votes.</p></div></div>{votePosts.length ? <ol className="votePostList">{votePosts.map((post, index) => {
      const label = `Vote post ${index + 1}`;
      const statusTone = post.status === "valid" ? "positive" : post.status === "invalid" ? "danger" : "warning";
      return <li className="votePostRow" key={post.evidenceId}><div className="votePostHeader"><div className="votePostIdentity"><a className="votePostLink" href={post.postUrl} target="_blank" rel="noreferrer" aria-label={`${label} on X (opens in a new tab)`}>{label}<ExternalLink size={13} aria-hidden="true" /></a><StatusBadge tone={statusTone}>{post.status}</StatusBadge></div><time dateTime={post.acceptedAt}>{new Date(post.acceptedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</time></div><ul className="voteTrancheList" aria-label={`Votes verified by ${label}`}>{post.tranches.map((tranche) => <li className="voteTrancheRow" key={tranche.id}><div>{tranche.proposalStatus === "confirmed" ? <Link href={`/otfs/${tranche.proposalSlug}`}>{tranche.proposalName}</Link> : <span>{tranche.proposalName}</span>}<small>${tranche.proposalTicker}{tranche.proposalStatus === "deleted" ? " · unavailable" : ""}</small></div><strong>{tranche.votes} {tranche.votes === 1 ? "vote" : "votes"}</strong></li>)}</ul></li>;
    })}</ol> : <p>No voting posts yet. Your verified voting batches will appear here.</p>}</SectionCard></>}
  </div>;
}
