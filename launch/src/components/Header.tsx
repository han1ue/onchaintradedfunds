import Link from "next/link";
import { BrandMark } from "./BrandMark";
import { PrimaryNav } from "./PrimaryNav";
import { ThemeToggle } from "./ThemeToggle";
import { XMark } from "./XMark";
import { auth, signIn } from "@/server/auth";

async function signInWithX() {
  "use server";
  await signIn("twitter", { redirectTo: "/" });
}

export async function Header() {
  const session = await auth();
  return <header className="topNav"><div className="navInner">
    <BrandMark />
    <strong className="launchLabel">Launch Competition</strong>
    <PrimaryNav />
    <div className="navActions">
      <ThemeToggle />
      {session?.user?.xUsername
        ? <Link className="accountButton" href="/me">@{session.user.xUsername}</Link>
        : <form action={signInWithX}><button className="button buttonSecondary compactButton" type="submit"><XMark /> Sign in with X</button></form>}
    </div>
  </div></header>;
}
