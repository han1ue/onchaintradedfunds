import { demoAssets, demoCompetition, demoLeaderboard, demoVoterLeaderboard } from "@/lib/demo-data";
import { COMPETITION_IDENTITY, COMPETITION_RULES } from "@/lib/competition";
import type { CompetitionSummary, EligibleAsset, LeaderboardEntry, VoterLeaderboardEntry } from "@/lib/types";
import { publicVoterName, rankVotersByXp } from "@/lib/voter-alias";
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

export async function getEligibleAssets(): Promise<EligibleAsset[]> {
  if (!sqlClient) return demoAssets;
  return sqlClient<EligibleAsset[]>`
    select id::text, symbol, name, contract_address as "contractAddress", price_source as "priceSource"
    from eligible_assets
    order by symbol`;
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
      coalesce((select json_agg(json_build_object(
        'assetId', pa.asset_id::text, 'symbol', a.symbol, 'name', a.name, 'weightBps', pa.weight_bps
      ) order by pa.position) from proposal_assets pa join eligible_assets a on a.id = pa.asset_id where pa.proposal_id = o.id), '[]') as allocations
    from ordered o order by o.rank`;
  return rows;
}

export async function getVoterLeaderboard(): Promise<VoterLeaderboardEntry[]> {
  if (!sqlClient) return demoVoterLeaderboard;
  const rows = await sqlClient<{
    userId: string;
    username: string;
    allowRealUsername: boolean;
    totalXp: number;
    votesCast: number;
    otfsSupported: number;
  }[]>`
    with latest_xp as (
      select id, competition_id from xp_calculation_runs
      order by case when status = 'final' then 0 else 1 end, calculated_at desc
      limit 1
    ), voter_scores as (
      select u.id as user_id, u.x_username,
        u.show_real_username_on_voter_leaderboard as allow_real_username,
        x.total_xp,
        coalesce(sum(ba.votes), 0)::int as votes_cast,
        count(distinct ba.proposal_id)::int as otfs_supported
      from latest_xp lx
      join xp_snapshot_rows x on x.run_id = lx.id
      join users u on u.id = x.user_id
      join ballots b on b.voter_user_id = x.user_id and b.competition_id = lx.competition_id and b.status = 'valid'
      left join ballot_allocations ba on ba.ballot_id = b.id
      group by b.id, u.id, x.total_xp
    )
    select user_id as "userId", x_username as username, allow_real_username as "allowRealUsername",
      total_xp as "totalXp", votes_cast as "votesCast", otfs_supported as "otfsSupported"
    from voter_scores
    order by total_xp desc, user_id`;
  return rankVotersByXp(rows).map((row) => ({
    rank: row.rank,
    publicName: publicVoterName(row),
    usesRealUsername: row.allowRealUsername,
    totalXp: row.totalXp,
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
