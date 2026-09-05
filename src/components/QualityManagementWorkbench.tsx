import { useMemo, useState } from "react";
import {
  BadgeCheck,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  FileWarning,
  ShieldCheck,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { QUALITY_METRIC_DEFINITIONS } from "../lib/quality-management";
import {
  executeQualityAction,
  getQualityCockpit,
  type QualityAction,
} from "../services/qualityManagementService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const ACTIONS: Array<{
  key: QualityAction;
  label: string;
  purpose: string;
  example: Record<string, unknown>;
}> = [
  {
    key: "record_requirement",
    label: "Create quality requirement",
    purpose: "Create a sourced, measurable requirement as a draft.",
    example: {
      requirementRef: "QR-001",
      title: "Final dimensional acceptance",
      requirementText:
        "The completed item shall meet the approved drawing dimensions.",
      sourceKind: "design",
      sourceReference: "DWG-100 revision C",
      acceptanceCriterion:
        "All controlled dimensions within drawing tolerance.",
      verificationMethod: "measurement",
      severity: "major",
      assetId: null,
      projectId: null,
      supplierId: null,
      workOrderId: null,
    },
  },
  {
    key: "approve_requirement",
    label: "Approve quality requirement",
    purpose: "Independently approve a draft requirement.",
    example: {
      id: 1,
      note: "Source and measurable acceptance criterion independently verified.",
    },
  },
  {
    key: "record_itp",
    label: "Create ITP",
    purpose:
      "Create an inspection and test plan with review, witness or hold controls.",
    example: {
      itpRef: "ITP-001",
      title: "Fabrication inspection and test plan",
      revision: "A",
      scope: "Fabrication through final release",
      procedureReference: "QP-100 revision A",
      projectId: null,
      assetId: null,
      supplierId: null,
      workOrderId: null,
      points: [
        {
          sequenceNo: 10,
          requirementId: 1,
          controlType: "hold",
          activity: "Final dimensional inspection",
          acceptanceCriterion:
            "All controlled dimensions within drawing tolerance.",
          inspectorRole: "reliability_engineer",
          witnessRole: "admin",
        },
      ],
    },
  },
  {
    key: "approve_itp",
    label: "Approve ITP",
    purpose:
      "Independently approve an ITP after every linked requirement is approved.",
    example: {
      id: 1,
      note: "All points, criteria, roles and linked requirements independently reviewed.",
    },
  },
  {
    key: "inspect_itp_point",
    label: "Record ITP point result",
    purpose:
      "Record pass/fail evidence; hold and witness passes remain blocked for release.",
    example: {
      pointId: 1,
      result: "pass",
      evidenceItemId: "00000000-0000-4000-8000-000000000000",
      note: "Measured result checked against the controlled acceptance criterion.",
    },
  },
  {
    key: "release_itp_point",
    label: "Release hold/witness point",
    purpose:
      "Apply independent hold release, witness attestation, rejection or controlled waiver.",
    example: {
      pointId: 1,
      decision: "release",
      witnessAttested: true,
      note: "Evidence and acceptance result independently checked before release.",
    },
  },
  {
    key: "open_ncr",
    label: "Open NCR",
    purpose:
      "Open a due-dated nonconformance linked to its requirement or control point.",
    example: {
      ncrRef: "NCR-001",
      requirementId: 1,
      itpPointId: null,
      title: "Controlled dimension out of tolerance",
      description: "Measured result exceeds the approved upper tolerance.",
      severity: "major",
      detectedAt: "2026-09-05T12:00:00Z",
      dueAt: "2026-09-12T12:00:00Z",
      ownerId: null,
      projectId: null,
      assetId: null,
      supplierId: null,
      workOrderId: null,
    },
  },
  {
    key: "transition_ncr",
    label: "Advance NCR lifecycle",
    purpose:
      "Contain, disposition, correct, verify, close or cancel through the enforced lifecycle.",
    example: {
      id: 1,
      transition: "contain",
      detail: {
        containmentAction:
          "Affected units segregated and further processing stopped.",
      },
    },
  },
  {
    key: "record_defect",
    label: "Record defect quantities",
    purpose:
      "Capture inspected, defective, first-pass, rework and scrap quantities with evidence.",
    example: {
      defectRef: "DEF-001",
      ncrId: 1,
      requirementId: 1,
      sourceKind: "in_process",
      defectCode: "DIMENSIONAL",
      description: "Controlled dimension above upper limit.",
      inspectedQuantity: 100,
      defectiveQuantity: 4,
      firstPassAcceptedQuantity: 96,
      reworkedQuantity: 3,
      scrappedQuantity: 1,
      repeatDefect: false,
      scrapCost: 250,
      currency: "CAD",
      costSource: "Approved material standard cost",
      evidenceItemId: "00000000-0000-4000-8000-000000000000",
    },
  },
  {
    key: "record_rework",
    label: "Capture rework cost",
    purpose:
      "Classify a canonical work order as rework and capture the sourced cost components.",
    example: {
      defectId: 1,
      workOrderId: "00000000-0000-4000-8000-000000000000",
      startedAt: "2026-09-05T12:00:00Z",
      completedAt: null,
      reworkedQuantity: 3,
      acceptedQuantity: null,
      labourCost: 300,
      materialCost: 150,
      equipmentCost: 75,
      downtimeCost: 600,
      externalCost: 0,
      currency: "CAD",
      costBasis: "Actual time and issued materials",
      costSource: "ERP work-order actuals",
      evidenceItemId: "00000000-0000-4000-8000-000000000000",
    },
  },
  {
    key: "record_acceptance_test",
    label: "Record acceptance test",
    purpose:
      "Add an evidenced acceptance result to the canonical FAT/SAT table.",
    example: {
      projectId: 1,
      requirementId: 1,
      itpId: 1,
      testRef: "FAT-001",
      testStage: "factory_acceptance",
      scheduledOn: "2026-09-05",
      performedOn: "2026-09-05",
      outcome: "pass",
      punchItemsRaised: 0,
      punchItemsOpen: 0,
      witnessedByOwner: true,
      acceptanceCriteria:
        "All controlled test steps pass with no open punch items.",
      testProcedureReference: "FAT-PROC-001 revision B",
      testedSamples: 10,
      passedSamples: 10,
      evidenceItemId: "00000000-0000-4000-8000-000000000000",
    },
  },
  {
    key: "release_acceptance_test",
    label: "Release acceptance test",
    purpose:
      "Independently release only a passed test with zero open punch items.",
    example: {
      id: 1,
      decision: "release",
      note: "Pass result, evidence and zero open punch items independently verified.",
    },
  },
  {
    key: "record_cost",
    label: "Record quality cost",
    purpose:
      "Record prevention, appraisal, internal-failure or external-failure cost with source.",
    example: {
      ncrId: 1,
      defectId: null,
      workOrderId: null,
      incurredAt: "2026-09-05T12:00:00Z",
      category: "external_failure",
      amount: 500,
      currency: "CAD",
      costType: "Customer field correction",
      sourceReference: "Approved invoice INV-001",
      evidenceItemId: null,
    },
  },
];

