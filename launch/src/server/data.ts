import { demoAssetRegistry, demoCompetition, demoLeaderboard } from "@/lib/demo-data";
import { COMPETITION_IDENTITY } from "@/lib/competition";
import type { AssetRegistryEntry, CompetitionSummary, LaunchOrderPage, LeaderboardEntry, LeaderboardPage } from "@/lib/types";
import { sqlClient } from "./db";
import { assertCompetitionRulesSnapshot } from "./competition-rules";
import { DEFAULT_PUBLIC_LIST_LIMIT, MAX_PUBLIC_LIST_LIMIT } from "./api";

type RankedListOptions = { limit?: number; cursor?: number; search?: string };

function normalizeRankedListOptions(options: RankedListOptions = {}) {
  const limit = options.limit ?? DEFAULT_PUBLIC_LIST_LIMIT;
  const cursor = options.cursor ?? 0;
  const search = options.search?.trim().toLowerCase() ?? "";
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PUBLIC_LIST_LIMIT) throw new Error("INVALID_QUERY");
  if (!Number.isInteger(cursor) || cursor < 0) throw new Error("INVALID_QUERY");
  if (search.length > 100) throw new Error("INVALID_QUERY");
  return { limit, cursor, search };
}

export function paginateRankedEntries(entries: LeaderboardEntry[], options: RankedListOptions = {}): LeaderboardPage {
  const { limit, cursor, search } = normalizeRankedListOptions(options);
  const matching = entries.filter((entry) => entry.rank > cursor && (!search
    || entry.name.toLowerCase().includes(search)
    || entry.ticker.toLowerCase().includes(search)
    || entry.slug.toLowerCase().includes(search)
    || entry.thesis.toLowerCase().includes(search)
    || entry.creator.username.toLowerCase().includes(search)
    || entry.creator.displayName.toLowerCase().includes(search)));
  const page = matching.slice(0, limit + 1);
  const hasMore = page.length > limit;
  const pageEntries = hasMore ? page.slice(0, limit) : page;
  return { entries: pageEntries, nextCursor: hasMore ? String(pageEntries.at(-1)!.rank) : null };
}

export async function getCompetition(): Promise<CompetitionSummary> {
  if (!sqlClient) return demoCompetition;
  const rows = await sqlClient<CompetitionSummary[]>`
    select c.id::text, ${COMPETITION_IDENTITY.slug}::text as slug, ${COMPETITION_IDENTITY.name}::text as name,
      c.phase, c.starts_at as "startsAt", c.ends_at as "endsAt",
      c.rules, c.rules_hash as "rulesHash", c.rules_frozen_at as "rulesFrozenAt",
      (select count(*)::int from proposals p where p.competition_id = c.id and p.status = 'confirmed') as "proposalCount",
      (select coalesce(sum(ba.votes), 0)::int from ballots b join ballot_allocations ba on ba.ballot_id = b.id where b.competition_id = c.id and b.status = 'valid') as "voteCount",
      (select count(*)::int from ballots b where b.competition_id = c.id and b.status = 'valid') as "uniqueVoterCount"
    from competitions c
    limit 1`;
  if (!rows[0]) throw new Error("COMPETITION_NOT_FOUND");
  const rules = assertCompetitionRulesSnapshot(rows[0].rules, rows[0].rulesHash);
  return { ...rows[0], rules, minFollowers: rules.minFollowers, minAccountAgeDays: rules.minAccountAgeDays };
}

