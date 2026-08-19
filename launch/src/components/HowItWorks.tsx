import { BadgeCheck, PenLine, ShieldCheck } from "lucide-react";
import type { ParticipationEligibility } from "@/lib/types";
import { CompetitionCountdown } from "./CompetitionCountdown";
import { Button, SectionCard } from "./ui";

export function HowItWorks({ eligibility, votingOpen, votingStartsAt, currentTime }: {
  eligibility: ParticipationEligibility;
  votingOpen: boolean;
  votingStartsAt: string;
  currentTime: string;
}) {
  const steps = [
    { icon: BadgeCheck, title: "Sign in with X", text: `Use a verified, public account with ${eligibility.minFollowers.toLocaleString()}+ followers.` },
    { icon: PenLine, title: "Choose the OTFs you support", text: "Voting opens after 7 days. You start with 3 votes and unlock 1 more every 3 voting days, up to 12." },
    { icon: ShieldCheck, title: "Verify the X post", text: "Publish the prepared text from X, then paste its public URL to verify your voting action. One post can cover several votes." }
  ];
  return <SectionCard className="howCard"><div className="cardHeading"><span>How it works</span></div>
    <ol className="steps">{steps.map(({ icon: Icon, title, text }, index) => <li key={title}><div className="stepIcon"><Icon size={20} /></div><span className="stepNumber">{index + 1}</span><div><strong>{title}</strong><p>{text}</p></div></li>)}</ol>
    <div className="howActions">
      <Button href="/vote">{votingOpen ? "Vote" : <>Vote in <CompetitionCountdown target={votingStartsAt} currentTime={currentTime} compact /></>}</Button>
      <p className="finePrint">We never post anything on your behalf.</p>
    </div>
  </SectionCard>;
}
