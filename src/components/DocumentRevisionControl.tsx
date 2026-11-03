import { useCallback, useEffect, useMemo, useState } from "react";
import { FileCheck2 } from "lucide-react";
import { useAuth } from "./AuthProvider";
import {
  decideDocumentRevision,
  getDocumentRevisionRegister,
  listDocumentRevisionCandidates,
  submitDocumentRevision,
  type DocumentRevision,
  type DocumentRevisionCandidate,
  type DocumentRevisionKind,
  type DocumentRevisionRegister,
} from "../services/documentRevisionService";

const CONTROL_ROLES = [
  "admin",
  "maintenance_manager",
  "reliability_engineer",
  "planner",
];

const kinds: Array<{ value: DocumentRevisionKind; label: string }> = [
  { value: "policy", label: "Policy" },
  { value: "data_standard", label: "Data standard" },
  { value: "form", label: "Form" },
  { value: "specification", label: "Specification" },
  { value: "work_instruction", label: "Work instruction" },
];

function kindLabel(kind: DocumentRevisionKind) {
  return kinds.find((entry) => entry.value === kind)?.label ?? kind;
}

function statusClass(status: DocumentRevision["controlStatus"]) {
  if (status === "effective") return "border-emerald-500/40 text-emerald-200";
  if (status === "rejected") return "border-red-500/40 text-red-200";
  if (status === "superseded") return "border-slate-500/40 text-slate-300";
  return "border-amber-500/40 text-amber-200";
}

