---
name: Onchain Traded Funds
description: A restrained dark finance interface for transparent onchain fund operations.
colors:
  background: "#0e1218"
  nav: "#0f141b"
  card: "#131820"
  card-raised: "#181e27"
  border: "#282f3a"
  text: "#edf2f7"
  text-muted: "#8794a7"
  teal: "#37b7aa"
  gold: "#f1b93d"
  danger: "#eb6570"
  splash-ground: "#071014"
  splash-lockup: "#f2f7f8"
  splash-flow: "#48d5c6"
  splash-entry: "#e7f5f2"
  splash-entry-ink: "#071411"
typography:
  display:
    fontFamily: "Inter, Segoe UI, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 5vw, 2.35rem)"
    fontWeight: 640
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  splash-display:
    fontFamily: 'Instrument Sans, Inter, "Segoe UI", ui-sans-serif, system-ui, sans-serif'
    fontSize: "clamp(4.25rem, 8.1vw, 6rem)"
    fontWeight: 560
    lineHeight: 0.82
    letterSpacing: "-0.04em"
    fontFeature: '"ss02" 1'
    fontVariation: '"wdth" 91, "wght" 560'
  body:
    fontFamily: "Inter, Segoe UI, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  control: "8px"
  card: "12px"
  primary-surface: "16px"
  splash-entry: "10px"
spacing:
  compact: "8px"
  standard: "16px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.teal}"
    textColor: "#071716"
    rounded: "{rounded.control}"
    height: "46px"
  surface-card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.primary-surface}"
  button-splash-entry:
    backgroundColor: "{colors.splash-entry}"
    textColor: "{colors.splash-entry-ink}"
    rounded: "{rounded.splash-entry}"
    padding: "0 18px 0 20px"
---

# Design System: Onchain Traded Funds

## Overview

**Creative North Star: "The Calm Exchange"**

The product uses a low-light operational field, teal signals, and thin rules to make financial state feel legible rather than promotional. Swap is intentionally reduced to one obvious exchange task, while supporting routes retain the denser operational language they need.

The splash is a deliberately separate threshold into that world: a full-viewport blue-black plate where fine teal market lines converge into one OTF. It is an established-world extension, not a replacement grammar; the oversized lowercase lockup, code-led field, and pale entry control stop at the app boundary.

**Key Characteristics:**

- Compact, breathable transaction controls with progressive disclosure.
- Teal marks a confirmed path or intentional action; gold and rose name caution or failure.
- Data is layered by tone and rule, not by an excess of floating cards.
- A single stark entry plate introduces the product, then yields to the compact Calm Exchange.

## Colors

Deep blue-black surfaces hold the interface; teal is scarce and therefore meaningful.

### Primary

- **OTF Teal:** Used for the primary action, active navigation, and verified-ready signals.

### Secondary

- **Caution Gold:** Used for experimental, unavailable, or non-recommended disclosures.
- **Failure Rose:** Used only for validation and transaction failures.

### Neutral

- **Night Field:** The page background and visual ground.
- **Raised Slate:** Inputs and nested task areas.
- **Ledger Rule:** Quiet structural separation.

**The Accent-Is-Evidence Rule.** Use teal to show an active selection or a confirmed state, never as generic decoration.

### Splash Extension

- **Entry Black:** Blue-black ground reserved for the entry plate.
- **Lockup White:** Near-white title color that keeps the lowercase name stark and legible.
- **Convergence Teal:** A brighter teal used only by the flow field and its small tagline rule.
- **Entry Pale and Entry Ink:** The high-contrast pair for the single splash entry control.

**The Threshold Palette Rule.** The convergence field is the splash-only expression of teal as many market lines becoming one OTF. Once the user enters, return to the incumbent Night Field, OTF Teal, and ledger neutrals.

## Typography

**Display Font:** Inter with the system sans-serif fallback stack.

**Body Font:** Inter with the system sans-serif fallback stack.

**Splash Display Font:** Self-hosted Instrument Sans variable with Inter and the system sans-serif stack as fallback.

**Character:** Modest display headings make space for the operational object. Numeric inputs are large enough to scan quickly, while labels and explanations stay compact and precise.

### Hierarchy

- **Display:** Used only for route-level purpose and fund identity.
- **Splash Display:** A three-line lowercase lockup at a variable 560 weight, a 4.25–6rem desktop scale, 0.82 line height, and tight tracking. Its slightly condensed width and stylistic set belong only to the product-name stack.
- **Body:** Kept to a readable measure and used for truthful operational explanation.
- **Label:** Small, medium-weight labels explain the value without becoming decoration.

**The Type Boundary Rule.** Instrument Sans and the oversized stacked lockup are exclusive to the splash; the operating application remains an Inter-led system with modest display headings.

## Layout

The Swap route centers a compact exchange surface in a broad dark field. The card keeps payment, reversal, receipt, the primary action, and only current status in one vertical flow; route inspection stays collapsed until requested. Auxiliary pages use ruled sections and a wider content measure. The shared header is an inset floating bar below the Testnet warning. On mobile it remains one compact row, reduces the brand to its mark or hides it when necessary, and prevents control overflow down to 320px.

