ALTER TABLE "x_action_challenges" ADD COLUMN "result_ballot_id" uuid;--> statement-breakpoint
ALTER TABLE "x_action_challenges" ADD COLUMN "result_slug" text;--> statement-breakpoint
UPDATE "x_action_challenges" AS challenge
SET "result_slug" = proposal.slug
FROM "proposals" AS proposal
WHERE challenge.action = 'submission'
  AND challenge.consumed_at IS NOT NULL
  AND challenge.proposal_id = proposal.id;--> statement-breakpoint
UPDATE "x_action_challenges" AS challenge
SET "result_ballot_id" = ballot.id
FROM "ballots" AS ballot
WHERE challenge.action = 'vote'
  AND challenge.consumed_at IS NOT NULL
  AND challenge.competition_id = ballot.competition_id
  AND challenge.user_id = ballot.voter_user_id;
