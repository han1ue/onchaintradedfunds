import Link from "next/link";

export function BrandMark() {
  return <Link className="brandMark" href="/" aria-label="OTF Launch Competition home"><span>OTF</span></Link>;
}

export function OtfTokenIcon({ ticker = "OTF", size = 38 }: { ticker?: string; size?: number }) {
  const label = ticker.trim().replace(/^OTF-/i, "").toUpperCase() || "OTF";
  const fontSize = label.length <= 3 ? 76 : label.length === 4 ? 57 : label.length === 5 ? 48 : 40;
  return <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" focusable="false">
    <rect x="7" y="7" width="242" height="242" rx="44" fill="#132625" stroke="#37b7aa" strokeOpacity=".68" strokeWidth="5" />
    <text x="128" y="148" fill="#7bd8ce" fontFamily="Inter, Arial, sans-serif" fontSize={fontSize} fontWeight="800" letterSpacing="-2" textAnchor="middle">{label}</text>
  </svg>;
}

export function ProposalMark({ ticker, size = 38 }: { ticker: string; size?: number }) {
  const variant = [...ticker].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 4;
  return <svg className="proposalMark" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
    <rect x=".5" y=".5" width="39" height="39" rx="7" fill="#132625" stroke="#37b7aa" strokeOpacity=".68" />
    {variant === 0 && <><circle cx="20" cy="20" r="10" fill="none" stroke="#37b7aa" strokeWidth="1.5" /><path d="M10 20h20M20 10c4 4 4 16 0 20M20 10c-4 4-4 16 0 20" fill="none" stroke="#7bd8ce" strokeWidth="1.2" /></>}
    {variant === 1 && <><path d="M20 8 30 14v12L20 32 10 26V14Z" fill="none" stroke="#37b7aa" strokeWidth="1.5" /><path d="m10 14 10 6 10-6M20 20v12" fill="none" stroke="#7bd8ce" strokeWidth="1.2" /></>}
    {variant === 2 && <><circle cx="13" cy="25" r="3" fill="none" stroke="#7bd8ce" /><circle cx="21" cy="13" r="3" fill="none" stroke="#37b7aa" /><circle cx="29" cy="25" r="3" fill="none" stroke="#7bd8ce" /><path d="m15 23 4-7m4 0 4 7M16 26h10" stroke="#37b7aa" strokeWidth="1.5" /></>}
    {variant === 3 && <><path d="m10 27 7-8 5 4 8-11" fill="none" stroke="#7bd8ce" strokeWidth="1.8" strokeLinecap="round" /><path d="M24 12h6v6" fill="none" stroke="#37b7aa" strokeWidth="1.5" /></>}
  </svg>;
}
