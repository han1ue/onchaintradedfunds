import { createHash } from "node:crypto";
import { env } from "./env";
import { parseXPostId } from "@/lib/validation";

export type XUser = {
  id: string;
  username: string;
  name: string;
  created_at: string;
  protected: boolean;
  verified: boolean;
  verified_type?: string;
  is_identity_verified?: boolean;
  profile_image_url?: string;
  public_metrics: { followers_count: number; following_count: number; tweet_count: number; listed_count: number };
};

export type XPost = {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  edit_history_tweet_ids?: string[];
  referenced_tweets?: { type: string; id: string }[];
  entities?: { urls?: { expanded_url?: string; unwound_url?: string }[] };
};

async function xFetch<T>(path: string): Promise<T> {
  if (!env.X_BEARER_TOKEN) throw new Error("X_UNAVAILABLE");
  const response = await fetch(`https://api.x.com${path}`, {
    headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(response.status === 429 ? "X_RATE_LIMITED" : response.status === 403 || response.status === 404 ? "X_NOT_FOUND" : "X_UNAVAILABLE");
  return response.json() as Promise<T>;
}

const userFields = "created_at,description,id,is_identity_verified,name,profile_image_url,protected,public_metrics,username,verified,verified_type";

export async function getXUser(xUserId: string) {
  const result = await xFetch<{ data: XUser }>(`/2/users/${encodeURIComponent(xUserId)}?user.fields=${userFields}`);
  return result.data;
}

export async function getXPost(postIdOrUrl: string) {
  const id = /^\d+$/.test(postIdOrUrl) ? postIdOrUrl : parseXPostId(postIdOrUrl);
  const result = await xFetch<{ data: XPost }>(`/2/tweets/${id}?tweet.fields=author_id,created_at,edit_history_tweet_ids,entities,referenced_tweets,text`);
  return result.data;
}

export function snapshotFromXUser(userId: string, profile: XUser) {
  return {
    userId,
    xUserId: profile.id,
    username: profile.username,
    displayName: profile.name,
    profileImageUrl: profile.profile_image_url,
    accountCreatedAt: new Date(profile.created_at),
    protected: profile.protected,
    verified: profile.verified,
    verifiedType: profile.verified_type,
    identityVerified: profile.is_identity_verified,
    followersCount: profile.public_metrics.followers_count,
    followingCount: profile.public_metrics.following_count,
    tweetCount: profile.public_metrics.tweet_count,
    observedAt: new Date()
  };
}

export function assertXEligible(profile: XUser, options: { minFollowers?: number; minAccountAgeDays: number }) {
  if (!profile.verified || profile.protected) throw new Error("X_NOT_VERIFIED");
  const ageMs = Date.now() - new Date(profile.created_at).getTime();
  if (ageMs < options.minAccountAgeDays * 86_400_000) throw new Error("ACCOUNT_TOO_NEW");
  if (options.minFollowers !== undefined && profile.public_metrics.followers_count < options.minFollowers) throw new Error("FOLLOWER_THRESHOLD");
}

export function verifyXPost(post: XPost, expected: { authorId: string; proofUrl: string; challengeCreatedAt: Date; expiresAt: Date; minContextCharacters?: number; allowExpired?: boolean }) {
  const now = new Date();
  if (!expected.allowExpired && now > expected.expiresAt) throw new Error("PROOF_EXPIRED");
  if (post.author_id !== expected.authorId) throw new Error("PROOF_MISMATCH");
  const postedAt = new Date(post.created_at);
  if (postedAt < expected.challengeCreatedAt || postedAt > expected.expiresAt) throw new Error("PROOF_MISMATCH");
  if (post.referenced_tweets?.some((reference) => reference.type === "retweeted")) throw new Error("PROOF_MISMATCH");
  const expanded = post.entities?.urls?.flatMap((url) => [url.expanded_url, url.unwound_url]).filter(Boolean) ?? [];
  const includesProof = post.text.includes(expected.proofUrl) || expanded.some((url) => url === expected.proofUrl || url?.startsWith(`${expected.proofUrl}?`));
  if (!includesProof) throw new Error("PROOF_MISMATCH");
  const context = post.text.replace(/https?:\/\/\S+/g, "").trim();
  if (context.length < (expected.minContextCharacters ?? 20)) throw new Error("PROOF_MISMATCH");
  return {
    postId: post.id,
    authorId: post.author_id,
    postedAt,
    editHistoryIds: post.edit_history_tweet_ids ?? [post.id],
    evidenceHash: createHash("sha256").update(JSON.stringify(post)).digest("hex"),
    rawText: post.text
  };
}
