---
name: Onchain Traded Funds
description: A Robinhood-native finance interface with light and charcoal-dark appearances.
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

The application presents financial state with compact controls, clear hierarchy, and one Robinhood palette across light and dark appearances. Swap stays focused on one exchange task; creation, fund detail, and liquidity pages can use denser layouts where the workflow requires them.

Robinhood lime identifies an available action, active selection, keyboard focus, or confirmed state. Gold marks caution or unavailable behavior, and rose marks validation or transaction failure. Adjacent black surface tones and thin borders provide most visual separation.

The splash screen is a separate entry surface. Its large Instrument Sans title, convergence field, and pale entry control end when the user enters the application. Interior routes use the same family at a compact operational scale.

## Color

- `background` is the page field; `nav`, `card`, and `card-raised` define increasing surface emphasis.
- `lime` is reserved for interaction and confirmed readiness, apart from the branded ambient field and logo.
- `gold` is reserved for experimental, unavailable, or cautionary states.
- `danger` is reserved for errors and failed transactions.
- Splash colors apply only to the entry screen.

The appearance selector offers Browser, Light, and Dark. Both appearances use the Robinhood palette; there is no alternate brand theme. Dark uses olive-charcoal surfaces rather than pitch black, while Light uses warm off-white surfaces and a darker olive accent for readable text and focus states.

## Typography

All interface text uses self-hosted Instrument Sans with system sans-serif fallbacks. Large text identifies the current route or fund; operational headings remain modest so values and controls dominate. Labels are compact and medium weight. Numeric content should remain easy to compare.

The splash title uses the specified Instrument Sans width, weight, line height, and tracking. Its display scale remains exclusive to the splash.

## Layout

Swap centers one compact surface in a broad field. Payment, reversal, receipt, current status, and the primary action form one vertical sequence. Alternate routes, fees, price impact, and hops remain behind a disclosure until requested.

Other routes use wider ruled sections. The shared header uses an olive-black Robinhood surface with a lime keyline. It stays on one row down to 320 px, reducing or hiding the brand label before controls overflow.

The splash fills the dynamic viewport below the warning. Desktop places the title on the left, convergence field on the right, and entry action at the lower right. At 760 px and below, the field moves behind the content and the copy and entry action align to a 20 px left edge. Short viewports reduce title size rather than add promotional sections or forced scrolling.

## Surfaces and controls

The primary Swap card uses a 16 px radius and the application's only diffuse resting shadow. Actions and inputs use 8 px radii; grouped fields use 12 px. Regular token marks and the protocol $OTF coin mark are circular. OTF fund-share marks are black squares with a heavy lime border.

Primary buttons use lime only when the action can proceed. Disabled controls must name the blocking condition. Secondary controls use transparent or card-toned surfaces with a border. Focus remains visible without relying on animation.

Inputs use the raised-black surface and ledger border. Focus changes the border to lime. Disabled or failed states pair color with explicit text.

Navigation contains Swap, Funds, and `$OTF`, followed by the Robinhood network selector, wallet control, and settings. The closed network selector remains icon-only.

## Splash

The splash contains the three-line lowercase product name, the fixed tagline `the standard for the new era.`, and one entry action. The inline SVG convergence field uses fine gradient paths, tilted orbits, and a central ring; no raster image ships with it.

Motion stays low-amplitude. Flow, drift, orbit, pulse, and rotation use cycles from 7 to 28 seconds. The entry control uses a 180 ms transition. `prefers-reduced-motion: reduce` stops every field animation and entry transition while preserving the static composition.

## Product presentation rules

- Show unavailable chain data as unavailable. Never substitute fixtures or previews for quotes, simulations, or submitted transactions.
- Keep market-cap weighting as an explicit mode. Recalculate on constituent changes while selected, switch to manual mode after a weight edit, and preserve remaining manual weights after removal.
- Use `Market-cap weighted` only for exact default percentage units. Any exact-unit change is `Modified market-cap weighted`.
- Present the `$1` value as an initial offchain calculation target. Avoid describing it as a peg or price guarantee. Keep the onchain thesis separate from offchain prices, percentages, weighting method, and market-cap snapshots.
- Label NAV per share and AUM as informational offchain snapshots. Browser-local history never becomes a protocol oracle.
- Keep transaction confirmation bound to the submitted payload. Lock editing and resubmission after broadcast until a failure or explicit revert makes retry safe.
- Separate route, fee, gas, and price-impact information.
- Keep production liquidity at the external venue. The built-in liquidity utility remains testnet-only and USDG-only.
- Use verification language only for identity and ordinary metadata. Do not imply verified liquidity, route quality, economics, audit status, or investment safety.
- Keep the splash to one viewport and one action. Do not extend its typography, field, or pale control into operating routes.
