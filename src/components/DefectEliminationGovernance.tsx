import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { useAuth } from "./AuthProvider";
import { EmptyState, ErrorState, LoadingState } from "./ui/AsyncStates";
import {
  loadDefectEliminationGovernance,
  recordDefectEliminationGovernance,
  type DefectEliminationBoundaries,
  type DefectEliminationCandidate,
  type DefectEliminationDisposition,
} from "../services/defectEliminationGovernanceService";

const GOVERNANCE_ROLES = new Set([
  "reliability_engineer",
  "maintenance_manager",
  "admin",
]);

const GAP_LABEL: Record<string, string> = {
  missing_fracas: "No retained FRACAS investigation pack for this asset.",
  rca_unassigned: "The FRACAS pack has no named RCA investigator.",
  missing_pm_assessment:
    "No canonical PM-optimization assessment for this asset.",
  unrecognized_pm_recommendation:
    "The PM assessment kind is not a recognized asset-strategy recommendation.",
  missing_weibull:
    "No retained Weibull report includes a life event for this asset.",
  weibull_unidentified:
    "The life-data report did not identify a Weibull fit. Beta and eta were not invented.",
};

const BOUNDARY_LABEL: Record<keyof DefectEliminationBoundaries, string> = {
  mayCreateWork: "Does not create work.",
  mayChangePmInterval: "Does not change a PM interval.",
  mayApproveStrategy: "Does not approve strategy.",
  mayAcceptRisk: "Does not accept risk.",
  mayCommitSpend: "Does not spend.",
  mayReturnToService: "Does not return equipment to service.",
};

const DISPOSITIONS: Array<{
  value: DefectEliminationDisposition;
  label: string;
}> = [
  {
    value: "pursue_elimination",
    label: "Pursue elimination",
  },
  {
    value: "retain_and_monitor",
    label: "Retain and monitor",
  },
  {
    value: "defer_for_evidence",
    label: "Defer for evidence",
  },
];

const field =
  "w-full rounded-lg border border-white/10 bg-industrial-black px-3 py-2 text-sm text-slate-200";

function gapText(code: string): string {
  return GAP_LABEL[code] ?? code;
}

function retainedNumber(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "not identified";
  return value.toLocaleString("en-CA", { maximumFractionDigits: 4 });
}

