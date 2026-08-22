import { relations, sql } from "drizzle-orm";
import type { CompetitionRules } from "@/lib/competition";
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
export const proposalStatus = pgEnum("proposal_status", ["draft", "confirmed", "deleted"]);
export const voteStatus = pgEnum("vote_status", ["valid", "invalid"]);
export const evidenceStatus = pgEnum("evidence_status", ["pending", "valid", "invalid", "unavailable"]);
export const evidenceAction = pgEnum("evidence_action", ["submission", "vote"]);

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
  showRealUsernameOnVoterLeaderboard: boolean("show_real_username_on_voter_leaderboard").default(false).notNull(),
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
  rules: jsonb("rules").$type<CompetitionRules>().notNull(),
  rulesHash: text("rules_hash").notNull(),
  rulesFrozenAt: timestamp("rules_frozen_at", { withTimezone: true }).notNull(),
  ...timestamps
}, (table) => [
  check("competition_singleton", sql`${table.singleton} = true`),
  check("competition_time_order", sql`${table.endsAt} > ${table.startsAt}`),
  check("competition_rules_hash", sql`${table.rulesHash} ~ '^[0-9a-f]{64}$'`)
]);

export const assetRegistry = pgTable("asset_registry", {
  id: uuid("id").defaultRandom().primaryKey(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  contractAddress: text("contract_address").notNull(),
  network: text("network").default("robinhood-mainnet").notNull(),
  chainId: integer("chain_id"),
  decimals: integer("decimals").default(18).notNull(),
  priceSource: text("price_source").default("robinhood-bid").notNull(),
  ...timestamps
}, (table) => [
  index("asset_registry_symbol_idx").on(sql`upper(${table.symbol})`),
  uniqueIndex("asset_registry_network_contract_uq").on(table.network, sql`lower(${table.contractAddress})`),
  check("asset_registry_contract_address", sql`${table.contractAddress} ~ '^0x[0-9a-fA-F]{40}$'`),
  check("asset_registry_price_source", sql`${table.priceSource} in ('robinhood-bid', 'coinbase-eth-usd-bid', 'coingecko-usd')`),
  check("asset_registry_exact_decimals", sql`${table.decimals} = 18`)
]);

export const verifiedAssets = pgTable("verified_assets", {
  assetAddress: text("asset_address").primaryKey(),
}, (table) => [
  check("verified_asset_address", sql`${table.assetAddress} ~ '^0x[0-9a-fA-F]{40}$'`),
]);

export const assetPricingConfigs = pgTable("asset_pricing_configs", {
  id: uuid("id").defaultRandom().primaryKey(),
  assetId: uuid("asset_id").notNull().references(() => assetRegistry.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  primaryAddress: text("primary_address").notNull(),
  secondaryAddress: text("secondary_address"),
  active: boolean("active").default(true).notNull(),
  ...timestamps
}, (table) => [
  index("asset_pricing_configs_asset_active_idx").on(table.assetId, table.active),
  uniqueIndex("asset_pricing_config_exact_uq").on(
    table.assetId,
    table.source,
    sql`lower(${table.primaryAddress})`,
    sql`lower(coalesce(${table.secondaryAddress}, ''))`,
  ),
  check("asset_pricing_config_source", sql`${table.source} in ('chainlink-direct', 'chainlink-weth', 'uniswap-v3')`),
  check("asset_pricing_config_shape", sql`(
    ${table.source} in ('chainlink-direct', 'uniswap-v3') and ${table.secondaryAddress} is null
  ) or (
    ${table.source} = 'chainlink-weth' and ${table.secondaryAddress} is not null
  )`),
  check("asset_pricing_config_addresses", sql`${table.primaryAddress} ~ '^0x[0-9a-fA-F]{40}$' and (${table.secondaryAddress} is null or ${table.secondaryAddress} ~ '^0x[0-9a-fA-F]{40}$')`)
]);

export const assetMarkets = pgTable("asset_markets", {
  id: uuid("id").defaultRandom().primaryKey(),
  assetId: uuid("asset_id").notNull().references(() => assetRegistry.id, { onDelete: "cascade" }),
  marketId: text("market_id").notNull().unique(),
  poolAddress: text("pool_address").notNull(),
  factoryAddress: text("factory_address").notNull(),
  quoteTokenAddress: text("quote_token_address").notNull(),
  feeTier: integer("fee_tier").notNull(),
  version: text("version").default("v3").notNull(),
  active: boolean("active").default(true).notNull(),
  poolCreatedAt: timestamp("pool_created_at", { withTimezone: true }),
  registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow().notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex("asset_market_pool_uq").on(sql`lower(${table.poolAddress})`),
  index("asset_markets_asset_active_idx").on(table.assetId, table.active),
  check("asset_market_v3_only", sql`${table.version} = 'v3'`),
  check("asset_market_fee_positive", sql`${table.feeTier} > 0`)
]);

export const assetEligibilitySnapshots = pgTable("asset_eligibility_snapshots", {
  marketId: uuid("market_id").notNull().references(() => assetMarkets.id, { onDelete: "cascade" }),
  sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  liquidityUsd: numeric("liquidity_usd", { precision: 24, scale: 8 }),
  marketCapUsd: numeric("market_cap_usd", { precision: 30, scale: 2 }),
  marketCapVerified: boolean("market_cap_verified"),
  gtVerified: boolean("gt_verified"),
  gtScore: numeric("gt_score", { precision: 8, scale: 2 }),
  isHoneypot: boolean("is_honeypot"),
  lockedLiquidityPct: numeric("locked_liquidity_pct", { precision: 8, scale: 4 }),
  reasons: text("reasons").array().default(sql`ARRAY[]::text[]`).notNull(),
  providerMetadata: jsonb("provider_metadata").$type<Record<string, unknown>>().default({}).notNull()
}, (table) => [
  primaryKey({ columns: [table.marketId, table.sampledAt] }),
  index("asset_eligibility_time_idx").on(table.sampledAt),
  check("asset_eligibility_status", sql`${table.status} in ('Pass', 'Pending', 'Fail')`)
]);

export const assetMarketRequests = pgTable("asset_market_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  requesterUserId: text("requester_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  network: text("network").default("robinhood-mainnet").notNull(),
  assetAddress: text("asset_address").notNull(),
  poolAddress: text("pool_address"),
  pricingSource: text("pricing_source").notNull(),
  primaryAddress: text("primary_address").notNull(),
  secondaryAddress: text("secondary_address"),
  status: text("status").default("pending").notNull(),
  reason: text("reason"),
  ...timestamps
}, (table) => [
  index("asset_market_requests_status_idx").on(table.status, table.createdAt),
  check("asset_market_request_status", sql`${table.status} in ('pending', 'registered', 'rejected')`),
  check("asset_market_request_pricing_source", sql`${table.pricingSource} in ('chainlink-direct', 'chainlink-weth', 'uniswap-v3')`),
  check("asset_market_request_pricing_shape", sql`(
    ${table.pricingSource} in ('chainlink-direct', 'uniswap-v3') and ${table.secondaryAddress} is null
  ) or (
    ${table.pricingSource} = 'chainlink-weth' and ${table.secondaryAddress} is not null
  )`),
  check("asset_market_request_pricing_addresses", sql`${table.primaryAddress} ~ '^0x[0-9a-fA-F]{40}$' and (${table.secondaryAddress} is null or ${table.secondaryAddress} ~ '^0x[0-9a-fA-F]{40}$')`)
]);

export const priceCaptureRuns = pgTable("price_capture_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  captureKey: text("capture_key").notNull(),
  sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  requestedAssetIds: uuid("requested_asset_ids").array().notNull(),
  missingSymbols: text("missing_symbols").array().default(sql`ARRAY[]::text[]`).notNull(),
  provider: text("provider").default("robinhood-bid").notNull(),
  purpose: text("purpose").default("scoring").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  uniqueIndex("price_capture_runs_capture_key_uq").on(table.captureKey),
  index("price_capture_runs_sampled_at_idx").on(table.sampledAt),
  check("price_capture_run_status", sql`${table.status} in ('complete', 'partial')`),
  check("price_capture_run_purpose", sql`${table.purpose} in ('submission', 'entry', 'final', 'scoring')`)
]);

