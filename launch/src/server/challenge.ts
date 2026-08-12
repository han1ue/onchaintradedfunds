import { createHash, randomBytes } from "node:crypto";
import { env } from "./env";

export function createChallengeToken() {
  const nonce = randomBytes(24).toString("base64url");
  return {
    nonce,
    nonceHash: createHash("sha256").update(nonce).digest("hex"),
    proofUrl: `${env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001"}/proof/${nonce}`
  };
}

export function xIntent(text: string, proofUrl: string) {
  const params = new URLSearchParams({ text: `${text}\n\n${proofUrl}\n\nMy take: ` });
  return `https://x.com/intent/post?${params.toString()}`;
}
