import { and, asc, eq, gt, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AdminModerationPanel } from "@/components/AdminModerationPanel";
import { auth } from "@/server/auth";
import { requireDb } from "@/server/db";
import { competitions, proposals } from "@/server/db/schema";
import { adminXIds } from "@/server/env";

export const metadata = { title: "Admin" };

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user?.xUserId || !adminXIds.has(session.user.xUserId)) redirect("/");

  const database = requireDb();
  const availableProposals = await database.select({
    id: proposals.id,
    name: proposals.name,
    ticker: proposals.ticker,
    status: proposals.status,
  }).from(proposals)
    .innerJoin(competitions, eq(competitions.id, proposals.competitionId))
    .where(and(
      ne(proposals.status, "deleted"),
      eq(competitions.phase, "open"),
      gt(competitions.endsAt, new Date()),
    ))
    .orderBy(asc(proposals.name));

  return <div className="pageShell contentPage">
    <header className="pageHeader">
      <h1>Competition operations</h1>
      <p>Moderate active proposals. Every action is attributed to @{session.user.xUsername} and saved with its reason and before/after state.</p>
    </header>
    <AdminModerationPanel proposals={availableProposals} />
  </div>;
}
