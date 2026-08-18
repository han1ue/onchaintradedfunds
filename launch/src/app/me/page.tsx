import Link from "next/link";
import { BadgeCheck, CircleX, Layers3, LogIn, LogOut, ShieldAlert, Trash2, UnlockKeyhole, Users, Vote } from "lucide-react";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { EligibilityAction } from "@/components/EligibilityGate";
import { Button, SectionCard, StatusBadge } from "@/components/ui";
import { XSignInButton } from "@/components/XSignInButton";
import { XProfileImage } from "@/components/XProfileImage";
import { auth, signOut } from "@/server/auth";
import { deleteProposal } from "@/server/actions";
import { getCompetition } from "@/server/data";
import { db } from "@/server/db";
import { ballotAllocations, ballots, proposals, users } from "@/server/db/schema";
import { getCompetitionTiming } from "@/lib/competition";
import { getParticipationEligibility } from "@/server/participation";
export const metadata = { title: "My profile" };

async function disconnectX() {
  "use server";
  await signOut({ redirectTo: "/" });
}

async function deleteOwnProposal(formData: FormData) {
  "use server";
  const proposalId = formData.get("proposalId");
  if (typeof proposalId !== "string") return;
  await deleteProposal(proposalId);
  revalidatePath("/me");
  revalidatePath("/");
  revalidatePath("/leaderboard");
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
  const timing = getCompetitionTiming(competition);
  const eligibility = await getParticipationEligibility(session.user, competition);
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
    <SectionCard className="contentCard accountSubmissions"><div className="accountSectionHeading"><h2>Your submissions</h2><Button href="/submit" variant="secondary">Submit OTF</Button></div>{ownProposals.length ? <div className="submissionList">{ownProposals.map((proposal) => {
      const canDelete = proposal.status !== "deleted" && proposal.votes === 0;
      const badgeTone = proposal.status === "confirmed" ? "positive" : proposal.status === "deleted" ? "danger" : "warning";
      const identity = <><strong>{proposal.name}</strong><small>${proposal.ticker} · {proposal.votes.toLocaleString()} votes</small></>;
      return <div className="submissionRow" key={proposal.id}><div className="submissionIdentity">{proposal.status === "confirmed" ? <Link href={`/otfs/${proposal.slug}`}>{identity}</Link> : identity}</div><div className="submissionRowActions"><StatusBadge tone={badgeTone}>{proposal.status}</StatusBadge>{canDelete ? <form action={deleteOwnProposal}><input type="hidden" name="proposalId" value={proposal.id} /><Button type="submit" variant="ghost" className="deleteSubmissionButton" aria-label={`Delete ${proposal.name}`}><Trash2 size={14} /> Delete</Button></form> : proposal.status !== "deleted" && <span className="submissionDeleteUnavailable">Has votes</span>}</div></div>;
    })}</div> : <p>No submissions yet. <Link className="inlineLink" href="/submit">Create an OTF</Link>.</p>}</SectionCard>
    <SectionCard className="contentCard"><h2>OTFs you voted on</h2>{ownVoteAllocations.length ? <div className="activityList">{ownVoteAllocations.map((allocation) => <div className="activityRow" key={allocation.proposalId}><span className="activityIcon vote" aria-hidden="true"><Vote size={16} /></span><div className="activityCopy"><Link href={`/otfs/${allocation.proposalSlug}`}><strong>{allocation.proposalName}</strong></Link><small>${allocation.proposalTicker} · {allocation.votes} locked {allocation.votes === 1 ? "vote" : "votes"}</small></div><time dateTime={allocation.updatedAt.toISOString()}>{allocation.updatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</time></div>)}</div> : <p>You haven’t voted on any OTFs yet. <Link className="inlineLink" href="/vote">Cast your unlocked votes</Link>.</p>}</SectionCard>
  </div>;
}
