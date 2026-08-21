import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  ClipboardCheck,
  FileSearch,
  Gauge,
  ListChecks,
  Loader2,
  Plus,
  Save,
  ShieldCheck,
  Target,
} from "lucide-react";
import {
  createActionDraft,
  createCriticalityDraft,
  createDecisionDraft,
  createFindingDraft,
  createOpportunityDraft,
  listRiaAuthoringFindings,
  listRiaAuthoringSources,
  recordVerification,
  saveBaselineMetric,
  transitionAssessmentPhase,
  type AssessmentPhase,
  type RiaAuthoringFinding,
  type RiaAuthoringSource,
} from "../../services/riaAuthoring";
import type { EvidenceGrade } from "../../services/riaAssessment";

type Mode =
  | "baseline"
  | "criticality"
  | "finding"
  | "opportunity"
  | "decision"
  | "action"
  | "verification"
  | "phase";

type Props = {
  assessmentId: string;
  currentStatus: string;
  role: string;
  onSaved?: () => void | Promise<void>;
};

const AUTHOR_ROLES = new Set([
  "reliability_engineer",
  "maintenance_manager",
  "admin",
  "ai_admin",
]);

const modes: Array<{
  id: Mode;
  label: string;
  icon: typeof Gauge;
  description: string;
}> = [
  {
    id: "baseline",
    label: "Baseline metric",
    icon: Gauge,
    description: "Record a metric only with its method, population and source fields.",
  },
  {
    id: "criticality",
    label: "Criticality item",
    icon: ShieldCheck,
    description: "Draft an asset criticality classification for human approval.",
  },
  {
    id: "finding",
    label: "Finding",
    icon: FileSearch,
    description: "Draft an evidence-linked engineering finding before publication.",
  },
  {
    id: "opportunity",
    label: "Opportunity",
    icon: BarChart3,
    description: "Record a reliability opportunity; value is optional but must show its working.",
  },
  {
    id: "decision",
    label: "Decision",
    icon: ClipboardCheck,
    description: "Queue a management decision with authority, boundary and verification.",
  },
  {
    id: "action",
    label: "90-day action",
    icon: ListChecks,
    description: "Draft a bounded 30/60/90-day action linked to a finding where applicable.",
  },
  {
    id: "verification",
    label: "Verification",
    icon: Target,
    description: "Record what was observed against the approved baseline and method.",
  },
  {
    id: "phase",
    label: "Assessment phase",
    icon: ShieldCheck,
    description: "Advance the assessment through its governed delivery lifecycle.",
  },
];

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/10 bg-[#07111A] px-3 py-2.5 text-sm text-white outline-hidden placeholder:text-slate-600 focus:border-teal-300/50"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <textarea
        value={value}
        required={required}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full resize-y rounded-lg border border-white/10 bg-[#07111A] px-3 py-2.5 text-sm text-white outline-hidden placeholder:text-slate-600 focus:border-teal-300/50"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-white/10 bg-[#07111A] px-3 py-2.5 text-sm text-white outline-hidden focus:border-teal-300/50"
      >
        {children}
      </select>
    </label>
  );
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function csv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function RiaAnalysisWorkbench({
  assessmentId,
  currentStatus,
  role,
  onSaved,
}: Props) {
  const [mode, setMode] = useState<Mode>("baseline");
  const [sources, setSources] = useState<RiaAuthoringSource[]>([]);
  const [findings, setFindings] = useState<RiaAuthoringFinding[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [metricKey, setMetricKey] = useState("");
  const [metricLabel, setMetricLabel] = useState("");
  const [metricValue, setMetricValue] = useState("");
  const [metricUnit, setMetricUnit] = useState("");
  const [metricMethod, setMetricMethod] = useState("");
  const [metricPopulation, setMetricPopulation] = useState("");
  const [metricSourceFields, setMetricSourceFields] = useState("");
  const [metricExclusions, setMetricExclusions] = useState("");
  const [metricGrade, setMetricGrade] = useState<EvidenceGrade>("unsupported");
  const [metricSourceId, setMetricSourceId] = useState("");

  const [assetRef, setAssetRef] = useState("");
  const [assetName, setAssetName] = useState("");
  const [criticality, setCriticality] = useState<"critical" | "high" | "medium" | "low">("medium");
  const [criticalityRationale, setCriticalityRationale] = useState("");

  const [findingTitle, setFindingTitle] = useState("");
  const [findingStatement, setFindingStatement] = useState("");
  const [findingSeverity, setFindingSeverity] = useState<"critical" | "high" | "moderate" | "low">("moderate");
  const [findingConfidence, setFindingConfidence] = useState<"high" | "medium" | "low">("medium");
  const [findingGrade, setFindingGrade] = useState<EvidenceGrade>("unsupported");
  const [findingBoundary, setFindingBoundary] = useState("");
  const [findingSourceId, setFindingSourceId] = useState("");
  const [findingRecordRef, setFindingRecordRef] = useState("");
  const [findingEvidenceNote, setFindingEvidenceNote] = useState("");
  const [findingProvenance, setFindingProvenance] = useState("");
  const [findingEvidenceConfidence, setFindingEvidenceConfidence] = useState<"high" | "medium" | "low">("medium");

  const [linkedFindingId, setLinkedFindingId] = useState("");
  const [opportunityTitle, setOpportunityTitle] = useState("");
  const [opportunityPriority, setOpportunityPriority] = useState<"critical" | "high" | "medium" | "low">("medium");
  const [opportunityRationale, setOpportunityRationale] = useState("");
  const [opportunityEffort, setOpportunityEffort] = useState<"" | "low" | "medium" | "high">("");
  const [opportunityAction, setOpportunityAction] = useState("");
  const [opportunityOwner, setOpportunityOwner] = useState("");
  const [valueLow, setValueLow] = useState("");
  const [valueHigh, setValueHigh] = useState("");
  const [valueCurrency, setValueCurrency] = useState("USD");
  const [valueMethod, setValueMethod] = useState("");
  const [valueSource, setValueSource] = useState("");
  const [valueAssumptions, setValueAssumptions] = useState("");
  const [valueConfidence, setValueConfidence] = useState<"high" | "medium" | "low">("low");

  const [decisionRequired, setDecisionRequired] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [evidenceSummary, setEvidenceSummary] = useState("");
  const [uncertainty, setUncertainty] = useState("");
  const [authorityRole, setAuthorityRole] = useState("");
  const [decisionBoundary, setDecisionBoundary] = useState("");
  const [decisionVerification, setDecisionVerification] = useState("");
  const [decisionDueOn, setDecisionDueOn] = useState("");

  const [actionHorizon, setActionHorizon] = useState<"day_30" | "day_60" | "day_90">("day_30");
  const [actionText, setActionText] = useState("");
  const [actionOwner, setActionOwner] = useState("");
  const [actionDueOn, setActionDueOn] = useState("");
  const [actionVerification, setActionVerification] = useState("");
  const [actionAuthority, setActionAuthority] = useState("");
  const [actionBoundary, setActionBoundary] = useState("");

  const [verificationCheckpoint, setVerificationCheckpoint] = useState<"day_30" | "day_60" | "day_90">("day_30");
  const [verificationMetric, setVerificationMetric] = useState("");
  const [verificationBaseline, setVerificationBaseline] = useState("");
  const [verificationObserved, setVerificationObserved] = useState("");
  const [verificationMethod, setVerificationMethod] = useState("");
  const [verificationSourceId, setVerificationSourceId] = useState("");
  const [verificationStatus, setVerificationStatus] = useState<"pending" | "supported" | "partially_supported" | "unsupported">("pending");
  const [phase, setPhase] = useState<AssessmentPhase>(currentStatus as AssessmentPhase);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sourceRows, findingRows] = await Promise.all([
          listRiaAuthoringSources(assessmentId),
          listRiaAuthoringFindings(assessmentId),
        ]);
        if (!cancelled) {
          setSources(sourceRows);
          setFindings(findingRows);
        }
      } catch (caught) {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : "Authoring references could not be loaded.");
      } finally {
        if (!cancelled) setLoadingRefs(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assessmentId]);

  const activeMode = useMemo(() => modes.find((item) => item.id === mode)!, [mode]);
  const canAuthor = AUTHOR_ROLES.has(role);
  const hasValue = Boolean(valueLow.trim() || valueHigh.trim());

  if (!canAuthor) {
    return (
      <section className="rounded-xl border border-white/10 bg-[#0B151F] p-5">
        <h2 className="font-semibold text-white">Analysis workbench</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          You can review this assessment, but drafting engineering analysis requires a Reliability Engineer, maintenance manager, or administrator role. The server remains the authority even when the UI is visible.
        </p>
      </section>
    );
  }

  const run = async (action: () => Promise<string | void>, success: string) => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await onSaved?.();
      const [sourceRows, findingRows] = await Promise.all([
        listRiaAuthoringSources(assessmentId),
        listRiaAuthoringFindings(assessmentId),
      ]);
      setSources(sourceRows);
      setFindings(findingRows);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The governed write failed.");
    } finally {
      setSaving(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (mode === "baseline") {
      await run(
        () =>
          saveBaselineMetric({
            assessmentId,
            metricKey: metricKey.trim(),
            label: metricLabel.trim(),
            valueText: metricValue.trim() || null,
            unit: metricUnit.trim() || null,
            method: metricMethod.trim(),
            population: metricPopulation.trim(),
            sourceFields: csv(metricSourceFields),
            exclusions: metricExclusions.trim() || null,
            evidenceGrade: metricGrade,
            evidenceSourceIds: metricSourceId ? [metricSourceId] : [],
          }),
        "Baseline metric saved through the governed assessment contract.",
      );
      return;
    }

    if (mode === "criticality") {
      await run(
        () =>
          createCriticalityDraft({
            assessmentId,
            assetRef: assetRef.trim() || null,
            assetName: assetName.trim(),
            criticality,
            rationale: criticalityRationale.trim(),
          }),
        "Criticality item drafted. It still requires human approval.",
      );
      return;
    }

    if (mode === "finding") {
      await run(
        () =>
          createFindingDraft({
            assessmentId,
            title: findingTitle.trim(),
            statement: findingStatement.trim(),
            severity: findingSeverity,
            confidence: findingConfidence,
            evidenceGrade: findingGrade,
            decisionBoundary: findingBoundary.trim(),
            evidence: findingSourceId
              ? [
                  {
                    dataSourceId: findingSourceId,
                    recordReference: findingRecordRef.trim() || null,
                    note: findingEvidenceNote.trim() || null,
                    provenance: findingProvenance.trim() || null,
                    confidence: findingEvidenceConfidence,
                  },
                ]
              : [],
          }),
        "Finding drafted. It is not customer-published until the publication gate passes.",
      );
      return;
    }

    if (mode === "opportunity") {
      if (hasValue && (!valueLow.trim() || !valueHigh.trim() || !valueMethod.trim() || !valueSource.trim() || !valueAssumptions.trim())) {
        setError("A quantified opportunity requires both range bounds, method, source and assumptions. Remove the values or complete the working.");
        return;
      }
      await run(
        () =>
          createOpportunityDraft({
            assessmentId,
            findingId: linkedFindingId || null,
            title: opportunityTitle.trim(),
            priority: opportunityPriority,
            rationale: opportunityRationale.trim(),
            effort: opportunityEffort || null,
            recommendedAction: opportunityAction.trim() || null,
            owner: opportunityOwner.trim() || null,
            valueLow: parseOptionalNumber(valueLow),
            valueHigh: parseOptionalNumber(valueHigh),
            valueCurrency: hasValue ? valueCurrency.trim() || "USD" : null,
            method: hasValue ? valueMethod.trim() : null,
            valueSource: hasValue ? valueSource.trim() : null,
            assumptions: hasValue ? valueAssumptions.trim() : null,
            confidence: valueConfidence,
          }),
        "Opportunity added to the governed register.",
      );
      return;
    }

    if (mode === "decision") {
      await run(
        () =>
          createDecisionDraft({
            assessmentId,
            findingId: linkedFindingId || null,
            decisionRequired: decisionRequired.trim(),
            recommendation: recommendation.trim(),
            evidenceSummary: evidenceSummary.trim(),
            uncertainty: uncertainty.trim() || null,
            authorityRole: authorityRole.trim(),
            boundary: decisionBoundary.trim(),
            verification: decisionVerification.trim(),
            dueOn: decisionDueOn || null,
          }),
        "Decision queued with its authority, boundary and verification requirement.",
      );
      return;
    }

    if (mode === "action") {
      await run(
        () =>
          createActionDraft({
            assessmentId,
            findingId: linkedFindingId || null,
            horizon: actionHorizon,
            action: actionText.trim(),
            owner: actionOwner.trim() || null,
            dueOn: actionDueOn || null,
            verificationMetric: actionVerification.trim() || null,
            authorityRole: actionAuthority.trim() || null,
            boundary: actionBoundary.trim() || null,
          }),
        "90-day action drafted. Working/closure remains subject to the authority gate.",
      );
      return;
    }

    if (mode === "verification") {
      await run(
        () =>
          recordVerification({
            assessmentId,
            checkpoint: verificationCheckpoint,
            metric: verificationMetric.trim(),
            baseline: verificationBaseline.trim() || null,
            observed: verificationObserved.trim() || null,
            method: verificationMethod.trim(),
            evidenceSourceIds: verificationSourceId ? [verificationSourceId] : [],
            status: verificationStatus,
          }),
        "Verification record saved with server-recorded reviewer authority.",
      );
      return;
    }

    await run(
      () => transitionAssessmentPhase(assessmentId, phase),
      `Assessment phase moved to ${phase.replaceAll("_", " ")}.`,
    );
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-[#0B151F] p-5 sm:p-6" aria-labelledby="ria-analysis-workbench-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Engineer workbench</p>
          <h2 id="ria-analysis-workbench-heading" className="mt-2 text-xl font-semibold text-white">Build the governed assessment record</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            These forms draft analysis into the assessment; they do not bypass publishing, approval, authority or tenancy gates. Missing server contracts fail visibly rather than pretending a save succeeded.
          </p>
        </div>
        {loadingRefs ? (
          <span className="inline-flex items-center gap-2 text-xs text-slate-500"><Loader2 size={14} className="animate-spin" />Loading evidence references…</span>
        ) : null}
      </div>

      <div className="mt-6 flex gap-2 overflow-x-auto pb-2">
        {modes.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setMode(item.id);
                setError("");
                setNotice("");
              }}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${mode === item.id ? "border-teal-300/30 bg-teal-300/10 text-teal-200" : "border-white/10 text-slate-400 hover:bg-white/[0.03] hover:text-white"}`}
            >
              <Icon size={14} />
              {item.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.02] p-4">
        <p className="text-sm font-medium text-slate-200">{activeMode.label}</p>
        <p className="mt-1 text-xs leading-5 text-slate-500">{activeMode.description}</p>
      </div>

      <form onSubmit={submit} className="mt-5 space-y-4">
        {mode === "baseline" && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Input label="Metric key" value={metricKey} onChange={setMetricKey} placeholder="mtbf_hours" required />
              <Input label="Display label" value={metricLabel} onChange={setMetricLabel} placeholder="Mean time between failures" required />
              <Input label="Value" value={metricValue} onChange={setMetricValue} placeholder="Not supportable, or reviewed value" />
              <Input label="Unit" value={metricUnit} onChange={setMetricUnit} placeholder="h" />
            </div>
            <TextArea label="Method / formula" value={metricMethod} onChange={setMetricMethod} required />
            <TextArea label="Population" value={metricPopulation} onChange={setMetricPopulation} placeholder="Assets/time window included" required />
            <Input label="Source fields (comma separated)" value={metricSourceFields} onChange={setMetricSourceFields} placeholder="equipment_id, failure_date, operating_hours" required />
            <TextArea label="Exclusions" value={metricExclusions} onChange={setMetricExclusions} placeholder="Known exclusions or data limitations" />
            <div className="grid gap-4 md:grid-cols-2">
              <Select label="Evidence grade" value={metricGrade} onChange={(v) => setMetricGrade(v as EvidenceGrade)}><option value="unsupported">Unsupported</option><option value="partially_supported">Partially supported</option><option value="supported">Supported</option></Select>
              <Select label="Primary evidence source" value={metricSourceId} onChange={setMetricSourceId}><option value="">No source selected</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.file_name} · {source.category}</option>)}</Select>
            </div>
          </>
        )}

        {mode === "criticality" && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Input label="Asset reference" value={assetRef} onChange={setAssetRef} placeholder="HT-104" />
              <Input label="Asset name" value={assetName} onChange={setAssetName} placeholder="Haul truck 104" required />
              <Select label="Criticality" value={criticality} onChange={(v) => setCriticality(v as typeof criticality)}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select>
            </div>
            <TextArea label="Classification rationale" value={criticalityRationale} onChange={setCriticalityRationale} required />
          </>
        )}

        {mode === "finding" && (
          <>
            <Input label="Finding title" value={findingTitle} onChange={setFindingTitle} required />
            <TextArea label="Finding statement" value={findingStatement} onChange={setFindingStatement} rows={4} required />
            <div className="grid gap-4 md:grid-cols-3">
              <Select label="Severity" value={findingSeverity} onChange={(v) => setFindingSeverity(v as typeof findingSeverity)}><option value="critical">Critical</option><option value="high">High</option><option value="moderate">Moderate</option><option value="low">Low</option></Select>
              <Select label="Confidence" value={findingConfidence} onChange={(v) => setFindingConfidence(v as typeof findingConfidence)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select>
              <Select label="Evidence grade" value={findingGrade} onChange={(v) => setFindingGrade(v as EvidenceGrade)}><option value="unsupported">Unsupported</option><option value="partially_supported">Partially supported</option><option value="supported">Supported</option></Select>
            </div>
            <TextArea label="Decision boundary" value={findingBoundary} onChange={setFindingBoundary} placeholder="What this evidence does and does not justify" required />
            <div className="grid gap-4 md:grid-cols-2">
              <Select label="Evidence source" value={findingSourceId} onChange={setFindingSourceId}><option value="">No evidence attached yet</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.file_name} · {source.category}</option>)}</Select>
              <Input label="Record reference" value={findingRecordRef} onChange={setFindingRecordRef} placeholder="WO 4411–4478 / rows 12,19,55" />
            </div>
            <TextArea label="Evidence note" value={findingEvidenceNote} onChange={setFindingEvidenceNote} />
            <TextArea label="Provenance" value={findingProvenance} onChange={setFindingProvenance} placeholder="How the cited records were extracted / mapped" />
            <Select label="Evidence-link confidence" value={findingEvidenceConfidence} onChange={(v) => setFindingEvidenceConfidence(v as typeof findingEvidenceConfidence)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select>
          </>
        )}

        {(mode === "opportunity" || mode === "decision" || mode === "action") && (
          <Select label="Linked finding (optional)" value={linkedFindingId} onChange={setLinkedFindingId}><option value="">No linked finding</option>{findings.map((finding) => <option key={finding.id} value={finding.id}>{finding.title} · {finding.severity}</option>)}</Select>
        )}

        {mode === "opportunity" && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Input label="Opportunity title" value={opportunityTitle} onChange={setOpportunityTitle} required />
              <Select label="Priority" value={opportunityPriority} onChange={(v) => setOpportunityPriority(v as typeof opportunityPriority)}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select>
            </div>
            <TextArea label="Rationale" value={opportunityRationale} onChange={setOpportunityRationale} required />
            <div className="grid gap-4 md:grid-cols-3">
              <Select label="Effort" value={opportunityEffort} onChange={(v) => setOpportunityEffort(v as typeof opportunityEffort)}><option value="">Not assessed</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></Select>
              <Input label="Owner" value={opportunityOwner} onChange={setOpportunityOwner} />
              <Select label="Value confidence" value={valueConfidence} onChange={(v) => setValueConfidence(v as typeof valueConfidence)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select>
            </div>
            <TextArea label="Recommended action" value={opportunityAction} onChange={setOpportunityAction} />
            <div className="rounded-xl border border-white/10 p-4">
              <p className="text-sm font-medium text-white">Optional value range</p>
              <p className="mt-1 text-xs text-slate-500">Leave both bounds blank if value is not yet defensible. If a number is entered, method, source and assumptions become mandatory.</p>
              <div className="mt-4 grid gap-4 md:grid-cols-3"><Input label="Low" value={valueLow} onChange={setValueLow} type="number" /><Input label="High" value={valueHigh} onChange={setValueHigh} type="number" /><Input label="Currency" value={valueCurrency} onChange={setValueCurrency} /></div>
              <div className="mt-4 grid gap-4 md:grid-cols-2"><TextArea label="Value method" value={valueMethod} onChange={setValueMethod} /><TextArea label="Value source" value={valueSource} onChange={setValueSource} /></div>
              <div className="mt-4"><TextArea label="Assumptions" value={valueAssumptions} onChange={setValueAssumptions} /></div>
            </div>
          </>
        )}

        {mode === "decision" && (
          <>
            <TextArea label="Decision required" value={decisionRequired} onChange={setDecisionRequired} required />
            <TextArea label="Recommendation" value={recommendation} onChange={setRecommendation} required />
            <TextArea label="Evidence summary" value={evidenceSummary} onChange={setEvidenceSummary} required />
            <TextArea label="Uncertainty" value={uncertainty} onChange={setUncertainty} />
            <div className="grid gap-4 md:grid-cols-2"><Input label="Authority role" value={authorityRole} onChange={setAuthorityRole} required /><Input label="Due date" value={decisionDueOn} onChange={setDecisionDueOn} type="date" /></div>
            <TextArea label="Decision boundary" value={decisionBoundary} onChange={setDecisionBoundary} required />
            <TextArea label="Verification required" value={decisionVerification} onChange={setDecisionVerification} required />
          </>
        )}

        {mode === "action" && (
          <>
            <Select label="Horizon" value={actionHorizon} onChange={(v) => setActionHorizon(v as typeof actionHorizon)}><option value="day_30">Day 30</option><option value="day_60">Day 60</option><option value="day_90">Day 90</option></Select>
            <TextArea label="Action" value={actionText} onChange={setActionText} required />
            <div className="grid gap-4 md:grid-cols-2"><Input label="Owner" value={actionOwner} onChange={setActionOwner} /><Input label="Due date" value={actionDueOn} onChange={setActionDueOn} type="date" /></div>
            <Input label="Verification metric" value={actionVerification} onChange={setActionVerification} />
            <div className="grid gap-4 md:grid-cols-2"><Input label="Authority role" value={actionAuthority} onChange={setActionAuthority} /><Input label="Boundary" value={actionBoundary} onChange={setActionBoundary} /></div>
          </>
        )}

        {mode === "verification" && (
          <>
            <div className="grid gap-4 md:grid-cols-2"><Select label="Checkpoint" value={verificationCheckpoint} onChange={(v) => setVerificationCheckpoint(v as typeof verificationCheckpoint)}><option value="day_30">Day 30</option><option value="day_60">Day 60</option><option value="day_90">Day 90</option></Select><Select label="Evidence conclusion" value={verificationStatus} onChange={(v) => setVerificationStatus(v as typeof verificationStatus)}><option value="pending">Pending</option><option value="supported">Supported</option><option value="partially_supported">Partially supported</option><option value="unsupported">Unsupported</option></Select></div>
            <Input label="Metric" value={verificationMetric} onChange={setVerificationMetric} required />
            <div className="grid gap-4 md:grid-cols-2"><Input label="Baseline" value={verificationBaseline} onChange={setVerificationBaseline} /><Input label="Observed" value={verificationObserved} onChange={setVerificationObserved} /></div>
            <TextArea label="Verification method" value={verificationMethod} onChange={setVerificationMethod} required />
            <Select label="Evidence source" value={verificationSourceId} onChange={setVerificationSourceId}><option value="">No source selected</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.file_name} · {source.category}</option>)}</Select>
          </>
        )}

        {mode === "phase" && (
          <>
            <Select label="Assessment phase" value={phase} onChange={(v) => setPhase(v as AssessmentPhase)}><option value="active">Active / intake</option><option value="analysis">Analysis</option><option value="customer_review">Customer review</option><option value="verification">Verification</option><option value="complete">Complete</option><option value="closed">Closed</option></Select>
            <p className="rounded-lg border border-amber-300/20 bg-amber-300/5 px-4 py-3 text-xs leading-5 text-amber-100">Phase transition is a governed server action. The server may refuse a transition when required evidence, approvals, decisions or verification are incomplete.</p>
          </>
        )}

        {error ? <div className="rounded-lg border border-red-300/20 bg-red-300/5 px-4 py-3 text-sm text-red-200" role="alert">{error}</div> : null}
        {notice ? <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/5 px-4 py-3 text-sm text-emerald-200" role="status">{notice}</div> : null}

        <div className="flex justify-end border-t border-white/8 pt-4">
          <button type="submit" disabled={saving || loadingRefs} className="inline-flex items-center gap-2 rounded-lg bg-teal-300 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-40">
            {saving ? <Loader2 size={16} className="animate-spin" /> : mode === "phase" ? <Save size={16} /> : <Plus size={16} />}
            {saving ? "Saving…" : mode === "phase" ? "Request phase transition" : `Save ${activeMode.label.toLowerCase()}`}
          </button>
        </div>
      </form>
    </section>
  );
}

export default RiaAnalysisWorkbench;
