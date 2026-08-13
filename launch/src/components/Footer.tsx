import Link from "next/link";
import { InfrastructureStatus } from "./InfrastructureStatus";

export function Footer() {
  return <footer className="footer"><InfrastructureStatus /><nav><Link href="/rules">Rules</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav></footer>;
}
