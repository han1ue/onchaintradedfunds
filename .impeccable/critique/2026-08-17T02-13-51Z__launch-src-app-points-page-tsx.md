---
target: the /launch XP page and live XP concept
total_score: 16
max_score: 32
na_heuristics: 3,9
p0_count: 0
p1_count: 3
timestamp: 2026-08-17T02-13-51Z
slug: launch-src-app-points-page-tsx
---
Method: dual-agent (A: /root/xp_design_review · B: /root/xp_evidence_review)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Timestamp and pending labels help, but the provisional state, refresh cadence, and volatility are not prominent. |
| 2 | Match System / Real World | 2 | “Live XP,” “released,” “allocated,” “canonical,” and “provider snapshot” require users to translate internal concepts. |
| 3 | User Control and Freedom | n/a | This is a read-only ledger with no reversible workflow. |
| 4 | Consistency and Standards | 3 | The page is visually cohesive with the launch application, though final-state terminology is inconsistent. |
| 5 | Error Prevention | 2 | The bottom warning cannot counteract a hero that implies an earned balance. |
| 6 | Recognition Rather Than Recall | 2 | Users must remember formulas, denominators, and rollover rules from another page. |
| 7 | Flexibility and Efficiency | 1 | The audit ledger lacks search, sorting, self-location, deltas, trends, and calculation drill-down. |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained and scannable, but numerical spectacle outranks comprehension. |
| 9 | Error Recovery | n/a | No input or error-recovery workflow exists on this surface. |
| 10 | Help and Documentation | 1 | No contextual explanation sits beside the numbers that need it. |
| **Total** | | **16/32** | **Acceptable — significant conceptual clarification needed.** |

## Design Specificity Verdict

The visual treatment is partially authored for OTF, but the structure remains a generic crypto rewards dashboard: large balance, KPI cards, leaderboard, disclaimer. The product-specific opportunity is the distribution mechanism itself—vote tranches, independent performance cohorts, the final price checkpoint, proportional pools, deterministic allocation, and rollovers. Explaining that mechanism visually would feel more specific and trustworthy than presenting another exact-number ledger.

“Live XP” is technically defensible only as an internal system status. The values are not accrued balances or dependable estimates of final XP; they are the latest provisional allocation of the portion of eligible pools released so far. Before finalization, performance XP is always zero and requires a final provider-price checkpoint. Participation and creator allocations can be calculated from current valid activity, but can rise or fall as votes, evidence, moderation, and eligible denominators change. If a performance cohort has no positive awardable score, its pool rolls into participation.

The deterministic scan returned zero findings for `launch/src/app/points/page.tsx`. This is not evidence that the concept is clear: the detector does not cover misleading product semantics or an empty state that misdiagnoses an already-completed calculation run.

No reliable user-visible overlay was created because the browser surface rejected mutable script injection. Desktop and mobile inspection instead confirmed a clean responsive layout with no horizontal overflow. The live page exposed a concrete copy bug: it showed an existing calculation timestamp, released XP, zero allocated XP, and zero participants while claiming that “XP calculation is starting.”

## Overall Impression

The page looks authoritative before it earns that authority. Its strongest qualities—precise integers, timestamps, canonical language, and a compact ledger—also intensify the central misunderstanding by making a reversible snapshot feel like an owned balance. The biggest opportunity is to turn the page from a rewards dashboard into an explanation-first allocation model, with the provisional ledger as optional audit detail.

## What’s Working

- Tabular numerals, right-aligned values, compact rows, restrained teal, and border-led depth support fast comparison without promotional noise.
- Calculation timestamps, final-provider state, pending tranche labels, generated-name disclosure, and deterministic allocation language create useful audit signals.
- The layout collapses cleanly at mobile sizes and avoids horizontal overflow.

## Priority Issues

### P1 — “Live XP” reads as an earned balance

**Why it matters:** “Your Live XP,” exact integers, leaderboard rank, and rewards language imply ownership even though the allocation can fall and omits all performance XP.

**Fix:** Rename the live state to “Provisional XP allocation” or “Current XP standings.” Place “Not final · can rise or fall” beside the title. Reserve “Final XP” for the audited snapshot.

**Suggested command:** `$impeccable clarify`

### P1 — The page shows outputs before explaining the distribution model

**Why it matters:** The core participant question is how 10,000,000 XP will be divided. KPI cards foreground changing outputs without teaching the rules that create them.

**Fix:** Lead with a 100% pool allocation bar, a current-versus-final timeline, and compact formula flows for performance, participation, and creator XP. Move the ledger below as audit detail.

**Suggested command:** `$impeccable distill`

### P1 — Metrics imply incorrect causal relationships

**Why it matters:** “Supporters” appears beside creator XP even though creator XP is weighted by valid votes, not unique supporters. “Released,” “allocated,” and final maximums are not clearly distinguished.

**Fix:** Label values as provisional released/allocated amounts against their maximums. Move “Unique supporters · context only” away from XP components or remove it. Explain released-but-unallocated gaps.

**Suggested command:** `$impeccable clarify`

### P2 — Critical qualification arrives too late

**Why it matters:** Users form an ownership interpretation from the hero before reaching the final disclaimer.

**Fix:** Put the volatility and performance-lock explanation directly under the title, with an inline “How allocation works” path. Keep monetary-value language as a separate end note.

**Suggested command:** `$impeccable layout`

### P2 — Empty-state and ledger semantics need hardening

**Why it matters:** An existing calculation with no eligible allocation is mislabeled as a calculation that has not started. The custom table and CSS-generated mobile labels also weaken accessible relationships.

**Fix:** Distinguish “no calculation run” from “calculated, no eligible participants.” Use semantic table markup or complete the ARIA hierarchy, preserve real mobile labels, and raise critical-label sizes.

**Suggested command:** `$impeccable harden`

## Persona Red Flags

**Jordan — first-time participant:** Reads “Your Live XP” literally, cannot distinguish released from allocated or final, and must leave the page to discover that the number can fall and performance is deferred.

**Alex — power user/auditor:** Cannot inspect formulas, denominators, prior-snapshot deltas, or why rank changed. “Supporters” appears analytically relevant even though it does not drive creator XP.

**Sam — screen-reader/low-vision user:** The pseudo-table lacks full cell/header semantics, mobile relationships depend on generated labels, and small metadata carries the most critical distinctions.

## Minor Observations

- Page metadata remains “Live XP” even when the snapshot is final.
- Pending performance is displayed as zero rather than “Locked until final snapshot.”
- “Verified participation” is misleading because participation is based on valid vote units, not the verified/non-verified performance cohort.
- The refresh cadence is not stated.
- Unauthenticated users receive no inline explanation that signing in reveals their own summary.

## Questions to Consider

- If provisional XP can fall, what exactly has the user earned today?
- Is the page primarily ranking people now, or explaining how 10,000,000 XP will ultimately be distributed?
- Would one allocation bar and three plain-language formulas create more trust than nine exact numbers?
- Should pending performance be represented as locked rather than zero?
- What should the empty state say when a calculation exists but nobody has an eligible allocation?