The splash fills the dynamic viewport below the Testnet warning. On desktop, the title and tagline stay on the left, the convergence field occupies the right, and the entry control anchors to the lower-right. At 760px and below, the field expands behind the composition while the copy and entry control share a 20px left edge; the control moves to the lower-left. Short desktop viewports reduce the title and move the copy toward the top without introducing scroll-led marketing sections.

## Elevation & Depth

Most separation comes from adjacent dark tones and 1px rules. The central Swap card alone gets a diffuse downward shadow so it reads as the current task without turning the rest of the product into a card grid.

The splash remains cardless. Its inline field uses soft SVG glow, while the pale entry control carries the only conventional lift with a diffuse downward shadow that tightens on press.

## Shapes

Controls are gently rounded: 8px for actions and inputs, 12px for grouped fields, and 16px for the primary swap surface. OTF marks use a square-softened teal form; regular token marks stay circular.

The splash entry control uses a restrained 10px radius. Flow paths, tilted orbits, and the central ring provide the entry plate's geometry; they do not introduce a new card silhouette for the interior app.

## Components

### Buttons

- **Primary:** Full-width teal action for a currently possible flow; unavailable actions become slate and must name the blocking condition.
- **Secondary:** Transparent or card-toned actions with a thin border.
- **Focus:** Inputs and controls move their border to teal; hover is subtle and never relies on motion alone.

### Cards / Containers

- **Primary Swap Surface:** One centered card with a 16px radius and diffuse shadow.
- **Quote Details:** A single collapsed disclosure contains alternate queried routes, metrics, hops, fees, impact, and factual route disclosures.

### Inputs / Fields

- **Style:** Raised-slate background with ledger border.
- **Focus:** Teal border and a small tonal shift.
- **Disabled:** Slate, muted text, and explicit recovery copy.

### Navigation

The navigation surface floats away from the viewport edges with rounded ends, a quiet rule, restrained blur, and soft shadow. It contains Swap, Funds, and Docs. The right side orders the icon-only Robinhood network selector, the RainbowKit connection/account control, and settings. The closed network control never displays a chain name.

### Splash Entry Plate

- **Lockup:** Three stacked lowercase title lines followed only by “the standard for the new era.”
- **Convergence Field:** A code-led inline SVG of fine gradient paths, tilted orbits, a glow, and a central ring. No raster asset is part of the splash.
- **Entry Control:** One pale rectangular button with a 10px radius, a right arrow, a 164px minimum width, and a 56px minimum height. Hover lifts it by 2px and advances the arrow by 3px; press returns it to rest.
- **Motion:** Flow current, field drift, orbit, core pulse, and ring rotation remain low-amplitude and contained within the field. The cycles run from 7 to 28 seconds, while the entry control uses a 180ms ease-out transition. Under `prefers-reduced-motion: reduce`, every field animation and entry transition stops.

## Do's and Don'ts

### Do:

- **Do** make unavailable chain data visibly unavailable.
- **Do** default creator allocations from current market caps at 18-decimal precision, keep every positive percentage editable, and require an exact internal 100% total.
- **Do** make market-cap weighting an explicit selected mode: automatically renormalize on constituent changes while selected, switch to manual mode on any weight edit, add new manual constituents at 0%, and leave remaining manual weights untouched when a constituent is removed.
- **Do** label exact default weights `Market-cap weighted` and any exact-unit tilt `Modified market-cap weighted`; show neutral fixed-point multipliers as unchanged, overweight, or underweight.
- **Do** describe creation methodology as informational initialization metadata, never an ongoing onchain rebalance, and show `Weighting method unavailable` rather than infer it from balances.
- **Do** show current price, market cap, minimum viable percentage, and final token quantity while composing the basket; keep Review focused on the final initial percentage for each constituent.
- **Do** describe the fixed `$1` target as an initial basket value based on current offchain prices, never as a peg or guaranteed market price.
- **Do** distinguish offchain prices, market caps, percentages, and the fixed `$1` target from the small onchain creation payload.
- **Do** render creation confirmation from the captured submitted payload, keeping navigation and resubmission locked while pending, successful, or receipt status is unknown; only a pre-broadcast failure or explicit onchain revert unlocks retry.
- **Do** open a dedicated confirmation route only after verifying the successful factory event, show the transaction and new OTF address, and redirect to the live fund page after five seconds.
- **Do** keep route, fee, gas, and price-impact information separate.
- **Do** leave production liquidity in its official venue with a leaving-app disclosure; keep the internal liquidity utility visibly testnet-only and USDG-only.
- **Do** keep the splash to the product name, the fixed tagline, and one entry action within the first viewport below the warning.
- **Do** confine the oversized Instrument Sans lockup, convergence geometry, and pale CTA to the splash, then restore the Calm Exchange grammar inside the app.
- **Do** preserve the static composition when reduced motion disables the splash animations.

### Don't:

- **Don't** use verification language for pools, routes, liquidity, economics, or investment safety.
- **Don't** report a fixture or preview as a quote, simulation, or submitted transaction.
- **Don't** imply that creation metadata is authenticated by or stored in the contracts.
- **Don't** classify methodology from touched fields, raw-token rounding, or current portfolio weights.
- **Don't** rebuild the route around equal-sized dashboard cards or a marketing hero.
- **Don't** expand the splash into a long marketing page, card-based hero, proof block, or additional product claim.
- **Don't** carry the splash title scale, flow field, or pale entry control into the operating application.
- **Don't** replace the code-led convergence field with a shipping raster.
