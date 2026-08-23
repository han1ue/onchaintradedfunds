import { SubmitWizard } from "@/components/SubmitWizard";
import { Callout, SectionCard } from "@/components/ui";
import { LockKeyhole } from "lucide-react";
import { and, eq, sql } from "drizzle-orm";
import { getCompetitionTiming } from "@/lib/competition";
import { auth } from "@/server/auth";
import { getProposalDraftForResume } from "@/server/actions";
import { getAssetRegistry, getCompetition } from "@/server/data";
import { db } from "@/server/db";
import { proposals } from "@/server/db/schema";
import { getParticipationEligibility } from "@/server/participation";
export const metadata = { title: "Create OTF" };
export default async function SubmitPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const [{ draft: draftId }, competition, assets, session] = await Promise.all([searchParams, getCompetition(), getAssetRegistry(), auth()]);
  const eligibility = await getParticipationEligibility(session?.user, competition);
  const submissionsOpen = getCompetitionTiming(competition).submissionsOpen;
  const [countRow] = db && session?.user?.id ? await db.select({
    count: sql<number>`count(*)::int`,
  }).from(proposals).where(and(
    eq(proposals.competitionId, competition.id),
    eq(proposals.creatorUserId, session.user.id),
    eq(proposals.status, "confirmed"),
  )) : [{ count: 0 }];
  const initialDraft = draftId && submissionsOpen && eligibility.eligible
    ? await getProposalDraftForResume(draftId)
    : null;
  const limit = competition.rules.maxProposalsPerAccount;
  return <div className="pageShell contentPage wideContent"><header className="pageHeader"><h1>Create OTF</h1><p>Build a portfolio with at least {competition.rules.minAssets} assets. Verified assets already have saved price sources; unlisted assets must pass server-side Robinhood RPC and GeckoTerminal market checks before they can be added. Each account may confirm up to {limit ?? "an unlimited number of"} OTF proposals during this competition; you currently have {countRow.count}.</p></header>{draftId && !initialDraft && submissionsOpen && <Callout tone="warning"><strong>Draft unavailable.</strong> It may have expired, been removed, or belong to another account.</Callout>}{submissionsOpen ? <SubmitWizard competition={competition} assets={assets} eligibility={eligibility} initialDraft={initialDraft} confirmedProposalCount={countRow.count} turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} /> : <SectionCard className="emptyState"><LockKeyhole size={30} aria-hidden="true" /><h2>Submissions are closed</h2><p>The competition has ended. Existing proposals and votes are now locked for the final audit.</p></SectionCard>}</div>;
}
