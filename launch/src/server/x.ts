import { createHash } from "node:crypto";
import { parseXPostId } from "@/lib/validation";
import { env } from "./env";
import { isParticipationAllowlistedXUserId } from "./participation-allowlist";

export type XUser = {
  id: string;
  username: string;
  name: string;
  created_at: string;
  protected: boolean;
  verified: boolean;
  verified_type?: string;
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
  type?: string;
  id: string;
  userName: string;
  url?: string;
  name: string;
  isBlueVerified?: boolean;
  verifiedType?: string;
  profilePicture?: string;
  coverPicture?: string;
  description?: string;
  location?: string;
  followers: number;
  following: number;
  canDm?: boolean;
  createdAt: string;
  favouritesCount?: number;
  hasCustomTimelines?: boolean;
  isTranslator?: boolean;
  mediaCount?: number;
  statusesCount: number;
  withheldInCountries?: string[];
  affiliatesHighlightedLabel?: Record<string, unknown>;
  possiblySensitive?: boolean;
  pinnedTweetIds?: string[];
  isAutomated?: boolean;
  automatedBy?: string;
  protected?: boolean;
  unavailable?: boolean;
  message?: string;
  unavailableReason?: string;
  profile_bio?: Record<string, unknown>;
};

type TwitterApiIoUserResponse = {
  users?: TwitterApiIoUser[];
  status?: string;
  msg?: string;
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
  const result = await twitterApiIoFetch<TwitterApiIoUserResponse>(`/twitter/user/batch_info_by_ids?${query}`);
  const profile = result.users?.find((user) => user.id === xUserId);
  if (!profile) throw new Error("X_NOT_FOUND");
  return {
    profile: mapTwitterApiIoUser(profile),
    providerProfile: profile,
    responseStatus: result.status,
    responseMessage: result.msg,
  };
}

type XOEmbed = { html?: unknown; author_url?: unknown };

function decodeHtmlText(value: string) {
  const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' };
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const point = Number.parseInt(code.startsWith("x") || code.startsWith("X") ? code.slice(1) : code, code.startsWith("x") || code.startsWith("X") ? 16 : 10);
      try { return String.fromCodePoint(point); } catch { return ""; }
    })
    .replace(/&(amp|apos|gt|lt|quot);/gi, (_, entity: string) => named[entity.toLowerCase()] ?? "");
}

async function fetchXOEmbed(postUrl: string, revalidate?: number) {
  const id = parseXPostId(postUrl);
  const query = new URLSearchParams({
    url: `https://x.com/i/status/${id}`,
    dnt: "true",
    omit_script: "true",
    maxwidth: "550",
  });
  const response = await fetch(`https://publish.twitter.com/oembed?${query}`, {
    signal: AbortSignal.timeout(5_000),
    ...(revalidate ? { next: { revalidate } } : { cache: "no-store" as const }),
  });
  if (!response.ok) throw new Error("X_POST_NOT_FOUND");
  const result = await response.json() as XOEmbed;
  if (typeof result.html !== "string" || result.html.length > 50_000 || !result.html.includes("twitter-tweet") || /<script/i.test(result.html)) {
    throw new Error("X_POST_NOT_FOUND");
  }
  return { id, html: result.html, authorUrl: result.author_url };
}

export async function getXPost(postUrl: string) {
  const { id, html, authorUrl: rawAuthorUrl } = await fetchXOEmbed(postUrl);
  if (typeof rawAuthorUrl !== "string") throw new Error("X_POST_NOT_FOUND");
  const authorUrl = new URL(rawAuthorUrl);
  const username = authorUrl.pathname.split("/").filter(Boolean)[0];
  const textMatch = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
  if (!username || !/^[A-Za-z0-9_]{1,15}$/.test(username) || !textMatch) throw new Error("X_POST_NOT_FOUND");
  return { id, username, text: decodeHtmlText(textMatch[1]), postUrl: `https://x.com/${username}/status/${id}`, embedHtml: html };
}

