"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "./auth";
import { requireDb } from "./db";
import { users } from "./db/schema";

export type VoterPrivacyState = {
  status: "idle" | "success" | "error";
  message: string;
};

export async function updateVoterLeaderboardPrivacy(
  _previousState: VoterPrivacyState,
  formData: FormData,
): Promise<VoterPrivacyState> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { status: "error", message: "Sign in with X again before changing this setting." };
    const showRealUsername = formData.get("showRealUsername") === "on";
    const database = requireDb();
    const [updated] = await database.update(users).set({
      showRealUsernameOnVoterLeaderboard: showRealUsername,
      updatedAt: new Date(),
    }).where(eq(users.id, session.user.id)).returning({ id: users.id });
    if (!updated) return { status: "error", message: "Your privacy setting could not be found. Reconnect X and try again." };
    revalidatePath("/me");
    revalidatePath("/leaderboard");
    return {
      status: "success",
      message: showRealUsername
        ? `Saved. @${session.user.xUsername} is now public on the voter leaderboard.`
        : "Saved. The voter leaderboard now uses your generated alias.",
    };
  } catch {
    return { status: "error", message: "We could not save this privacy choice. Please try again." };
  }
}
