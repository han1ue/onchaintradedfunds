import Link from "next/link";
import { InfrastructureStatus } from "./InfrastructureStatus";

export function Footer() {
  return <footer className="footer"><span>OTF Launch Competition</span><InfrastructureStatus /><nav><Link href="/rules">Rules</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav></footer>;
}