export async function getAssetRegistry(search = ""): Promise<AssetRegistryEntry[]> {
  if (!sqlClient) return demoAssetRegistry;
  const query = search.trim().toLowerCase();
  return sqlClient<AssetRegistryEntry[]>`
    select ea.id::text, ea.symbol, ea.name, ea.contract_address as "contractAddress",
      ea.network, ea.chain_id as "chainId", ea.decimals,
      (va.asset_address is not null) as verified,
      ea.price_source as "priceSource", latest.bid_usd::float8 as "latestPriceUsd",
      latest.sampled_at::text as "latestPriceAt",
      coalesce(configs.items, '[]'::json) as "pricingConfigs",
      coalesce(markets.items, '[]'::json) as markets
    from asset_registry ea
    left join verified_assets va on lower(va.asset_address) = lower(ea.contract_address)
    left join lateral (
      select aps.bid_usd, aps.sampled_at
      from asset_price_snapshots aps
      join price_capture_runs pcr on pcr.id = aps.capture_run_id
      where aps.asset_id = ea.id and pcr.purpose = 'scoring'
      order by aps.sampled_at desc
      limit 1
    ) latest on true
    left join lateral (
      select json_agg(case pc.source
        when 'chainlink-direct' then json_build_object(
          'id', pc.id::text, 'active', pc.active, 'source', pc.source, 'feedAddress', pc.primary_address
        )
        when 'chainlink-weth' then json_build_object(
          'id', pc.id::text, 'active', pc.active, 'source', pc.source,
          'assetWethFeedAddress', pc.primary_address, 'wethUsdFeedAddress', pc.secondary_address
        )
        else json_build_object(
          'id', pc.id::text, 'active', pc.active, 'source', pc.source, 'poolAddress', pc.primary_address
        ) end order by
          case pc.source when 'chainlink-direct' then 0 when 'chainlink-weth' then 1 else 2 end,
          pc.created_at) as items
      from asset_pricing_configs pc
      where pc.asset_id = ea.id
    ) configs on true
    left join lateral (
      select json_agg(json_build_object(
        'id', am.id::text, 'marketId', am.market_id, 'poolAddress', am.pool_address,
        'feeTier', am.fee_tier, 'active', am.active,
        'poolCreatedAt', am.pool_created_at,
        'quoteTokenAddress', am.quote_token_address,
        'evidenceStatus', evidence.status,
        'evidenceReasons', coalesce(evidence.reasons, ARRAY[]::text[])
      ) order by am.registered_at) as items
      from asset_markets am
      left join lateral (
        select aes.status, aes.reasons from asset_eligibility_snapshots aes
        where aes.market_id = am.id order by aes.sampled_at desc limit 1
      ) evidence on true
      where am.asset_id = ea.id
    ) markets on true
    where ${query} = '' or lower(ea.name) like ${`%${query}%`}
      or lower(ea.symbol) like ${`%${query}%`}
      or lower(ea.contract_address) = ${query}
    order by (va.asset_address is not null) desc, ea.symbol
    limit 100`;
}

export async function getLatestScoringCheckpointAt(): Promise<string | null> {
  if (!sqlClient) return null;
  const rows = await sqlClient<{ sampledAt: string | null }[]>`
    select max(sampled_at)::text as "sampledAt"
    from price_capture_runs
    where purpose = 'scoring'`;
  return rows[0]?.sampledAt ?? null;
}

