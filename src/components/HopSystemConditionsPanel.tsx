import { useState } from "react";
import { Activity, Plus, RefreshCw, ShieldAlert } from "lucide-react";
import {
  HOP_CATEGORIES,
  recordHopSystemCondition,
  runHopAgent,
  type HopAgentResult,
  type HopCategory,
} from "../services/hopAgentService";

export function HopSystemConditionsPanel() {
  const [result, setResult] = useState<HopAgentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<HopCategory[]>([]);
  const [conditions, setConditions] = useState("");
  const [basis, setBasis] = useState("");
  const [action, setAction] = useState("");
  const [refs, setRefs] = useState("");
  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await runHopAgent());
    } catch (e) {
      setError(e instanceof Error ? e.message : "HOP screen unavailable");
    } finally {
      setLoading(false);
    }
  };
  const record = async () => {
    setLoading(true);
    setError(null);
    try {
      await recordHopSystemCondition({
        conditionCategories: categories,
        errorType: "knowledge_based_mistake",
        outcomeSeverity: "near_miss",
        contributingConditions: conditions,
        correctiveAction: action || undefined,
        observationBasis: basis,
        evidenceRefs: refs
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean),
      });
      setOpen(false);
      setCategories([]);
      setConditions("");
      setBasis("");
      setAction("");
      setRefs("");
      await run();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Condition could not be recorded",
      );
    } finally {
      setLoading(false);
    }
  };
  return (
    <section
      className="rounded-xl border border-white/8 bg-[#0D1520] p-5"
      aria-labelledby="hop-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-signal-cyan" />
            <h2 id="hop-title" className="font-semibold text-white">
              HOP system conditions
            </h2>
            <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">
              No-person invariant
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
            Asks what about the work system made an error likely. It does not
            identify, rank, score or assign blame to a worker.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200"
          >
            <Plus className="h-3.5 w-3.5" />
            Record condition
          </button>
          <button
            type="button"
            onClick={() => void run()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-signal-cyan/25 bg-signal-cyan/10 px-3 py-2 text-xs font-semibold text-signal-cyan disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5${loading ? " animate-spin" : ""}`}
            />
            {result ? "Run again" : "Screen conditions"}
          </button>
        </div>
      </div>
      {open ? (
        <div className="mt-4 space-y-3 rounded-lg border border-white/8 p-4">
          <p className="flex items-center gap-2 text-xs text-amber-200">
            <ShieldAlert className="h-4 w-4" />
            Do not enter names, email addresses, employee identifiers or
            individual performance judgements.
          </p>
          <div className="flex flex-wrap gap-2">
            {HOP_CATEGORIES.map(([key, label]) => (
              <button
                type="button"
                key={key}
                onClick={() =>
                  setCategories((x) =>
                    x.includes(key) ? x.filter((v) => v !== key) : [...x, key],
                  )
                }
                className={`rounded-full border px-2.5 py-1 text-[11px] ${categories.includes(key) ? "border-signal-cyan bg-signal-cyan/10 text-signal-cyan" : "border-white/10 text-slate-400"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <textarea
            aria-label="System conditions"
            value={conditions}
            onChange={(e) => setConditions(e.target.value)}
            placeholder="Describe the task, procedure, handoff, authority, workload or environmental conditions…"
            className="min-h-20 w-full rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white"
          />
          <textarea
            aria-label="Observation basis"
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
            placeholder="State the observation or evidence basis (minimum 20 characters)…"
            className="min-h-16 w-full rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white"
          />
          <input
            aria-label="Corrective action"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="Possible system action for human review (optional)"
            className="w-full rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white"
          />
          <textarea
            aria-label="Evidence references"
            value={refs}
            onChange={(e) => setRefs(e.target.value)}
            placeholder="Evidence references, one per line (optional)"
            className="min-h-14 w-full rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-white"
          />
          <button
            type="button"
            disabled={
              loading ||
              categories.length === 0 ||
              conditions.trim().length < 20 ||
              basis.trim().length < 20
            }
            onClick={() => void record()}
            className="rounded-lg bg-signal-cyan px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40"
          >
            Record system condition
          </button>
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-200"
        >
          {error}
        </div>
      ) : null}
      {result ? (
        <div className="mt-5 space-y-4">
          <p className="text-sm font-semibold text-white">
            {result.analysis.headline}
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {result.analysis.categoryCounts.map((c) => (
              <div key={c.key} className="rounded-lg border border-white/6 p-3">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">
                  {c.label}
                </p>
                <p className="mt-1 text-xl font-bold text-white">{c.count}</p>
              </div>
            ))}
          </div>
          {result.analysis.findings.length ? (
            <div className="space-y-2">
              {result.analysis.findings.map((f) => (
                <article
                  key={f.id}
                  className="rounded-lg border border-white/8 p-3"
                >
                  <h3 className="text-sm font-semibold text-white">
                    {f.headline}
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-slate-300">
                    {f.detail}
                  </p>
                  <p className="mt-2 text-xs text-signal-cyan">
                    <b>Human action:</b> {f.humanAction}
                  </p>
                  <p className="mt-2 break-all font-mono text-[10px] text-slate-500">
                    {f.sourceRefs.join(" · ")}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-200">
              No condition was detected in this bounded screen. This is not
              proof that no condition exists.
            </p>
          )}
          <div className="rounded-lg border border-white/6 p-3 text-[11px] leading-5 text-slate-500">
            <p>{result.analysis.basis}</p>
            {result.analysis.limitations.map((x) => (
              <p key={x}>• {x}</p>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
