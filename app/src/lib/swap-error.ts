/** Convert wallet/provider failures into actionable copy without exposing request data. */
export function swapErrorMessage(error: unknown, submittedHash?: string): string {
  const seen = new Set<unknown>();
  let cause = error;
  let rejected = false;
  let insufficientFunds = false;
  let reverted = false;
  while (cause && typeof cause === "object" && !seen.has(cause)) {
    seen.add(cause);
    const detail = cause as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
    const text = [detail.name, detail.message].filter((value) => typeof value === "string").join(" ");
    rejected ||= detail.code === 4001 || detail.code === "4001" || detail.code === "ACTION_REJECTED"
      || /UserRejectedRequestError|user (rejected|denied)|request rejected/iu.test(text);
    insufficientFunds ||= /InsufficientFundsError|insufficient funds/iu.test(text);
    reverted ||= /reverted/iu.test(text);
    cause = detail.cause;
  }
  if (rejected) return "Request cancelled in your wallet.";
  if (submittedHash) return reverted
    ? "The transaction reverted. Refresh the quote before trying again."
    : "Confirmation is taking longer than expected. Check the transaction before trying again.";
  if (insufficientFunds) return "Not enough funds to cover the swap and gas fee. Reduce the amount or add funds.";
  if (reverted) return "The swap could not be completed. Refresh the quote and try again.";
  return "Swap failed. Refresh the quote and try again.";
}
