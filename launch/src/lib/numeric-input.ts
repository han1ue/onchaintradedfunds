export function normalizeWholeNumberInput(value: string, maximum: number) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return String(Math.min(maximum, Number.parseInt(digits, 10)));
}
