"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui";

export type DeleteProposalState = { error: string | null };

export function DeleteProposalForm({
  proposalId,
  proposalName,
  action,
}: {
  proposalId: string;
  proposalName: string;
  action: (state: DeleteProposalState, formData: FormData) => Promise<DeleteProposalState>;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });

  return <form className="deleteSubmissionForm" action={formAction}>
    <input type="hidden" name="proposalId" value={proposalId} />
    {state.error && <span className="submissionDeleteError" role="alert">{state.error}</span>}
    <Button type="submit" variant="ghost" className="deleteSubmissionButton" aria-label={`Delete ${proposalName}`} disabled={pending}>
      <Trash2 size={14} /> {pending ? "Deleting…" : "Delete"}
    </Button>
  </form>;
}
