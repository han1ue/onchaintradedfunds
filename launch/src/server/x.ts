import { createHash } from "node:crypto";
import { parseXPostId } from "@/lib/validation";
import { env } from "./env";

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

type TwitterApiIoUser = {
  id: string;
  userName: string;
  name: string;
  isBlueVerified?: boolean;
  verifiedType?: string;
  profilePicture?: string;
  followers: number;
  following: number;
  createdAt: string;
  statusesCount: number;
  protected?: boolean;
  unavailable?: boolean;
};

type TwitterApiIoTweet = {
  id: string;
  url?: string;
  text: string;
  createdAt: string;
  author: TwitterApiIoUser;
  retweeted_tweet?: unknown;
};

async function twitterApiIoFetch<T>(path: string): Promise<T> {
  if (!env.TWITTERAPI_IO_API_KEY) throw new Error("X_UNAVAILABLE");
  const response = await fetch(`https://api.twitterapi.io${path}`, {
    headers: { "x-api-key": env.TWITTERAPI_IO_API_KEY },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(response.status === 429 ? "X_RATE_LIMITED" : response.status === 403 || response.status === 404 ? "X_NOT_FOUND" : "X_UNAVAILABLE");
  return response.json() as Promise<T>;
}

function mapTwitterApiIoUser(profile: TwitterApiIoUser): XUser {
  const verifiedType = profile.verifiedType?.trim();
  const verified = Boolean(profile.isBlueVerified || (verifiedType && verifiedType.toLowerCase() !== "none"));
  return {
    id: profile.id,
    username: profile.userName,
    name: profile.name,
    created_at: profile.createdAt,
    protected: Boolean(profile.protected || profile.unavailable),
    verified,
    verified_type: verifiedType,
    profile_image_url: profile.profilePicture,
    public_metrics: {
      followers_count: profile.followers,
      following_count: profile.following,
      tweet_count: profile.statusesCount,
      listed_count: 0,
    },
  };
}

export async function getXUserById(xUserId: string) {
  const query = new URLSearchParams({ userIds: xUserId });
  const result = await twitterApiIoFetch<{ users?: TwitterApiIoUser[] }>(`/twitter/user/batch_info_by_ids?${query}`);
  const profile = result.users?.find((user) => user.id === xUserId);
  if (!profile) throw new Error("X_NOT_FOUND");
  return mapTwitterApiIoUser(profile);
}

export async function getXPost(postUrl: string) {
  const id = parseXPostId(postUrl);
  const query = new URLSearchParams({ tweet_ids: id });
  const result = await twitterApiIoFetch<{ tweets?: TwitterApiIoTweet[] }>(`/twitter/tweets?${query}`);
  const post = result.tweets?.find((tweet) => tweet.id === id);
  if (!post?.author?.userName || post.retweeted_tweet) throw new Error("X_POST_NOT_FOUND");
  return {
    id,
    authorId: post.author.id,
    username: post.author.userName,
    text: post.text,
    postUrl: `https://x.com/${post.author.userName}/status/${id}`,
  };
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
