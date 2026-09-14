import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, CircleHelp, GitCompareArrows } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getConditionStateWorkspace,
  listConditionAssets,
  listConditionEvidence,
  recordAssetConditionState,
  verifyAssetConditionState,
  type ConditionKnowledgeState,
} from "../services/conditionStateService";
import { useAuth } from "./AuthProvider";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const STATE_LABELS: Record<ConditionKnowledgeState, string> = {
  known: "Known",
  estimated: "Estimated",
  predicted: "Predicted",
  unknown: "Unknown",
  conflicting: "Conflicting",
};

const REVIEW_ROLES = new Set([
  "reliability_engineer",
  "maintenance_manager",
  "executive",
  "admin",
]);

export function ConditionStatePanel() {
  const { profile } = useAuth();
  const workspace = useAsyncData(getConditionStateWorkspace, []);
  const assets = useAsyncData(listConditionAssets, []);
  const [assetId, setAssetId] = useState("");
  const evidence = useAsyncData(
    () => (assetId ? listConditionEvidence(assetId) : Promise.resolve([])),
    [assetId],
  );
  const [knowledgeState, setKnowledgeState] =
    useState<ConditionKnowledgeState>("unknown");
  const [basis, setBasis] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("");
  const [observedAt, setObservedAt] = useState("");
  const [validThrough, setValidThrough] = useState("");
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewDecision, setReviewDecision] = useState<
    "verified" | "superseded"
  >("verified");
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => setEvidenceIds([]), [assetId]);

  const canReview = REVIEW_ROLES.has(profile?.role ?? "");
  const selectedEvidence = useMemo(() => new Set(evidenceIds), [evidenceIds]);

  if (workspace.loading || assets.loading) {
    return <LoadingState label="Loading condition knowledge states" />;
  }
  if (workspace.error || assets.error) {
    return (
      <ErrorState
        message={
          workspace.error ?? assets.error ?? "Condition state unavailable"
        }
        onRetry={() => {
          void workspace.refetch();
          void assets.refetch();
        }}
      />
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFlash(null);
    try {
      await recordAssetConditionState({
        assetId,
        knowledgeState,
        basis,
        assessedValue: value.trim() ? Number(value) : null,
        valueUnit: unit.trim() || null,
        evidenceItemIds: evidenceIds,
        observedAt: observedAt ? new Date(observedAt).toISOString() : null,
        validThrough: validThrough
          ? new Date(validThrough).toISOString()
          : null,
      });
      setBasis("");
      setValue("");
      setUnit("");
      setObservedAt("");
      setValidThrough("");
      setEvidenceIds([]);
      setFlash(
        "Draft condition knowledge state recorded for independent review.",
      );
      await workspace.refetch();
    } catch (caught) {
      setFlash((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function review(event: FormEvent) {
    event.preventDefault();
    if (!reviewingId) return;
    setBusy(true);
    setFlash(null);
    try {
      await verifyAssetConditionState(reviewingId, reviewDecision, reviewNote);
      setReviewingId(null);
      setReviewNote("");
      setFlash("Independent condition-state disposition recorded.");
      await workspace.refetch();
    } catch (caught) {
      setFlash((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const rows = workspace.data?.assessments ?? [];

  return (
    <section
      data-testid="condition-state-workspace"
      className="rounded-xl border border-white/8 bg-overlook-deep/40 p-4"
      aria-labelledby="condition-state-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3
            id="condition-state-heading"
            className="flex items-center gap-2 text-sm font-semibold text-white"
          >
            <CircleHelp className="h-4 w-4 text-signal-cyan" aria-hidden />
            Condition knowledge state
          </h3>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
            {workspace.data?.basis}
          </p>
        </div>
        <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-slate-400">
          {rows.length} active assessment{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      {flash ? (
        <p className="mt-3 rounded-lg border border-signal-cyan/20 bg-signal-cyan/5 p-2 text-xs text-slate-200">
          {flash}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-2">
          {rows.length === 0 ? (
            <p className="rounded-lg border border-white/6 bg-white/2 p-3 text-xs text-slate-400">
              No asset condition has been assessed. Absence remains unassessed;
              it is not silently presented as healthy or known.
            </p>
          ) : (
            rows.map((row) => (
              <article
                key={row.id}
                className="rounded-lg border border-white/6 bg-white/2 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-slate-100">
                      {row.asset}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">{row.basis}</p>
                  </div>
                  <div className="flex gap-2">
                    <span className="rounded-full border border-signal-cyan/25 px-2 py-0.5 text-[11px] text-signal-cyan">
                      {STATE_LABELS[row.knowledge_state]}
                    </span>
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-slate-400">
                      {row.status}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {row.assessed_value == null
                    ? "No numeric value asserted"
                    : `${row.assessed_value} ${row.value_unit}`}
                  {" · "}
                  {row.evidence_item_ids.length} evidence reference
                  {row.evidence_item_ids.length === 1 ? "" : "s"}
                  {row.valid_through
                    ? ` · valid through ${new Date(row.valid_through).toLocaleString()}`
                    : ""}
                </p>
                {canReview && row.status === "draft" ? (
                  <button
                    type="button"
                    className="mt-2 text-xs font-medium text-signal-cyan underline-offset-2 hover:underline"
                    onClick={() => setReviewingId(row.id)}
                  >
                    Independently review
                  </button>
                ) : null}
              </article>
            ))
          )}
        </div>

        <form
          className="space-y-3 rounded-lg border border-white/8 bg-black/10 p-3"
          onSubmit={submit}
        >
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
            Record a draft assessment
          </h4>
          <label className="block text-xs text-slate-400">
            Asset
            <select
              required
              value={assetId}
              onChange={(event) => setAssetId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-slate-100"
            >
              <option value="">Select asset</option>
              {(assets.data ?? []).map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                  {asset.tag ? ` · ${asset.tag}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-slate-400">
            Knowledge state
            <select
              value={knowledgeState}
              onChange={(event) =>
                setKnowledgeState(event.target.value as ConditionKnowledgeState)
              }
              className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-slate-100"
            >
              {Object.entries(STATE_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-400">
              Value (optional)
              <input
                type="number"
                step="any"
                value={value}
                disabled={knowledgeState === "unknown"}
                onChange={(event) => setValue(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-slate-100 disabled:opacity-40"
              />
            </label>
            <label className="text-xs text-slate-400">
              Unit (paired)
              <input
                value={unit}
                disabled={knowledgeState === "unknown"}
                onChange={(event) => setUnit(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-slate-100 disabled:opacity-40"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-400">
              Observed at
              <input
                type="datetime-local"
                value={observedAt}
                onChange={(event) => setObservedAt(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-2 py-2 text-xs text-slate-100"
              />
            </label>
            <label className="text-xs text-slate-400">
              Valid through
              <input
                type="datetime-local"
                value={validThrough}
                onChange={(event) => setValidThrough(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-2 py-2 text-xs text-slate-100"
              />
            </label>
          </div>
          <fieldset className="space-y-1">
            <legend className="text-xs text-slate-400">
              Canonical evidence
            </legend>
            {(evidence.data ?? []).length === 0 ? (
              <p className="text-[11px] text-slate-500">
                No selectable evidence for this asset.
              </p>
            ) : (
              (evidence.data ?? []).map((item) => (
                <label
                  key={item.id}
                  className="flex gap-2 rounded border border-white/6 p-2 text-[11px] text-slate-400"
                >
                  <input
                    type="checkbox"
                    checked={selectedEvidence.has(item.id)}
                    onChange={(event) =>
                      setEvidenceIds((current) =>
                        event.target.checked
                          ? [...current, item.id]
                          : current.filter((id) => id !== item.id),
                      )
                    }
                  />
                  <span>
                    {item.description}
                    <strong className="ml-1 text-slate-500">
                      · {item.verification_status}
                    </strong>
                  </span>
                </label>
              ))
            )}
          </fieldset>
          <label className="block text-xs text-slate-400">
            Basis and limitations
            <textarea
              required
              minLength={20}
              rows={3}
              value={basis}
              onChange={(event) => setBasis(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-slate-100"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !assetId}
            className="rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-3 py-2 text-xs font-medium text-signal-cyan disabled:opacity-40"
          >
            Record draft state
          </button>
        </form>
      </div>

      {reviewingId ? (
        <form
          onSubmit={review}
          className="mt-4 rounded-lg border border-signal-gold/30 bg-signal-gold/5 p-3"
        >
          <h4 className="flex items-center gap-2 text-xs font-semibold text-signal-gold">
            <GitCompareArrows className="h-4 w-4" aria-hidden />
            Independent review
          </h4>
          <div className="mt-2 grid gap-2 md:grid-cols-[12rem_1fr_auto]">
            <select
              value={reviewDecision}
              onChange={(event) =>
                setReviewDecision(
                  event.target.value as "verified" | "superseded",
                )
              }
              className="rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-slate-100"
            >
              <option value="verified">Verify</option>
              <option value="superseded">Supersede</option>
            </select>
            <input
              required
              minLength={20}
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              placeholder="Verification method and conclusion"
              className="rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-slate-100"
            />
            <button
              type="submit"
              disabled={busy}
              className="flex items-center gap-1 rounded-lg border border-signal-gold/30 px-3 py-2 text-xs font-medium text-signal-gold disabled:opacity-40"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              Record
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
