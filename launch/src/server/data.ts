import { demoAssets, demoCompetition, demoLeaderboard, demoVoterLeaderboard } from "@/lib/demo-data";
import { COMPETITION_IDENTITY, COMPETITION_RULES } from "@/lib/competition";
import type { CompetitionSummary, EligibleAsset, LeaderboardEntry, VoterLeaderboardEntry } from "@/lib/types";
import { publicVoterName, rankVotersByParticipation } from "@/lib/voter-alias";
import { sqlClient } from "./db";

export async function getCompetition(): Promise<CompetitionSummary> {
  if (!sqlClient) return demoCompetition;
  const rows = await sqlClient<CompetitionSummary[]>`
    select c.id::text, ${COMPETITION_IDENTITY.slug}::text as slug, ${COMPETITION_IDENTITY.name}::text as name,
      c.phase, c.starts_at as "startsAt", c.ends_at as "endsAt",
      ${COMPETITION_RULES.minFollowers}::int as "minFollowers",
      ${COMPETITION_RULES.minAccountAgeDays}::int as "minAccountAgeDays",
      (select count(*)::int from proposals p where p.competition_id = c.id and p.status in ('accepted','hidden')) as "proposalCount",
      (select coalesce(sum(ba.votes), 0)::int from ballots b join ballot_allocations ba on ba.ballot_id = b.id where b.competition_id = c.id and b.status = 'valid') as "voteCount",
      (select count(*)::int from ballots b where b.competition_id = c.id and b.status = 'valid') as "uniqueVoterCount"
    from competitions c
    limit 1`;
  if (!rows[0]) throw new Error("COMPETITION_NOT_FOUND");
  return rows[0];
}

export async function getEligibleAssets(search = ""): Promise<EligibleAsset[]> {
  if (!sqlClient) return demoAssets;
  const query = search.trim().toLowerCase();
  return sqlClient<EligibleAsset[]>`
    select ea.id::text, ea.symbol, ea.name, ea.contract_address as "contractAddress",
      ea.network, ea.chain_id as "chainId", ea.decimals,
      case when ea.quality = 'high' then 'high' else 'normal' end as quality,
      ea.price_source as "priceSource", latest.bid_usd::float8 as "latestPriceUsd",
      latest.sampled_at::text as "latestPriceAt",
      coalesce(configs.items, '[]'::json) as "pricingConfigs",
      coalesce(markets.items, '[]'::json) as markets
    from eligible_assets ea
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
    order by case when ea.quality = 'high' then 0 else 1 end, ea.symbol
    limit 100`;
}

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  if (!sqlClient) return demoLeaderboard;
  const rows = await sqlClient<LeaderboardEntry[]>`
    with ranked as (
      select p.id, p.creator_user_id, p.slug, p.name, p.ticker, p.thesis, p.accepted_at,
        u.x_user_id, u.x_username, u.display_name as creator_name,
        u.profile_image_url as creator_profile_image_url,
        coalesce(sum(case when b.status = 'valid' then ba.votes else 0 end), 0)::int as votes
      from proposals p join users u on u.id = p.creator_user_id
      left join ballot_allocations ba on ba.proposal_id = p.id
      left join ballots b on b.id = ba.ballot_id
      where p.status = 'accepted' and p.competition_id = (select id from competitions limit 1)
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
      (o.accepted_at < (select starts_at from competitions limit 1) + interval '7 days') as "submissionBoost",
      (select te.post_url from tweet_evidence te where te.proposal_id = o.id and te.action = 'submission' and te.status = 'valid' limit 1) as "proofUrl",
      json_build_object('xId', o.x_user_id, 'username', o.x_username, 'displayName', o.creator_name, 'profileImageUrl', o.creator_profile_image_url) as creator,
      case when exists (
        select 1 from proposal_assets quality_pa join eligible_assets quality_a on quality_a.id = quality_pa.asset_id
        where quality_pa.proposal_id = o.id and quality_a.quality <> 'high'
      ) then 'normal' else 'high' end as quality,
      coalesce((select json_agg(json_build_object(
        'assetId', pa.asset_id::text, 'symbol', a.symbol, 'name', a.name,
        'contractAddress', a.contract_address,
        'quality', case when a.quality = 'high' then 'high' else 'normal' end,
        'pricingConfig', case pa.pricing_source
          when 'chainlink-direct' then json_build_object('source', pa.pricing_source, 'feedAddress', pa.primary_address)
          when 'chainlink-weth' then json_build_object('source', pa.pricing_source, 'assetWethFeedAddress', pa.primary_address, 'wethUsdFeedAddress', pa.secondary_address)
          when 'uniswap-v3' then json_build_object('source', pa.pricing_source, 'poolAddress', pa.primary_address)
          else null end,
        'poolAddress', coalesce(case when pa.pricing_source = 'uniswap-v3' then pa.primary_address end, am.pool_address),
        'weightBps', pa.weight_bps
      ) order by pa.position) from proposal_assets pa join eligible_assets a on a.id = pa.asset_id
        left join asset_markets am on am.id = pa.market_id where pa.proposal_id = o.id), '[]') as allocations
    from ordered o order by o.rank`;
  return rows;
}

export async function getVoterLeaderboard(): Promise<VoterLeaderboardEntry[]> {
  if (!sqlClient) return demoVoterLeaderboard;
  const rows = await sqlClient<{
    userId: string;
    username: string;
    allowRealUsername: boolean;
    votesCast: number;
    otfsSupported: number;
  }[]>`
    with voter_scores as (
      select u.id as user_id, u.x_username,
        u.show_real_username_on_voter_leaderboard as allow_real_username,
        coalesce(sum(ba.votes), 0)::int as votes_cast,
        count(distinct ba.proposal_id)::int as otfs_supported
      from competitions c
      join ballots b on b.competition_id = c.id and b.status = 'valid'
      join users u on u.id = b.voter_user_id
      left join ballot_allocations ba on ba.ballot_id = b.id
      group by b.id, u.id
    )
    select user_id as "userId", x_username as username, allow_real_username as "allowRealUsername",
      votes_cast as "votesCast", otfs_supported as "otfsSupported"
    from voter_scores
    order by votes_cast desc, user_id`;
  return rankVotersByParticipation(rows).map((row) => ({
    rank: row.rank,
    publicName: publicVoterName(row),
    usesRealUsername: row.allowRealUsername,
    votesCast: row.votesCast,
    otfsSupported: row.otfsSupported,
  }));
}

export async function getProposal(slug: string) {
  const leaderboard = await getLeaderboard();
  return leaderboard.find((proposal) => proposal.slug === slug) ?? null;
}

export async function getPublicLaunchOrder() {
  const leaderboard = await getLeaderboard();
  return leaderboard.map(({ rank, slug, name, ticker }) => ({ rank, slug, name, ticker }));
}
