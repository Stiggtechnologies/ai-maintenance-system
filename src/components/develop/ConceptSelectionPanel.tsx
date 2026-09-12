import { useState } from "react";
import { CloudSun, Leaf, ShieldCheck } from "lucide-react";
import type {
  CaseOptionComparison,
  WorkspaceEvidence,
} from "../../lib/develop";
import {
  CLIMATE_RESILIENCE_HAZARDS,
  RECORDED_OPTION_DIMENSIONS,
} from "../../lib/develop/sustainability";
import {
  createClimateResilienceAssessment,
  recordClimateResilienceHazard,
  recordOptionSustainabilityObservation,
  reviewClimateResilienceAssessment,
} from "../../services/developService";

const input =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";

function label(value: string) {
  return value.replaceAll("_", " ");
}

function EvidenceSelect({ evidence }: { evidence: WorkspaceEvidence[] }) {
  return (
    <select name="evidenceItemId" required defaultValue="" className={input}>
      <option value="" disabled>
        Evidence source…
      </option>
      {evidence.map((item) => (
        <option key={item.id} value={item.id}>
          {item.description ?? item.sourceReference ?? item.id}
        </option>
      ))}
    </select>
  );
}

export function ConceptSelectionPanel({
  comparison,
  evidence,
  canPlan,
  canReview,
  busy,
  run,
}: {
  comparison: CaseOptionComparison | null;
  evidence: WorkspaceEvidence[];
  canPlan: boolean;
  canReview: boolean;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [observationOption, setObservationOption] = useState<number | null>(null);
  const [climateOption, setClimateOption] = useState<number | null>(null);
  const [hazardAssessment, setHazardAssessment] = useState<string | null>(null);
  const [reviewAssessment, setReviewAssessment] = useState<string | null>(null);

  if (comparison == null) {
    return <p className="text-xs text-slate-500">Loading concept-selection evidence…</p>;
  }

  return (
    <div className="space-y-3 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.025] p-4">
      <div className="flex items-start gap-2">
        <Leaf className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden />
        <div>
          <p className="text-xs font-semibold text-slate-200">
            Sustainability and climate resilience at concept selection
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            Every option is compared across eleven evidence-backed dimensions.
            Climate resilience requires all eight future-condition hazards and
            independent human review. Completeness is not a score, certification,
            approval or preferred-option decision.
          </p>
        </div>
      </div>

      {comparison.options.length === 0 ? (
        <p className="text-xs text-slate-500">
          Add a business-case option before recording concept-selection evidence.
        </p>
      ) : (
        comparison.options.map((option) => {
          const climate = option.climateAssessment;
          return (
            <article key={option.id} className="rounded-lg border border-white/8 bg-black/10 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-200">
                  {option.label}{option.isDoNothing ? " · do nothing" : ""}
                </p>
                <span className={option.comparisonComplete ? "text-[11px] text-emerald-300" : "text-[11px] text-amber-300"}>
                  {option.comparisonComplete
                    ? "11/11 dimensions recorded"
                    : `${11 - option.missingDimensions.length}/11 dimensions recorded`}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {option.dimensions.map((dimension) => (
                  <span
                    key={dimension.dimension}
                    title={dimension.observation ?? "No evidence-backed observation recorded"}
                    className={`rounded-full border px-2 py-1 text-[10px] ${
                      dimension.status === "recorded"
                        ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
                        : "border-amber-400/20 bg-amber-400/5 text-amber-200/80"
                    }`}
                  >
                    {label(dimension.dimension)} · {dimension.status}
                  </span>
                ))}
              </div>

              {option.missingDimensions.length > 0 && (
                <p className="mt-2 text-[11px] text-amber-200/80">
                  Named gaps: {option.missingDimensions.map(label).join(", ")}.
                  No ranking is available.
                </p>
              )}

              {climate && (
                <div className="mt-3 rounded-lg border border-sky-400/15 bg-sky-400/[0.03] p-3">
                  <div className="flex items-center gap-2 text-xs text-slate-300">
                    <CloudSun className="h-4 w-4 text-sky-300" aria-hidden />
                    {climate.assessmentRef} · revision {climate.revision} · {climate.status}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {climate.hazards.length}/8 hazards recorded
                    {climate.missingHazards.length > 0
                      ? ` · missing ${climate.missingHazards.map(label).join(", ")}`
                      : " · all hazard records present"}
                  </p>
                </div>
              )}

              {canPlan && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="text-[11px] font-semibold text-signal-cyan" onClick={() => setObservationOption(option.id)}>
                    Record dimension
                  </button>
                  {climate == null && (
                    <button className="text-[11px] font-semibold text-sky-300" onClick={() => setClimateOption(option.id)}>
                      Start climate assessment
                    </button>
                  )}
                  {climate?.status === "draft" && (
                    <button className="text-[11px] font-semibold text-sky-300" onClick={() => setHazardAssessment(climate.id)}>
                      Record hazard
                    </button>
                  )}
                </div>
              )}
              {canReview && climate?.status === "draft" && (
                <button className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-emerald-300" onClick={() => setReviewAssessment(climate.id)}>
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Independent review
                </button>
              )}

              {observationOption === option.id && (
                <form
                  className="mt-3 grid gap-2 md:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    const rawValue = String(data.get("value") ?? "");
                    void run(() =>
                      recordOptionSustainabilityObservation({
                        optionId: option.id,
                        dimension: String(data.get("dimension") ?? ""),
                        observation: String(data.get("observation") ?? ""),
                        value: rawValue === "" ? null : Number(rawValue),
                        unit: String(data.get("unit") ?? "") || null,
                        basis: String(data.get("basis") ?? ""),
                        evidenceItemId: String(data.get("evidenceItemId") ?? ""),
                      }),
                    ).then(() => setObservationOption(null));
                  }}
                >
                  <select name="dimension" required defaultValue="" className={input}>
                    <option value="" disabled>Dimension…</option>
                    {RECORDED_OPTION_DIMENSIONS.map((dimension) => <option key={dimension} value={dimension}>{label(dimension)}</option>)}
                  </select>
                  <EvidenceSelect evidence={evidence} />
                  <input name="observation" required minLength={10} placeholder="Evidence-backed observation" className={`${input} md:col-span-2`} />
                  <input name="value" type="number" step="any" placeholder="Value (optional)" className={input} />
                  <input name="unit" placeholder="Unit (required with value)" className={input} />
                  <input name="basis" required minLength={10} placeholder="Basis and comparison boundary" className={`${input} md:col-span-2`} />
                  <button disabled={busy || evidence.length === 0} className="rounded-lg border border-signal-cyan/30 px-3 py-2 text-xs font-semibold text-signal-cyan disabled:opacity-40">Record observation</button>
                </form>
              )}

              {climateOption === option.id && (
                <form
                  className="mt-3 grid gap-2 md:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void run(() => createClimateResilienceAssessment({
                      optionId: option.id,
                      assessmentRef: String(data.get("assessmentRef") ?? ""),
                      futureConditionsBasis: String(data.get("futureConditionsBasis") ?? ""),
                    })).then(() => setClimateOption(null));
                  }}
                >
                  <input name="assessmentRef" required minLength={3} placeholder="Assessment reference" className={input} />
                  <input name="futureConditionsBasis" required minLength={20} placeholder="Future-conditions source and horizon" className={input} />
                  <button disabled={busy} className="rounded-lg border border-sky-400/30 px-3 py-2 text-xs font-semibold text-sky-300 disabled:opacity-40">Create draft</button>
                </form>
              )}

              {hazardAssessment === climate?.id && climate && (
                <form
                  className="mt-3 grid gap-2 md:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void run(() => recordClimateResilienceHazard({
                      assessmentId: climate.id,
                      hazard: String(data.get("hazard") ?? ""),
                      futureCondition: String(data.get("futureCondition") ?? ""),
                      designResponse: String(data.get("designResponse") ?? ""),
                      residualGap: String(data.get("residualGap") ?? ""),
                      evidenceItemId: String(data.get("evidenceItemId") ?? ""),
                    })).then(() => setHazardAssessment(null));
                  }}
                >
                  <select name="hazard" required defaultValue="" className={input}>
                    <option value="" disabled>Climate hazard…</option>
                    {CLIMATE_RESILIENCE_HAZARDS.map((hazard) => <option key={hazard} value={hazard}>{label(hazard)}</option>)}
                  </select>
                  <EvidenceSelect evidence={evidence} />
                  <input name="futureCondition" required minLength={10} placeholder="Future condition and horizon" className={input} />
                  <input name="designResponse" required minLength={10} placeholder="Design response" className={input} />
                  <input name="residualGap" required minLength={3} placeholder="Residual gap, or ‘none evidenced’" className={`${input} md:col-span-2`} />
                  <button disabled={busy || evidence.length === 0} className="rounded-lg border border-sky-400/30 px-3 py-2 text-xs font-semibold text-sky-300 disabled:opacity-40">Record hazard</button>
                </form>
              )}

              {reviewAssessment === climate?.id && climate && (
                <form
                  className="mt-3 flex flex-col gap-2 md:flex-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void run(() => reviewClimateResilienceAssessment({
                      assessmentId: climate.id,
                      note: String(data.get("note") ?? ""),
                    })).then(() => setReviewAssessment(null));
                  }}
                >
                  <input name="note" required minLength={20} placeholder="Independent review note (not approval or certification)" className={input} />
                  <button disabled={busy} className="shrink-0 rounded-lg border border-emerald-400/30 px-3 py-2 text-xs font-semibold text-emerald-300 disabled:opacity-40">Record review</button>
                </form>
              )}
            </article>
          );
        })
      )}
      <p className="text-[10px] leading-relaxed text-slate-500">
        {comparison.decisionBoundary}
      </p>
    </div>
  );
}

