import { useCallback, useEffect, useMemo, useState } from "react";
import { FileCheck2, ShieldCheck } from "lucide-react";
import {
  getControlledDocumentRegister,
  listControlledDocumentCandidates,
  registerControlledDocument,
  reviewControlledDocument,
  type ControlledDocument,
  type ControlledDocumentCandidate,
  type ControlledDocumentKind,
  type ControlledDocumentRegister,
} from "../services/controlledDocumentsService";

const kinds: Array<{ value: ControlledDocumentKind; label: string }> = [
  { value: "drawing", label: "Drawing" },
  { value: "pid", label: "P&ID" },
  { value: "manual", label: "Manual" },
  { value: "procedure", label: "Procedure" },
  { value: "inspection_record", label: "Inspection record" },
  { value: "engineering_standard", label: "Engineering standard" },
];

function kindLabel(kind: ControlledDocumentKind) {
  return kinds.find((entry) => entry.value === kind)?.label ?? kind;
}

function optionalInteger(values: FormData, name: string) {
  const raw = String(values.get(name) ?? "").trim();
  return raw === "" ? null : Number.parseInt(raw, 10);
}

function statusClass(status: ControlledDocument["controlStatus"]) {
  if (status === "effective") return "border-emerald-500/40 text-emerald-200";
  if (status === "rejected") return "border-red-500/40 text-red-200";
  if (status === "superseded") return "border-slate-500/40 text-slate-300";
  return "border-amber-500/40 text-amber-200";
}

