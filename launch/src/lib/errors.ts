export const errorMessages: Record<string, string> = {
  X_NOT_VERIFIED: "A verified, public X account is required.",
  FOLLOWER_THRESHOLD: "Your X account does not meet the follower requirement.",
  ASSET_INELIGIBLE: "One or more portfolio assets are not currently eligible.",
  WEIGHTS_NOT_100: "Portfolio weights must total 100%.",
  X_RECONNECT_REQUIRED: "Reconnect X so OTF Launch can publish the post you approve.",
  X_POST_FAILED: "X could not publish the post. Nothing was submitted; please try again.",
  X_RATE_LIMITED: "X is temporarily rate limited. Please try again shortly.",
  X_POST_CHANGED: "The required X post was deleted or changed, so the action is no longer valid.",
  POST_TOO_LONG: "The X post is too long. Shorten your context and try again.",
  DUPLICATE_VOTE: "You have already voted for this OTF.",
  SELF_VOTE: "You cannot vote for your own OTF.",
  ACTION_IN_PROGRESS: "This action is already being processed.",
  COMPETITION_NOT_OPEN: "The competition is not currently open."
};
