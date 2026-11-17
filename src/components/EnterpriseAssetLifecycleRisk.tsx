import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  GitBranch,
  ShieldAlert,
} from "lucide-react";
import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getEnterpriseAssetLifecycleRisk,
  recordInitialAssetLifecycleState,
  type RecordedRiskLevel,
} from "../services/enterpriseAssetLifecycleRiskService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const levelStyle: Record<RecordedRiskLevel, string> = {
  Critical: "border-red-400/30 bg-red-400/10 text-red-200",
  High: "border-orange-400/30 bg-orange-400/10 text-orange-200",
  Medium: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  Low: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200",
  "Very Low": "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
};

function ratio(covered: number, total: number) {
  return total > 0 ? `${covered} / ${total}` : "—";
}

export function EnterpriseAssetLifecycleRisk() {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useAsyncData(
    getEnterpriseAssetLifecycleRisk,
    [],
  );
  const [assetId, setAssetId] = useState("");
  const [stageKey, setStageKey] = useState("");
  const [evidenceItemId, setEvidenceItemId] = useState("");
  const [basis, setBasis] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  if (loading)
    return <LoadingState label="Loading enterprise asset lifecycle risk" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return null;

  const { coverage } = data;
  const setup = data.initialStateSetup;
  const applicableEvidence = setup.evidence.filter(
    (item) => item.assetId === assetId,
  );

  async function recordInitialState(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaveMessage("");
    try {
      await recordInitialAssetLifecycleState({
        assetId,
        stageKey,
        evidenceItemId,
        basis,
      });
      setSaveMessage("Initial canonical lifecycle state recorded.");
      setAssetId("");
      setStageKey("");
      setEvidenceItemId("");
      setBasis("");
      refetch();
    } catch (saveError) {
      setSaveMessage(
        saveError instanceof Error
          ? saveError.message
          : "Lifecycle state was not recorded.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="rounded-2xl border border-white/8 bg-slate-950/35 p-5"
      data-testid="enterprise-asset-lifecycle-risk"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-white">
            <ShieldAlert className="h-4 w-4 text-cyan-300" aria-hidden />
            Asset lifecycle risk
          </p>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
            One enterprise posture composed from canonical lifecycle state, ISO
            31000 risk, condition, economics and lifecycle decisions. Recorded
            scores are never recalculated or replaced by asset-master defaults.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigate("/risk")}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-400/15 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            Open risk workspace <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => navigate("/lifecycle/decisions")}
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-cyan-300"
          >
            Open lifecycle decisions <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Enterprise index
          </p>
          <p className="mt-2 text-3xl font-semibold tabular-nums text-white">
            {data.index.indexComputable ? data.index.value : "—"}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {data.index.indexComputable
              ? `${data.index.criteriaProfile?.name ?? "Adopted criteria"} v${data.index.criteriaProfile?.version ?? "—"}`
              : "No enterprise index is published"}
          </p>
        </article>
        <article className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Lifecycle coverage
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-white">
            {ratio(
              coverage.assets - coverage.assetsWithoutCurrentLifecycle,
              coverage.assets,
            )}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Assets with canonical stage
          </p>
        </article>
        <article className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Current risk coverage
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-white">
            {ratio(
              coverage.assets - coverage.assetsWithoutCurrentRisk,
              coverage.assets,
            )}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Assets with complete current assessment
          </p>
        </article>
        <article className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Review integrity
          </p>
          <p
            className={`mt-2 text-2xl font-semibold tabular-nums ${
              coverage.incompleteRiskRecords > 0 ||
              coverage.staleOrUndatedRiskRecords > 0
                ? "text-amber-300"
                : "text-white"
            }`}
          >
            {coverage.incompleteRiskRecords +
              coverage.staleOrUndatedRiskRecords}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Incomplete, stale or undated records
          </p>
        </article>
      </div>

      <div
        className={`mt-4 rounded-xl border p-4 ${
          data.index.indexComputable
            ? "border-emerald-400/25 bg-emerald-400/[0.06]"
            : "border-amber-400/25 bg-amber-400/[0.06]"
        }`}
      >
        <div className="flex items-start gap-3">
          {data.index.indexComputable ? (
            <CheckCircle2
              className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300"
              aria-hidden
            />
          ) : (
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
              aria-hidden
            />
          )}
          <div>
            <p className="text-sm font-medium text-white">
              {data.index.indexComputable
                ? "Comparable enterprise position"
                : "Index withheld — evidence remains actionable"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              {data.index.basis}
            </p>
            {data.evidenceGaps.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-amber-100/90">
                {data.evidenceGaps.map((gap) => (
                  <li key={gap}>• {gap}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {setup.canRecord && setup.assets.length > 0 && (
        <form
          onSubmit={recordInitialState}
          className="mt-4 grid gap-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4 md:grid-cols-2"
          aria-label="Record initial asset lifecycle state"
        >
          <div className="md:col-span-2">
            <h3 className="text-sm font-semibold text-white">
              Establish missing lifecycle state
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              A named lifecycle authority can establish an asset&apos;s first
              canonical stage from independently verified, asset-specific
              evidence. This requires a verified factor and an AAL2 session; it
              does not approve work, spending, risk acceptance or return to
              service.
            </p>
          </div>
          <label className="grid gap-1 text-xs text-slate-300">
            Asset without lifecycle state
            <select
              required
              value={assetId}
              onChange={(event) => {
                setAssetId(event.target.value);
                setEvidenceItemId("");
              }}
              className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="">Select asset</option>
              {setup.assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.tag ? `${asset.tag} — ` : ""}
                  {asset.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-slate-300">
            Canonical lifecycle stage
            <select
              required
              value={stageKey}
              onChange={(event) => setStageKey(event.target.value)}
              className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="">Select stage</option>
              {setup.stages.map((stage) => (
                <option key={stage.stageKey} value={stage.stageKey}>
                  {stage.label} — {stage.phase.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-slate-300 md:col-span-2">
            Independently verified evidence
            <select
              required
              disabled={!assetId || applicableEvidence.length === 0}
              value={evidenceItemId}
              onChange={(event) => setEvidenceItemId(event.target.value)}
              className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              <option value="">
                {!assetId
                  ? "Select an asset first"
                  : applicableEvidence.length === 0
                    ? "No eligible verified evidence for this asset"
                    : "Select evidence"}
              </option>
              {applicableEvidence.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description ??
                    item.evidenceClass ??
                    "Verified evidence"}
                  {item.sourceSystem ? ` — ${item.sourceSystem}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-slate-300 md:col-span-2">
            Lifecycle basis
            <textarea
              required
              minLength={20}
              maxLength={4000}
              value={basis}
              onChange={(event) => setBasis(event.target.value)}
              placeholder="Explain why the verified evidence establishes this current lifecycle stage (20–4000 characters)."
              className="min-h-24 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </label>
          <button
            type="submit"
            disabled={
              saving ||
              !assetId ||
              !stageKey ||
              !evidenceItemId ||
              basis.trim().length < 20
            }
            className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
          >
            {saving ? "Recording…" : "Record initial lifecycle state"}
          </button>
          {saveMessage && (
            <p role="status" className="self-center text-sm text-slate-300">
              {saveMessage}
            </p>
          )}
        </form>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
          <h3 className="text-sm font-semibold text-white">
            Recorded risk levels
          </h3>
          {data.riskLevels.length === 0 ? (
            <p className="mt-3 text-xs text-slate-400">
              No complete, current asset risk records are available.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {data.riskLevels.map((level) => (
                <span
                  key={level.level}
                  className={`rounded-full border px-3 py-1 text-xs ${levelStyle[level.level]}`}
                >
                  {level.level}: {level.records}
                </span>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Counts preserve the customer&apos;s recorded levels; SyncAI does not
            translate between criteria profiles.
          </p>
        </article>

        <article className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <GitBranch className="h-4 w-4 text-cyan-300" aria-hidden />
            Lifecycle stage coverage
          </h3>
          <div className="mt-3 space-y-2">
            {data.lifecycleStages.map((stage) => (
              <div
                key={stage.stageKey}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span className="text-slate-300">{stage.stageLabel}</span>
                <span className="tabular-nums text-slate-400">
                  {stage.assetsWithCurrentRisk} / {stage.assets} assessed
                </span>
              </div>
            ))}
          </div>
        </article>
      </div>

      {data.detailAccess && data.assets.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-white/8">
          <table className="min-w-full divide-y divide-white/8 text-left text-xs">
            <thead className="bg-white/[0.03] text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">Asset</th>
                <th className="px-3 py-2 font-medium">Lifecycle</th>
                <th className="px-3 py-2 font-medium">Risk</th>
                <th className="px-3 py-2 font-medium">Condition</th>
                <th className="px-3 py-2 font-medium">Evidence gaps</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              {data.assets.map((asset) => (
                <tr key={asset.id} className="text-slate-300">
                  <td className="px-3 py-3">
                    <p className="font-medium text-white">{asset.name}</p>
                    <p className="text-slate-500">
                      {asset.tag ?? asset.assetClass ?? "No tag or class"}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    {asset.lifecycle?.stageLabel ?? "Unassigned"}
                  </td>
                  <td className="px-3 py-3 tabular-nums">
                    {asset.assetRiskScore ?? "—"}
                    {asset.restrictedRiskRecords > 0 && (
                      <p className="text-[11px] text-amber-300">
                        {asset.restrictedRiskRecords} restricted record
                        {asset.restrictedRiskRecords === 1 ? "" : "s"}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3 capitalize">
                    {asset.conditionKnowledgeState ?? "Not assessed"}
                  </td>
                  <td className="max-w-sm px-3 py-3 text-slate-400">
                    {asset.evidenceGaps.length > 0
                      ? asset.evidenceGaps.join(" · ")
                      : "No modeled evidence gaps"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!data.detailAccess && data.detailRestriction && (
        <p className="mt-4 rounded-lg border border-white/8 bg-white/[0.025] px-3 py-2 text-xs text-slate-400">
          {data.detailRestriction}
        </p>
      )}

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        {data.decisionBoundary}
      </p>
    </section>
  );
}