export const assetPriceSnapshots = pgTable("asset_price_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  assetId: uuid("asset_id").notNull().references(() => assetRegistry.id, { onDelete: "cascade" }),
  sampledAt: timestamp("sampled_at", { withTimezone: true }).notNull(),
  captureRunId: uuid("capture_run_id").references(() => priceCaptureRuns.id, { onDelete: "restrict" }),
  quoteGeneratedAt: timestamp("quote_generated_at", { withTimezone: true }).notNull(),
  bidUsd: numeric("bid_usd", { precision: 24, scale: 8 }).notNull(),
  twapWindowSeconds: integer("twap_window_seconds").default(0).notNull()
}, (table) => [
  uniqueIndex("asset_price_snapshot_run_asset_uq").on(table.captureRunId, table.assetId),
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
  draftAllocations: jsonb("draft_allocations").$type<unknown[]>().default([]).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  moderatedReason: text("moderated_reason"),
  ...timestamps
}, (table) => [
  uniqueIndex("proposal_competition_slug_uq").on(table.competitionId, table.slug).where(sql`${table.status} <> 'deleted'`),
  uniqueIndex("proposal_competition_name_uq").on(table.competitionId, sql`lower(${table.name})`).where(sql`${table.status} <> 'deleted'`),
  uniqueIndex("proposal_competition_ticker_uq").on(table.competitionId, sql`lower(${table.ticker})`).where(sql`${table.status} <> 'deleted'`),
  check("proposal_ticker_format", sql`${table.ticker} ~ '^[A-Z0-9][A-Z0-9-]{0,15}$'`),
  check("proposal_name_suffix", sql`${table.name} like '% OTF'`),
  check("proposal_thesis_nonempty", sql`octet_length(${table.thesis}) between 1 and 2048`)
]);

