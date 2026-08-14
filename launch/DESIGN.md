---
name: OTF Launch Competition
description: A restrained ranked allocation desk for comparing and verifying proposed Onchain Traded Funds.
colors:
  background: "#0e1218"
  nav: "#0f141b"
  card: "#131820"
  card-raised: "#181e27"
  surface: "#1b222d"
  muted: "#242c37"
  border: "#282f3a"
  border-strong: "#35404d"
  text: "#edf2f7"
  text-soft: "#c7d0dc"
  text-muted: "#8794a7"
  teal: "#37b7aa"
  teal-hover: "#42c3b6"
  accent-foreground: "#071716"
  positive: "#2ed09a"
  warning: "#f1b93d"
  info: "#56acd3"
  rose: "#e9717e"
  violet: "#9c8be5"
  danger: "#eb6570"
typography:
  display:
    fontFamily: 'Inter, "Segoe UI", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "clamp(2.15rem, 4vw, 3.7rem)"
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: "-0.052em"
  headline:
    fontFamily: 'Inter, "Segoe UI", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "clamp(1.85rem, 4vw, 3rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.04em"
  title:
    fontFamily: 'Inter, "Segoe UI", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "0.98rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  body:
    fontFamily: 'Inter, "Segoe UI", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "0.82rem"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "normal"
  label:
    fontFamily: 'Inter, "Segoe UI", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "0.68rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "0.055em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  full: "999px"
spacing:
  hairline: "4px"
  control: "8px"
  grid: "12px"
  gutter-mobile: "14px"
  panel: "18px"
  gutter: "24px"
components:
  button-primary:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.accent-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.teal-hover}"
    textColor: "{colors.accent-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.teal}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 14px"
    height: "36px"
  field:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "8px 11px"
    height: "38px"
  status-badge:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
    height: "22px"
  section-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "18px"
  leaderboard-row:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text}"
    padding: "12px 16px"
    height: "102px"
---

# Design System: OTF Launch Competition

## Overview

**Creative North Star: "The Ranked Allocation Desk"**

OTF Launch is an operational comparison surface, not a promotional campaign. It feels like a compact market desk: proposals are ordered, theses are clipped for scanning, portfolio shape is visible before detail, and verified actions sit close to the evidence they affect. The system is dark-first, precise, and restrained enough for finance-oriented and crypto-native users to read the same interface without translation.

Visual identity comes from disciplined density rather than ornament. Teal signals action, active navigation, and trusted interaction; bordered near-black surfaces organize the workload; tabular numerals keep rankings, votes, and weights aligned. Light theme support remaps the same semantic roles while preserving hierarchy and contrast.

**Key Characteristics:**

- Dark-first operational canvas with a semantic light-theme counterpart.
- Dominant ranked data, compact thesis excerpts, and allocation-first comparison.
- Thin bordered surfaces, tight radii, sparse state color, and virtually no resting shadow.
- One system type stack with tabular numerals and a compressed label scale.
- Exact percentages are revealed where decisions need detail, while lists preserve scan speed.

## Colors

The palette is a cool near-black neutral ladder with a single teal interaction voice and a small set of semantic status and allocation hues.

### Primary

- **Verification Teal:** The interactive and active-state color for primary actions, links, current navigation, focus, icons, and the core allocation accent.
- **Teal Hover:** A slightly brighter response reserved for interactive hover state.
- **Deep Teal Ink:** The high-contrast foreground placed on teal-filled controls.

### Secondary

- **Signal Green:** Positive, valid, or live state only.
- **Evidence Blue:** Informational callouts and one allocation-series color.

### Tertiary

- **Review Gold:** Warning, timing, and first-rank emphasis.
- **Portfolio Rose:** Allocation-series differentiation; danger uses its separate semantic token.
- **Portfolio Violet:** Allocation-series differentiation only.

### Neutral

- **Night Canvas:** The application background and field well.
- **Navigation Ink:** Sticky navigation material.
- **Desk Surface:** Default cards and controls.
- **Raised Desk Surface:** Hovered controls, step icons, and subtle nested separation.
- **Inset Surface:** Secondary tonal layer for compact internal regions.
- **Muted Track:** Allocation-strip track and low-emphasis fills.
- **Hairline Border:** Default panel and divider stroke.
- **Strong Border:** Controls, active structure, and higher-emphasis boundaries.
- **Primary Text:** Headings, totals, and decisive labels.
- **Soft Text:** Body copy and secondary values.
- **Muted Text:** Metadata, helper copy, and column labels.
- **Danger Red:** Errors, destructive hover state, and invalid totals.

