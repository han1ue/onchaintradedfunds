export type XPostProposal = { name: string; ticker: string; slug: string };

export function slugifyProposalName(value: string) {
  return value.toLowerCase().replace(/\s+otf$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-otf";
}

function proposalUrl(siteUrl: string, slug: string) {
  return `${siteUrl.replace(/\/$/, "")}/otfs/${slug}`;
}

export function buildSubmissionPost(reason: string, proposal: XPostProposal, siteUrl: string, challenge?: string) {
  return `${reason}\n\nI submitted ${proposal.name} to OTF Launch${challenge ? ` · ${challenge}` : ""}\n${proposalUrl(siteUrl, proposal.slug)}`;
}

export function buildVotePost(reason: string, proposal: XPostProposal, siteUrl: string, challenge?: string) {
  return `${reason}\n\nI just voted for ${proposal.name} in OTF Launch${challenge ? ` · ${challenge}` : ""}\n${proposalUrl(siteUrl, proposal.slug)}`;
}

export function buildXIntentUrl(text: string) {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

export function approximateXPostLength(text: string) {
  return text.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;
}
