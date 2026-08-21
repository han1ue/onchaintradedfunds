"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Trash2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui";

export type DeleteProposalState = { error: string | null; disabledReason?: string };

export function DeleteProposalForm({
  proposalId,
  proposalName,
  voteCount,
  action,
  disabledReason,
}: {
  proposalId: string;
  proposalName: string;
  voteCount: number;
  action: (state: DeleteProposalState, formData: FormData) => Promise<DeleteProposalState>;
  disabledReason?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  const [confirmationName, setConfirmationName] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmed = confirmationName === proposalName;
  const unavailableReason = disabledReason ?? state.disabledReason;
  const tooltipId = `delete-${proposalId}-tooltip`;

  useEffect(() => {
    if (state.disabledReason && dialogRef.current?.open) dialogRef.current.close();
  }, [state.disabledReason]);

  if (unavailableReason) return <span className="deleteSubmissionUnavailable" tabIndex={0} aria-label={`Delete ${proposalName} unavailable`} aria-describedby={tooltipId}>
    <Button type="button" variant="ghost" className="deleteSubmissionButton" disabled><Trash2 size={14} /> Delete</Button>
    <span className="deleteSubmissionTooltip" id={tooltipId} role="tooltip">{unavailableReason}</span>
  </span>;

  return <>
    <Button type="button" variant="ghost" className="deleteSubmissionButton" aria-label={`Delete ${proposalName}`} onClick={() => dialogRef.current?.showModal()}>
      <Trash2 size={14} /> Delete
    </Button>
    <dialog ref={dialogRef} className="deleteConfirmationDialog" aria-labelledby={`delete-${proposalId}-title`} onClose={() => setConfirmationName("")}>
      <form className="deleteConfirmationBody" action={formAction}>
        <input type="hidden" name="proposalId" value={proposalId} />
        <button className="dialogClose" type="button" onClick={() => dialogRef.current?.close()} aria-label="Close delete confirmation"><X size={17} /></button>
        <div className="deleteConfirmationIcon"><TriangleAlert size={23} aria-hidden="true" /></div>
        <h2 id={`delete-${proposalId}-title`}>Delete this OTF?</h2>
        <p>This permanently removes <strong>{proposalName}</strong> from the competition.</p>
        <div className="deleteConfirmationWarning">
          <strong>This cannot be undone</strong>
          {voteCount > 0 && <p>{voteCount.toLocaleString()} {voteCount === 1 ? "vote stays" : "votes stay"} spent and cannot be reassigned. {voteCount === 1 ? "It will" : "They will"} not count toward Participation or Performance XP.</p>}
          <p>Creating another OTF later requires publishing and verifying a new X post.</p>
        </div>
        <label className="deleteConfirmationField">
          <span>Enter <strong>{proposalName}</strong> to confirm</span>
          <input name="confirmationName" value={confirmationName} onChange={(event) => setConfirmationName(event.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        {state.error && <p className="submissionDeleteError" role="alert">{state.error}</p>}
        <div className="deleteConfirmationActions">
          <Button type="button" variant="secondary" onClick={() => dialogRef.current?.close()} disabled={pending}>Cancel</Button>
          <Button type="submit" variant="ghost" className="confirmDeleteButton" disabled={!confirmed || pending}>
            <Trash2 size={14} /> {pending ? "Deleting…" : "Delete OTF"}
          </Button>
        </div>
      </form>
    </dialog>
  </>;
}
