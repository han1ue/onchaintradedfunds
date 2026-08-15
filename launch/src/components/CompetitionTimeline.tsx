import { Check, Circle, Clock3 } from "lucide-react";
import { COMPETITION_RULES, getCompetitionStatus } from "@/lib/competition";
import type { CompetitionSummary } from "@/lib/types";
import { SectionCard } from "./ui";

export function CompetitionTimeline({ competition }: { competition: CompetitionSummary }) {
  const status = getCompetitionStatus(competition);
  const currentIndex = status.stage === "submissions" ? 0 : status.stage === "voting" ? 1 : status.stage === "review" || status.stage === "final" ? 2 : -1;
  const phases = [
    { title: "Submission week", timing: "Days 1–7", detail: "Submit OTF proposals before voting begins." },
    { title: "Voting month", timing: "Days 8–37", detail: `Voting opens with ${COMPETITION_RULES.initialVotes} votes. One more unlocks every ${COMPETITION_RULES.voteUnlockIntervalDays} days; submissions stay open.` },
    { title: "Final results", timing: "After voting", detail: "Votes are reviewed and the final ranking becomes launch order." },
  ];
  const stageCopy = status.stage === "submissions"
    ? "Submissions are open now. Voting and the first 3 votes come next."
    : status.stage === "voting"
      ? `${status.unlockedVotes} of ${COMPETITION_RULES.totalVotes} votes are unlocked now. New OTF submissions still join the board.`
      : status.stage === "review"
        ? "Voting has closed. The final vote and evidence review is underway."
        : status.stage === "final"
          ? "The competition is complete and the launch order is final."
          : status.stage === "cancelled"
            ? "This competition has been cancelled."
            : "The submission week begins when the competition opens.";

  return <SectionCard className="competitionTimeline"><div className="timelineHeader"><div><strong>Competition timeline</strong><p>{stageCopy}</p></div><span>Competition day {status.competitionDay} of {COMPETITION_RULES.submissionOnlyDays + COMPETITION_RULES.votingDays}</span></div>
    <ol>{phases.map((phase, index) => {
      const state = index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming";
      const Icon = state === "complete" ? Check : state === "current" ? Clock3 : Circle;
      return <li className={state} key={phase.title}><div className="timelineMarker"><Icon size={14} /><span>{state === "complete" ? "Complete" : state === "current" ? "Now" : "Next"}</span></div><strong>{phase.title}</strong><small>{phase.timing}</small><p>{phase.detail}</p></li>;
    })}</ol>
  </SectionCard>;
}
