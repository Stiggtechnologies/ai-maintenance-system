import { useEffect, useState } from "react";
import { ProjectEvidenceSearch } from "./ProjectEvidenceSearch";
import {
  listOrgEvidenceItems,
  registerStandardWorkBaseline,
} from "../../services/developService";

export function StandardBaselineForm({
  onSaved,
}: {
  onSaved: (standardWorkId: number) => Promise<void>;
}) {
  const [fields, setFields] = useState({
    workKey: "",
    title: "",
    language: "",
    content: "",
    basis: "",
    evidenceId: "",
  });
  const [items, setItems] = useState<
    Awaited<ReturnType<typeof listOrgEvidenceItems>>
  >([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    listOrgEvidenceItems()
      .then((rows) => {
        if (active) {
          setItems(rows);
          setReady(true);
        }
      })
      .catch((e: unknown) => {
        if (active)
          setError(e instanceof Error ? e.message : "Could not load evidence");
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <form
      className="space-y-2 rounded border border-slate-700 p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        setMessage(null);
        try {
          const receipt = await registerStandardWorkBaseline(fields);
          await onSaved(receipt.standardWorkId);
          setMessage(
            `Existing procedure registered as standard ${receipt.standardWorkId}. No measured standard time was invented.`,
          );
          setFields({
            workKey: "",
            title: "",
            language: "",
            content: "",
            basis: "",
            evidenceId: "",
          });
          setAttested(false);
        } catch (e) {
          setError(
            e instanceof Error ? e.message : "Could not register procedure",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <h5 className="font-semibold">
        Register an existing controlled procedure
      </h5>
      <p>
        Requires a named human with approval authority. This records existing
        verified content; it does not approve a proposed revision or overwrite
        history.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {(
        [
          ["workKey", "Standard key", 200],
          ["title", "Standard title", 1000],
          ["language", "Language code", 30],
          ["content", "Existing procedure content", 100000],
          ["basis", "Existing procedure source basis", 10000],
        ] as const
      ).map(([key, label, limit]) => (
        <label key={key} className="block">
          {label}
          <textarea
            required
            maxLength={limit}
            value={fields[key]}
            onChange={(e) =>
              setFields((old) => ({ ...old, [key]: e.target.value }))
            }
            className="block w-full rounded bg-slate-900 p-2"
          />
        </label>
      ))}
      <ProjectEvidenceSearch onResults={(rows) => {
        setItems(rows); setFields((old) => ({ ...old, evidenceId: "" })); setReady(true);
      }} />
      <label className="block">
        Controlled-procedure evidence
        <select
          required
          disabled={!ready || busy}
          value={fields.evidenceId}
          onChange={(e) =>
            setFields((old) => ({ ...old, evidenceId: e.target.value }))
          }
          className="block w-full bg-slate-900 p-2"
        >
          <option value="">Select evidence</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.description}
            </option>
          ))}
        </select>
      </label>
      <p>
        Initially shows the organization’s 200 most recent evidence items. Selection alone
        does not establish quality or applicability.
      </p>
      <label className="block">
        <input
          type="checkbox"
          checked={attested}
          onChange={(e) => setAttested(e.target.checked)}
        />{" "}
        I have verified this existing procedure against the cited controlled
        source.
      </label>
      <button
        disabled={
          busy ||
          !ready ||
          !attested ||
          Object.values(fields).some((value) => !value.trim())
        }
      >
        {busy ? "Registering…" : "Register verified baseline"}
      </button>
    </form>
  );
}
