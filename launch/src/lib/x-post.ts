import { PUBLIC_SITE_ORIGIN, publicSiteUrl } from "@/config/site";

export type XPostProposal = { name: string; ticker: string; slug: string };
export type VotePostChoice = { ticker: string; votes: number };

export function slugifyProposalName(value: string) {
  return value.toLowerCase().replace(/\s+otf$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-otf";
}

export function buildSubmissionPost(reason: string, proposal: XPostProposal, challenge?: string) {
  const context = reason.trim();
  return `${context ? `${context}\n\n` : ""}I submitted ${proposal.name} as an OTF proposal to OTF Launch\n${publicSiteUrl(`/otfs/${proposal.slug}`)}${challenge ? `\n${challenge}` : ""}`;
}

function voteChoicesLine(choices: VotePostChoice[]) {
  return choices.length ? `\nMy picks: ${choices.map((choice) => `${choice.votes}× $${choice.ticker}`).join(", ")}` : "";
}

export function buildVotePost(reason: string, challenge?: string, choices: VotePostChoice[] = []) {
  const context = reason.trim();
  return `${context ? `${context}\n\n` : ""}I just voted in the OTF Launch competition.${voteChoicesLine(choices)}\n${PUBLIC_SITE_ORIGIN}/vote${challenge ? `\n${challenge}` : ""}`;
}

export function buildXIntentUrl(text: string) {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

export function isValidXPostUrl(value: string) {
  const trimmed = value.trim();
  const candidate = /^(?:www\.)?(?:x|twitter)\.com\//i.test(trimmed)
    ? `https://${trimmed}`
    : trimmed;
  try {
    const url = new URL(candidate);
    if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname.toLowerCase())) return false;
    return /^\/[A-Za-z0-9_]+\/status\/\d+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function approximateXPostLength(text: string) {
  return text.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;
}
