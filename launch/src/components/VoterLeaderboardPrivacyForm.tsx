"use client";

import { useActionState, useEffect, useRef, useState } from "react";
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
  const [checked, setChecked] = useState(defaultChecked);
  const [savedChecked, setSavedChecked] = useState(defaultChecked);
  const submittedChecked = useRef(defaultChecked);
  const changed = checked !== savedChecked;
  useEffect(() => {
    if (state.status === "success") setSavedChecked(submittedChecked.current);
  }, [state]);
  return <form className="voterPrivacyForm" action={action} onSubmit={() => { submittedChecked.current = checked; }}>
    <div className="privacyChoice voterPrivacyChoice">
      <Button type="submit" variant="secondary" className="privacyInlineSave" disabled={pending || !changed}>{pending ? "Saving…" : "Save"}</Button>
      <label className="voterPrivacyToggle">
        <input name="showRealUsername" type="checkbox" checked={checked} disabled={pending} onChange={(event) => setChecked(event.target.checked)} />
        <span><strong>Show @{username} on public user leaderboards</strong><small>Off by default. When off, the voter and XP leaderboards show {generatedAlias}. Your choice is reversible at any time.</small></span>
      </label>
      {state.message && (state.status === "error" || !changed) && <p className={`privacySaveMessage ${state.status}`} aria-live="polite">{state.message}</p>}
    </div>
  </form>;
}
