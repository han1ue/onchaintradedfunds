import { CheckCircle2 } from "lucide-react";
import { SectionCard } from "@/components/ui";
export default function ProofPage() { return <div className="pageShell contentPage proofPage"><SectionCard className="contentCard proofCard"><CheckCircle2 size={34} /><h1>OTF action proof</h1><p>This unique link binds an X post to one submission or vote. Return to the launch site and paste the public post URL to complete verification.</p><small>The link is single-use and expires after 30 minutes.</small></SectionCard></div>; }
