import { demoAssets, demoCompetition, demoLeaderboard } from "@/lib/demo-data";
import type { CompetitionSummary, EligibleAsset, LeaderboardEntry } from "@/lib/types";
import { getLaunchAssetName, isLaunchAsset } from "@/lib/launch-assets";
import { sqlClient } from "./db";

export async function getCompetition(): Promise<CompetitionSummary> {
  if (!sqlClient) return demoCompetition;
  const rows = await sqlClient<CompetitionSummary[]>`
    select c.id::text, c.slug, c.name, c.phase, c.starts_at as "startsAt", c.ends_at as "endsAt",
      c.min_followers as "minFollowers", c.min_account_age_days as "minAccountAgeDays",
      count(distinct p.id)::int as "proposalCount",
      count(distinct v.id) filter (where v.status = 'valid')::int as "verifiedVoteCount",
      count(distinct v.voter_user_id) filter (where v.status = 'valid')::int as "uniqueVoterCount"
    from competitions c
    left join proposals p on p.competition_id = c.id and p.status in ('accepted','hidden')
    left join votes v on v.competition_id = c.id
    where c.phase in ('open','auditing','final')
    group by c.id order by c.starts_at desc limit 1`;
  if (!rows[0]) throw new Error("COMPETITION_NOT_FOUND");
  return rows[0];
}

export async function getEligibleAssets(): Promise<EligibleAsset[]> {
  if (!sqlClient) return demoAssets;
  const assets = await sqlClient<EligibleAsset[]>`
    select a.id::text, a.robinhood_uid as "robinhoodUid", a.symbol, a.name,
      a.contract_address as "contractAddress", a.logo_url as "logoUrl",
      p.fee_tier as "feeTier", p.pool_address as "poolAddress",
      s.observed_at as "observedAt", s.reason
    from eligible_assets a
    join asset_pools p on p.asset_id = a.id and p.enabled = true
    join lateral (
      select * from asset_eligibility_snapshots es where es.asset_id = a.id order by es.observed_at desc limit 1
    ) s on s.eligible = true
    where a.admin_enabled = true and a.status = 'active'
    order by a.symbol`;
  return assets
    .filter((asset) => isLaunchAsset(asset.symbol))
    .map((asset) => ({ ...asset, name: getLaunchAssetName(asset.symbol) ?? asset.name }));
}

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  if (!sqlClient) return demoLeaderboard;
  const rows = await sqlClient<LeaderboardEntry[]>`
    with ranked as (
      select p.id, p.slug, p.name, p.ticker, p.thesis, p.accepted_at,
        u.x_user_id, u.x_username, coalesce(u.name, u.x_username) as creator_name,
        coalesce((select xis.profile_image_url from x_identity_snapshots xis where xis.user_id = u.id order by xis.observed_at desc limit 1), u.image) as creator_profile_image_url,
        count(v.id) filter (where v.status = 'valid')::int as votes
      from proposals p join users u on u.id = p.creator_user_id
      left join votes v on v.proposal_id = p.id
      where p.status = 'accepted'
      group by p.id, u.id
    ), ordered as (
      select *, row_number() over (order by votes desc, accepted_at asc, id asc)::int as rank from ranked
    )
    select o.id::text, o.slug, o.rank, o.name, o.ticker, o.thesis, o.votes,
      o.accepted_at as "acceptedAt",
      (select te.post_url from tweet_evidence te where te.proposal_id = o.id and te.action = 'submission' and te.status = 'valid' limit 1) as "proofUrl",
      json_build_object('xId', o.x_user_id, 'username', o.x_username, 'displayName', o.creator_name, 'profileImageUrl', o.creator_profile_image_url) as creator,
      coalesce((select json_agg(json_build_object(
        'assetId', pa.asset_id::text, 'symbol', a.symbol, 'name', a.name, 'weightBps', pa.weight_bps
      ) order by pa.position) from proposal_assets pa join eligible_assets a on a.id = pa.asset_id where pa.proposal_id = o.id), '[]') as allocations
    from ordered o order by o.rank`;
  return rows;
}

export async function getProposal(slug: string) {
  const leaderboard = await getLeaderboard();
  return leaderboard.find((proposal) => proposal.slug === slug) ?? null;
}

export async function getPublicLaunchOrder() {
  const leaderboard = await getLeaderboard();
  return leaderboard.map(({ rank, slug, name, ticker }) => ({ rank, slug, name, ticker }));
}
