import { Check, Circle, Clock3 } from "lucide-react";
import { getCompetitionStatus } from "@/lib/competition";
import type { CompetitionSummary } from "@/lib/types";
import { SectionCard } from "./ui";

export function CompetitionTimeline({ competition }: { competition: CompetitionSummary }) {
  const status = getCompetitionStatus(competition);
  const rules = competition.rules;
  const totalDays = rules.submissionOnlyDays + rules.votingDays;
  const elapsedDays = status.progressDays;
  const progressPercent = totalDays > 0
    ? Math.max(0, Math.min(100, elapsedDays / totalDays * 100))
    : 0;
  const currentIndex = status.stage === "submissions" ? 0 : status.stage === "voting" ? 1 : status.stage === "review" || status.stage === "final" ? 2 : -1;
  const cancelled = status.stage === "cancelled";
  const phases = [
    { title: "Submission week", timing: `Days 1–${rules.submissionOnlyDays}`, detail: cancelled ? "Submissions are closed." : rules.maxProposalsPerAccount === null ? "Confirm as many OTF proposals as you want." : `Confirm up to ${rules.maxProposalsPerAccount} OTF proposals per account.` },
    { title: "Voting month", timing: `Days ${rules.submissionOnlyDays + 1}–${totalDays}`, detail: cancelled ? "Voting is closed and no more votes can be cast." : `Voting opens with ${rules.initialVotes} votes. ${rules.votesPerUnlock} more unlocks every ${rules.voteUnlockIntervalDays} days; OTF submissions stay open.` },
    { title: "Final results", timing: "After voting", detail: cancelled ? "The cancelled competition will not produce a launch order." : "Votes are reviewed and the final ranking becomes launch order." },
  ];
  const stageCopy = status.stage === "submissions"
    ? `Submissions are open now. Voting and the first ${rules.initialVotes} votes come next.`
    : status.stage === "voting"
      ? `${status.unlockedVotes} of ${rules.totalVotes} votes are unlocked now. New OTF submissions still join the board.`
      : status.stage === "review"
        ? "Voting has closed. The final vote and evidence review is underway."
        : status.stage === "final"
          ? "The competition is complete and the launch order is final."
          : status.stage === "cancelled"
            ? "This competition has been cancelled."
            : "The submission week begins when the competition opens.";

  return <SectionCard className="competitionTimeline"><div className="timelineHeader"><div><strong>Timeline</strong><p>{stageCopy}</p></div><span>Competition day {status.competitionDay} of {totalDays}</span></div>
    <div className="timelineProgress" role="progressbar" aria-label="Competition progress" aria-valuemin={0} aria-valuemax={totalDays} aria-valuenow={elapsedDays}>
      <span className="timelineProgressFill" style={{ width: `${progressPercent}%` }} />
      <span className="timelineProgressThumb" style={{ left: `clamp(4px, ${progressPercent}%, calc(100% - 4px))` }} aria-hidden="true" />
    </div>
    <ol>{phases.map((phase, index) => {
      const state = cancelled ? "cancelled" : index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming";
      const Icon = state === "complete" ? Check : state === "current" ? Clock3 : Circle;
      return <li className={state} key={phase.title}><div className="timelineMarker"><Icon size={14} /><span>{state === "cancelled" ? "Ended" : state === "complete" ? "Complete" : state === "current" ? "Now" : "Next"}</span></div><strong>{phase.title}</strong><small>{phase.timing}</small><p>{phase.detail}</p></li>;
    })}</ol>
  </SectionCard>;
}
