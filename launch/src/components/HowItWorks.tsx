import { BadgeCheck, PenLine, ShieldCheck } from "lucide-react";
import type { ParticipationEligibility } from "@/lib/types";
import { EligibilityAction } from "./EligibilityGate";
import { Button, SectionCard } from "./ui";

export function HowItWorks({ eligibility }: { eligibility: ParticipationEligibility }) {
  const steps = [
    { icon: BadgeCheck, title: "Sign in with X", text: `Use a verified, public account with ${eligibility.minFollowers.toLocaleString()}+ followers.` },
    { icon: PenLine, title: "Propose or vote", text: "Build an OTF proposal or back the ones you believe in." },
    { icon: ShieldCheck, title: "Verify the X post", text: "Publish the prepared text from X, then paste its URL to verify it." }
  ];
  return <SectionCard className="howCard"><div className="cardHeading"><span>How it works</span></div>
    <ol className="steps">{steps.map(({ icon: Icon, title, text }, index) => <li key={title}><div className="stepIcon"><Icon size={20} /></div><span className="stepNumber">{index + 1}</span><div><strong>{title}</strong><p>{text}</p></div></li>)}</ol>
    <div className="howActions">
      {eligibility.eligible ? <Button href="/submit">Submit OTF proposal</Button> : <EligibilityAction eligibility={eligibility} action="submit" callbackUrl="/submit">{eligibility.connected ? "Use another X account" : "Sign in with X to get started"}</EligibilityAction>}
      <p className="finePrint">We never post without permission.</p>
    </div>
  </SectionCard>;
}
