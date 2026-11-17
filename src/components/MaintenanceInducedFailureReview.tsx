import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  loadMaintenanceInducedWorkspace,
  reviewMaintenanceInducedFailure,
  type MaintenanceInducedCause,
  type MaintenanceInducedVerdict,
} from "../services/maintenanceInducedFailureService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const CAUSES: Array<{ value: MaintenanceInducedCause; label: string }> = [
  { value: "workmanship", label: "Workmanship" },
  { value: "reassembly", label: "Reassembly" },
  { value: "foreign_material", label: "Foreign material" },
  { value: "incorrect_part", label: "Incorrect part" },
  { value: "incorrect_setting", label: "Incorrect setting" },
  { value: "maintenance_procedure", label: "Maintenance procedure" },
  { value: "other_maintenance_origin", label: "Other maintenance origin" },
];

export function MaintenanceInducedFailureReview() {
  const [windowInput, setWindowInput] = useState("168");
  const [screenWindow, setScreenWindow] = useState(168);
  const { data, loading, error, refetch } = useAsyncData(
    () => loadMaintenanceInducedWorkspace(screenWindow),
    [screenWindow],
    { isEmpty: () => false },
  );
  const [candidateId, setCandidateId] = useState("");
  const [verdict, setVerdict] =
    useState<MaintenanceInducedVerdict>("inconclusive");
  const [causeCode, setCauseCode] =
    useState<MaintenanceInducedCause>("workmanship");
  const [windowEvidenceId, setWindowEvidenceId] = useState("");
  const [supportingEvidenceIds, setSupportingEvidenceIds] = useState<string[]>(
    [],
  );
  const [basis, setBasis] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (!candidateId && data?.candidates[0]) {
      setCandidateId(data.candidates[0].failureWorkOrderId);
    }
    if (!windowEvidenceId && data?.verifiedEvidence[0]) {
      setWindowEvidenceId(data.verifiedEvidence[0].id);
    }
  }, [candidateId, data, windowEvidenceId]);

  const candidate = useMemo(
    () =>
      data?.candidates.find(
        (item) => item.failureWorkOrderId === candidateId,
      ) ?? null,
    [candidateId, data],
  );

  function applyWindow() {
    const parsed = Number.parseInt(windowInput, 10);
    setScreenWindow(
      Math.min(Math.max(Number.isFinite(parsed) ? parsed : 168, 1), 2160),
    );
  }

  function toggleEvidence(id: string) {
    setSupportingEvidenceIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  async function submitReview() {
    if (!candidate) return;
    setBusy(true);
    setNotice(null);
    try {
      await reviewMaintenanceInducedFailure({
        candidate,
        verdict,
        causeCode: verdict === "confirmed" ? causeCode : null,
        exposureWindowHours: screenWindow,
        windowBasisEvidenceItemId: windowEvidenceId,
        supportingEvidenceItemIds: supportingEvidenceIds,
        basis,
      });
      setNotice({
        kind: "ok",
        text: "Append-only named-human classification recorded. No work, approval or operating authority was created.",
      });
      setBasis("");
      setSupportingEvidenceIds([]);
      refetch();
    } catch (actionError) {
      setNotice({
        kind: "error",
        text:
          actionError instanceof Error
            ? actionError.message
            : "Governed classification failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data)
    return (
      <LoadingState label="Screening maintenance-induced failure candidates" />
    );
  if (error && !data) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <section className="overflow-hidden rounded-2xl border border-amber-400/20 bg-[#0a111c]">
      <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.12),transparent_48%)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
              <Wrench className="h-4 w-4" aria-hidden /> Maintenance quality
            </div>
            <h2 className="text-xl font-semibold text-white">
              Maintenance-induced failure review
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Screen failures recorded soon after maintenance, then require a
              retained FRACAS investigation and verified evidence before a named
              human can classify maintenance as the dominant origin. Time
              proximity alone is never promoted into causation.
            </p>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            {[
              ["Candidates", data?.candidateCount ?? 0],
              ["Confirmed", data?.confirmedCount ?? 0],
              ["Rejected", data?.rejectedCount ?? 0],
              ["Inconclusive", data?.inconclusiveCount ?? 0],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg border border-white/8 bg-black/20 px-3 py-2"
              >
                <div className="text-lg font-semibold text-white">{value}</div>
                <div className="text-slate-500">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-white/8 bg-white/[0.025] p-4">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Screening window (hours)
            <input
              type="number"
              min={1}
              max={2160}
              value={windowInput}
              onChange={(event) => setWindowInput(event.target.value)}
              className="mt-2 w-36 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm normal-case text-white"
            />
          </label>
          <button
            type="button"
            onClick={applyWindow}
            className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5"
          >
            <RefreshCw className="h-4 w-4" aria-hidden /> Apply screen
          </button>
          <p className="min-w-64 flex-1 text-xs leading-5 text-slate-500">
            This is a screening filter, not an engineering threshold. A
            confirmed classification separately requires verified evidence
            supporting the selected exposure window.
          </p>
        </div>

        {(data?.candidates.length ?? 0) === 0 ? (
          <div className="rounded-xl border border-white/8 bg-white/[0.025] p-6 text-center">
            <ShieldCheck
              className="mx-auto h-8 w-8 text-teal-300"
              aria-hidden
            />
            <p className="mt-3 text-sm font-medium text-slate-200">
              No governed candidate is available in this screening window.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Candidates require completed corrective work, a named-human-coded
              failure mechanism and preceding completed maintenance on the same
              asset.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="space-y-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Candidate
                <select
                  aria-label="Maintenance-induced failure candidate"
                  value={candidateId}
                  onChange={(event) => setCandidateId(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm normal-case tracking-normal text-white"
                >
                  {(data?.candidates ?? []).map((item) => (
                    <option
                      key={item.failureWorkOrderId}
                      value={item.failureWorkOrderId}
                    >
                      {item.failureWorkOrderNumber} · {item.assetTag} ·{" "}
                      {item.observedGapHours} h
                    </option>
                  ))}
                </select>
              </label>

              {candidate && (
                <div className="rounded-xl border border-white/8 bg-black/15 p-4 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-white">
                        {candidate.assetTag} · {candidate.mechanismName}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {candidate.precedingWorkOrderNumber} →{" "}
                        {candidate.failureWorkOrderNumber}
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-2 py-1 text-xs font-semibold ${
                        candidate.readyForReview
                          ? "bg-teal-400/10 text-teal-300"
                          : "bg-amber-400/10 text-amber-300"
                      }`}
                    >
                      {candidate.readyForReview
                        ? "FRACAS retained"
                        : "FRACAS required"}
                    </span>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-slate-500">Preceding maintenance</dt>
                      <dd className="mt-1 text-slate-300">
                        {candidate.precedingTitle}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Observed gap</dt>
                      <dd className="mt-1 text-slate-300">
                        {candidate.observedGapHours} hours
                      </dd>
                    </div>
                  </dl>
                  {candidate.currentReview && (
                    <div className="mt-4 rounded-lg border border-cyan-400/15 bg-cyan-400/5 p-3 text-xs text-slate-300">
                      Current revision {candidate.currentReview.revision}:{" "}
                      <strong className="text-cyan-200">
                        {candidate.currentReview.verdict}
                      </strong>
                      . A new submission appends a superseding revision; the
                      prior record is never overwritten.
                    </div>
                  )}
                </div>
              )}
              <p className="text-xs leading-5 text-slate-500">{data?.basis}</p>
            </div>

            <div className="space-y-4 rounded-xl border border-white/8 bg-white/[0.025] p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Human verdict
                  <select
                    value={verdict}
                    onChange={(event) =>
                      setVerdict(
                        event.target.value as MaintenanceInducedVerdict,
                      )
                    }
                    className="mt-2 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm normal-case text-white"
                  >
                    <option value="inconclusive">Inconclusive</option>
                    <option value="rejected">Rejected</option>
                    <option value="confirmed">Confirmed</option>
                  </select>
                </label>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Maintenance-origin code
                  <select
                    value={causeCode}
                    disabled={verdict !== "confirmed"}
                    onChange={(event) =>
                      setCauseCode(
                        event.target.value as MaintenanceInducedCause,
                      )
                    }
                    className="mt-2 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm normal-case text-white disabled:opacity-40"
                  >
                    {CAUSES.map((cause) => (
                      <option key={cause.value} value={cause.value}>
                        {cause.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Verified exposure-window basis
                <select
                  value={windowEvidenceId}
                  onChange={(event) => setWindowEvidenceId(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm normal-case text-white"
                >
                  <option value="">Select verified evidence…</option>
                  {(data?.verifiedEvidence ?? []).map((evidence) => (
                    <option key={evidence.id} value={evidence.id}>
                      {evidence.description} ·{" "}
                      {evidence.evidenceClass ?? "unclassified"}
                    </option>
                  ))}
                </select>
              </label>

              <fieldset>
                <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Independently verified supporting evidence
                </legend>
                <div className="mt-2 max-h-36 space-y-2 overflow-y-auto rounded-lg border border-white/8 bg-black/15 p-3">
                  {(data?.verifiedEvidence.length ?? 0) === 0 ? (
                    <p className="text-xs text-amber-300">
                      No verified evidence is available. Classifications fail
                      closed until a named human verifies canonical evidence.
                    </p>
                  ) : (
                    data?.verifiedEvidence.map((evidence) => (
                      <label
                        key={evidence.id}
                        className="flex items-start gap-2 text-xs text-slate-300"
                      >
                        <input
                          type="checkbox"
                          checked={supportingEvidenceIds.includes(evidence.id)}
                          disabled={!evidence.independentlyVerified}
                          onChange={() => toggleEvidence(evidence.id)}
                          className="mt-0.5"
                        />
                        <span>
                          {evidence.description}
                          {!evidence.independentlyVerified &&
                            " · self-verified — cannot confirm causation"}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </fieldset>

              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Review basis
                <textarea
                  value={basis}
                  onChange={(event) => setBasis(event.target.value)}
                  placeholder="State what the retained investigation and verified evidence prove or fail to prove…"
                  className="mt-2 min-h-24 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm normal-case text-white"
                />
              </label>

              {notice && (
                <div
                  className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                    notice.kind === "ok"
                      ? "border-teal-400/20 bg-teal-400/5 text-teal-200"
                      : "border-red-400/20 bg-red-400/5 text-red-200"
                  }`}
                >
                  {notice.kind === "ok" ? (
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden
                    />
                  ) : (
                    <CircleAlert
                      className="mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden
                    />
                  )}
                  {notice.text}
                </div>
              )}

              <button
                type="button"
                onClick={submitReview}
                disabled={
                  busy ||
                  !candidate?.readyForReview ||
                  !windowEvidenceId ||
                  basis.trim().length < 20 ||
                  (verdict === "confirmed" &&
                    supportingEvidenceIds.length === 0)
                }
                className="w-full rounded-lg bg-amber-300 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Recording…" : "Record named-human review"}
              </button>
              <p className="text-center text-xs text-slate-500">
                Advisory classification only · no work, approval, risk,
                spending, operating-limit or return-to-service authority
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
