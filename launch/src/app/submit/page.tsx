import { SubmitWizard } from "@/components/SubmitWizard";
import { auth } from "@/server/auth";
import { getCompetition, getEligibleAssets } from "@/server/data";
import { getParticipationEligibility } from "@/server/participation";
export const metadata = { title: "Submit OTF proposal" };
export default async function SubmitPage() { const [competition, assets, session] = await Promise.all([getCompetition(), getEligibleAssets(), auth()]); const eligibility = await getParticipationEligibility(session?.user, competition); return <div className="pageShell contentPage wideContent"><header className="pageHeader"><h1>Submit OTF proposal</h1><p>Build a portfolio with at least two assets. Verified assets already have approved price sources; unlisted assets need a qualifying Uniswap V3 pool. Submissions stay open through the 7-day opening phase and the full 30-day voting month.</p></header><SubmitWizard competition={competition} assets={assets} eligibility={eligibility} turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} siteUrl={process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001"} /></div>; }
