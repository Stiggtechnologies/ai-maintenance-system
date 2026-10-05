import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Link2, Loader2, X } from "lucide-react";
import type { RecommendationRow } from "../types/operating";
import {
  getRecommendationFailureBasis,
  recordRecommendationFailureBasis,
  type FailureBasisKind,
  type RecommendationFailureBasis,
} from "../services/recommendationFailureBasisService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

export function RecommendationFailureBasisDrawer({
  rec,
  canGovern,
  onClose,
}: {
  rec: RecommendationRow;
  canGovern: boolean;
  onClose: () => void;
}) {
  const [workspace, setWorkspace] =
    useState<RecommendationFailureBasis | null>(null);
  const [kind, setKind] = useState<FailureBasisKind>("failure_mode");
  const [subjectId, setSubjectId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setWorkspace(await getRecommendationFailureBasis(rec.id));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not load failure basis.",
      );
    }
  }, [rec.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const options =
    kind === "failure_mode"
      ? workspace?.eligibleFailureModes ?? []
      : kind === "risk_scenario"
        ? workspace?.eligibleRiskScenarios ?? []
        : [];

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await recordRecommendationFailureBasis({
        recommendationId: rec.id,
        kind,
        subjectId: kind === "not_applicable" ? null : subjectId || null,
        note,
      });
      await load();
      setNote("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not record failure basis.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
      <section className="h-full w-full max-w-xl overflow-y-auto border-l border-white/10 bg-[#0D1520] p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Link2 className="h-4 w-4 text-teal-400" aria-hidden />
              Failure mode or risk basis
            </h2>
            <p className="mt-1 text-xs text-slate-400">{rec.title}</p>
          </div>
          <button
            aria-label="Close"
            onClick={onClose}
            className="text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!workspace && !error && (
          <LoadingState label="Loading governed basis…" />
        )}
        {error && (
          <div className="mt-4">
            <ErrorState message={error} onRetry={load} />
          </div>
        )}

        {workspace && (
          <>
            <div className="mt-5 rounded-xl border border-white/8 bg-black/20 p-4 text-xs text-slate-300">
              <p>
                <span className="text-slate-500">Current: </span>
                {workspace.kind ?? "Not recorded"}
              </p>
              {workspace.failureMode && (
                <p className="mt-1">{workspace.failureMode.label}</p>
              )}
              {workspace.riskScenario && (
                <p className="mt-1">{workspace.riskScenario.label}</p>
              )}
              {workspace.note && (
                <p className="mt-2 text-slate-400">{workspace.note}</p>
              )}
              {workspace.kind && !workspace.valid && (
                <p
                  role="alert"
                  className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-amber-200"
                >
                  <AlertTriangle
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                    aria-hidden
                  />
                  This basis is no longer current. A named human must review and
                  record a valid governed basis before relying on it.
                </p>
              )}
              <p className="mt-2 text-slate-500">{workspace.boundary}</p>
            </div>

            {canGovern && rec.status === "pending" && (
              <div className="mt-5 space-y-3">
                <label className="block text-xs text-slate-400">
                  Basis type
                  <select
                    value={kind}
                    onChange={(e) => {
                      setKind(e.target.value as FailureBasisKind);
                      setSubjectId("");
                    }}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-slate-200"
                  >
                    <option value="failure_mode">Reviewed failure mode</option>
                    <option value="risk_scenario">Governed risk scenario</option>
                    <option value="not_applicable">
                      Explicitly not applicable
                    </option>
                  </select>
                </label>
                {kind !== "not_applicable" && (
                  <label className="block text-xs text-slate-400">
                    Governed subject
                    <select
                      value={subjectId}
                      onChange={(e) => setSubjectId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-slate-200"
                    >
                      <option value="">Select one…</option>
                      {options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="block text-xs text-slate-400">
                  Engineering basis
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={4}
                    placeholder="Explain why this failure mode, risk scenario, or not-applicable disposition is correct."
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-slate-200 placeholder:text-slate-600"
                  />
                </label>
                <button
                  disabled={
                    busy ||
                    note.trim().length < 20 ||
                    (kind !== "not_applicable" && !subjectId)
                  }
                  onClick={save}
                  className="flex items-center gap-2 rounded-lg border border-teal-500/30 bg-teal-500/20 px-3 py-2 text-xs font-medium text-teal-300 disabled:opacity-40"
                >
                  {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                  Record governed basis
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
