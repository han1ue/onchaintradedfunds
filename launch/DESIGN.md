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
  chart-series-1: "#3cc7b5"
  chart-series-2: "#f08a5d"
  chart-series-3: "#6c8cff"
  chart-series-4: "#f3c44e"
  chart-series-5: "#b58ae8"
  chart-series-6: "#e66b9d"
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

# Launch application design system

## Design principles

Launch is a compact comparison and verification interface. Ranked proposals, vote state, and portfolio allocation take precedence over promotional content. The default theme is dark, with a light theme that preserves the same hierarchy and semantic colors.

Teal marks actions, active navigation, selection, focus, and verified interaction. Green, gold, blue, and red appear only for their literal status meanings. Portfolio colors belong to allocation data and must not replace action or status colors.

Surfaces use close neutral steps, thin borders, and small radii. The design avoids resting card shadows, glossy material, broad glow, and decorative raster images.

## Typography

Inter and system sans-serif fallbacks serve all text. Page identity may use the display scale; cards, controls, and table labels remain compact. Votes, ranks, percentages, dates, and metrics use tabular figures.

Uppercase is limited to short labels and status metadata. Long theses and legal copy use a larger body size and line height than dense operational rows.

## Layout

The desktop shell has a maximum width of 1360 px, 24 px side gutters, a 56 px sticky navigation bar, and a recurring 12 px gap. The primary board places the phase timeline above the leaderboard and a 300 px action rail. Proposal detail uses a flexible content column with a 310 px voting rail. The ballot uses a flexible proposal list and a sticky 320 px vote-schedule rail.

At 1120 px, split boards become one column and the leaderboard drops portfolio comparison before creator identity. At 760 px, side gutters shrink to 14 px, tables become labelled rows, and secondary metrics recede. At 440 px, navigation and row spacing tighten. Rank, OTF identity, and vote total remain visible down to the 320 px minimum canvas.

Responsive layouts must retain evidence and state, even when they remove comparative detail.

## Color and depth

`background` and `nav` form the canvas. `card`, `card-raised`, `surface`, and `muted` provide ordered surface levels. `border` separates ordinary regions; `border-strong` marks controls and active structure.

Primary text is used for headings and totals, soft text for body copy, and muted text for metadata. Teal never becomes ambient decoration. Semantic colors remain sparse so a warning or failure cannot be mistaken for ordinary ornament.

One-pixel borders carry most depth. The navigation may use restrained translucency and blur. A low-opacity focus halo and a small live-status halo are the only glow treatments.

## Shapes and controls

Panels use 8 px radii, controls use 6 px, allocation tracks use 4 px, and status badges use full pills. Circular geometry is limited to progress markers, status dots, and allocation keys.

Buttons have a 36 px minimum height and 14 px horizontal padding. Primary buttons use teal with dark text. Secondary buttons use the card surface and strong border. Ghost buttons use teal text on a transparent background. Disabled controls use reduced opacity, no lift, and a not-allowed cursor.

Fields use the page background, strong border, 6 px radius, 38 px minimum height, and 8 by 11 px padding. Focus changes the border to teal and adds a tight low-opacity halo. Invalid totals use danger red; valid totals use green.

Status badges are 22 px pills with a border, compact label, and leading dot. Their color must match the represented state.

## Navigation

The sticky navigation uses a translucent dark surface, bottom border, and the 1360 px inner shell. Links start muted, become primary text on hover, and show a 2 px teal underline when active.

`Submit OTF` is contextual. It appears in leaderboard headings and on the profile page, not in primary navigation. Lower-priority labels and links disappear before core actions on small screens.

## Leaderboard and allocation

Desktop rows align rank, OTF identity, thesis excerpt, portfolio shape, creator, and allocated vote total. Each row is at least 102 px high and uses border separation with a faint teal hover wash. The shared `OtfTokenIcon` identifies proposals.

Allocation strips use the six categorical colors with a one-pixel separator. Labels or an adjacent legend must remain available so color is never the only cue. Proposal detail increases the strip height and includes a complete allocation table.

Row entry may rise 5 px over 320 ms with staggered delays. Reduced-motion preferences remove this animation.

## Ballot and progress

The ballot is one competition-wide vote ledger. Voting opens after seven submission-only days and lasts 30 days while submissions remain open. Three votes become available at opening, followed by one every three voting days up to 12.

Plus and minus controls change only the current draft. Cast votes form a permanent floor for each proposal and cannot move. One X post may commit several newly available votes. Proposal choices remain hidden in the post unless the voter explicitly reveals them.

The sticky rail shows remaining votes and the next scheduled vote. The submission wizard uses four equal steps in a 70 px band with 24 px circular markers and a hairline connector. Mobile may hide step labels but retains ordered markers.

## Implementation constraints

- Organize dense content with bordered tonal layers and the 12 px grid.
- Keep action and focus teal. Reserve semantic colors for actual states and portfolio colors for allocation data.
- Preserve tabular numerals, aligned totals, and exact percentages where users compare proposals.
- Remove portfolio detail before creator identity at narrow widths, while retaining rank, OTF identity, and vote total.
- Disable nonessential animation when reduced motion is requested.
- Do not add ambient shadows, glossy surfaces, broad neon glow, decorative charts, or generated raster imagery.