export async function getXEmbedHtml(postUrl: string) {
  return (await fetchXOEmbed(postUrl, 3_600)).html;
}

export function hashXPostText(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

export function userIdentityFromXUser(
  profile: XUser,
  providerProfile: TwitterApiIoUser
) {
  return {
    xUserId: profile.id,
    xUsername: profile.username,
    displayName: profile.name,
    profileUrl: providerProfile.url,
    profileImageUrl: profile.profile_image_url,
    coverImageUrl: providerProfile.coverPicture,
    description: providerProfile.description,
    location: providerProfile.location,
    accountCreatedAt: new Date(profile.created_at),
    protected: profile.protected,
    verified: profile.verified,
    blueVerified: Boolean(providerProfile.isBlueVerified),
    verifiedType: profile.verified_type,
    followersCount: profile.public_metrics.followers_count,
    followingCount: profile.public_metrics.following_count,
    canDm: providerProfile.canDm,
    favouritesCount: providerProfile.favouritesCount,
    hasCustomTimelines: providerProfile.hasCustomTimelines,
    translator: providerProfile.isTranslator,
    mediaCount: providerProfile.mediaCount,
    tweetCount: profile.public_metrics.tweet_count,
    withheldInCountries: providerProfile.withheldInCountries ?? [],
    affiliatesHighlightedLabel: providerProfile.affiliatesHighlightedLabel ?? {},
    possiblySensitive: providerProfile.possiblySensitive,
    pinnedTweetIds: providerProfile.pinnedTweetIds ?? [],
    automated: providerProfile.isAutomated,
    automatedBy: providerProfile.automatedBy,
    unavailable: providerProfile.unavailable,
    providerMessage: providerProfile.message,
    unavailableReason: providerProfile.unavailableReason,
    profileBio: providerProfile.profile_bio ?? {},
    profileFetchedAt: new Date(),
    updatedAt: new Date()
  };
}

export function assertXEligible(profile: XUser, options: { minFollowers?: number; minAccountAgeDays: number }) {
  const allowlisted = isParticipationAllowlistedXUserId(profile.id);
  if (profile.protected || (!profile.verified && !allowlisted)) throw new Error("X_NOT_VERIFIED");
  const ageMs = Date.now() - new Date(profile.created_at).getTime();
  if (ageMs < options.minAccountAgeDays * 86_400_000) throw new Error("ACCOUNT_TOO_NEW");
  if (!allowlisted && options.minFollowers !== undefined && profile.public_metrics.followers_count < options.minFollowers) throw new Error("FOLLOWER_THRESHOLD");
}

export function assertStoredXEligible(snapshot: { xUserId: string; verified: boolean; protected: boolean; accountCreatedAt: Date; followersCount: number }, options: { minFollowers?: number; minAccountAgeDays: number }) {
  const allowlisted = isParticipationAllowlistedXUserId(snapshot.xUserId);
  if (snapshot.protected || (!snapshot.verified && !allowlisted)) throw new Error("X_NOT_VERIFIED");
  if (Date.now() - snapshot.accountCreatedAt.getTime() < options.minAccountAgeDays * 86_400_000) throw new Error("ACCOUNT_TOO_NEW");
  if (!allowlisted && options.minFollowers !== undefined && snapshot.followersCount < options.minFollowers) throw new Error("FOLLOWER_THRESHOLD");
}

export function verifyStoredXPost(post: XPost, expected: { authorId: string; evidenceHash: string }) {
  if (post.author_id !== expected.authorId) throw new Error("X_POST_CHANGED");
  if (post.referenced_tweets?.some((reference) => reference.type === "retweeted")) throw new Error("X_POST_CHANGED");
  if (hashXPostText(post.text) !== expected.evidenceHash) throw new Error("X_POST_CHANGED");
  return { editHistoryIds: post.edit_history_tweet_ids ?? [post.id] };
}
