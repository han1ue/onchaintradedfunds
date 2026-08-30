import { describe, expect, it, vi } from "vitest";
import { ensureExactErc20Approval } from "./erc20-approval";

describe("ensureExactErc20Approval", () => {
  it("approves exactly the requirement when the allowance is zero", async () => {
    const confirmApproval = vi.fn(async () => undefined);

    await ensureExactErc20Approval(0n, 25n, confirmApproval);

    expect(confirmApproval).toHaveBeenCalledTimes(1);
    expect(confirmApproval).toHaveBeenCalledWith(25n);
  });

  it("waits for a nonzero allowance reset before approving the exact requirement", async () => {
    const submitted: bigint[] = [];
    let confirmReset: () => void = () => undefined;
    const resetConfirmation = new Promise<void>((resolve) => {
      confirmReset = resolve;
    });

    const pending = ensureExactErc20Approval(5n, 25n, async (amount) => {
      submitted.push(amount);
      if (amount === 0n) await resetConfirmation;
    });

    expect(submitted).toEqual([0n]);
    confirmReset();
    await pending;
    expect(submitted).toEqual([0n, 25n]);
  });

  it("does not submit an approval when the current allowance is sufficient", async () => {
    const confirmApproval = vi.fn(async () => undefined);

    await ensureExactErc20Approval(25n, 25n, confirmApproval);

    expect(confirmApproval).not.toHaveBeenCalled();
  });
});