### Named Rules

**The One Teal Voice Rule.** Teal marks interaction, selection, verification, or portfolio identity; it does not become general decoration.

**The Semantic Rarity Rule.** Green, gold, blue, and danger red appear only when the content carries that state. Sparse status color makes each occurrence meaningful.

**The Role-Preserving Theme Rule.** Light theme may remap values, but it must not change which semantic role owns action, text, surface, border, or status.

## Typography

**Display Font:** Inter with Segoe UI and system sans-serif fallbacks
**Body Font:** Inter with Segoe UI and system sans-serif fallbacks
**Label/Mono Font:** The same system stack; numeric content uses tabular figures rather than a separate mono face

**Character:** A single incumbent product stack keeps the interface practical and consistent. Hierarchy comes from scale, weight, spacing, and compressed tracking instead of display-font contrast.

### Hierarchy

- **Display:** Reserved for the competition or proposal identity at the top of a primary screen; tightly tracked and nearly solid in line-height.
- **Headline:** Used for compact page titles and content-page headings.
- **Title:** Used for card headings and strong component labels.
- **Body:** Used for explanatory and legal content; long-form thesis copy loosens to a taller line-height and slightly larger size.
- **Label:** Used for table headers, metrics, state, helper copy, and dense navigation. Uppercase is limited to true labels and status metadata.

### Named Rules

**The Tabular Evidence Rule.** Votes, ranks, percentages, dates, and metrics use tabular numerals so comparison never shifts horizontally.

**The Restrained Hierarchy Rule.** Only page identity earns large type. Operational cards and controls remain compact so data, not headings, dominates the viewport.

## Layout

The desktop shell is centered at a maximum width of 1360px. Navigation is a sticky 56px band; page content uses 24px horizontal gutters and a 12px recurring grid gap. The primary desktop composition places a flexible leaderboard beside a 300px action rail, while proposal detail uses a flexible content column beside a 310px voting rail. The 100-vote ballot uses a flexible proposal list beside a sticky 320px total and activation rail. Content pages narrow to 1000px, and forms may use a 1160px working width with a 270px guidance rail.

At 1120px, the primary board collapses to one column and the leaderboard removes its portfolio column before creator identity. At 760px, gutters contract to 14px, main split layouts become single columns, the leaderboard turns from a header-led table into self-contained rows, creator metadata then recedes, and supporting metric detail is reduced. At 440px, navigation and row density tighten again while preserving rank, OTF identity, and vote total. The minimum supported canvas is 320px.

**The Twelve-Pixel Grid Rule.** Sibling cards and primary panel divisions use the recurring 12px gap unless a component's internal rhythm requires a tighter control-scale gap.

**The Evidence-Preserving Collapse Rule.** Responsive layouts remove portfolio comparison before creator metadata, then retain OTF identity, rank, and vote total through every narrower collapse.

## Elevation & Depth

The system is flat by default. One-pixel borders, close neutral steps, and an extremely faint teal radial wash create separation; section cards do not cast resting shadows. The sticky navigation adds restrained translucency and blur so content can pass behind it without becoming visually noisy. Shadow-like effects are state-specific: form focus uses a tight teal halo, and the positive badge dot uses a small semantic halo.

### Named Rules

**The Border Carries Depth Rule.** Prefer border and tonal contrast for hierarchy. Do not add card shadows to create depth the neutral ladder already provides.

**The State-Only Halo Rule.** Glow is permitted only for focus visibility or a small live-status indicator, never as ambient decoration.

## Shapes

The form language is precise and slightly softened: primary surfaces use an 8px radius, controls use 6px, compact allocation tracks use 4px, and status badges use a full pill. Most boundaries are a single pixel. Circles are reserved for progress steps, status dots, and tiny allocation markers rather than general container styling.

**The Tight Corner Rule.** Operational surfaces stay within the 4px-to-8px radius family; pill geometry belongs to compact state badges only.

