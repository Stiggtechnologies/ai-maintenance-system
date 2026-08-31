import { useState } from "react";

export type LearnResult = "achieved" | "not_achieved" | "inconclusive";

const OPTIONS: Array<{ value: LearnResult; label: string }> = [
  { value: "achieved", label: "Achieved" },
  { value: "not_achieved", label: "Not achieved" },
  { value: "inconclusive", label: "Inconclusive" },
];

export function InThreadLearnRecorder({
  onSubmit,
}: {
  onSubmit: (result: LearnResult, note: string) => void;
}) {
  const [result, setResult] = useState<LearnResult | null>(null);
  const [note, setNote] = useState("");
  const canSubmit = result !== null && note.trim() !== "";

  return (
    <form
      className="dw-learn"
      data-testid="learn-recorder"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit || result === null) return;
        onSubmit(result, note.trim());
      }}
    >
      <h3>Record the outcome</h3>
      <fieldset>
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
        />
      </label>
      <button type="submit" disabled={!canSubmit}>
        Record outcome
      </button>
    </form>
  );
}
