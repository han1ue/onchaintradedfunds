import Link from "next/link";
import { Activity, BadgeCheck, CircleX, Layers3, LogIn, LogOut, ShieldAlert, Users, Vote } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { EligibilityAction } from "@/components/EligibilityGate";
import { Button, SectionCard } from "@/components/ui";
import { XSignInButton } from "@/components/XSignInButton";
import { XProfileImage } from "@/components/XProfileImage";
import { auth, signOut } from "@/server/auth";
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
  if (event.eventType === "proposal.accepted") return { title: `Proposed ${proposalName}`, detail: "Added to the OTF competition", kind: "proposal" };
  if (event.eventType === "ballot.activated") return { title: "Cast your first votes", detail: "Activated your ballot", kind: "vote" };
  if (event.eventType === "ballot.updated") return { title: "Cast newly unlocked votes", detail: "Added permanent votes to your ballot", kind: "vote" };
  if (event.eventType === "proposal.hidden") return { title: `${proposalName} was hidden`, detail: "Removed from the public leaderboard", kind: "proposal" };
  if (event.eventType === "proposal.disqualified") return { title: `${proposalName} was disqualified`, detail: "Removed from the competition", kind: "proposal" };
  if (event.eventType === "proposal.withdrawn") return { title: `Withdrew ${proposalName}`, detail: "Removed your proposal from the competition", kind: "proposal" };
  return { title: `Updated ${proposalName}`, detail: "Account activity", kind: "activity" };
}

async function disconnectX() {
  "use server";
  await signOut({ redirectTo: "/" });
}

export default async function MePage() {
  const session = await auth();
  if (!session?.user?.id) return <div className="pageShell contentPage"><SectionCard className="emptyState"><LogIn size={30} /><h1>Sign in with X to view your activity</h1><p>Your proposals, vote distribution and proof history appear here.</p><XSignInButton redirectTo="/me" /></SectionCard></div>;
  const [identityRows, ownProposals, ownVoteAllocations, activity] = db ? await Promise.all([
    db.select().from(users).where(eq(users.id, session.user.id)).limit(1),
    db.select().from(proposals).where(eq(proposals.creatorUserId, session.user.id)),
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
  const proposedOtfCount = ownProposals.filter((proposal) => proposal.status !== "draft" && proposal.status !== "posting").length;
  const runningOtfCount = ownProposals.filter((proposal) => proposal.status === "accepted").length;
  const votesAllocated = ownVoteAllocations.filter((allocation) => allocation.status === "valid").reduce((sum, allocation) => sum + allocation.votes, 0);
  return <div className="pageShell contentPage">
    <header className="pageHeader accountHeader">
      <div className="accountTitle">
        <XProfileImage src={identity?.profileImageUrl ?? session.user.image} username={username} size={46} />
        <div className="accountNameActions"><h1>@{username}</h1><form className="accountHeaderActionForm" action={disconnectX}><Button type="submit" variant="ghost" className="disconnectButton"><LogOut size={15} /> Disconnect X</Button></form></div>
      </div>
      <div className="accountControls"><div className="accountIdentitySummary" aria-label="X account details">
        <div className={`accountFollowerCount ${meetsFollowerRequirement ? "eligible" : "underMinimum"}`}><Users size={17} aria-hidden="true" /><span><strong>{identity ? identity.followersCount.toLocaleString() : "—"}</strong> followers</span></div>
        <span className={`accountVerificationStatus ${identity?.verified ? "verified" : "unverified"}`}>{identity?.verified ? <BadgeCheck size={17} aria-hidden="true" /> : <CircleX size={17} aria-hidden="true" />}<span>{verificationLabel}</span></span>
      </div></div>
    </header>
    {!eligibility.eligible && <SectionCard className="contentCard accountEligibilityPrompt"><ShieldAlert size={22} aria-hidden="true" /><strong>Eligible X account required</strong><p>Your account needs to be verified, public, and have at least {eligibility.minFollowers.toLocaleString()} followers.</p><EligibilityAction eligibility={eligibility} action="submit" callbackUrl="/me">{eligibility.connected ? "Use another X account" : "Sign in with an eligible account"}</EligibilityAction></SectionCard>}
    <div className="accountMetrics">
      <SectionCard><Layers3 size={19} /><span>OTF proposals</span><strong>{proposedOtfCount}</strong></SectionCard>
      <SectionCard><Activity size={19} /><span>Running</span><strong>{runningOtfCount}</strong></SectionCard>
      <SectionCard><Vote size={19} /><span>Votes allocated</span><strong>{votesAllocated}</strong></SectionCard>
    </div>
    <SectionCard className="contentCard"><h2>Activity history</h2>{activity.length ? <div className="activityList">{activity.map((event) => {
      const details = activityDetails(event);
      return <div className="activityRow" key={event.id}><span className={`activityIcon ${details.kind}`} aria-hidden="true">{details.kind === "vote" ? <Vote size={16} /> : details.kind === "proposal" ? <Layers3 size={16} /> : <Activity size={16} />}</span><div className="activityCopy"><strong>{details.title}</strong><small>{details.detail}</small></div><time dateTime={event.occurredAt.toISOString()}>{event.occurredAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</time></div>;
    })}</div> : <p>No activity yet. <Link className="inlineLink" href="/submit">Submit an OTF proposal</Link> or <Link className="inlineLink" href="/vote">cast your unlocked votes</Link>.</p>}</SectionCard>
  </div>;
}
