type MarkProps = {
  className?: string;
};

export type OtfTokenIconProps = MarkProps & {
  size?: number;
  ticker?: string;
};

export const OTF_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="2" y="2" width="60" height="60" fill="#090909" stroke="#ccff00" stroke-width="4"/><text x="32" y="39.5" fill="#ccff00" font-family="Arial, sans-serif" font-size="20" font-weight="800" letter-spacing="0" text-anchor="middle">OTF</text></svg>`;

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
    <rect x="7" y="7" width="242" height="242" fill="#090909" stroke="#ccff00" strokeWidth="12" />
    <text x="128" y="156" fill="#ccff00" fontFamily="Inter, Arial, sans-serif" fontSize={tickerFontSize(label)} fontWeight="700" letterSpacing="-2" textAnchor="middle" textLength={tickerTextLength(label)} lengthAdjust="spacingAndGlyphs">{label}</text>
  </svg>;
}