## Components

### Buttons

- **Shape:** Compact rectangular controls with gently curved 6px corners and a 36px minimum height; the navigation action may contract to 34px.
- **Primary:** Verification teal fill with deep teal ink, strong label weight, and 14px horizontal padding.
- **Hover / Focus:** Hover brightens teal and lifts by 1px over 150ms; focus uses the global 2px teal outline with 3px offset; active may return the control to its resting plane.
- **Secondary / Ghost:** Secondary controls use a strong border on the desk surface and lift onto the raised surface on hover. Ghost controls carry teal text on transparent material.
- **Disabled:** Reduce opacity to 48%, remove the lift, and use a not-allowed cursor.

### Chips

- **Style:** Status badges are 22px pills with a 1px border, compact uppercase label treatment, and a 6px leading dot.
- **State:** Neutral badges use muted text and border. Positive, warning, and danger variants borrow semantic color only; positive state may add a faint tinted fill and dot halo.

### Cards / Containers

- **Corner Style:** Tight 8px corners.
- **Background:** Default desk surface, with subtle transparency only where the page wash should show through.
- **Shadow Strategy:** None at rest; see the border-led elevation rules.
- **Border:** A 1px neutral hairline separates cards, table rows, headers, and footers.
- **Internal Padding:** 18px is the panel baseline; dense rows and utility callouts use 12px-to-14px.

### Inputs / Fields

- **Style:** Night-canvas well, strong 1px border, 6px radius, 38px minimum height, and 8px by 11px internal padding.
- **Focus:** Teal border plus a tight 2px halo at low opacity. The global focus-visible outline remains the fallback for keyboard focus.
- **Error / Disabled:** Invalid totals use danger red; valid totals use signal green. Disabled action controls follow the button disabled rule.

### Navigation

The 56px sticky navigation uses a translucent navigation-ink material, a bottom hairline, and a 1360px inner shell. The square OTF mark is stroked in teal. Links are compact and muted by default, become primary text on hover, and use a 2px teal underline for the active route. On small screens, the launch label and lower-priority links progressively disappear before core actions do.

### Ranked Leaderboard

The signature comparison component aligns rank, OTF identity and thesis, portfolio shape, creator, and allocated vote total in a single desktop row. Each row is at least 102px high, divided by hairlines, and gains only a faint teal wash on hover. OTF identity uses the shared ticker-aware `OtfTokenIcon`. Allocation is encoded by a 6px segmented strip with clipped symbol and percentage labels; proposal detail grows the strip to 9px and follows it with a full allocation table. Entry animation is a restrained 5px rise over 320ms with staggered delays, and it is removed for reduced-motion preference.

### 100-Vote Ballot

The ballot is a single competition-wide workspace, not a set of independent proposal actions. Each proposal receives a numeric vote field, including the voter’s own proposal, and exactly 100 votes are required to activate or save. The running total remains visible in a sticky rail. One public X post activates the ballot; later redistributions reuse that verified ballot without requesting another post. A rolling 24-hour cooldown begins at activation and restarts after every saved redistribution.

### Wizard Progress

Four equal steps sit in a 70px band above the form. A 24px circular marker and a single hairline connector indicate sequence; active steps use a restrained teal tint rather than a filled progress rail. On mobile, text labels may disappear while ordered markers remain.

## Do's and Don'ts

### Do:

- **Do** use bordered tonal layers and the recurring 12px grid to organize dense operational content.
- **Do** keep action, verification, and focus in teal while reserving status hues for their literal semantic state.
- **Do** preserve tabular numerals, right-aligned totals, and explicit percentage detail where comparison requires precision.
- **Do** remove portfolio comparison before creator metadata, then retain rank, OTF identity, and vote total through every narrower collapse.
- **Do** honor reduced-motion preference by removing nonessential animation and transition.

### Don't:

- **Don't** add ambient card shadows, glossy materials, or broad neon glow.
- **Don't** use green, gold, blue, rose, violet, or danger red as general decoration.
- **Don't** enlarge card headings or labels until they compete with the ranked data.
- **Don't** replace the segmented allocation strip with a decorative chart that slows row scanning.
- **Don't** introduce decorative raster imagery into the operational shell.