export function ControlledTechnicalDocuments({
  canControl,
  canReview,
}: {
  canControl: boolean;
  canReview: boolean;
}) {
  const [register, setRegister] = useState<ControlledDocumentRegister | null>(
    null,
  );
  const [candidates, setCandidates] = useState<ControlledDocumentCandidate[]>(
    [],
  );
  const [kind, setKind] = useState<ControlledDocumentKind>("drawing");
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
        getControlledDocumentRegister(),
        listControlledDocumentCandidates(),
      ]);
      setRegister(controlled);
      setCandidates(available);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The controlled document register could not be loaded.",
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

  async function submitRegistration(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const reviewDue = String(values.get("reviewDueAt") ?? "").trim();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await registerControlledDocument({
        documentId: String(values.get("documentId") ?? ""),
        kind,
        documentNumber: String(values.get("documentNumber") ?? ""),
        revisionLabel: String(values.get("revisionLabel") ?? ""),
        applicability: String(values.get("applicability") ?? ""),
        basis: String(values.get("basis") ?? ""),
        reviewDueAt: reviewDue
          ? new Date(`${reviewDue}T00:00:00`).toISOString()
          : null,
        assetId: String(values.get("assetId") ?? "") || null,
        siteId: String(values.get("siteId") ?? "") || null,
        standardWorkId: optionalInteger(values, "standardWorkId"),
        governanceStandardId:
          String(values.get("governanceStandardId") ?? "") || null,
        evidenceItemId: String(values.get("evidenceItemId") ?? "") || null,
        inspectionPlanId: optionalInteger(values, "inspectionPlanId"),
        supersedesDocumentId:
          String(values.get("supersedesDocumentId") ?? "") || null,
      });
      if (
        result.engineeringAuthority !== false ||
        result.operationalAuthorization !== false
      ) {
        throw new Error("Unexpected document-control authority response");
      }
      setNotice(
        `${result.documentNumber} revision ${result.revisionLabel} is under independent review. No work or operating authority was granted.`,
      );
      setFormVersion((value) => value + 1);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The document revision could not be registered.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitReview(
    document: ControlledDocument,
    decision: "effective" | "rejected",
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
      const result = await reviewControlledDocument({
        documentId: document.id,
        decision,
        basis,
      });
      if (
        result.segregationOfDuties !== true ||
        result.engineeringAuthority !== false ||
        result.operationalAuthorization !== false
      ) {
        throw new Error("Unexpected document-review authority response");
      }
      setNotice(
        decision === "effective"
          ? `${document.documentNumber} revision ${document.revisionLabel} now has controlled standing only; no work, risk or return-to-service approval was created.`
          : `${document.documentNumber} revision ${document.revisionLabel} was rejected and retained in history.`,
      );
      setReviewBasis((current) => ({ ...current, [document.id]: "" }));
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The independent review could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="controlled-documents-title"
      className="mt-8 space-y-5 rounded-xl border border-industrial-border bg-industrial-surface/30 p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="controlled-documents-title"
            className="flex items-center gap-2 text-lg font-semibold text-industrial-text"
          >
            <FileCheck2 className="h-5 w-5 text-[#3A8DFF]" />
            Controlled technical documents
          </h2>
          <p className="mt-1 max-w-4xl text-sm text-industrial-muted">
            Govern exact revisions of drawings, P&amp;IDs, manuals, procedures,
            inspection records and engineering standards. Security clearance
            permits review; a different named human with verified MFA and an
            AAL2 session decides effectivity.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || busy}
          className="rounded-lg border border-industrial-border px-3 py-2 text-sm font-medium text-industrial-text disabled:opacity-50"
        >
          Refresh register
        </button>
      </div>

      <div className="rounded-lg border border-blue-500/25 bg-blue-500/5 px-4 py-3 text-xs text-blue-100">
        <span className="font-semibold">Authority boundary:</span>{" "}
        {register?.decisionBoundary ??
          "Document effectivity records controlled standing only. It does not approve work, alter standard work, certify inspection truth, accept risk, change operating limits or authorize return to service."}
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

      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
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
          onSubmit={submitRegistration}
          className="space-y-4 rounded-lg border border-industrial-border bg-industrial-bg/50 p-4"
        >
          <div>
            <h3 className="font-semibold text-industrial-text">
              Register an uploaded revision
            </h3>
            <p className="text-xs text-industrial-muted">
              Only cleared or independently released uploads appear. A
              controlled upload cannot be overwritten; corrections are new
              revisions with explicit supersession.
            </p>
          </div>
          <fieldset
            disabled={busy}
            className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"
          >
            <label className="text-sm text-industrial-text lg:col-span-2">
              Cleared upload
              <select
                name="documentId"
                required
                defaultValue=""
                className="mt-1 block w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2"
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
            <label className="text-sm text-industrial-text">
              Document family
              <select
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as ControlledDocumentKind)
                }
                className="mt-1 block w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2"
              >
                {kinds.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-industrial-text">
              Review due
              <input
                name="reviewDueAt"
                type="date"
                className="mt-1 block w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2"
              />
            </label>
            <label className="text-sm text-industrial-text">
              Document number
              <input
                name="documentNumber"
                required
                minLength={2}
                maxLength={200}
                className="mt-1 block w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2"
              />
            </label>
            <label className="text-sm text-industrial-text">
              Revision
              <input
                name="revisionLabel"
                required
                maxLength={100}
                className="mt-1 block w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2"
              />
            </label>
            <label className="text-sm text-industrial-text lg:col-span-2">
              Supersedes effective revision
              <select
                name="supersedesDocumentId"
                defaultValue=""
                className="mt-1 block w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2"
              >
                <option value="">First effective revision</option>
                {effectiveDocuments.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.documentNumber} · rev {document.revisionLabel} ·{" "}
                    {kindLabel(document.kind)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-industrial-text lg:col-span-2">
              Applicability
              <textarea
                name="applicability"
                required
                minLength={20}
                maxLength={8000}
                rows={2}
                placeholder="Assets, system, site, operating envelope and exclusions"
                className="mt-1 block w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2"
              />
            </label>
            <label className="text-sm text-industrial-text lg:col-span-2">
              Control basis
              <textarea
                name="basis"
                required
                minLength={20}
                maxLength={8000}
                rows={2}
                placeholder="Source, change basis and revision evidence"
                className="mt-1 block w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2"
              />
            </label>

            {kind === "procedure" && (
              <label className="text-sm text-industrial-text lg:col-span-2">
                Canonical standard-work ID
                <input
                  name="standardWorkId"
                  type="number"
                  min={1}
                  required
                  className="mt-1 block w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2"
                />
              </label>
            )}
            {kind === "engineering_standard" && (
              <label className="text-sm text-industrial-text lg:col-span-2">
                Adopted governance-standard UUID
                <input
                  name="governanceStandardId"
                  required
                  className="mt-1 block w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2"
                />
              </label>
            )}
            {kind === "inspection_record" && (
              <>
                <label className="text-sm text-industrial-text lg:col-span-2">
                  Verified evidence-item UUID
                  <input
                    name="evidenceItemId"
                    required
                    className="mt-1 block w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2"
                  />
                </label>
                <label className="text-sm text-industrial-text lg:col-span-2">
                  Inspection-plan ID (optional)
                  <input
                    name="inspectionPlanId"
                    type="number"
                    min={1}
                    className="mt-1 block w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2"
                  />
                </label>
              </>
            )}
            <label className="text-sm text-industrial-text">
              Asset UUID (optional)
              <input
                name="assetId"
                className="mt-1 block w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2"
              />
            </label>
            <label className="text-sm text-industrial-text">
              Site UUID (optional)
              <input
                name="siteId"
                className="mt-1 block w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2"
              />
            </label>
          </fieldset>
          <button
            type="submit"
            disabled={busy || candidates.length === 0}
            className="rounded-lg bg-[#3A8DFF] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Recording…" : "Register for independent review"}
          </button>
        </form>
      )}

      <div>
        <h3 className="mb-3 font-semibold text-industrial-text">
          Revision register {register ? `(${register.documents.length})` : ""}
        </h3>
        {loading ? (
          <p role="status" className="py-5 text-sm text-industrial-muted">
            Loading controlled revisions…
          </p>
        ) : !(register?.documents.length ?? 0) ? (
          <p className="rounded-lg border border-dashed border-industrial-border px-4 py-5 text-sm text-industrial-muted">
            No controlled technical-document revision has been registered yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {register?.documents.map((document) => (
              <li
                key={document.id}
                className="rounded-lg border border-industrial-border bg-industrial-bg/40 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-industrial-text">
                      {document.documentNumber} · rev {document.revisionLabel}
                    </p>
                    <p className="text-xs text-industrial-muted">
                      {kindLabel(document.kind)} · {document.title} · security{" "}
                      {document.securityStatus}
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${statusClass(document.controlStatus)}`}
                  >
                    {document.controlStatus.replaceAll("_", " ")}
                  </span>
                </div>
                <p className="mt-2 text-sm text-industrial-muted">
                  {document.applicability}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-industrial-muted">
                  <span>
                    Registered{" "}
                    {new Date(document.controlledAt).toLocaleString()}
                  </span>
                  {document.effectiveAt && (
                    <span>
                      Effective{" "}
                      {new Date(document.effectiveAt).toLocaleString()}
                    </span>
                  )}
                  {document.reviewDueAt && (
                    <span>
                      Review due{" "}
                      {new Date(document.reviewDueAt).toLocaleDateString()}
                    </span>
                  )}
                  {document.supersedesDocumentId && (
                    <span>Superseding revision</span>
                  )}
                </div>

                {document.controlStatus === "under_review" && canReview && (
                  <div className="mt-3 space-y-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
                    <p className="flex items-center gap-2 text-xs text-amber-100">
                      <ShieldCheck className="h-4 w-4" />A different named human
                      must use a verified factor and AAL2 session. Canonical
                      procedure, standard or inspection evidence is rechecked at
                      decision time.
                    </p>
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
                      rows={2}
                      placeholder="Independent review basis (minimum 20 characters)"
                      className="block w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2 text-sm text-industrial-text"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void submitReview(document, "effective")}
                        className="rounded-lg border border-emerald-500/50 px-3 py-1.5 text-xs font-semibold text-emerald-200 disabled:opacity-50"
                      >
                        Mark revision effective
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void submitReview(document, "rejected")}
                        className="rounded-lg border border-red-500/50 px-3 py-1.5 text-xs font-semibold text-red-200 disabled:opacity-50"
                      >
                        Reject revision
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
