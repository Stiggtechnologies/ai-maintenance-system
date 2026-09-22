import { useState } from "react";
import { Factory, Minus, ShieldAlert } from "lucide-react";
import type {
  CaseOperationalDisruption,
  WorkspaceEvidence,
} from "../../lib/develop";
import { recordOptionOperationalDisruption } from "../../services/developService";

const input =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-300/50 focus:outline-none";

function money(value: number, currency = "CAD") {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function EvidenceSelect({
  evidence,
  name,
  label,
}: {
  evidence: WorkspaceEvidence[];
  name: string;
  label: string;
}) {
  return (
    <label className="space-y-1 text-[10px] uppercase tracking-wide text-slate-500">
      {label}
      <select name={name} required defaultValue="" className={input}>
        <option value="" disabled>
          Evidence source…
        </option>
        {evidence.map((item) => (
          <option key={item.id} value={item.id}>
            {item.description ?? item.sourceReference ?? item.id}
          </option>
        ))}
      </select>
    </label>
  );
}

export function OperationalDisruptionPanel({
  model,
  evidence,
  canPlan,
  busy,
  run,
}: {
  model: CaseOperationalDisruption | null;
  evidence: WorkspaceEvidence[];
  canPlan: boolean;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [editing, setEditing] = useState<number | null>(null);

  if (model == null) {
    return <p className="text-xs text-slate-500">Loading operational-disruption evidence…</p>;
  }

  return (
    <div className="space-y-3 rounded-xl border border-amber-300/15 bg-amber-300/[0.025] p-4">
      <div className="flex items-start gap-2">
        <Factory className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
        <div>
          <p className="text-xs font-semibold text-slate-200">
            Brownfield operational disruption
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            {model.formula}. Project value comes from an immutable recorded
            evaluation; each deduction carries its own evidence, and outage scope
            uses the canonical site windows.
          </p>
        </div>
      </div>

      {!model.available ? (
        <p className="text-xs text-slate-400">{model.reason}</p>
      ) : model.options.length === 0 ? (
        <p className="text-xs text-slate-400">
          Add a business-case option before modelling operational disruption.
        </p>
      ) : (
        model.options.map((option) => {
          const assessment = option.assessment;
          return (
            <article key={option.id} className="rounded-lg border border-white/8 bg-black/10 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-200">
                  {option.label}{option.isDoNothing ? " · do nothing" : ""}
                </p>
                <span className={assessment ? "text-[11px] text-emerald-300" : "text-[11px] text-amber-300"}>
                  {assessment ? `Revision ${assessment.revision} · complete` : "Model incomplete"}
                </span>
              </div>

              {assessment ? (
                <div className="mt-3 space-y-2">
                  <div className="grid gap-2 sm:grid-cols-5">
                    {[
                      ["Project value", assessment.projectValue],
                      ["Construction disruption", -assessment.constructionDisruption],
                      ["Production loss", -assessment.productionLoss],
                      ["SIMOPS risk", -assessment.simopsRisk],
                      ["Net option value", assessment.netOptionValue],
                    ].map(([term, value], index) => (
                      <div key={String(term)} className={`rounded-lg border p-2 ${index === 4 ? "border-emerald-400/20 bg-emerald-400/[0.04]" : "border-white/8 bg-white/[0.02]"}`}>
                        <p className="text-[10px] text-slate-500">{term}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-200">
                          {money(Number(value), model.currency)}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="flex items-center gap-1 text-[11px] text-slate-400">
                    <Minus className="h-3 w-3" aria-hidden />
                    {assessment.outages.length} recorded outage window{assessment.outages.length === 1 ? "" : "s"}: {assessment.outages.length === 0 ? "none — explicit basis recorded" : assessment.outages.map((outage) => outage.windowKey).join(", ")}
                  </p>
                </div>
              ) : (
                <p className="mt-2 flex items-start gap-1 text-[11px] text-amber-200/80">
                  <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                  Named gaps: {option.missing.join(", ")}. No net option value is shown.
                </p>
              )}

              {canPlan && option.valueEvaluations.length > 0 && (
                <button
                  className="mt-3 text-[11px] font-semibold text-amber-300"
                  onClick={() => setEditing(option.id)}
                >
                  {assessment ? "Record new revision" : "Record disruption model"}
                </button>
              )}
              {canPlan && option.valueEvaluations.length === 0 && (
                <p className="mt-3 text-[11px] text-amber-200/80">
                  Record this option’s value evaluation before its disruption model.
                </p>
              )}

              {editing === option.id && (
                <form
                  className="mt-3 grid gap-3 md:grid-cols-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const data = new FormData(event.currentTarget);
                    void run(() =>
                      recordOptionOperationalDisruption({
                        optionId: option.id,
                        valueEvaluationId: String(data.get("valueEvaluationId") ?? ""),
                        constructionDisruptionCost: Number(data.get("constructionDisruptionCost")),
                        constructionDisruptionBasis: String(data.get("constructionDisruptionBasis") ?? ""),
                        constructionDisruptionEvidenceItemId: String(data.get("constructionDisruptionEvidenceItemId") ?? ""),
                        productionLossCost: Number(data.get("productionLossCost")),
                        productionLossBasis: String(data.get("productionLossBasis") ?? ""),
                        productionLossEvidenceItemId: String(data.get("productionLossEvidenceItemId") ?? ""),
                        simopsRiskCost: Number(data.get("simopsRiskCost")),
                        simopsRiskBasis: String(data.get("simopsRiskBasis") ?? ""),
                        simopsRiskEvidenceItemId: String(data.get("simopsRiskEvidenceItemId") ?? ""),
                        outageWindowIds: data.getAll("outageWindowIds").map(String),
                        outageScopeBasis: String(data.get("outageScopeBasis") ?? ""),
                      }),
                    ).then(() => setEditing(null));
                  }}
                >
                  <label className="space-y-1 text-[10px] uppercase tracking-wide text-slate-500 md:col-span-2">
                    Recorded project-value evaluation
                    <select name="valueEvaluationId" required defaultValue={option.valueEvaluations[0]?.id} className={input}>
                      {option.valueEvaluations.map((evaluation) => (
                        <option key={evaluation.id} value={evaluation.id}>
                          {money(evaluation.projectValue, model.currency)} · {evaluation.uncertaintyLevel} uncertainty · {new Date(evaluation.evaluatedAt).toLocaleDateString()}
                        </option>
                      ))}
                    </select>
                  </label>

                  {[
                    ["constructionDisruption", "Construction disruption"],
                    ["productionLoss", "Production loss"],
                    ["simopsRisk", "SIMOPS risk"],
                  ].map(([key, term]) => (
                    <div key={key} className="space-y-2 rounded-lg border border-white/8 p-3 md:col-span-2">
                      <p className="text-xs font-semibold text-slate-300">{term}</p>
                      <div className="grid gap-2 md:grid-cols-2">
                        <input name={`${key}Cost`} type="number" min="0" step="any" required placeholder={`${term} cost`} className={input} />
                        <EvidenceSelect evidence={evidence} name={`${key}EvidenceItemId`} label={`${term} evidence`} />
                        <input name={`${key}Basis`} required minLength={20} placeholder={`${term} basis and boundary`} className={`${input} md:col-span-2`} />
                      </div>
                    </div>
                  ))}

                  <fieldset className="space-y-2 rounded-lg border border-white/8 p-3 md:col-span-2">
                    <legend className="px-1 text-xs font-semibold text-slate-300">Canonical outage scope</legend>
                    {(model.availableOutageWindows ?? []).length === 0 ? (
                      <p className="text-[11px] text-slate-500">No active outage windows are recorded for the affected site.</p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(model.availableOutageWindows ?? []).map((outage) => (
                          <label key={outage.id} className="flex items-start gap-2 text-[11px] text-slate-300">
                            <input name="outageWindowIds" type="checkbox" value={outage.id} className="mt-0.5" />
                            <span>{outage.windowKey} · {outage.title} · {outage.status}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    <input name="outageScopeBasis" required minLength={20} placeholder="Why these windows are the complete scope, or why none is required" className={input} />
                  </fieldset>

                  <button disabled={busy || evidence.length === 0} className="rounded-lg border border-amber-300/30 px-3 py-2 text-xs font-semibold text-amber-200 disabled:opacity-40">
                    Record governed calculation
                  </button>
                </form>
              )}
            </article>
          );
        })
      )}
      {model.decisionBoundary && (
        <p className="text-[10px] leading-relaxed text-slate-500">{model.decisionBoundary}</p>
      )}
    </div>
  );
}
