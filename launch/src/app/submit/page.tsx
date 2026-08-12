import { SubmitWizard } from "@/components/SubmitWizard";
import { auth } from "@/server/auth";
import { getCompetition, getEligibleAssets } from "@/server/data";
export const metadata = { title: "Submit OTF" };
export default async function SubmitPage() { const [competition, assets, session] = await Promise.all([getCompetition(), getEligibleAssets(), auth()]); return <div className="pageShell contentPage wideContent"><header className="pageHeader"><h1>Submit OTF</h1><p>Build a coherent portfolio from eligible real-world assets, make the case, and verify your submission through X.</p></header><SubmitWizard competition={competition} assets={assets} connected={Boolean(session?.user)} turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} /></div>; }
