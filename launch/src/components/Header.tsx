import Link from "next/link";
import { BrandMark } from "./BrandMark";
import { ThemeToggle } from "./ThemeToggle";
import { auth } from "@/server/auth";

export async function Header() {
  const session = await auth();
  return <header className="topNav"><div className="navInner">
    <BrandMark />
    <strong className="launchLabel">Launch Competition</strong>
    <nav className="primaryNav" aria-label="Primary navigation">
      <Link href="/">Leaderboard</Link>
      <Link href="/submit">Submit OTF</Link>
      <Link href="/rules">Rules</Link>
    </nav>
    <div className="navActions">
      <ThemeToggle />
      {session?.user?.xUsername
        ? <Link className="accountButton" href="/me">@{session.user.xUsername}</Link>
        : <Link className="button buttonSecondary compactButton" href="/api/auth/signin?callbackUrl=%2F">Connect X</Link>}
    </div>
  </div></header>;
}
