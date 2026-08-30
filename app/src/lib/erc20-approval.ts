export async function ensureExactErc20Approval(
  currentAllowance: bigint,
  requiredAmount: bigint,
  confirmApproval: (amount: bigint) => Promise<void>,
): Promise<void> {
  if (currentAllowance >= requiredAmount) return;
  if (currentAllowance > 0n) await confirmApproval(0n);
  await confirmApproval(requiredAmount);
}
