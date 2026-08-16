type MarkProps = {
  className?: string;
};

export type OtfTokenIconProps = MarkProps & {
  size?: number;
  ticker?: string;
};

export const OTF_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="13" fill="#13201f"/><rect x="1" y="1" width="62" height="62" rx="12" fill="none" stroke="#37b7aa" stroke-opacity=".62" stroke-width="2"/><text x="32" y="39.5" fill="#37b7aa" font-family="Arial, sans-serif" font-size="20" font-weight="800" letter-spacing="0" text-anchor="middle">OTF</text></svg>`;

export const OTF_FAVICON_DATA_URL = `data:image/svg+xml,${encodeURIComponent(OTF_FAVICON_SVG)}`;

export function OtfBrandMark({ className = "" }: MarkProps) {
  return <span className={`otfBrandMark ${className}`.trim()} aria-hidden="true">OTF</span>;
}

function iconTicker(ticker: string): string {
  const normalized = ticker.trim().replace(/^OTF-/i, "").toUpperCase();
  return normalized || "OTF";
}

function tickerFontSize(ticker: string): number {
  if (ticker.length <= 3) return 76;
  if (ticker.length === 4) return 60;
  if (ticker.length === 5) return 48;
  if (ticker.length === 6) return 41;
  return 34;
}

function tickerTextLength(ticker: string): number | undefined {
  // Keep four-letter marks optically consistent even when Inter is unavailable
  // and the browser falls back to a wider system font.
  return ticker.length === 4 ? 172 : undefined;
}

export function OtfTokenIcon({ className, size = 32, ticker = "OTF" }: OtfTokenIconProps) {
  const label = iconTicker(ticker);

  return <svg className={className} width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" focusable="false">
    <rect x="7" y="7" width="242" height="242" rx="44" fill="#132625" stroke="#37b7aa" strokeOpacity=".68" strokeWidth="5" />
    <text x="128" y="156" fill="#7bd8ce" fontFamily="Inter, Arial, sans-serif" fontSize={tickerFontSize(label)} fontWeight="800" letterSpacing="-2" textAnchor="middle" textLength={tickerTextLength(label)} lengthAdjust="spacingAndGlyphs">{label}</text>
  </svg>;
}
