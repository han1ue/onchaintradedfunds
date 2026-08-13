import { createHash } from "node:crypto";
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

export type CreatedXPost = { id: string; text: string };

async function xFetch<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`https://api.x.com${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(response.status === 429 ? "X_RATE_LIMITED" : response.status === 403 || response.status === 404 ? "X_NOT_FOUND" : "X_UNAVAILABLE");
  return response.json() as Promise<T>;
}

const userFields = "created_at,description,id,is_identity_verified,name,profile_image_url,protected,public_metrics,username,verified,verified_type";

export async function getAuthenticatedXUser(accessToken: string) {
  const result = await xFetch<{ data: XUser }>(`/2/users/me?user.fields=${userFields}`, accessToken);
  return result.data;
}

function decodeHtml(value: string) {
  return value.replace(/<[^>]*>/g, "").replace(/&#(x?[0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code.replace(/^x/i, ""), code[0]?.toLowerCase() === "x" ? 16 : 10)))
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

export async function getXOEmbed(postUrl: string) {
  const id = parseXPostId(postUrl);
  const response = await fetch(`https://publish.x.com/oembed?omit_script=true&hide_thread=true&url=${encodeURIComponent(postUrl)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("X_POST_NOT_FOUND");
  const result = await response.json() as { author_url?: string; html?: string };
  if (!result.author_url || !result.html) throw new Error("X_POST_NOT_FOUND");
  const username = new URL(result.author_url).pathname.split("/").filter(Boolean)[0];
  const paragraph = result.html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1];
  if (!username || !paragraph) throw new Error("X_POST_NOT_FOUND");
  return { id, username, text: decodeHtml(paragraph), postUrl: `https://x.com/${username}/status/${id}` };
}

export function hashXPostText(text: string) {
  return createHash("sha256").update(text).digest("hex");
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

export function assertStoredXEligible(snapshot: { verified: boolean; protected: boolean; accountCreatedAt: Date; followersCount: number }, options: { minFollowers?: number; minAccountAgeDays: number }) {
  if (!snapshot.verified || snapshot.protected) throw new Error("X_NOT_VERIFIED");
  if (Date.now() - snapshot.accountCreatedAt.getTime() < options.minAccountAgeDays * 86_400_000) throw new Error("ACCOUNT_TOO_NEW");
  if (options.minFollowers !== undefined && snapshot.followersCount < options.minFollowers) throw new Error("FOLLOWER_THRESHOLD");
}

export function verifyStoredXPost(post: XPost, expected: { authorId: string; evidenceHash: string }) {
  if (post.author_id !== expected.authorId) throw new Error("X_POST_CHANGED");
  if (post.referenced_tweets?.some((reference) => reference.type === "retweeted")) throw new Error("X_POST_CHANGED");
  if (hashXPostText(post.text) !== expected.evidenceHash) throw new Error("X_POST_CHANGED");
  return { editHistoryIds: post.edit_history_tweet_ids ?? [post.id] };
}
