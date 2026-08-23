import { BadgeCheck, PenLine, ShieldCheck } from "lucide-react";
import type { CompetitionRules, CompetitionStage } from "@/lib/competition";
import type { ParticipationEligibility } from "@/lib/types";
import { CompetitionCountdown } from "./CompetitionCountdown";
import { Button, SectionCard } from "./ui";

export function HowItWorks({ eligibility, rules, stage, votingStartsAt, currentTime }: {
  eligibility: ParticipationEligibility;
  rules: CompetitionRules;
  stage: CompetitionStage;
  votingStartsAt: string;
  currentTime: string;
}) {
  const votingOpen = stage === "voting";
  const votingEnded = stage === "review" || stage === "final" || stage === "cancelled";
  const steps = [
    { icon: BadgeCheck, title: "Sign in with X", text: `Use a verified, public account with ${eligibility.minFollowers.toLocaleString()}+ followers.` },
    { icon: PenLine, title: "Choose the OTFs you support", text: votingEnded ? "Voting is closed. Cast votes remain permanent and auditable." : `Voting opens after ${rules.submissionOnlyDays} days. You start with ${rules.initialVotes} votes and unlock ${rules.votesPerUnlock} more every ${rules.voteUnlockIntervalDays} voting days, up to ${rules.totalVotes}.` },
    { icon: ShieldCheck, title: "Verify the X post", text: votingEnded ? "Verified voting posts remain attached to their immutable vote batches for audit." : "Publish the prepared text from X, then paste its public URL to verify your voting action. One post can cover several votes." }
  ];
  return <SectionCard className="howCard"><div className="cardHeading"><span>How it works</span></div>
    <ol className="steps">{steps.map(({ icon: Icon, title, text }, index) => <li key={title}><div className="stepIcon"><Icon size={20} /></div><span className="stepNumber">{index + 1}</span><div><strong>{title}</strong><p>{text}</p></div></li>)}</ol>
    <div className="howActions">
      <Button href={votingEnded ? "/leaderboard" : "/vote"}>{votingOpen ? "Vote" : votingEnded ? "View leaderboard" : <>Vote in <CompetitionCountdown target={votingStartsAt} currentTime={currentTime} compact /></>}</Button>
      <p className="finePrint">We never post anything on your behalf.</p>
    </div>
  </SectionCard>;
}
