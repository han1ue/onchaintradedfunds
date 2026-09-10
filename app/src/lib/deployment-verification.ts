import { keccak256, type Hex } from "viem";

// Only bytecode without delegation can retain immutable binding checks. Code is
// read again by the caller so a changed deployment invalidates the fingerprint.
export function delegates(code: Hex): boolean {
  const bytes = code.slice(2);
  for (let offset = 0; offset < bytes.length; offset += 2) {
    const opcode = Number.parseInt(bytes.slice(offset, offset + 2), 16);
    if (opcode === 0xf4 || opcode === 0xf2) return true;
    if (opcode >= 0x60 && opcode <= 0x7f) offset += (opcode - 0x5f) * 2;
  }
  return code.startsWith("0xef0100");
}

const verified = new Map<string, Promise<void>>();
export async function verifyImmutableDeployment(configuration: string, codes: readonly Hex[], verify: () => Promise<void>) {
  if (codes.some(delegates)) return verify();
  const key = `${configuration}:${codes.map(code => keccak256(code)).join(":")}`;
  let result = verified.get(key);
  if (!result) {
    if (verified.size >= 16) verified.delete(verified.keys().next().value!);
    result = verify().catch(error => { verified.delete(key); throw error; });
    verified.set(key, result);
  }
  return result;
}
