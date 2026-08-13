import { SubmitWizard } from "@/components/SubmitWizard";
import { auth } from "@/server/auth";
import { getCompetition, getEligibleAssets } from "@/server/data";
import { getParticipationEligibility } from "@/server/participation";
export const metadata = { title: "Submit OTF" };
export default async function SubmitPage() { const [competition, assets, session] = await Promise.all([getCompetition(), getEligibleAssets(), auth()]); const eligibility = await getParticipationEligibility(session?.user, competition); return <div className="pageShell contentPage wideContent"><header className="pageHeader"><h1>Submit OTF</h1><p>Build a coherent portfolio from eligible real-world assets. Participation requires a verified, public X account with at least {competition.minFollowers.toLocaleString()} followers.</p></header><SubmitWizard competition={competition} assets={assets} eligibility={eligibility} turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001"} /></div>; }
