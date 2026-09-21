import { Bot, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { WorkspaceEvidence } from "../../lib/develop";
import { contractTypeLabel } from "../../lib/develop/procurement";
import {
  runContractStrategyAgent,
  type ContractStrategyAgentResult,
  type ContractStrategyAssessmentInput,
  type ContractStrategyDimension,
} from "../../services/developService";

const DIMENSIONS: {
  key: ContractStrategyDimension;
  label: string;
  help: string;
}[] = [
  {
    key: "definition_maturity",
    label: "Definition maturity",
    help: "How completely is scope and acceptance defined?",
  },
  {
    key: "uncertainty",
    label: "Uncertainty",
    help: "How much technical, quantity or execution uncertainty remains?",
  },
  {
    key: "market_conditions",
    label: "Market conditions",
    help: "How constrained and competitive is the supplier market?",
  },
  {
    key: "owner_capability",
    label: "Owner capability",
    help: "How able is the owner to integrate, direct and assure the work?",
  },
  {
    key: "interface_complexity",
    label: "Interface complexity",
    help: "How many difficult organizational or technical interfaces exist?",
  },
  {
    key: "risk_allocation",
    label: "Risk allocation",
    help: "How transferable and controllable are the material risks?",
  },
];

const emptyAssessment = (): ContractStrategyAssessmentInput =>
  Object.fromEntries(
    DIMENSIONS.map(({ key }) => [
      key,
      { level: "medium", basis: "", evidenceItemId: "" },
    ]),
  ) as ContractStrategyAssessmentInput;

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";

export function ContractStrategyAgentPanel({
  caseId,
  evidence,
  canPlan,
}: {
  caseId: string;
  evidence: WorkspaceEvidence[];
  canPlan: boolean;
}) {
  const [assessment, setAssessment] = useState(emptyAssessment);
  const [result, setResult] = useState<ContractStrategyAgentResult | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = DIMENSIONS.every(
    ({ key }) =>
      assessment[key].basis.trim().length >= 20 &&
      assessment[key].evidenceItemId,
  );

  const update = (
    key: ContractStrategyDimension,
    patch: Partial<ContractStrategyAssessmentInput[ContractStrategyDimension]>,
  ) =>
    setAssessment((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await runContractStrategyAgent({ caseId, assessment, record: true }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="rounded-xl border border-signal-cyan/20 bg-signal-cyan/[0.025] p-4"
      data-testid="contract-strategy-agent"
    >
      <div className="flex items-start gap-2">
        <Bot className="mt-0.5 h-4 w-4 text-signal-cyan" aria-hidden />
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            Contract strategy advisor
          </h3>
           <p className="mt-1 text-xs text-slate-400">
             Compare all seven I.17 strategies against six evidence-backed
             factors before tender. The output is a pending recommendation—not a
             bidder selection, commitment or award.
           </p>
           <p className="mt-1 text-[11px] font-medium text-amber-200">
             AI recommends. Accountable humans decide.
           </p>
        </div>
      </div>

      {canPlan ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {DIMENSIONS.map(({ key, label, help }) => (
            <fieldset
              key={key}
              className="rounded-lg border border-white/8 p-3"
            >
              <legend className="px-1 text-xs font-semibold text-slate-200">
                {label}
              </legend>
              <p className="mb-2 text-[11px] text-slate-500">{help}</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <select
                  value={assessment[key].level}
                  onChange={(event) =>
                    update(key, {
                      level: event.target.value as "low" | "medium" | "high",
                    })
                  }
                  className={inputClass}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <select
                  value={assessment[key].evidenceItemId}
                  onChange={(event) =>
                    update(key, { evidenceItemId: event.target.value })
                  }
                  className={`${inputClass} sm:col-span-2`}
                >
                  <option value="">Evidence from this case…</option>
                  {evidence.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.description ?? item.sourceReference ?? item.id} ·{" "}
                      {item.verificationStatus}
                    </option>
                  ))}
                </select>
                <textarea
                  value={assessment[key].basis}
                  onChange={(event) =>
                    update(key, { basis: event.target.value })
                  }
                  placeholder="State how this evidence supports the rating (20 characters minimum)"
                  className={`${inputClass} min-h-16 sm:col-span-3`}
                />
              </div>
            </fieldset>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">
          A planning, engineering or governance role may request and record this
          advice.
        </p>
      )}

      {error && (
        <p className="mt-3 rounded border border-red-400/30 bg-red-400/10 p-2 text-xs text-red-200">
          {error}
        </p>
      )}
      {canPlan && evidence.length === 0 && (
        <p className="mt-3 rounded border border-amber-400/25 bg-amber-400/5 p-2 text-xs text-amber-200">
          No case evidence is available. Record evidence before requesting a
          strategy recommendation.
        </p>
      )}
      {canPlan && (
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || !ready}
          className="mt-3 rounded-lg bg-signal-cyan/15 px-3 py-2 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/25 disabled:opacity-40"
        >
          {busy
            ? "Evaluating seven strategies…"
            : "Generate and record pending recommendation"}
        </button>
      )}

      {result?.refusal && (
        <p className="mt-3 rounded border border-amber-400/25 bg-amber-400/5 p-2 text-xs text-amber-200">
          {result.refusal}
        </p>
      )}
      {result?.advice && (
        <div className="mt-4 space-y-3 rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-signal-cyan" aria-hidden />
            <strong className="text-slate-100">
              Recommended for human review:{" "}
              {contractTypeLabel(result.advice.recommendedStrategy)}
            </strong>
          </div>
          <p>{result.advice.rationale}</p>
          <p className="text-amber-200">
            Limitations: {result.advice.limitations}
          </p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {result.advice.evaluations.map((item) => (
              <div
                key={item.strategy}
                className="rounded border border-white/8 p-2"
              >
                <p className="font-semibold text-slate-100">
                  {contractTypeLabel(item.strategy)} · {item.fit}
                </p>
                <p className="mt-1 text-slate-400">{item.reason}</p>
              </div>
            ))}
          </div>
          <p className="border-t border-white/8 pt-2 text-slate-500">
            {result.disclaimer}
          </p>
          {result.recorded && (
            <p className="font-medium text-emerald-300">
              Pending recommendation recorded:{" "}
              {result.recorded.recommendationId}
            </p>
          )}
          {result.recordNote && (
            <p className="text-amber-200">{result.recordNote}</p>
          )}
        </div>
      )}
    </div>
  );
}
