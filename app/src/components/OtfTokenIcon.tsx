type OtfTokenIconProps = {
  className?: string;
  size?: number;
  ticker?: string;
};

function iconTicker(ticker: string): string {
  const normalized = ticker.trim().replace(/^OTF-/i, "").toUpperCase();
  return normalized || "OTF";
}

function tickerFontSize(ticker: string): number {
  if (ticker.length <= 3) return 76;
  if (ticker.length === 4) return 57;
  if (ticker.length === 5) return 48;
  if (ticker.length === 6) return 41;
  return 34;
}

export function OtfTokenIcon({ className, size = 32, ticker = "OTF" }: OtfTokenIconProps) {
  const label = iconTicker(ticker);

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 256 256"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="7" y="7" width="242" height="242" rx="44" fill="#132625" stroke="#37b7aa" strokeOpacity=".68" strokeWidth="5" />
      <text
        x="128"
        y="148"
        fill="#7bd8ce"
        fontFamily="Inter, Arial, sans-serif"
        fontSize={tickerFontSize(label)}
        fontWeight="800"
        letterSpacing="-2"
        textAnchor="middle"
      >
        {label}
      </text>
    </svg>
  );
}
