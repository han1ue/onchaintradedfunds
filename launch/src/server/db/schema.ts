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

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  xUserId: text("x_user_id").unique(),
  xUsername: text("x_username"),
  ...timestamps
});

export const accounts = pgTable("accounts", {
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").$type<"oauth" | "oidc" | "email" | "webauthn">().notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state")
}, (table) => [primaryKey({ columns: [table.provider, table.providerAccountId] })]);

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

export const xIdentitySnapshots = pgTable("x_identity_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  providerType: text("provider_type"),
  xUserId: text("x_user_id").notNull(),
  username: text("username").notNull(),
  displayName: text("display_name").notNull(),
  profileUrl: text("profile_url"),
  profileImageUrl: text("profile_image_url"),
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
  responseStatus: text("response_status"),
  responseMessage: text("response_message"),
  observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [index("x_identity_user_observed_idx").on(table.userId, table.observedAt)]);

export const competitions = pgTable("competitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  phase: competitionPhase("phase").default("draft").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  launchStartAt: timestamp("launch_start_at", { withTimezone: true }),
  launchIntervalDays: integer("launch_interval_days").default(4).notNull(),
  minFollowers: integer("min_followers").default(100).notNull(),
  minAccountAgeDays: integer("min_account_age_days").default(30).notNull(),
  minAssets: integer("min_assets").default(2).notNull(),
  minAssetWeightBps: integer("min_asset_weight_bps").default(100).notNull(),
  ruleVersion: text("rule_version").default("v1").notNull(),
  rankingPolicyVersion: text("ranking_policy_version").default("votes-v1").notNull(),
  rulesFrozenAt: timestamp("rules_frozen_at", { withTimezone: true }),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  ...timestamps
}, (table) => [
  check("competition_positive_thresholds", sql`${table.minFollowers} >= 0 and ${table.minAccountAgeDays} >= 0 and ${table.launchIntervalDays} > 0`),
  check("competition_time_order", sql`${table.endsAt} > ${table.startsAt}`)
]);

export const eligibleAssets = pgTable("eligible_assets", {
  id: uuid("id").defaultRandom().primaryKey(),
  robinhoodUid: text("robinhood_uid").notNull().unique(),
  chainId: integer("chain_id").default(4663).notNull(),
  contractAddress: text("contract_address").notNull(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  status: text("status").notNull(),
  multiplier: numeric("multiplier", { precision: 38, scale: 18 }).notNull(),
  adminEnabled: boolean("admin_enabled").default(false).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("eligible_asset_chain_address_uq").on(table.chainId, sql`lower(${table.contractAddress})`),
  index("eligible_asset_enabled_idx").on(table.adminEnabled, table.status)
]);

export const assetPools = pgTable("asset_pools", {
  id: uuid("id").defaultRandom().primaryKey(),
  assetId: uuid("asset_id").notNull().references(() => eligibleAssets.id, { onDelete: "cascade" }),
  protocol: text("protocol").default("uniswap-v3").notNull(),
  poolAddress: text("pool_address").notNull(),
  usdgAddress: text("usdg_address").notNull(),
  feeTier: integer("fee_tier").notNull(),
  enabled: boolean("enabled").default(false).notNull(),
  ...timestamps
}, (table) => [uniqueIndex("asset_pool_address_uq").on(sql`lower(${table.poolAddress})`)]);

export const assetEligibilitySnapshots = pgTable("asset_eligibility_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  assetId: uuid("asset_id").notNull().references(() => eligibleAssets.id, { onDelete: "cascade" }),
  poolId: uuid("pool_id").references(() => assetPools.id, { onDelete: "set null" }),
  observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
  blockNumber: numeric("block_number", { precision: 78, scale: 0 }),
  liquidity: numeric("liquidity", { precision: 78, scale: 0 }),
  buyQuoteOut: numeric("buy_quote_out", { precision: 78, scale: 0 }),
  sellQuoteOut: numeric("sell_quote_out", { precision: 78, scale: 0 }),
  buyPriceImpactBps: integer("buy_price_impact_bps"),
  sellPriceImpactBps: integer("sell_price_impact_bps"),
  referenceNotionalUsd: numeric("reference_notional_usd", { precision: 20, scale: 2 }).default("1000").notNull(),
  eligible: boolean("eligible").notNull(),
  reason: text("reason").notNull(),
  configVersion: text("config_version").default("v1").notNull(),
  rawEvidence: jsonb("raw_evidence").$type<Record<string, unknown>>().default({}).notNull()
}, (table) => [index("asset_snapshot_latest_idx").on(table.assetId, table.observedAt)]);

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
  eligibilitySnapshotId: uuid("eligibility_snapshot_id").notNull().references(() => assetEligibilitySnapshots.id, { onDelete: "restrict" }),
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
  proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
  identitySnapshotId: uuid("identity_snapshot_id").notNull().references(() => xIdentitySnapshots.id, { onDelete: "restrict" }),
  xPostId: text("x_post_id").notNull().unique(),
  xAuthorId: text("x_author_id").notNull(),
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
  proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
  identitySnapshotId: uuid("identity_snapshot_id").notNull().references(() => xIdentitySnapshots.id, { onDelete: "restrict" }),
  token: text("token").notNull().unique(),
  reason: text("reason").notNull(),
  postText: text("post_text").notNull(),
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

export const votes = pgTable("votes", {
  id: uuid("id").defaultRandom().primaryKey(),
  competitionId: uuid("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
  proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
  voterUserId: text("voter_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  evidenceId: uuid("evidence_id").unique().references(() => tweetEvidence.id, { onDelete: "restrict" }),
  identitySnapshotId: uuid("identity_snapshot_id").notNull().references(() => xIdentitySnapshots.id, { onDelete: "restrict" }),
  followerCount: integer("follower_count").notNull(),
  status: voteStatus("status").default("posting").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  ...timestamps
}, (table) => [
  uniqueIndex("vote_once_per_otf_uq").on(table.competitionId, table.proposalId, table.voterUserId),
  index("valid_votes_idx").on(table.proposalId, table.status)
]);

export const activityEvents = pgTable("activity_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  competitionId: uuid("competition_id").references(() => competitions.id, { onDelete: "set null" }),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  proposalId: uuid("proposal_id").references(() => proposals.id, { onDelete: "set null" }),
  voteId: uuid("vote_id").references(() => votes.id, { onDelete: "set null" }),
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
  validVotes: integer("valid_votes").notNull()
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

export const usersRelations = relations(users, ({ many }) => ({ snapshots: many(xIdentitySnapshots), proposals: many(proposals), votes: many(votes) }));
export const proposalsRelations = relations(proposals, ({ many, one }) => ({
  assets: many(proposalAssets), votes: many(votes), creator: one(users, { fields: [proposals.creatorUserId], references: [users.id] })
}));
