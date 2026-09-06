# Documentation design

The Nextra site adapts the main application's visual system for long-form technical reading. It should look related to the product without behaving like a marketing page.

## Visual system

- The site always uses dark mode with deep slate and blue-black surfaces. There is no theme selector.
- Teal is limited to links, active navigation, focus, selection, and confirmed interaction.
- Self-hosted Instrument Sans with system sans-serif fallbacks provides the text stack. Articles use a maximum measure of 74 characters; code disables ligatures so addresses and identifiers remain exact.
- Thin rules and adjacent surface tones establish hierarchy. The site avoids decorative shadows and grids of custom cards.
- The compact OTF mark and 7 to 8 px radii connect the site to the application.

## Information architecture

Nextra supplies navigation, search, page outline, previous and next links, repository and edit links, feedback, and the footer.

The index opens with a plain description and testnet status, followed by links to the protocol overview, security specification, risk model, token economics, and deployment status. Each page explains a mechanism before its risks or operational requirements.

Explain what a holder or creator can do and how it affects their assets before introducing contract names and formulas. Define fund shares separately from protocol OTF. Use short examples for proportional ownership, fees, and cumulative claims. Keep exact constants with the relevant mechanism, after the explanation, and preserve the security specification as a precise contract reference.

## Responsive and accessible behavior

At 640 px and below, the expanded brand label and navbar `Open app` control are hidden. The footer stacks and retains its application link.

The document language is English with left-to-right direction. The decorative OTF mark is hidden from assistive technology. Keyboard focus uses a 2 px teal ring with a 3 px offset. Preserve readable contrast, and reduced-motion preferences disable animation, transitions, and smooth scrolling without removing interaction.

## Constraints

- Keep the index factual and warning-first.
- Preserve the article measure, visible keyboard focus, mobile application link, safety status, and dark appearance.
- Do not turn the index into a promotional hero or use teal as background decoration.
