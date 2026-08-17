import Link from "next/link";
import { Activity, BadgeCheck, CircleX, Layers3, LogIn, LogOut, ShieldAlert, Trash2, Users, Vote } from "lucide-react";
import { desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { EligibilityAction } from "@/components/EligibilityGate";
import { Button, SectionCard, StatusBadge } from "@/components/ui";
import { XSignInButton } from "@/components/XSignInButton";
import { XProfileImage } from "@/components/XProfileImage";
import { auth, signOut } from "@/server/auth";
import { deleteProposal } from "@/server/actions";
import { getCompetition } from "@/server/data";
import { db } from "@/server/db";
import { activityEvents, ballotAllocations, ballots, proposals, users } from "@/server/db/schema";
import { getParticipationEligibility } from "@/server/participation";
export const metadata = { title: "My profile" };

type AccountActivity = {
  id: string;
  eventType: string;
  occurredAt: Date;
  proposalName: string | null;
};

function activityDetails(event: AccountActivity) {
  const proposalName = event.proposalName ?? "OTF proposal";
  if (event.eventType === "proposal.confirmed" || event.eventType === "proposal.accepted") return { title: `Proposed ${proposalName}`, detail: "Confirmed by its X post", kind: "proposal" };
  if (event.eventType === "ballot.activated") return { title: "Cast your first votes", detail: "Activated your ballot", kind: "vote" };
  if (event.eventType === "ballot.updated") return { title: "Cast newly unlocked votes", detail: "Added permanent votes to your ballot", kind: "vote" };
  if (event.eventType === "proposal.hidden") return { title: `${proposalName} was hidden`, detail: "Removed from the public leaderboard", kind: "proposal" };
  if (event.eventType === "proposal.disqualified") return { title: `${proposalName} was disqualified`, detail: "Removed from the competition", kind: "proposal" };
  if (event.eventType === "proposal.deleted" || event.eventType === "proposal.withdrawn") return { title: `Deleted ${proposalName}`, detail: "Removed your zero-vote submission", kind: "proposal" };
  return { title: `Updated ${proposalName}`, detail: "Account activity", kind: "activity" };
}

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
  const [identityRows, ownProposals, ownVoteAllocations, activity] = db ? await Promise.all([
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
    }).from(proposals).where(eq(proposals.creatorUserId, session.user.id)).orderBy(desc(proposals.createdAt)),
    db.select({ votes: ballotAllocations.votes, status: ballots.status }).from(ballotAllocations).innerJoin(ballots, eq(ballotAllocations.ballotId, ballots.id)).where(eq(ballots.voterUserId, session.user.id)),
    db.select({
      id: activityEvents.id,
      eventType: activityEvents.eventType,
      occurredAt: activityEvents.occurredAt,
      proposalName: proposals.name,
    }).from(activityEvents).leftJoin(proposals, eq(activityEvents.proposalId, proposals.id)).where(eq(activityEvents.actorUserId, session.user.id)).orderBy(desc(activityEvents.occurredAt)).limit(30)
  ]) : [[], [], [], []];
  const identity = identityRows[0];
  const competition = await getCompetition();
  const eligibility = await getParticipationEligibility(session.user, competition);
  const meetsFollowerRequirement = identity ? identity.followersCount >= eligibility.minFollowers : false;
  const verificationLabel = identity ? (identity.verified ? "X verified" : "Not verified") : "Status unavailable";
  const username = session.user.xUsername ?? session.user.name ?? "X user";
  const proposedOtfCount = ownProposals.filter((proposal) => proposal.status !== "deleted").length;
  const confirmedOtfCount = ownProposals.filter((proposal) => proposal.status === "confirmed").length;
  const votesAllocated = ownVoteAllocations.filter((allocation) => allocation.status === "valid").reduce((sum, allocation) => sum + allocation.votes, 0);
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
      <SectionCard><Activity size={19} /><span>Confirmed</span><strong>{confirmedOtfCount}</strong></SectionCard>
      <SectionCard><Vote size={19} /><span>Votes allocated</span><strong>{votesAllocated}</strong></SectionCard>
    </div>
    <SectionCard className="contentCard accountSubmissions"><div className="accountSectionHeading"><h2>Your submissions</h2><Button href="/submit">Submit OTF</Button></div>{ownProposals.length ? <div className="submissionList">{ownProposals.map((proposal) => {
      const canDelete = proposal.status !== "deleted" && proposal.votes === 0;
      const badgeTone = proposal.status === "confirmed" ? "positive" : proposal.status === "deleted" ? "danger" : "warning";
      const identity = <><strong>{proposal.name}</strong><small>${proposal.ticker} · {proposal.votes.toLocaleString()} votes</small></>;
      return <div className="submissionRow" key={proposal.id}><div className="submissionIdentity">{proposal.status === "confirmed" ? <Link href={`/otfs/${proposal.slug}`}>{identity}</Link> : identity}</div><StatusBadge tone={badgeTone}>{proposal.status}</StatusBadge>{canDelete ? <form action={deleteOwnProposal}><input type="hidden" name="proposalId" value={proposal.id} /><Button type="submit" variant="ghost" className="deleteSubmissionButton" aria-label={`Delete ${proposal.name}`}><Trash2 size={14} /> Delete</Button></form> : <span className="submissionDeleteUnavailable">{proposal.status === "deleted" ? "" : "Has votes"}</span>}</div>;
    })}</div> : <p>No submissions yet. <Link className="inlineLink" href="/submit">Create an OTF</Link>.</p>}</SectionCard>
    <SectionCard className="contentCard"><h2>Activity history</h2>{activity.length ? <div className="activityList">{activity.map((event) => {
      const details = activityDetails(event);
      return <div className="activityRow" key={event.id}><span className={`activityIcon ${details.kind}`} aria-hidden="true">{details.kind === "vote" ? <Vote size={16} /> : details.kind === "proposal" ? <Layers3 size={16} /> : <Activity size={16} />}</span><div className="activityCopy"><strong>{details.title}</strong><small>{details.detail}</small></div><time dateTime={event.occurredAt.toISOString()}>{event.occurredAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</time></div>;
    })}</div> : <p>No activity yet. <Link className="inlineLink" href="/submit">Create an OTF</Link> or <Link className="inlineLink" href="/vote">cast your unlocked votes</Link>.</p>}</SectionCard>
  </div>;
}
