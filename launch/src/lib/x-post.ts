export type XPostProposal = { name: string; ticker: string; slug: string };
export type VotePostChoice = { ticker: string; votes: number };

export function slugifyProposalName(value: string) {
  return value.toLowerCase().replace(/\s+otf$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-otf";
}

function proposalUrl(siteUrl: string, slug: string) {
  return `${siteUrl.replace(/\/$/, "")}/otfs/${slug}`;
}

export function buildSubmissionPost(reason: string, proposal: XPostProposal, siteUrl: string, challenge?: string) {
  const context = reason.trim();
  return `${context ? `${context}\n\n` : ""}I submitted ${proposal.name} as an OTF proposal to OTF Launch${challenge ? ` · ${challenge}` : ""}\n${proposalUrl(siteUrl, proposal.slug)}`;
}

function voteChoicesLine(choices: VotePostChoice[]) {
  return choices.length ? `\nMy picks: ${choices.map((choice) => `${choice.votes}× $${choice.ticker}`).join(", ")}` : "";
}

export function buildVotePost(reason: string, siteUrl: string, challenge?: string, choices: VotePostChoice[] = []) {
  const context = reason.trim();
  return `${context ? `${context}\n\n` : ""}I cast unlocked votes in OTF Launch${voteChoicesLine(choices)}${challenge ? `\n${challenge}` : ""}\n${siteUrl.replace(/\/$/, "")}/vote`;
}

export function buildXIntentUrl(text: string) {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

export function approximateXPostLength(text: string) {
  return text.replace(/https?:\/\/\S+/g, "x".repeat(23)).length;
}
