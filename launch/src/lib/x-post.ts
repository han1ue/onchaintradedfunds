export type XPostProposal = { name: string; ticker: string; slug: string };

export function slugifyProposalName(value: string) {
  return value.toLowerCase().replace(/\s+otf$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-otf";
}

function proposalUrl(siteUrl: string, slug: string) {
  return `${siteUrl.replace(/\/$/, "")}/otfs/${slug}`;
}

export function buildSubmissionPost(reason: string, proposal: XPostProposal, siteUrl: string) {
  return `${reason}\n\n${proposal.name} ($${proposal.ticker}) — submitted to OTF Launch\n${proposalUrl(siteUrl, proposal.slug)}`;
}

export function buildVotePost(reason: string, proposal: XPostProposal, siteUrl: string) {
  return `${reason}\n\n${proposal.name} ($${proposal.ticker}) — my vote in OTF Launch\n${proposalUrl(siteUrl, proposal.slug)}`;
}

export function approximateXPostLength(text: string) {
  return text.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;
}
