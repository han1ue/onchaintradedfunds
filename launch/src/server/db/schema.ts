import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
};

export const competitionPhase = pgEnum("competition_phase", ["draft", "scheduled", "open", "auditing", "final", "cancelled"]);
export const proposalStatus = pgEnum("proposal_status", ["draft", "posting", "accepted", "hidden", "disqualified", "withdrawn"]);
export const voteStatus = pgEnum("vote_status", ["posting", "valid", "invalid"]);
export const evidenceStatus = pgEnum("evidence_status", ["pending", "valid", "invalid", "unavailable"]);
export const evidenceAction = pgEnum("evidence_action", ["submission", "vote"]);
export const launchStatus = pgEnum("launch_status", ["waiting", "eligible", "launched", "void"]);
export const xpRunStatus = pgEnum("xp_run_status", ["live", "final"]);

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  xUserId: text("x_user_id").notNull().unique(),
  xUsername: text("x_username").notNull(),
  displayName: text("display_name").notNull(),
  profileImageUrl: text("profile_image_url"),
  profileUrl: text("profile_url"),
  coverImageUrl: text("cover_image_url"),
  description: text("description"),
  location: text("location"),
  accountCreatedAt: timestamp("account_created_at", { withTimezone: true }).notNull(),
  protected: boolean("protected").notNull(),
  verified: boolean("verified").notNull(),
  blueVerified: boolean("blue_verified").notNull(),
  verifiedType: text("verified_type"),
  followersCount: integer("followers_count").notNull(),
  followingCount: integer("following_count").notNull(),
  canDm: boolean("can_dm"),
  favouritesCount: integer("favourites_count"),
  hasCustomTimelines: boolean("has_custom_timelines"),
  translator: boolean("translator"),
  mediaCount: integer("media_count"),
  tweetCount: integer("tweet_count").notNull(),
  withheldInCountries: text("withheld_in_countries").array().default(sql`ARRAY[]::text[]`).notNull(),
  affiliatesHighlightedLabel: jsonb("affiliates_highlighted_label").$type<Record<string, unknown>>().default({}).notNull(),
  possiblySensitive: boolean("possibly_sensitive"),
  pinnedTweetIds: text("pinned_tweet_ids").array().default(sql`ARRAY[]::text[]`).notNull(),
  automated: boolean("automated"),
  automatedBy: text("automated_by"),
  unavailable: boolean("unavailable"),
  providerMessage: text("provider_message"),
  unavailableReason: text("unavailable_reason"),
  profileBio: jsonb("profile_bio").$type<Record<string, unknown>>().default({}).notNull(),
  profileFetchedAt: timestamp("profile_fetched_at", { withTimezone: true }).defaultNow().notNull(),
  ...timestamps
});

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull()
});

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires", { mode: "date" }).notNull()
}, (table) => [primaryKey({ columns: [table.identifier, table.token] })]);

export const competitions = pgTable("competitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  singleton: boolean("singleton").default(true).notNull().unique(),
  phase: competitionPhase("phase").default("draft").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  launchStartAt: timestamp("launch_start_at", { withTimezone: true }),
  rulesFrozenAt: timestamp("rules_frozen_at", { withTimezone: true }),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  ...timestamps
}, (table) => [
  check("competition_singleton", sql`${table.singleton} = true`),
  check("competition_time_order", sql`${table.endsAt} > ${table.startsAt}`)
]);

export const eligibleAssets = pgTable("eligible_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  contractAddress: text("contract_address").notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("eligible_asset_symbol_uq").on(sql`upper(${table.symbol})`),
  uniqueIndex("eligible_asset_contract_address_uq").on(sql`lower(${table.contractAddress})`)
]);

export const priceCaptureRuns = pgTable("price_capture_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  requestedAssetIds: uuid("requested_asset_ids").array().notNull(),
  missingSymbols: text("missing_symbols").array().default(sql`ARRAY[]::text[]`).notNull(),
  provider: text("provider").default("robinhood-bid").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("price_capture_runs_sampled_at_idx").on(table.sampledAt),
  check("price_capture_run_status", sql`${table.status} in ('complete', 'partial')`)
]);

