import { useState } from "react";
import { Activity, GitPullRequestArrow } from "lucide-react";
import {
  proposeMethodologyImprovement,
  runMethodologyOutcomeAnalysis,
  type FrameworkShelfEntry,
  type MethodologyOutcomeAnalysis,
  type MethodologyOutcomePattern,
} from "../../services/developService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";

function number(value: number | null | undefined, suffix = "") {
  return value == null ? "not calculable" : `${value}${suffix}`;
}

export function MethodologyLearningPanel({
  adopted,
  canAuthor,
  onChanged,
}: {
  adopted: FrameworkShelfEntry[];
  canAuthor: boolean;
  onChanged: () => void;
}) {
  const [frameworkId, setFrameworkId] = useState("");
  const [analysis, setAnalysis] = useState<MethodologyOutcomeAnalysis | null>(
    null,
  );
  const [selected, setSelected] = useState<MethodologyOutcomePattern | null>(
    null,
  );
  const [action, setAction] = useState<"simplify" | "strengthen">("strengthen");
  const [mandatory, setMandatory] = useState<"preserve" | "true" | "false">(
    "preserve",
  );
  const [rationale, setRationale] = useState("");
  const [evidenceType, setEvidenceType] = useState("");
  const [minimumConfidence, setMinimumConfidence] = useState("");
  const [guidance, setGuidance] = useState("");
  const [weight, setWeight] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const analyze = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setSelected(null);
    try {
      setAnalysis(await runMethodologyOutcomeAnalysis(frameworkId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const propose = async () => {
    if (!analysis || !selected) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await proposeMethodologyImprovement({
        calculationRunId: analysis.calculationRunId,
        criterionId: selected.criterionId,
        action,
        rationale,
        isMandatory: mandatory === "preserve" ? null : mandatory === "true",
        evidenceType: evidenceType.trim() || null,
        minimumConfidence:
          minimumConfidence === "" ? null : Number(minimumConfidence),
        guidance: guidance.trim() || null,
        weight: weight === "" ? null : Number(weight),
      });
      setNotice(
        `Draft framework v${result.version} created. It governs nothing until an administrator or executive reviews and adopts it below.`,
      );
      setSelected(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-white/8 p-2.5">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
        <Activity className="h-3.5 w-3.5 text-slate-400" aria-hidden />
        Methodology learning — execution → outcomes → improved draft
      </div>
      <p className="text-[11px] text-slate-500">
        Compare latest gate findings with independently evidenced completed
        outcomes. Each met and not-met cohort needs at least three projects.
        Results are associations, never causal proof or an automatic method
        change.
      </p>
      <div className="flex gap-2">
        <select
          aria-label="Adopted framework to analyze"
          value={frameworkId}
          onChange={(e) => {
            setFrameworkId(e.target.value);
            setAnalysis(null);
            setSelected(null);
          }}
          className={inputClass}
        >
          <option value="">Adopted framework…</option>
          {adopted.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} v{f.version}
            </option>
          ))}
        </select>
        <button
          onClick={() => void analyze()}
          disabled={busy || !frameworkId}
          className="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
        >
          {busy ? "Analyzing…" : "Analyze outcomes"}
        </button>
      </div>
      {error && (
        <div className="rounded border border-red-400/30 bg-red-400/10 px-2.5 py-2 text-xs whitespace-pre-wrap text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-2 text-xs text-emerald-300">
          {notice}
        </div>
      )}
      {analysis && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <span className="rounded-full bg-white/5 px-2 py-1 text-slate-300">
              immutable run {analysis.calculationRunId.slice(0, 8)}
            </span>
            <span className="rounded-full bg-white/5 px-2 py-1 text-slate-300">
              {analysis.eligiblePatterns} eligible association(s)
            </span>
            <span className="rounded-full bg-amber-400/10 px-2 py-1 font-semibold text-amber-300">
              association ≠ causation
            </span>
          </div>
          {analysis.refusals.map((refusal) => (
            <p
              key={refusal}
              className="rounded border border-amber-400/20 bg-amber-400/5 px-2 py-1.5 text-[11px] text-amber-200"
            >
              {refusal}
            </p>
          ))}
          {(analysis.criteria ?? []).map((pattern) => (
            <div
              key={pattern.criterionId}
              className="rounded border border-white/8 bg-white/[0.02] p-2 text-[11px] text-slate-300"
            >
              <div className="font-semibold text-slate-100">
                {pattern.stageKey} · {pattern.gateName}
              </div>
              <div>{pattern.criterion}</div>
              <div className="mt-1 grid gap-1 sm:grid-cols-2">
                <div className="rounded bg-emerald-400/5 p-1.5">
                  Met (n={pattern.metSample}): cost growth{" "}
                  {number(pattern.means.met.costGrowthPct, "%")}, schedule{" "}
                  {number(pattern.means.met.scheduleGrowthPct, "%")}, defects{" "}
                  {number(pattern.means.met.commissioningDefects)}, startup{" "}
                  {number(pattern.means.met.startupReliabilityPct, "%")}
                </div>
                <div className="rounded bg-amber-400/5 p-1.5">
                  Not met (n={pattern.notMetSample}): cost growth{" "}
                  {number(pattern.means.notMet.costGrowthPct, "%")}, schedule{" "}
                  {number(pattern.means.notMet.scheduleGrowthPct, "%")}, defects{" "}
                  {number(pattern.means.notMet.commissioningDefects)}, startup{" "}
                  {number(pattern.means.notMet.startupReliabilityPct, "%")}
                </div>
              </div>
              {canAuthor && (
                <button
                  onClick={() => setSelected(pattern)}
                  className="mt-1.5 flex items-center gap-1 text-[10px] text-signal-cyan hover:underline"
                >
                  <GitPullRequestArrow className="h-3 w-3" aria-hidden />
                  propose a governed draft change
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {selected && analysis && (
        <div className="space-y-1.5 rounded-lg border border-signal-cyan/20 bg-signal-cyan/[0.03] p-2.5">
          <div className="text-xs font-semibold text-slate-100">
            Draft a change to “{selected.criterion}”
          </div>
          <p className="text-[10px] text-slate-500">
            Blank controls preserve the current value. This creates the next
            draft version only. Adoption remains a separate named-human act.
          </p>
          <div className="grid gap-1.5 sm:grid-cols-3">
            <select
              aria-label="Improvement action"
              value={action}
              onChange={(e) =>
                setAction(e.target.value as "simplify" | "strengthen")
              }
              className={inputClass}
            >
              <option value="strengthen">Strengthen</option>
              <option value="simplify">Simplify</option>
            </select>
            <select
              aria-label="Mandatory setting"
              value={mandatory}
              onChange={(e) => setMandatory(e.target.value as typeof mandatory)}
              className={inputClass}
            >
              <option value="preserve">Preserve mandatory setting</option>
              <option value="true">Make mandatory</option>
              <option value="false">Make advisory</option>
            </select>
            <input
              aria-label="Requirement weight"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              type="number"
              min="0.01"
              step="0.1"
              placeholder="Weight — preserve"
              className={inputClass}
            />
            <input
              aria-label="Evidence type"
              value={evidenceType}
              onChange={(e) => setEvidenceType(e.target.value)}
              placeholder="Evidence type — preserve"
              className={inputClass}
            />
            <input
              aria-label="Minimum confidence"
              value={minimumConfidence}
              onChange={(e) => setMinimumConfidence(e.target.value)}
              type="number"
              min="0"
              max="1"
              step="0.05"
              placeholder="Minimum confidence — preserve"
              className={inputClass}
            />
            <input
              aria-label="Requirement guidance"
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              placeholder="Guidance — preserve"
              className={inputClass}
            />
          </div>
          <textarea
            aria-label="Human rationale"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="Human rationale for the change (20 characters minimum)"
            rows={2}
            className={inputClass}
          />
          <div className="flex gap-2">
            <button
              onClick={() => void propose()}
              disabled={busy || rationale.trim().length < 20}
              className="rounded border border-signal-cyan/30 bg-signal-cyan/10 px-2.5 py-1 text-[11px] font-semibold text-signal-cyan disabled:opacity-50"
            >
              Create draft version and proposal
            </button>
            <button
              onClick={() => setSelected(null)}
              className="px-2 py-1 text-[11px] text-slate-500"
            >
              cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
