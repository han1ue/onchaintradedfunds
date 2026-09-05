type MarkProps = {
  className?: string;
};

export type OtfTokenIconProps = MarkProps & {
  size?: number;
  ticker?: string;
};

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
  // Keep four-letter marks optically consistent when the brand font is unavailable
  // and the browser falls back to a wider system font.
  return ticker.length === 4 ? 172 : undefined;
}

export function OtfTokenIcon({ className, size = 32, ticker = "OTF" }: OtfTokenIconProps) {
  const label = iconTicker(ticker);

  return <svg className={className} width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" focusable="false">
    <rect x="7" y="7" width="242" height="242" fill="#090909" stroke="#ccff00" strokeWidth="12" />
    <text x="128" y="156" fill="#ccff00" fontFamily="Instrument Sans, Arial, sans-serif" fontSize={tickerFontSize(label)} fontWeight="700" letterSpacing="-2" textAnchor="middle" textLength={tickerTextLength(label)} lengthAdjust="spacingAndGlyphs">{label}</text>
  </svg>;
}

export function OtfCoinIcon({ className, size = 32 }: MarkProps & { size?: number }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
    <circle cx="512" cy="512" r="470" fill="#090909" stroke="#ccff00" strokeWidth="40" />
    <text x="512" y="620" fill="#ccff00" fontFamily="Instrument Sans, Arial, sans-serif" fontSize="300" fontWeight="700" letterSpacing="24" textAnchor="middle">OTF</text>
  </svg>;
}