export const assetPriceSnapshots = pgTable("asset_price_snapshots", {
  assetId: uuid("asset_id").notNull().references(() => eligibleAssets.id, { onDelete: "cascade" }),
  sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull(),
  captureRunId: uuid("capture_run_id").references(() => priceCaptureRuns.id, { onDelete: "restrict" }),
  quoteGeneratedAt: timestamp("quote_generated_at", { withTimezone: true }).notNull(),
  bidUsd: numeric("bid_usd", { precision: 24, scale: 8 }).notNull()
}, (table) => [
  primaryKey({ columns: [table.assetId, table.sampledAt] }),
  index("asset_price_snapshots_sampled_at_idx").on(table.sampledAt)
]);

export const proposals = pgTable("proposals", {
  id: uuid("id").defaultRandom().primaryKey(),
  competitionId: uuid("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
  creatorUserId: text("creator_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  ticker: text("ticker").notNull(),
  thesis: text("thesis").notNull(),
  status: proposalStatus("status").default("draft").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  initialPriceCaptureRunId: uuid("initial_price_capture_run_id").references(() => priceCaptureRuns.id, { onDelete: "restrict" }),
  moderatedReason: text("moderated_reason"),
  ...timestamps
}, (table) => [
  uniqueIndex("proposal_competition_slug_uq").on(table.competitionId, table.slug),
  uniqueIndex("proposal_competition_name_uq").on(table.competitionId, sql`lower(${table.name})`),
  uniqueIndex("proposal_competition_ticker_uq").on(table.competitionId, sql`lower(${table.ticker})`),
  uniqueIndex("proposal_one_creator_uq").on(table.competitionId, table.creatorUserId),
  check("proposal_ticker_format", sql`${table.ticker} ~ '^[A-Z0-9][A-Z0-9-]{0,15}$'`),
  check("proposal_name_suffix", sql`${table.name} like '% OTF'`),
  check("proposal_thesis_nonempty", sql`octet_length(${table.thesis}) between 1 and 2048`)
]);

export const proposalAssets = pgTable("proposal_assets", {
  proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").notNull().references(() => eligibleAssets.id, { onDelete: "restrict" }),
  weightBps: integer("weight_bps").notNull(),
  position: integer("position").notNull()
}, (table) => [
  primaryKey({ columns: [table.proposalId, table.assetId] }),
  uniqueIndex("proposal_asset_position_uq").on(table.proposalId, table.position),
  check("proposal_asset_minimum", sql`${table.weightBps} >= 100 and ${table.weightBps} <= 10000`)
]);

export const tweetEvidence = pgTable("tweet_evidence", {
  id: uuid("id").defaultRandom().primaryKey(),
  action: evidenceAction("action").notNull(),
  competitionId: uuid("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  proposalId: uuid("proposal_id").references(() => proposals.id, { onDelete: "cascade" }),
  xPostId: text("x_post_id").notNull().unique(),
  xAuthorId: text("x_author_id").notNull(),
  xAuthorUsername: text("x_author_username").notNull(),
  postUrl: text("post_url").notNull(),
  postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
  editHistoryIds: jsonb("edit_history_ids").$type<string[]>().default([]).notNull(),
  evidenceHash: text("evidence_hash").notNull(),
  status: evidenceStatus("status").default("pending").notNull(),
  reason: text("reason"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  rawTextExpiresAt: timestamp("raw_text_expires_at", { withTimezone: true }),
  rawText: text("raw_text")
}, (table) => [
  index("tweet_evidence_competition_status_idx").on(table.competitionId, table.status),
  uniqueIndex("submission_evidence_once_uq").on(table.proposalId).where(sql`${table.action} = 'submission'`)
]);

export const xActionChallenges = pgTable("x_action_challenges", {
  id: uuid("id").defaultRandom().primaryKey(),
  action: evidenceAction("action").notNull(),
  competitionId: uuid("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  proposalId: uuid("proposal_id").references(() => proposals.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  reason: text("reason").notNull(),
  postText: text("post_text").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [index("x_action_challenge_lookup_idx").on(table.userId, table.proposalId, table.expiresAt)]);

export const evidenceChecks = pgTable("evidence_checks", {
  id: uuid("id").defaultRandom().primaryKey(),
  evidenceId: uuid("evidence_id").notNull().references(() => tweetEvidence.id, { onDelete: "cascade" }),
  status: evidenceStatus("status").notNull(),
  reason: text("reason"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
  responseMeta: jsonb("response_meta").$type<Record<string, unknown>>().default({}).notNull()
}, (table) => [index("evidence_check_history_idx").on(table.evidenceId, table.checkedAt)]);

export const ballots = pgTable("ballots", {
  id: uuid("id").defaultRandom().primaryKey(),
  competitionId: uuid("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
  voterUserId: text("voter_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  evidenceId: uuid("evidence_id").unique().references(() => tweetEvidence.id, { onDelete: "restrict" }),
  followerCount: integer("follower_count").notNull(),
  status: voteStatus("status").default("posting").notNull(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  ...timestamps
}, (table) => [
  uniqueIndex("ballot_once_per_competition_uq").on(table.competitionId, table.voterUserId),
  index("valid_ballots_idx").on(table.competitionId, table.status)
]);

export const ballotAllocations = pgTable("ballot_allocations", {
  ballotId: uuid("ballot_id").notNull().references(() => ballots.id, { onDelete: "cascade" }),
  proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
  votes: integer("votes").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  primaryKey({ columns: [table.ballotId, table.proposalId] }),
  index("ballot_allocations_proposal_idx").on(table.proposalId),
  check("ballot_allocation_votes_range", sql`${table.votes} between 1 and 12`)
]);

export const voteTranches = pgTable("vote_tranches", {
  id: uuid("id").defaultRandom().primaryKey(),
  competitionId: uuid("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
  ballotId: uuid("ballot_id").notNull().references(() => ballots.id, { onDelete: "cascade" }),
  voterUserId: text("voter_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "restrict" }),
  evidenceId: uuid("evidence_id").notNull().references(() => tweetEvidence.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
  effectiveEntryAt: timestamp("effective_entry_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("vote_tranches_competition_idx").on(table.competitionId, table.acceptedAt),
  index("vote_tranches_voter_idx").on(table.voterUserId),
  index("vote_tranches_proposal_idx").on(table.proposalId),
  check("vote_tranche_quantity_positive", sql`${table.quantity} > 0`)
]);

export const activityEvents = pgTable("activity_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  competitionId: uuid("competition_id").references(() => competitions.id, { onDelete: "set null" }),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  proposalId: uuid("proposal_id").references(() => proposals.id, { onDelete: "set null" }),
  ballotId: uuid("ballot_id").references(() => ballots.id, { onDelete: "set null" }),
  evidenceId: uuid("evidence_id").references(() => tweetEvidence.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  ruleVersion: text("rule_version").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  reversesEventId: uuid("reverses_event_id")
}, (table) => [index("activity_actor_time_idx").on(table.actorUserId, table.occurredAt)]);

export const finalizationRuns = pgTable("finalization_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  competitionId: uuid("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  cursor: text("cursor"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  error: text("error"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull()
});

export const xpCalculationRuns = pgTable("xp_calculation_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  competitionId: uuid("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
  status: xpRunStatus("status").notNull(),
  calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull(),
  priceCheckpointAt: timestamp("price_checkpoint_at", { withTimezone: true }),
  performanceReleased: integer("performance_released").notNull(),
  performanceAllocated: integer("performance_allocated").notNull(),
  participationReleased: integer("participation_released").notNull(),
  participationAllocated: integer("participation_allocated").notNull(),
  creatorReleased: integer("creator_released").notNull(),
  creatorAllocated: integer("creator_allocated").notNull(),
  policyVersion: text("policy_version").notNull(),
  canonicalHash: text("canonical_hash").notNull(),
  canonicalJson: jsonb("canonical_json").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("xp_runs_competition_time_idx").on(table.competitionId, table.calculatedAt),
  uniqueIndex("xp_final_once_uq").on(table.competitionId).where(sql`${table.status} = 'final'`)
]);

export const xpSnapshotRows = pgTable("xp_snapshot_rows", {
  runId: uuid("run_id").notNull().references(() => xpCalculationRuns.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  performanceXp: integer("performance_xp").notNull(),
  participationXp: integer("participation_xp").notNull(),
  creatorXp: integer("creator_xp").notNull(),
  totalXp: integer("total_xp").notNull(),
  uniqueSupporterCount: integer("unique_supporter_count").default(0).notNull(),
  submissionBoost: boolean("submission_boost").default(false).notNull(),
  pendingTrancheCount: integer("pending_tranche_count").default(0).notNull()
}, (table) => [primaryKey({ columns: [table.runId, table.userId] })]);

export const leaderboardSnapshots = pgTable("leaderboard_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  competitionId: uuid("competition_id").notNull().unique().references(() => competitions.id, { onDelete: "cascade" }),
  canonicalHash: text("canonical_hash").notNull(),
  canonicalJson: jsonb("canonical_json").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const leaderboardRows = pgTable("leaderboard_rows", {
  snapshotId: uuid("snapshot_id").notNull().references(() => leaderboardSnapshots.id, { onDelete: "cascade" }),
  proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "restrict" }),
  rank: integer("rank").notNull(),
  votes: integer("votes").notNull()
}, (table) => [
  primaryKey({ columns: [table.snapshotId, table.proposalId] }),
  uniqueIndex("leaderboard_rank_uq").on(table.snapshotId, table.rank)
]);

export const launchQueue = pgTable("launch_queue", {
  id: uuid("id").defaultRandom().primaryKey(),
  competitionId: uuid("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
  proposalId: uuid("proposal_id").notNull().unique().references(() => proposals.id, { onDelete: "restrict" }),
  rank: integer("rank").notNull(),
  earliestLaunchAt: timestamp("earliest_launch_at", { withTimezone: true }).notNull(),
  status: launchStatus("status").default("waiting").notNull(),
  launchedAt: timestamp("launched_at", { withTimezone: true }),
  voidReason: text("void_reason"),
  ...timestamps
}, (table) => [uniqueIndex("launch_queue_rank_uq").on(table.competitionId, table.rank)]);

export const adminActions = pgTable("admin_actions", {
  id: uuid("id").defaultRandom().primaryKey(),
  adminUserId: text("admin_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  reason: text("reason").notNull(),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const usersRelations = relations(users, ({ many }) => ({ proposals: many(proposals), ballots: many(ballots), voteTranches: many(voteTranches), sessions: many(sessions), xpSnapshots: many(xpSnapshotRows) }));
export const proposalsRelations = relations(proposals, ({ many, one }) => ({
  assets: many(proposalAssets), ballotAllocations: many(ballotAllocations), voteTranches: many(voteTranches), creator: one(users, { fields: [proposals.creatorUserId], references: [users.id] }),
  initialPriceCaptureRun: one(priceCaptureRuns, { fields: [proposals.initialPriceCaptureRunId], references: [priceCaptureRuns.id] })
}));
export const ballotsRelations = relations(ballots, ({ many, one }) => ({
  allocations: many(ballotAllocations), tranches: many(voteTranches), voter: one(users, { fields: [ballots.voterUserId], references: [users.id] })
}));
export const ballotAllocationsRelations = relations(ballotAllocations, ({ one }) => ({
  ballot: one(ballots, { fields: [ballotAllocations.ballotId], references: [ballots.id] }),
  proposal: one(proposals, { fields: [ballotAllocations.proposalId], references: [proposals.id] })
}));
export const voteTranchesRelations = relations(voteTranches, ({ one }) => ({
  ballot: one(ballots, { fields: [voteTranches.ballotId], references: [ballots.id] }),
  voter: one(users, { fields: [voteTranches.voterUserId], references: [users.id] }),
  proposal: one(proposals, { fields: [voteTranches.proposalId], references: [proposals.id] }),
  evidence: one(tweetEvidence, { fields: [voteTranches.evidenceId], references: [tweetEvidence.id] })
}));
export const xpCalculationRunsRelations = relations(xpCalculationRuns, ({ many }) => ({ rows: many(xpSnapshotRows) }));
export const xpSnapshotRowsRelations = relations(xpSnapshotRows, ({ one }) => ({
  run: one(xpCalculationRuns, { fields: [xpSnapshotRows.runId], references: [xpCalculationRuns.id] }),
  user: one(users, { fields: [xpSnapshotRows.userId], references: [users.id] })
}));
