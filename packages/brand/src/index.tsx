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
  return 48;
}

export function OtfTokenIcon({ className, size = 32, ticker = "OTF" }: OtfTokenIconProps) {
  const label = iconTicker(ticker);
  const splitAt = Math.ceil(label.length / 2);
  const lines = label.length > 5 ? [label.slice(0, splitAt), label.slice(splitAt)] : [label];

  return <svg className={className} width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" focusable="false">
    <rect x="9" y="9" width="238" height="238" fill="#090909" stroke="#ccff00" strokeWidth="16" />
    {lines.map((line, index) => <text key={index} x="128" y={lines.length === 1 ? line.length <= 3 ? 156 : line.length === 4 ? 149.5 : 145 : index === 0 ? 116.5 : 182.5} fill="#ccff00" fontFamily="Instrument Sans, Arial, sans-serif" fontSize={lines.length === 1 ? tickerFontSize(line) : 60} fontWeight="700" letterSpacing="-2" textAnchor="middle" textLength={line.length >= 4 ? 172 : undefined} lengthAdjust="spacingAndGlyphs">{line}</text>)}
  </svg>;
}

export function OtfCoinIcon({ className, size = 32 }: MarkProps & { size?: number }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
    <circle cx="512" cy="512" r="470" fill="#090909" stroke="#ccff00" strokeWidth="40" />
    <text x="512" y="620" fill="#ccff00" fontFamily="Instrument Sans, Arial, sans-serif" fontSize="300" fontWeight="700" letterSpacing="24" textAnchor="middle">OTF</text>
  </svg>;
}
