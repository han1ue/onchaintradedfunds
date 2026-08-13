CREATE TABLE "x_action_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" "evidence_action" NOT NULL,
	"competition_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"proposal_id" uuid NOT NULL,
	"identity_snapshot_id" uuid NOT NULL,
	"token" text NOT NULL,
	"reason" text NOT NULL,
	"post_text" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "x_action_challenges_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "competitions" ALTER COLUMN "min_followers" SET DEFAULT 50;--> statement-breakpoint
UPDATE "competitions" SET "min_followers" = 50 WHERE "phase" IN ('draft', 'scheduled', 'open');--> statement-breakpoint
ALTER TABLE "x_action_challenges" ADD CONSTRAINT "x_action_challenges_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_action_challenges" ADD CONSTRAINT "x_action_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_action_challenges" ADD CONSTRAINT "x_action_challenges_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_action_challenges" ADD CONSTRAINT "x_action_challenges_identity_snapshot_id_x_identity_snapshots_id_fk" FOREIGN KEY ("identity_snapshot_id") REFERENCES "public"."x_identity_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "x_action_challenge_lookup_idx" ON "x_action_challenges" USING btree ("user_id","proposal_id","expires_at");
