import Link from "next/link";
import { Activity, BadgeCheck, LogIn, LogOut, Users, Vote } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { Button, SectionCard, StatusBadge } from "@/components/ui";
import { XSignInButton } from "@/components/XSignInButton";
import { XProfileImage } from "@/components/XProfileImage";
import { auth, signOut } from "@/server/auth";
import { db } from "@/server/db";
import { activityEvents, proposals, users, votes } from "@/server/db/schema";
export const metadata = { title: "My activity" };

async function disconnectX() {
  "use server";
  await signOut({ redirectTo: "/" });
}

export default async function MePage() {
  const session = await auth();
  if (!session?.user?.id) return <div className="pageShell contentPage"><SectionCard className="emptyState"><LogIn size={30} /><h1>Sign in with X to view your activity</h1><p>Your submissions, verified votes and proof history appear here.</p><XSignInButton redirectTo="/me" /></SectionCard></div>;
  const [identityRows, ownProposals, ownVotes, activity] = db ? await Promise.all([
    db.select().from(users).where(eq(users.id, session.user.id)).limit(1),
    db.select().from(proposals).where(eq(proposals.creatorUserId, session.user.id)),
    db.select().from(votes).where(eq(votes.voterUserId, session.user.id)),
    db.select().from(activityEvents).where(eq(activityEvents.actorUserId, session.user.id)).orderBy(desc(activityEvents.occurredAt)).limit(30)
  ]) : [[], [], [], []];
  const identity = identityRows[0];
  const verificationLabel = identity ? (identity.verified ? "X verified" : "Not verified") : "Status unavailable";
  const username = session.user.xUsername ?? session.user.name ?? "X user";
  return <div className="pageShell contentPage"><header className="pageHeader accountHeader"><div><div className="accountTitle"><XProfileImage src={identity?.profileImageUrl ?? session.user.image} username={username} size={46} /><h1>@{username}</h1><form className="accountHeaderActionForm" action={disconnectX}><Button type="submit" variant="secondary" className="disconnectButton"><LogOut size={15} /> Disconnect X</Button></form></div><p>Your X identity is refreshed whenever you connect.</p></div><div className="accountControls"><div className="accountIdentitySummary" aria-label="X account details"><div className="accountFollowerCount"><Users size={17} aria-hidden="true" /><span><strong>{identity ? identity.followersCount.toLocaleString() : "—"}</strong> followers</span></div><StatusBadge tone={identity?.verified ? "positive" : "neutral"}>{verificationLabel}</StatusBadge></div></div></header><div className="accountMetrics"><SectionCard><BadgeCheck size={19} /><span>Proposal</span><strong>{ownProposals[0]?.status ?? "None"}</strong></SectionCard><SectionCard><Vote size={19} /><span>Votes</span><strong>{ownVotes.filter((vote) => vote.status === "valid").length}</strong></SectionCard><SectionCard><Activity size={19} /><span>Verified actions</span><strong>{activity.length}</strong></SectionCard></div><SectionCard className="contentCard"><h2>Activity history</h2>{activity.length ? <div className="activityList">{activity.map((event) => <div key={event.id}><span>{event.eventType.replace(".", " ")}</span><time>{event.occurredAt.toLocaleDateString()}</time></div>)}</div> : <p>No verified activity yet. <Link className="inlineLink" href="/submit">Submit an OTF</Link> or vote from the leaderboard.</p>}</SectionCard></div>;
}