export function DefectEliminationGovernance() {
  const { profile } = useAuth();
  const role = profile?.role;
  const canGovern = role != null && GOVERNANCE_ROLES.has(role);
  const workspace = useAsyncData(loadDefectEliminationGovernance, []);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [disposition, setDisposition] =
    useState<DefectEliminationDisposition>("defer_for_evidence");
  const [basis, setBasis] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (workspace.loading) {
    return <LoadingState label="Loading defect-elimination governance" />;
  }
  if (workspace.error) {
    return <ErrorState message={workspace.error} onRetry={workspace.refetch} />;
  }

  const data = workspace.data;
  if (!data) {
    return (
      <EmptyState message="Defect-elimination governance did not return a tenant posture." />
    );
  }

  const candidates = data.candidates;
  const selected: DefectEliminationCandidate | null =
    candidates.find((candidate) => candidate.assetId === assetId) ??
    candidates.find((candidate) => candidate.ready) ??
    candidates[0] ??
    null;
  const eliminationAvailable =
    data.elimination.available === true &&
    typeof data.elimination.eliminationRatePct === "number";
  const formReady =
    selected?.ready === true &&
    selected.fracasPackId != null &&
    selected.strategyAssessmentId != null &&
    selected.lifeReportId != null &&
    canGovern &&
    !selected.callerIsInvestigator;

  const record = async () => {
    if (
      !selected?.fracasPackId ||
      !selected.strategyAssessmentId ||
      !selected.lifeReportId
    ) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await recordDefectEliminationGovernance({
        assetId: selected.assetId,
        fracasPackId: selected.fracasPackId,
        strategyAssessmentId: selected.strategyAssessmentId,
        lifeReportId: selected.lifeReportId,
        disposition,
        basis,
      });
      setBasis("");
      setMessage(
        "Governance recorded. It does not create work, change an interval, approve strategy, accept risk, spend or return equipment to service.",
      );
      workspace.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="defect-elimination-governance-heading"
      className="space-y-4 rounded-xl border border-white/6 bg-overlook-deep/40 p-4"
      data-testid="defect-elimination-governance"
    >
      <div>
        <h2
          id="defect-elimination-governance-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <ShieldCheck className="h-5 w-5 text-teal-300" aria-hidden />
          Defect-elimination governance
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">{data.basis}</p>
      </div>

      <ul className="grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
        <li>{data.reuse.fracas}</li>
        <li>{data.reuse.pmOptimization}</li>
        <li>{data.reuse.weibull}</li>
        <li>{data.reuse.elimination}</li>
      </ul>

      <div className="rounded-lg border border-white/8 p-3 text-sm text-slate-300">
        <div className="text-xs uppercase tracking-wide text-slate-500">
          Organization elimination metric
        </div>
        {eliminationAvailable ? (
          <p className="mt-1">
            <span className="text-xl font-semibold tabular-nums text-teal-300">
              {data.elimination.eliminationRatePct}%
            </span>
            <span className="mt-1 block text-xs text-slate-400">
              {data.elimination.basis}
            </span>
          </p>
        ) : (
          <p className="mt-1 text-sm text-slate-400">
            {data.elimination.basis}
          </p>
        )}
      </div>

      <ul className="flex flex-wrap gap-2 text-xs text-slate-400">
        {(
          Object.entries(BOUNDARY_LABEL) as Array<
            [keyof DefectEliminationBoundaries, string]
          >
        ).map(([key, label]) => (
          <li key={key}>
            {data.boundaries[key] === false
              ? label
              : `${label} The server did not confirm this refusal.`}
          </li>
        ))}
      </ul>

      {candidates.length === 0 ? (
        <EmptyState message="No asset in this organization has FRACAS, PM-optimization or Weibull evidence yet. Governance does not invent that evidence." />
      ) : (
        <div className="space-y-3">
          <label
            className="block text-sm text-slate-300"
            htmlFor="defect-elimination-asset"
          >
            Asset
            <select
              id="defect-elimination-asset"
              className={`${field} mt-1`}
              value={selected?.assetId ?? ""}
              onChange={(event) => setAssetId(event.target.value)}
            >
              {candidates.map((candidate) => (
                <option key={candidate.assetId} value={candidate.assetId}>
                  {candidate.assetTag}
                  {candidate.ready ? "" : " — evidence incomplete"}
                </option>
              ))}
            </select>
          </label>

          {selected && (
            <div className="space-y-2 text-sm text-slate-300">
              <p>
                FRACAS {selected.workOrderNumber ?? "pack"} · RCA{" "}
                {selected.investigatorName ?? "unassigned"} · PM{" "}
                {selected.recommendationKind ?? "not assessed"} · Weibull{" "}
                {selected.weibullMethod ?? "not retained"}
                {selected.component ? ` on ${selected.component}` : ""}
              </p>
              {selected.ready &&
                selected.beta != null &&
                selected.eta != null && (
                  <p className="text-xs text-slate-400">
                    Retained fit, not a new calculation: beta{" "}
                    {retainedNumber(selected.beta)}, eta{" "}
                    {retainedNumber(selected.eta)}.
                  </p>
                )}
              {selected.gaps.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm text-signal-gold">
                  {selected.gaps.map((gap) => (
                    <li key={gap}>{gapText(gap)}</li>
                  ))}
                </ul>
              )}
              {selected.callerIsInvestigator && (
                <p className="text-sm text-signal-gold">
                  The assigned RCA investigator cannot govern their own
                  defect-elimination decision.
                </p>
              )}
            </div>
          )}

          {!canGovern && (
            <p className="text-sm text-slate-400">
              Recording a decision requires a named reliability engineer,
              maintenance manager or administrator. The AI operator cannot
              record one.
            </p>
          )}

          {formReady && (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void record();
              }}
            >
              <label
                className="block text-sm text-slate-300"
                htmlFor="defect-elimination-disposition"
              >
                Disposition
                <select
                  id="defect-elimination-disposition"
                  className={`${field} mt-1`}
                  value={disposition}
                  onChange={(event) =>
                    setDisposition(
                      event.target.value as DefectEliminationDisposition,
                    )
                  }
                >
                  {DISPOSITIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label
                className="block text-sm text-slate-300"
                htmlFor="defect-elimination-basis"
              >
                Basis
                <textarea
                  id="defect-elimination-basis"
                  className={`${field} mt-1 min-h-24`}
                  value={basis}
                  onChange={(event) => setBasis(event.target.value)}
                  minLength={20}
                  maxLength={4000}
                  required
                />
              </label>
              <button
                type="submit"
                className="rounded-lg border border-signal-cyan/35 bg-signal-cyan/10 px-3 py-1.5 text-sm font-medium text-signal-cyan disabled:opacity-40"
                disabled={busy || basis.trim().length < 20}
              >
                Record governance decision
              </button>
            </form>
          )}
        </div>
      )}

      {message && (
        <p role="alert" className="text-sm text-slate-200">
          {message}
        </p>
      )}

      {data.decisions.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-white">
            Recorded decisions
          </h3>
          <ul className="space-y-2">
            {data.decisions.map((decision) => (
              <li
                key={decision.id}
                className="rounded-lg border border-white/8 p-3 text-sm text-slate-300"
              >
                <div className="font-medium text-slate-100">
                  {decision.assetTag} ·{" "}
                  {decision.disposition.split("_").join(" ")}
                </div>
                <p className="mt-1">{decision.basisNote}</p>
                <p className="mt-1 text-xs text-slate-500">
                  PM {decision.recommendationKind ?? "unspecified"} · Weibull{" "}
                  {decision.weibullMethod ?? "unspecified"}
                  {decision.component ? ` · ${decision.component}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
