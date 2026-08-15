"use client";

import { useActionState } from "react";
import { Button } from "./ui";
import { updateVoterLeaderboardPrivacy, type VoterPrivacyState } from "@/server/profile";

const initialState: VoterPrivacyState = { status: "idle", message: "" };

export function VoterLeaderboardPrivacyForm({
  username,
  generatedAlias,
  defaultChecked,
}: {
  username: string;
  generatedAlias: string;
  defaultChecked: boolean;
}) {
  const [state, action, pending] = useActionState(updateVoterLeaderboardPrivacy, initialState);
  return <form className="voterPrivacyForm" action={action}>
    <label className="privacyChoice">
      <input name="showRealUsername" type="checkbox" defaultChecked={defaultChecked} />
      <span><strong>Show @{username} on public user leaderboards</strong><small>Off by default. When off, the voter and XP leaderboards show {generatedAlias}. Your choice is reversible at any time.</small></span>
    </label>
    <div className="voterPrivacyActions"><Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Save privacy choice"}</Button>{state.message && <p className={`privacySaveMessage ${state.status}`} aria-live="polite">{state.message}</p>}</div>
  </form>;
}
