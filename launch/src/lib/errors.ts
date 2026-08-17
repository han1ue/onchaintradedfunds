export const errorMessages: Record<string, string> = {
  X_NOT_VERIFIED: "A verified, public X account is required.",
  PRICING_CONFIG_REQUIRED: "An exact pricing route is required for this unverified asset.",
  FOLLOWER_THRESHOLD: "Your X account must have at least 100 followers to submit or vote.",
  ASSET_NOT_FOUND: "One or more asset metadata records could not be found.",
  UNLISTED_ASSET_MARKET_REQUIRED: "Unlisted assets must include a validated Uniswap V3 pool.",
  ASSET_MARKET_REQUIREMENTS_NOT_MET: "This asset or pool does not currently meet every market requirement. Review the observed values and try again later.",
  ASSET_MARKET_VALIDATION_UNAVAILABLE: "Asset validation is temporarily unavailable. No asset or proposal was saved; try again shortly.",
  ASSETS_NOT_UNIQUE: "Each token contract may appear only once in a proposal.",
  WEIGHTS_NOT_100: "Portfolio weights must total 100%.",
  X_RECONNECT_REQUIRED: "Sign in with X again so OTF Launch can refresh your eligibility.",
  ACCOUNT_TOO_NEW: "Your X account must be at least 30 days old to submit or vote.",
  X_UNAVAILABLE: "X verification is temporarily unavailable. Please try again shortly.",
  X_NOT_FOUND: "That X account or post could not be found. Check it is public and try again.",
  X_POST_NOT_FOUND: "That public X post could not be found. Check the URL and try again.",
  PROOF_AUTHOR_MISMATCH: "This post was not published by your signed-in X account.",
  PROOF_CODE_MISSING: "The post does not contain the required verification code. Publish the prepared text without removing it.",
  PROOF_MISMATCH: "Paste a valid public x.com post URL.",
  CHALLENGE_EXPIRED: "This verification code expired. Prepare a new X post and try again.",
  X_RATE_LIMITED: "X is temporarily rate limited. Please try again shortly.",
  RATE_LIMITED: "Too many attempts. Please wait ten minutes and try again.",
  RATE_LIMIT_UNAVAILABLE: "Request protection is temporarily unavailable. Please try again shortly.",
  TURNSTILE_REQUIRED: "Complete the verification check, then try again.",
  TURNSTILE_FAILED: "The verification check expired or failed. Complete it again and retry.",
  X_POST_CHANGED: "The required X post was deleted or changed, so the action is no longer valid.",
  POST_TOO_LONG: "The X post is too long. Shorten your context and try again.",
  PROPOSAL_HAS_VOTES: "This submission already has votes and can no longer be deleted.",
  BALLOT_ALREADY_ACTIVE: "Your ballot is already active. Cast newly unlocked votes from your existing ballot.",
  BALLOT_NOT_ACTIVE: "Activate your ballot before casting newly unlocked votes.",
  VOTING_NOT_OPEN: "Voting opens on competition day 8. OTF submissions are open now.",
  VOTES_NOT_UNLOCKED: "You tried to cast more votes than are currently unlocked. Wait for the next vote to unlock.",
  VOTES_ARE_FINAL: "Votes already cast cannot be moved or removed. Add only newly unlocked votes.",
  NO_NEW_VOTES: "Add at least one newly unlocked vote before continuing.",
  ACTION_IN_PROGRESS: "This action is already being processed.",
  COMPETITION_NOT_OPEN: "The competition is not currently open.",
  PRICE_CHECKPOINT_UNAVAILABLE: "A complete price checkpoint within the allowed freshness window is unavailable. Try again after the next 30-minute checkpoint."
};

export class PublicApiError extends Error {
  constructor(code: string, readonly metadata: Record<string, unknown> = {}) {
    super(code);
    this.name = "PublicApiError";
  }
}
