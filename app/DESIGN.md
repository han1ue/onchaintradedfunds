---
name: Onchain Traded Funds
description: A Robinhood-native finance interface with a charcoal-dark appearance.
colors:
  background: "#0d0f0c"
  nav: "#12150e"
  card: "#151814"
  card-raised: "#1b1e18"
  border: "#343a30"
  text: "#f7f7f5"
  text-muted: "#999991"
  lime: "#ccff00"
  gold: "#f1b93d"
  danger: "#eb6570"
  splash-ground: "#080907"
  splash-lockup: "#f2f7f8"
  splash-flow: "#ccff00"
  splash-entry: "#ccff00"
  splash-entry-ink: "#090909"
typography:
  display:
    fontFamily: 'Instrument Sans, "Segoe UI", ui-sans-serif, system-ui, sans-serif'
    fontSize: "clamp(1.75rem, 5vw, 2.35rem)"
    fontWeight: 640
    lineHeight: 1.15
    letterSpacing: "-0.035em"
  splash-display:
    fontFamily: 'Instrument Sans, "Segoe UI", ui-sans-serif, system-ui, sans-serif'
    fontSize: "clamp(4.25rem, 8.1vw, 6rem)"
    fontWeight: 560
    lineHeight: 0.82
    letterSpacing: "-0.04em"
    fontFeature: '"ss02" 1'
    fontVariation: '"wdth" 91, "wght" 560'
  body:
    fontFamily: 'Instrument Sans, "Segoe UI", ui-sans-serif, system-ui, sans-serif'
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
    backgroundColor: "{colors.lime}"
    textColor: "#090909"
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

# Main application design system

## Design principles

Use compact controls, clear hierarchy, and the Robinhood dark palette. Swap focuses on one exchange; creation, fund detail, and liquidity pages can use denser layouts.

Color identifies actions and status. Surface tones and thin borders separate content.

The splash uses a large Instrument Sans title, animated convergence field, and lime entry control. Interior routes keep the same typeface at a smaller scale.

## Color

- `background` fills the page; `nav`, `card`, and `card-raised` distinguish surfaces.
- `lime` marks available actions, active selections, focus, and confirmed states. It also appears in the ambient field and logo.
- `gold` is reserved for experimental, unavailable, or cautionary states.
- `danger` is reserved for errors and failed transactions.
- Splash colors apply only to the entry screen.

The application always uses olive-charcoal surfaces, including wallet dialogs. Settings contains no appearance selector.

## Typography

Use self-hosted Instrument Sans with system sans-serif fallbacks. Large text identifies the route or fund; smaller headings let values and controls dominate. Labels are compact and medium weight. Use tabular numerals for comparison.

Reserve the splash title's display scale, width, weight, line height, and tracking for that screen.

## Layout

Center the compact Swap card. Arrange payment, reversal, receipt, status, and primary action vertically. Keep alternate routes, fees, price impact, and hops behind a disclosure.

Other routes use wider ruled sections. The shared header has an olive-black surface and lime keyline. Keep it on one row down to 320 px, reducing or hiding the brand label before controls overflow.

The splash fills the dynamic viewport below the warning. On desktop, place the title left, convergence field right, and entry action lower right. At 760 px and below, move the field behind the content and align the text and action 20 px from the left edge. Reduce title size on short viewports.

## Surfaces and controls

The Swap card uses a 16 px radius and a diffuse shadow. Actions and inputs use 8 px radii; grouped fields use 12 px. Token and protocol $OTF coin marks are circular. Fund-share marks are black squares with a heavy lime border.

Use lime primary buttons when the action can proceed. Name what blocks disabled controls. Secondary controls use bordered, transparent or card-toned surfaces. Keep focus visible without animation.

Inputs use the raised surface and a border. Focus uses the accent color. Pair disabled and failed states with explicit text.

Navigation contains Swap, Funds, `$OTF`, the Robinhood network selector, wallet control, and settings. The closed network selector shows only its icon.

## Splash

The splash contains the product name on three lines with lime O, T, and F initials, the tagline `the standard for the new era`, and one entry action. The convergence field is an inline SVG with gradient paths, tilted orbits, and a central ring.

Keep motion subtle, with field cycles of 7 to 28 seconds and a 180 ms entry transition. `prefers-reduced-motion: reduce` stops field animations and entry transitions while preserving the static composition.

## Product presentation rules

- Show missing chain data as unavailable. Use real quotes, simulations, and transaction results.
- Keep market-cap weighting as an explicit mode. Recalculate on constituent changes while selected, switch to manual mode after a weight edit, and preserve remaining manual weights after removal.
- Use `Market-cap weighted` only for exact default percentage units. Any exact-unit change is `Modified market-cap weighted`.
- Describe `$1` as the initial offchain calculation target, with no peg or price guarantee. Distinguish the onchain thesis from offchain prices, percentages, and weighting metadata.
- Label NAV per share and AUM as informational offchain snapshots with browser-local history.
- Confirm the submitted payload. Lock editing and resubmission after broadcast; only a confirmed revert allows retry.
- Separate route, fee, gas, and price-impact information.
- Link to external venues for production liquidity. The built-in utility is testnet-only and USDG-only.
- Limit verification labels to identity and ordinary metadata. They do not verify liquidity, route quality, economics, audit status, or investment safety.
- Keep the splash to one viewport and one action. Reserve its display typography and convergence field for that screen.