export async function getLeaderboard(options: RankedListOptions = {}): Promise<LeaderboardPage> {
  const { limit, cursor, search } = normalizeRankedListOptions(options);
  if (!sqlClient) return paginateRankedEntries(demoLeaderboard, { limit, cursor, search });
  const rows = await sqlClient<LeaderboardEntry[]>`
    with ranked as (
      select p.id, p.creator_user_id, p.slug, p.name, p.ticker, p.thesis, p.accepted_at,
        u.x_user_id, u.x_username, u.display_name as creator_name,
        u.profile_image_url as creator_profile_image_url, u.verified as creator_verified,
        coalesce(sum(case when b.status = 'valid' then ba.votes else 0 end), 0)::int as votes
      from proposals p join users u on u.id = p.creator_user_id
      left join ballot_allocations ba on ba.proposal_id = p.id
      left join ballots b on b.id = ba.ballot_id
      where p.status = 'confirmed' and p.competition_id = (select id from competitions limit 1)
      group by p.id, u.id
    ), ordered as (
      select *, row_number() over (order by votes desc, accepted_at asc, id asc)::int as rank from ranked
    )
    select o.id::text, o.slug, o.rank, o.name, o.ticker, o.thesis, o.votes,
      o.accepted_at as "acceptedAt",
      (select count(distinct vt.voter_user_id)::int from vote_tranches vt
        join ballots vb on vb.id = vt.ballot_id and vb.status = 'valid'
        join tweet_evidence ve on ve.id = vt.evidence_id and ve.status = 'valid'
        where vt.proposal_id = o.id and vt.voter_user_id <> o.creator_user_id) as "uniqueSupporterCount",
      (select te.post_url from tweet_evidence te where te.proposal_id = o.id and te.action = 'submission' and te.status = 'valid' limit 1) as "proofUrl",
      json_build_object('xId', o.x_user_id, 'username', o.x_username, 'displayName', o.creator_name, 'profileImageUrl', o.creator_profile_image_url, 'verified', o.creator_verified) as creator,
      not exists (
        select 1 from proposal_assets verification_pa
        join asset_registry verification_a on verification_a.id = verification_pa.asset_id
        left join verified_assets verification_va on lower(verification_va.asset_address) = lower(verification_a.contract_address)
        where verification_pa.proposal_id = o.id and verification_va.asset_address is null
      ) as verified,
      coalesce((select json_agg(json_build_object(
        'assetId', pa.asset_id::text, 'symbol', a.symbol, 'name', a.name,
        'contractAddress', a.contract_address,
        'verified', (va.asset_address is not null),
        'pricingConfig', case pa.pricing_source
          when 'chainlink-direct' then json_build_object('source', pa.pricing_source, 'feedAddress', pa.primary_address)
          when 'chainlink-weth' then json_build_object('source', pa.pricing_source, 'assetWethFeedAddress', pa.primary_address, 'wethUsdFeedAddress', pa.secondary_address)
          when 'uniswap-v3' then json_build_object('source', pa.pricing_source, 'poolAddress', pa.primary_address)
          else null end,
        'poolAddress', coalesce(case when pa.pricing_source = 'uniswap-v3' then pa.primary_address end, am.pool_address),
        'weightBps', pa.weight_bps
      ) order by pa.position) from proposal_assets pa join asset_registry a on a.id = pa.asset_id
        left join verified_assets va on lower(va.asset_address) = lower(a.contract_address)
        left join asset_markets am on am.id = pa.market_id where pa.proposal_id = o.id), '[]') as allocations
    from ordered o
    where o.rank > ${cursor}
      and (${search} = ''
        or lower(o.name) like ${`%${search}%`}
        or lower(o.ticker) like ${`%${search}%`}
        or lower(o.slug) like ${`%${search}%`}
        or lower(o.thesis) like ${`%${search}%`}
        or lower(o.x_username) like ${`%${search}%`}
        or lower(o.creator_name) like ${`%${search}%`})
    order by o.rank
    limit ${limit + 1}`;
  const hasMore = rows.length > limit;
  const entries = hasMore ? rows.slice(0, limit) : rows;
  return { entries, nextCursor: hasMore ? String(entries.at(-1)!.rank) : null };
}

export async function getProposal(slug: string) {
  if (!sqlClient) return demoLeaderboard.find((proposal) => proposal.slug === slug) ?? null;
  const rows = await sqlClient<LeaderboardEntry[]>`
    with ranked as (
      select p.id, p.creator_user_id, p.slug, p.name, p.ticker, p.thesis, p.accepted_at,
        u.x_user_id, u.x_username, u.display_name as creator_name,
        u.profile_image_url as creator_profile_image_url, u.verified as creator_verified,
        coalesce(sum(case when b.status = 'valid' then ba.votes else 0 end), 0)::int as votes
      from proposals p join users u on u.id = p.creator_user_id
      left join ballot_allocations ba on ba.proposal_id = p.id
      left join ballots b on b.id = ba.ballot_id
      where p.status = 'confirmed' and p.competition_id = (select id from competitions limit 1)
      group by p.id, u.id
    ), ordered as (
      select *, row_number() over (order by votes desc, accepted_at asc, id asc)::int as rank from ranked
    )
    select o.id::text, o.slug, o.rank, o.name, o.ticker, o.thesis, o.votes,
      o.accepted_at as "acceptedAt",
      (select count(distinct vt.voter_user_id)::int from vote_tranches vt
        join ballots vb on vb.id = vt.ballot_id and vb.status = 'valid'
        join tweet_evidence ve on ve.id = vt.evidence_id and ve.status = 'valid'
        where vt.proposal_id = o.id and vt.voter_user_id <> o.creator_user_id) as "uniqueSupporterCount",
      (select te.post_url from tweet_evidence te where te.proposal_id = o.id and te.action = 'submission' and te.status = 'valid' limit 1) as "proofUrl",
      json_build_object('xId', o.x_user_id, 'username', o.x_username, 'displayName', o.creator_name, 'profileImageUrl', o.creator_profile_image_url, 'verified', o.creator_verified) as creator,
      not exists (
        select 1 from proposal_assets verification_pa
        join asset_registry verification_a on verification_a.id = verification_pa.asset_id
        left join verified_assets verification_va on lower(verification_va.asset_address) = lower(verification_a.contract_address)
        where verification_pa.proposal_id = o.id and verification_va.asset_address is null
      ) as verified,
      coalesce((select json_agg(json_build_object(
        'assetId', pa.asset_id::text, 'symbol', a.symbol, 'name', a.name,
        'contractAddress', a.contract_address,
        'verified', (va.asset_address is not null),
        'pricingConfig', case pa.pricing_source
          when 'chainlink-direct' then json_build_object('source', pa.pricing_source, 'feedAddress', pa.primary_address)
          when 'chainlink-weth' then json_build_object('source', pa.pricing_source, 'assetWethFeedAddress', pa.primary_address, 'wethUsdFeedAddress', pa.secondary_address)
          when 'uniswap-v3' then json_build_object('source', pa.pricing_source, 'poolAddress', pa.primary_address)
          else null end,
        'poolAddress', coalesce(case when pa.pricing_source = 'uniswap-v3' then pa.primary_address end, am.pool_address),
        'weightBps', pa.weight_bps
      ) order by pa.position) from proposal_assets pa join asset_registry a on a.id = pa.asset_id
        left join verified_assets va on lower(va.asset_address) = lower(a.contract_address)
        left join asset_markets am on am.id = pa.market_id where pa.proposal_id = o.id), '[]') as allocations
    from ordered o
    where o.slug = ${slug}
    limit 1`;
  return rows[0] ?? null;
}

