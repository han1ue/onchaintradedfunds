# Documentation design

The Nextra site adapts the main application's visual system for long-form technical reading. It should look related to the product without behaving like a marketing page.

## Visual system

- Dark mode uses deep slate and blue-black surfaces. Light mode maps the same roles to cool near-white surfaces.
- Teal is limited to links, active navigation, focus, selection, and confirmed interaction.
- Self-hosted Instrument Sans with system sans-serif fallbacks provides the text stack. Articles use a maximum measure of 74 characters; code disables ligatures so addresses and identifiers remain exact.
- Thin rules and adjacent surface tones establish hierarchy. The site avoids decorative shadows and grids of custom cards.
- The compact OTF mark and 7 to 8 px radii connect the site to the application.

## Information architecture

Nextra supplies navigation, search, page outline, previous and next links, repository and edit links, feedback, and the footer.

The index opens with a plain description and an unaudited warning, followed by links to the protocol overview, security specification, risk model, token economics, and deployment status. Detailed pages should introduce a mechanism before discussing its risks or operational consequences.

## Responsive and accessible behavior

At 640 px and below, the expanded brand label and navbar `Open app` control are hidden. The footer stacks and retains its application link.

The document language is English with left-to-right direction. The decorative OTF mark is hidden from assistive technology. Keyboard focus uses a 2 px teal ring with a 3 px offset. Both themes must preserve readable contrast, and reduced-motion preferences disable animation, transitions, and smooth scrolling without removing interaction.

## Constraints

- Keep the index factual and warning-first.
- Preserve the article measure, visible keyboard focus, mobile application link, safety status, and light theme.
- Do not turn the index into a promotional hero or use teal as background decoration.
