import Link from "next/link";
import { auth } from "@/server/auth";
import { adminXIds } from "@/server/env";
import { InfrastructureStatus } from "./InfrastructureStatus";

export async function Footer() {
  const session = await auth();
  const isAdmin = Boolean(session?.user.xUserId && adminXIds.has(session.user.xUserId));
  return <footer className="footer"><InfrastructureStatus /><nav aria-label="Footer navigation"><Link href="/rules">Rules</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link>{isAdmin && <Link className="footerAdminLink" href="/admin">Admin</Link>}</nav></footer>;
}
