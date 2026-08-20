import { createHash } from "node:crypto";
import type { CompetitionRules } from "@/lib/competition";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

export function hashCompetitionRules(rules: CompetitionRules) {
  return createHash("sha256").update(JSON.stringify(canonicalize(rules))).digest("hex");
}

export function assertCompetitionRulesSnapshot(rules: CompetitionRules, expectedHash: string) {
  if (hashCompetitionRules(rules) !== expectedHash) throw new Error("COMPETITION_RULES_INVALID");
  return rules;
}
