import { SubmitWizard } from "@/components/SubmitWizard";
import { SectionCard } from "@/components/ui";
import { LockKeyhole } from "lucide-react";
import { getCompetitionTiming } from "@/lib/competition";
import { auth } from "@/server/auth";
import { getCompetition, getEligibleAssets } from "@/server/data";
import { getParticipationEligibility } from "@/server/participation";
export const metadata = { title: "Create OTF" };
export default async function SubmitPage() { const [competition, assets, session] = await Promise.all([getCompetition(), getEligibleAssets(), auth()]); const eligibility = await getParticipationEligibility(session?.user, competition); const submissionsOpen = getCompetitionTiming(competition).submissionsOpen; return <div className="pageShell contentPage wideContent"><header className="pageHeader"><h1>Create OTF</h1><p>Build a portfolio with at least two assets. Verified assets already have saved price sources; unlisted assets must pass server-side Robinhood RPC and GeckoTerminal market checks before they can be added. Submissions stay open through the 7-day opening phase and the full 30-day voting month.</p></header>{submissionsOpen ? <SubmitWizard competition={competition} assets={assets} eligibility={eligibility} turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001"} /> : <SectionCard className="emptyState"><LockKeyhole size={30} aria-hidden="true" /><h2>Submissions are closed</h2><p>The competition has ended. Existing proposals and votes are now locked for the final audit.</p></SectionCard>}</div>; }
