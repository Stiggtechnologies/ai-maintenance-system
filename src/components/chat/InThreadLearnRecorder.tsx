/**
 * Named-human recorder UI (Feature bar from #309: no default; submit needs
 * result AND note). Mount only when an obligation id is already resolved.
 * Persist is the caller's job: `recordVerificationResult` →
 * `record_verification_result`. Success copy comes from that return, never
 * from a local "Outcome recorded" string.
 */
import { useState } from "react";

export type LearnResult = "achieved" | "not_achieved" | "inconclusive";

const OPTIONS: Array<{ value: LearnResult; label: string }> = [
  { value: "achieved", label: "Achieved" },
  { value: "not_achieved", label: "Not achieved" },
  { value: "inconclusive", label: "Inconclusive" },
];

export function InThreadLearnRecorder({
  onSubmit,
  obligationLabel,
  method,
}: {
  onSubmit: (result: LearnResult, note: string) => Promise<string> | string;
  obligationLabel?: string;
  method?: string;
}) {
  const [result, setResult] = useState<LearnResult | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const canSubmit = result !== null && note.trim() !== "" && !busy && !success;

  return (
    <form
      className="dw-learn"
      data-testid="learn-recorder"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit || result === null) return;
        setBusy(true);
        setError(null);
        void Promise.resolve(onSubmit(result, note.trim()))
          .then((detail) => {
            const text = detail.trim();
            if (text === "") {
              throw new Error("Verification result was not recorded.");
            }
            setNote("");
            setResult(null);
            setSuccess(text);
          })
          .catch((caught: unknown) => {
            setSuccess(null);
            setError(
              caught instanceof Error
                ? caught.message
                : "Verification was not recorded.",
            );
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <h3>Record the outcome</h3>
      {obligationLabel && (
        <p className="dw-learn-subject" data-testid="learn-obligation-label">
          {obligationLabel}
        </p>
      )}
      {method && <p className="dw-learn-method">{method}</p>}
      <fieldset disabled={busy || Boolean(success)}>
        <legend className="sr-only">Outcome</legend>
        {OPTIONS.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name="learn-result"
              value={option.value}
              checked={result === option.value}
              onChange={() => setResult(option.value)}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
      <label className="dw-learn-note">
        <span>Outcome note</span>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What was measured, against what, and when"
          disabled={busy || Boolean(success)}
        />
      </label>
      <button type="submit" disabled={!canSubmit}>
        {busy ? "Recording…" : "Record outcome"}
      </button>
      <p className="dw-learn-bound">
        Named human attestation. A recommendation is not authorization. This
        does not execute plant action.
      </p>
      {error && (
        <p className="dw-learn-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="dw-learn-ok" role="status" data-testid="learn-recorded">
          {success}
        </p>
      )}
    </form>
  );
}
