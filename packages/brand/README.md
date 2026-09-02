# OTF brand package

`@onchaintradedfunds/brand` contains the marks shared by the main and launch applications.

- `OtfBrandMark` renders the square navigation mark.
- `OtfTokenIcon` renders the ticker-aware token mark for three- and four-letter symbols.
- `OTF_FAVICON_DATA_URL` supplies the canonical favicon through Next.js metadata.
- `styles.css` defines mark geometry and theme-aware colors.
- `assets/otf-icon.png` is a 256 px transparent export of the standard token mark.
- `assets/otf-favicon.png` is a 64 px transparent export for external integrations.

Applications may add navigation behavior around these components. They should not duplicate the marks' geometry or typography.