export const proposalAssets = pgTable("proposal_assets", {
  proposalId: uuid("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").notNull().references(() => assetRegistry.id, { onDelete: "restrict" }),
  marketId: uuid("market_id").references(() => assetMarkets.id, { onDelete: "restrict" }),
  pricingSource: text("pricing_source"),
  primaryAddress: text("primary_address"),
  secondaryAddress: text("secondary_address"),
  weightBps: integer("weight_bps").notNull(),
  position: integer("position").notNull()
}, (table) => [
  primaryKey({ columns: [table.proposalId, table.assetId] }),
  uniqueIndex("proposal_asset_position_uq").on(table.proposalId, table.position),
  check("proposal_asset_minimum", sql`${table.weightBps} >= 100 and ${table.weightBps} <= 10000`),
  check("proposal_asset_pricing_source", sql`${table.pricingSource} is null or ${table.pricingSource} in ('chainlink-direct', 'chainlink-weth', 'uniswap-v3')`),
  check("proposal_asset_pricing_shape", sql`${table.pricingSource} is null or (
    ${table.pricingSource} in ('chainlink-direct', 'uniswap-v3') and ${table.primaryAddress} is not null and ${table.secondaryAddress} is null
  ) or (
    ${table.pricingSource} = 'chainlink-weth' and ${table.primaryAddress} is not null and ${table.secondaryAddress} is not null
  )`),
  check("proposal_asset_pricing_addresses", sql`${table.pricingSource} is null or (${table.primaryAddress} ~ '^0x[0-9a-fA-F]{40}$' and (${table.secondaryAddress} is null or ${table.secondaryAddress} ~ '^0x[0-9a-fA-F]{40}$'))`)
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
  followerCount: integer("follower_count").notNull(),
  status: voteStatus("status").notNull(),
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
  entryPriceCaptureRunId: uuid("entry_price_capture_run_id").references(() => priceCaptureRuns.id, { onDelete: "restrict" }),
  effectiveEntryAt: timestamp("effective_entry_at", { withTimezone: true }),
  performanceComparisonProposalIds: uuid("performance_comparison_proposal_ids").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("vote_tranches_competition_idx").on(table.competitionId, table.acceptedAt),
  index("vote_tranches_voter_idx").on(table.voterUserId),
  index("vote_tranches_proposal_idx").on(table.proposalId),
  check("vote_tranche_quantity_positive", sql`${table.quantity} > 0`)
]);

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

export const usersRelations = relations(users, ({ many }) => ({ proposals: many(proposals), ballots: many(ballots), voteTranches: many(voteTranches), sessions: many(sessions) }));
export const proposalsRelations = relations(proposals, ({ many, one }) => ({
  assets: many(proposalAssets), ballotAllocations: many(ballotAllocations), voteTranches: many(voteTranches), creator: one(users, { fields: [proposals.creatorUserId], references: [users.id] })
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
