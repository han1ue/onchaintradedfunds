import Link from "next/link";
import { BrandMark } from "./BrandMark";
import { PrimaryNav } from "./PrimaryNav";
import { ThemeToggle } from "./ThemeToggle";
import { XSignInButton } from "./XSignInButton";
import { XProfileImage } from "./XProfileImage";
import { auth } from "@/server/auth";

export async function Header() {
  const session = await auth();
  return <header className="topNav"><div className="navInner">
    <BrandMark />
    <strong className="launchLabel">Launch Competition</strong>
    <PrimaryNav />
    <div className="navActions">
      <ThemeToggle />
      {session?.user?.xUsername
        ? <Link className="accountButton" href="/me" aria-label={`Open profile for @${session.user.xUsername}`}>
            <XProfileImage src={session.user.image} username={session.user.xUsername} size={22} />
            <span>@{session.user.xUsername}</span>
          </Link>
        : <XSignInButton variant="secondary" className="compactButton" showMark />}
    </div>
  </div></header>;
}