function displayNumber(value: number | null, suffix = ""): string {
  return value == null ? "—" : `${value.toLocaleString()}${suffix}`;
}

export function QualityManagementWorkbench() {
  const { data, loading, error, refetch } = useAsyncData(getQualityCockpit, []);
  const [action, setAction] = useState<QualityAction>("record_requirement");
  const definition = useMemo(
    () => ACTIONS.find((candidate) => candidate.key === action)!,
    [action],
  );
  const [payload, setPayload] = useState(() =>
    JSON.stringify(ACTIONS[0].example, null, 2),
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  function changeAction(next: QualityAction) {
    const nextDefinition = ACTIONS.find((candidate) => candidate.key === next)!;
    setAction(next);
    setPayload(JSON.stringify(nextDefinition.example, null, 2));
    setActionError(null);
    setResult(null);
  }

  async function execute() {
    setActionError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      setActionError("Payload must be valid JSON.");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setActionError("Payload must be a JSON object.");
      return;
    }
    setBusy(true);
    try {
      const response = await executeQualityAction(
        action,
        parsed as Record<string, unknown>,
      );
      setResult(response);
      refetch();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "Quality action failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data)
    return <LoadingState label="Loading governed quality records…" />;
  if (error && !data) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-cyan-500/12 p-2 text-cyan-300">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">
              Quality management & assurance
            </h2>
            <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">
              Sourced requirements flow through approved ITP review, witness and
              hold points into NCR containment, costed defect/rework, evidenced
              acceptance and independent release. This records quality
              decisions; it does not certify compliance or authorize operation.
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <div
            key={metric.key}
            className="rounded-xl border border-white/7 bg-[#0D1520] p-4"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {metric.label}
            </p>
            <p className="mt-2 text-2xl font-black text-white">
              {displayNumber(metric.value, "%")}
            </p>
            <p className="mt-1 text-[10px] text-slate-500">
              {metric.numerator} / {metric.denominator}
            </p>
          </div>
        ))}
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">
            NCR aging
          </p>
          <p className="mt-2 text-2xl font-black text-white">
            {displayNumber(data.ncrAging.oldestOpenAgeDays, " d")}
          </p>
          <p className="mt-1 text-[10px] text-slate-500">
            Oldest open · {data.ncrAging.overdue} overdue
          </p>
        </div>
      </div>

      <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-5">
        <div className="flex items-center gap-2">
          <CircleDollarSign className="h-4 w-4 text-emerald-300" />
          <h3 className="text-sm font-bold text-white">
            Cost of quality by currency
          </h3>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.costByCurrency.map((cost) => (
            <div
              key={cost.currency}
              className="rounded-xl border border-white/7 bg-white/3 p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300">
                  {cost.currency}
                </span>
                <span className="text-lg font-black text-red-300">
                  {cost.costOfPoorQuality.toLocaleString()}
                </span>
              </div>
              <p className="mt-2 text-[10px] text-slate-500">
                COPQ = internal {cost.internalFailure.toLocaleString()} +
                external {cost.externalFailure.toLocaleString()}
              </p>
              <p className="mt-1 text-[10px] text-slate-500">
                Prevention {cost.prevention.toLocaleString()} · appraisal{" "}
                {cost.appraisal.toLocaleString()} · total quality cost{" "}
                {cost.totalCostOfQuality.toLocaleString()}
              </p>
            </div>
          ))}
          {data.costByCurrency.length === 0 && (
            <p className="text-xs text-slate-500">
              No sourced quality cost has been recorded.
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-5">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-teal-300" />
            <h3 className="text-sm font-bold text-white">
              Controlled quality action
            </h3>
          </div>
          <label className="mt-4 block text-xs font-semibold text-slate-300">
            Action
            <select
              aria-label="Quality action"
              value={action}
              onChange={(event) =>
                changeAction(event.target.value as QualityAction)
              }
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#111C29] px-3 py-2 text-sm text-white"
            >
              {ACTIONS.map((candidate) => (
                <option key={candidate.key} value={candidate.key}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-3 rounded-lg border border-white/6 bg-white/3 p-3 text-xs leading-relaxed text-slate-400">
            {definition.purpose}
          </p>
          <label className="mt-4 block text-xs font-semibold text-slate-300">
            Governed payload
            <textarea
              aria-label="Governed quality payload"
              value={payload}
              onChange={(event) => setPayload(event.target.value)}
              spellCheck={false}
              className="mt-1.5 min-h-80 w-full rounded-xl border border-white/10 bg-[#071019] p-3 font-mono text-xs leading-relaxed text-slate-200"
            />
          </label>
          {actionError && (
            <p className="mt-3 text-xs text-red-300">{actionError}</p>
          )}
          {result && (
            <pre className="mt-3 overflow-auto rounded-lg border border-teal-500/20 bg-teal-500/5 p-3 text-[10px] text-teal-200">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => void execute()}
              disabled={busy}
              className="rounded-lg bg-teal-500 px-4 py-2 text-xs font-bold text-[#04100f] hover:bg-teal-400 disabled:opacity-40"
            >
              {busy ? "Recording…" : "Validate & record"}
            </button>
          </div>
        </section>

        <div className="space-y-5">
          <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-5">
            <div className="flex items-center gap-2">
              <BadgeCheck className="h-4 w-4 text-cyan-300" />
              <h3 className="text-sm font-bold text-white">
                Requirements & ITP controls
              </h3>
            </div>
            <div className="mt-3 space-y-2 text-xs">
              {data.requirements.slice(0, 6).map((item) => (
                <div
                  key={`r-${item.id}`}
                  className="rounded-lg border border-white/7 p-3"
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold text-slate-200">
                      {item.requirement_ref} · {item.title}
                    </span>
                    <span className="text-slate-500">{item.status}</span>
                  </div>
                </div>
              ))}
              {data.itpPoints
                .filter((point) => point.control_type !== "review")
                .slice(0, 6)
                .map((point) => (
                  <div
                    key={`p-${point.id}`}
                    className="rounded-lg border border-amber-500/15 bg-amber-500/4 p-3"
                  >
                    <div className="flex justify-between gap-2">
                      <span className="font-semibold text-amber-200">
                        {point.control_type.toUpperCase()} · {point.activity}
                      </span>
                      <span className="text-slate-500">{point.status}</span>
                    </div>
                  </div>
                ))}
              {data.requirements.length === 0 &&
                data.itpPoints.length === 0 && (
                  <p className="text-slate-500">
                    No requirement or ITP control has been recorded.
                  </p>
                )}
            </div>
          </section>

          <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-5">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-amber-300" />
              <h3 className="text-sm font-bold text-white">NCR aging</h3>
            </div>
            <div className="mt-3 space-y-2">
              {data.ncrs.slice(0, 8).map((ncr) => (
                <div
                  key={ncr.id}
                  className={`rounded-lg border p-3 ${ncr.overdue ? "border-red-500/20 bg-red-500/5" : "border-white/7"}`}
                >
                  <div className="flex justify-between gap-2 text-xs">
                    <span className="font-semibold text-slate-200">
                      {ncr.ncr_ref} · {ncr.title}
                    </span>
                    <span
                      className={
                        ncr.overdue ? "text-red-300" : "text-slate-500"
                      }
                    >
                      {ncr.ageDays} d
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {ncr.severity} · {ncr.status} · due{" "}
                    {new Date(ncr.due_at).toLocaleDateString()}
                  </p>
                </div>
              ))}
              {data.ncrs.length === 0 && (
                <p className="text-xs text-slate-500">
                  No NCR has been recorded.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-white/7 bg-white/2 p-4 text-[11px] leading-relaxed text-slate-500">
            <div className="flex items-center gap-2 text-slate-300">
              <FileWarning className="h-3.5 w-3.5" />
              Calculation basis
            </div>
            <p className="mt-2">{data.basis}</p>
            <p className="mt-2">
              The seven definitions are version-controlled:{" "}
              {QUALITY_METRIC_DEFINITIONS.map((metric) => metric.label).join(
                ", ",
              )}
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