export function DocumentRevisionControl() {
  const { profile } = useAuth();
  const canControl = CONTROL_ROLES.includes(String(profile?.role ?? ""));
  const actorId = profile?.id ?? null;
  const [register, setRegister] = useState<DocumentRevisionRegister | null>(
    null,
  );
  const [candidates, setCandidates] = useState<DocumentRevisionCandidate[]>([]);
  const [kind, setKind] = useState<DocumentRevisionKind>("policy");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewBasis, setReviewBasis] = useState<Record<string, string>>({});
  const [formVersion, setFormVersion] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [controlled, available] = await Promise.all([
        getDocumentRevisionRegister(),
        listDocumentRevisionCandidates(),
      ]);
      setRegister(controlled);
      setCandidates(available);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The document revision register could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const effectiveDocuments = useMemo(
    () =>
      (register?.documents ?? []).filter(
        (document) => document.controlStatus === "effective",
      ),
    [register],
  );

  async function submitRevision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const reviewDue = String(values.get("reviewDueAt") ?? "").trim();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await submitDocumentRevision({
        documentId: String(values.get("documentId") ?? ""),
        kind,
        documentNumber: String(values.get("documentNumber") ?? ""),
        revisionLabel: String(values.get("revisionLabel") ?? ""),
        applicability: String(values.get("applicability") ?? ""),
        basis: String(values.get("basis") ?? ""),
        reviewDueAt: reviewDue
          ? new Date(`${reviewDue}T00:00:00`).toISOString()
          : null,
        supersedesDocumentId:
          String(values.get("supersedesDocumentId") ?? "") || null,
      });
      if (result.operationalAuthorization !== false) {
        throw new Error("Unexpected document-revision authority response");
      }
      setNotice(
        `${result.documentNumber} revision ${result.revisionLabel} is waiting for an independent approval. No work or operating authority was granted.`,
      );
      setFormVersion((value) => value + 1);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The document revision could not be submitted.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitDecision(
    document: DocumentRevision,
    decision: "approved" | "rejected",
  ) {
    const basis = reviewBasis[document.id]?.trim() ?? "";
    if (basis.length < 20) {
      setError("Record at least 20 characters of independent review basis.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await decideDocumentRevision({
        documentId: document.id,
        decision,
        basis,
      });
      if (
        result.segregationOfDuties !== true ||
        result.operationalAuthorization !== false
      ) {
        throw new Error("Unexpected document-revision authority response");
      }
      setNotice(
        decision === "approved"
          ? `${document.documentNumber} revision ${document.revisionLabel} is now the controlled revision. No work, risk or return-to-service approval was created.`
          : `${document.documentNumber} revision ${document.revisionLabel} was rejected and retained in history.`,
      );
      setReviewBasis((current) => ({ ...current, [document.id]: "" }));
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The document revision decision could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="document-revision-title"
      className="space-y-4 rounded-xl border border-white/10 bg-white/2 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="document-revision-title"
            className="flex items-center gap-2 text-lg font-semibold text-white"
          >
            <FileCheck2 className="h-5 w-5 text-signal-cyan" aria-hidden />
            Document revision control
          </h2>
          <p className="mt-1 max-w-4xl text-sm text-slate-300">
            Submit an exact revision of a policy, data standard, form,
            specification or work instruction. A different named human with a
            verified factor and an AAL2 session approves it, and that approval
            supersedes the prior effective revision.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || busy}
          className="rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-slate-200 disabled:opacity-50"
        >
          Refresh register
        </button>
      </div>

      <div className="rounded-lg border border-sky-500/25 bg-sky-500/5 px-4 py-3 text-xs text-sky-100">
        <span className="font-semibold">Authority boundary:</span>{" "}
        {register?.decisionBoundary ??
          "Approving a document revision records controlled standing only. It does not approve work, accept risk, change an operating limit or authorize return to service."}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200"
        >
          {notice}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {kinds.map((entry) => {
          const count = register?.coverage?.[entry.value] ?? 0;
          return (
            <div
              key={entry.value}
              className={`rounded-lg border px-3 py-2 text-sm ${
                count > 0
                  ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-100"
                  : "border-amber-500/30 bg-amber-500/5 text-amber-100"
              }`}
            >
              <p className="font-medium">{entry.label}</p>
              <p className="text-xs opacity-80">
                {count > 0 ? `${count} effective` : "No effective revision"}
              </p>
            </div>
          );
        })}
      </div>

      {canControl && (
        <form
          key={formVersion}
          onSubmit={submitRevision}
          className="space-y-4 rounded-lg border border-white/10 p-4"
        >
          <div>
            <h3 className="font-semibold text-white">
              Submit a revision for approval
            </h3>
            <p className="text-xs text-slate-400">
              Only cleared or released uploads appear. A controlled upload
              cannot be overwritten; the next change is a new revision that
              names the revision it supersedes.
            </p>
          </div>
          <fieldset
            disabled={busy}
            className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"
          >
            <label className="text-sm text-slate-200 lg:col-span-2">
              Cleared upload
              <select
                name="documentId"
                required
                defaultValue=""
                className="mt-1 block w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2"
              >
                <option value="" disabled>
                  Select an exact upload
                </option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.title} · {candidate.source_id} ·{" "}
                    {candidate.security_status}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-200">
              Controlled class
              <select
                name="kind"
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as DocumentRevisionKind)
                }
                className="mt-1 block w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2"
              >
                {kinds.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-200">
              Document number
              <input
                name="documentNumber"
                required
                minLength={2}
                maxLength={200}
                className="mt-1 block w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2"
              />
            </label>
            <label className="text-sm text-slate-200">
              Revision
              <input
                name="revisionLabel"
                required
                minLength={1}
                maxLength={100}
                className="mt-1 block w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2"
              />
            </label>
            <label className="text-sm text-slate-200">
              Supersedes
              <select
                name="supersedesDocumentId"
                defaultValue=""
                className="mt-1 block w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2"
              >
                <option value="">No current effective revision</option>
                {effectiveDocuments
                  .filter((document) => document.kind === kind)
                  .map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.documentNumber} rev {document.revisionLabel}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm text-slate-200">
              Review due
              <input
                name="reviewDueAt"
                type="date"
                className="mt-1 block w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2"
              />
            </label>
            <label className="text-sm text-slate-200 lg:col-span-2">
              Applicability
              <textarea
                name="applicability"
                required
                minLength={20}
                maxLength={8000}
                rows={3}
                className="mt-1 block w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2"
              />
            </label>
            <label className="text-sm text-slate-200 lg:col-span-2">
              Control basis
              <textarea
                name="basis"
                required
                minLength={20}
                maxLength={8000}
                rows={3}
                className="mt-1 block w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2"
              />
            </label>
          </fieldset>
          <button
            type="submit"
            disabled={busy || candidates.length === 0}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Submit revision
          </button>
        </form>
      )}

      {loading && (
        <p className="text-sm text-slate-400">Loading document revisions.</p>
      )}
      {!loading && (register?.documents.length ?? 0) === 0 && (
        <p className="text-sm text-slate-400">
          No governed document revision has been submitted yet.
        </p>
      )}
      <ul className="space-y-3">
        {(register?.documents ?? []).map((document) => {
          const canDecide =
            canControl &&
            document.controlStatus === "under_review" &&
            actorId != null &&
            document.controlledBy !== actorId;
          return (
            <li
              key={document.id}
              className="rounded-lg border border-white/10 p-4 text-sm text-slate-200"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-white">
                  {document.documentNumber} rev {document.revisionLabel}
                </p>
                <span
                  className={`rounded border px-2 py-0.5 text-xs uppercase tracking-wide ${statusClass(document.controlStatus)}`}
                >
                  {document.controlStatus.replace("_", " ")}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {kindLabel(document.kind)} · {document.title}
                {document.supersedesDocumentId
                  ? " · supersedes a prior revision"
                  : ""}
                {document.supersededByDocumentId
                  ? " · superseded by a later revision"
                  : ""}
              </p>
              <p className="mt-2 text-slate-300">{document.applicability}</p>
              {canDecide && (
                <div className="mt-3 space-y-2">
                  <label className="block text-xs text-slate-300">
                    Independent review basis
                    <textarea
                      value={reviewBasis[document.id] ?? ""}
                      onChange={(event) =>
                        setReviewBasis((current) => ({
                          ...current,
                          [document.id]: event.target.value,
                        }))
                      }
                      minLength={20}
                      maxLength={8000}
                      rows={3}
                      className="mt-1 block w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-sm"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void submitDecision(document, "approved")}
                      className="rounded-lg border border-emerald-500/50 px-3 py-1.5 font-semibold text-emerald-200 disabled:opacity-50"
                    >
                      Approve revision
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void submitDecision(document, "rejected")}
                      className="rounded-lg border border-red-500/50 px-3 py-1.5 font-semibold text-red-200 disabled:opacity-50"
                    >
                      Reject revision
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
