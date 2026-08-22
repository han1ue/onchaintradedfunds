export function deriveOtfVerified(values: readonly unknown[]): boolean {
  return values.length > 0 && values.every((value) => value === true);
}