export async function getInvalidProposal(slug: string) {
  if (!sqlClient) return null;
  const rows = await sqlClient<{
    id: string;
    slug: string;
    name: string;
    ticker: string;
    votes: number;
    creator: { xId: string; username: string; profileImageUrl: string | null };
  }[]>`
    select p.id::text, p.slug, p.name, p.ticker,
      coalesce(sum(case when b.status = 'valid' then ba.votes else 0 end), 0)::int as votes,
      json_build_object('xId', u.x_user_id, 'username', u.x_username, 'profileImageUrl', u.profile_image_url) as creator
    from proposals p
    join users u on u.id = p.creator_user_id
    left join ballot_allocations ba on ba.proposal_id = p.id
    left join ballots b on b.id = ba.ballot_id
    where p.slug = ${slug}
      and p.status = 'deleted'
      and p.moderated_reason like 'X post invalid:%'
    group by p.id, u.id
    limit 1`;
  return rows[0] ?? null;
}

export async function getPublicLaunchOrder(options: RankedListOptions = {}): Promise<LaunchOrderPage> {
  const { limit, cursor, search } = normalizeRankedListOptions(options);
  if (!sqlClient) {
    const page = paginateRankedEntries(demoLeaderboard, { limit, cursor, search });
    return { entries: page.entries.map(({ rank, slug, name, ticker }) => ({ rank, slug, name, ticker })), nextCursor: page.nextCursor };
  }
  const rows = await sqlClient<{ rank: number; slug: string; name: string; ticker: string }[]>`
    with ranked as (
      select p.id, p.slug, p.name, p.ticker, p.accepted_at,
        coalesce(sum(case when b.status = 'valid' then ba.votes else 0 end), 0)::int as votes
      from proposals p
      left join ballot_allocations ba on ba.proposal_id = p.id
      left join ballots b on b.id = ba.ballot_id
      where p.status = 'confirmed' and p.competition_id = (select id from competitions limit 1)
      group by p.id
    ), ordered as (
      select *, row_number() over (order by votes desc, accepted_at asc, id asc)::int as rank from ranked
    )
    select rank, slug, name, ticker from ordered
    where rank > ${cursor}
      and (${search} = ''
        or lower(name) like ${`%${search}%`}
        or lower(ticker) like ${`%${search}%`}
        or lower(slug) like ${`%${search}%`})
    order by rank
    limit ${limit + 1}`;
  const hasMore = rows.length > limit;
  const entries = hasMore ? rows.slice(0, limit) : rows;
  return { entries, nextCursor: hasMore ? String(entries.at(-1)!.rank) : null };
}
