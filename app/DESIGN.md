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
typography:
  display:
    fontFamily: "Inter, Segoe UI, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 5vw, 2.35rem)"
    fontWeight: 640
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Inter, Segoe UI, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  control: "8px"
  card: "12px"
  primary-surface: "16px"
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
---

# Design System: Onchain Traded Funds

## Overview

**Creative North Star: "The Dark Exchange Ledger"**

The product uses a low-light operational field, teal signals, and thin rules to make financial state feel legible rather than promotional. The visual hierarchy is compact, exact, and calm enough for repeated task use.

**Key Characteristics:**

- Dense but breathable transaction controls.
- Teal marks a confirmed path or intentional action; gold and rose name caution or failure.
- Data is layered by tone and rule, not by an excess of floating cards.

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

## Typography

**Display Font:** Inter with the system sans-serif fallback stack.

**Body Font:** Inter with the system sans-serif fallback stack.

**Character:** Modest display headings make space for the operational object. Numeric inputs are large enough to scan quickly, while labels and explanations stay compact and precise.

### Hierarchy

- **Display:** Used only for route-level purpose and fund identity.
- **Body:** Kept to a readable measure and used for truthful operational explanation.
- **Label:** Small, medium-weight labels explain the value without becoming decoration.

## Layout

The Swap route centers a narrow task surface in a broad dark field. The card keeps payment, reversal, receipt, state, and route details in a single vertical flow. Auxiliary pages use ruled sections and a wider 760px content measure. On mobile, navigation becomes two rows and pair, quote, and formation fields collapse without horizontal overflow.

## Elevation & Depth

Most separation comes from adjacent dark tones and 1px rules. The central Swap card alone gets a diffuse downward shadow so it reads as the current task without turning the rest of the product into a card grid.

## Shapes

Controls are gently rounded: 8px for actions and inputs, 12px for grouped fields, and 16px for the primary swap surface. OTF marks use a square-softened teal form; regular token marks stay circular.

## Components

### Buttons

- **Primary:** Full-width teal action for a currently possible flow; unavailable actions become slate and must name the blocking condition.
- **Secondary:** Transparent or card-toned actions with a thin border.
- **Focus:** Inputs and controls move their border to teal; hover is subtle and never relies on motion alone.

### Cards / Containers

- **Primary Swap Surface:** One centered card with a 16px radius and diffuse shadow.
- **Route Ledger:** Uses internal rules and rows, not nested raised cards.

### Inputs / Fields

- **Style:** Raised-slate background with ledger border.
- **Focus:** Teal border and a small tonal shift.
- **Disabled:** Slate, muted text, and explicit recovery copy.

### Navigation

The nav is a ruled, lightly blurred top bar. Swap, Funds, and Verified are centered; the active item receives a restrained teal wash. Wallet connection remains on the right.

## Do's and Don'ts

### Do:

- **Do** make unavailable chain data visibly unavailable.
- **Do** use ordered constituent addresses for formation; allocation belongs to the authenticated snapshot, not the creator form.
- **Do** keep route, fee, gas, and price-impact information separate.
- **Do** leave external liquidity in its official venue with a leaving-app disclosure.

### Don't:

- **Don't** use verification language for pools, routes, liquidity, economics, or investment safety.
- **Don't** report a fixture or preview as a quote, simulation, or submitted transaction.
- **Don't** rebuild the route around equal-sized dashboard cards or a marketing hero.
