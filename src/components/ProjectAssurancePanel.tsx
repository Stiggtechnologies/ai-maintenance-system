import { useEffect, useState } from "react";
import { ChartNoAxesCombined, DatabaseZap, ShieldAlert } from "lucide-react";
import {
  getProjectAssuranceWorkspace,
  recordVerifiedProjectOutcome,
  runProjectAssurance,
  type ProjectAssuranceRun,
  type ProjectAssuranceWorkspace,
} from "../services/projectAssuranceService";

const number = (value: number | undefined, digits = 0) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("en-CA", { maximumFractionDigits: digits }).format(
        value,
      );

export function ProjectAssurancePanel() {
  const [run, setRun] = useState<ProjectAssuranceRun | null>(null);
  const [workspace, setWorkspace] = useState<ProjectAssuranceWorkspace | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setWorkspace(await getProjectAssuranceWorkspace());
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Project assurance workspace unavailable",
      );
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage(null);
    try {
      setRun(
        await runProjectAssurance({
          caseId: String(form.get("caseId")),
          evidenceItemId: String(form.get("evidenceItemId")),
          forecastCost: Number(form.get("forecastCost")),
          forecastDurationDays: Number(form.get("forecastDurationDays")),
          baselineCost: Number(form.get("baselineCost")),
          baselineDurationDays: Number(form.get("baselineDurationDays")),
          complexityRating: Number(form.get("complexityRating")),
          geography: String(form.get("geography")),
          technologyNoveltyRating: Number(form.get("technologyNoveltyRating")),
          executionStrategy: String(form.get("executionStrategy")),
          currency: String(form.get("currency")).toUpperCase(),
        }),
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Assurance run failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function recordOutcome(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setMessage(null);
    try {
      await recordVerifiedProjectOutcome({
        caseId: String(form.get("outcomeCaseId")),
        evidenceItemId: String(form.get("outcomeEvidenceId")),
        baselineCost: Number(form.get("baselineCost")),
        actualCost: Number(form.get("actualCost")),
        baselineDurationDays: Number(form.get("baselineDurationDays")),
        actualDurationDays: Number(form.get("actualDurationDays")),
        currency: String(form.get("outcomeCurrency")).toUpperCase(),
        complexityRating: Number(form.get("outcomeComplexityRating")),
        geography: String(form.get("outcomeGeography")),
        technologyNoveltyRating: Number(
          form.get("outcomeTechnologyNoveltyRating"),
        ),
        executionStrategy: String(form.get("outcomeExecutionStrategy")),
        engineeringMaturityAtExecutionPct: Number(
          form.get("engineeringMaturityAtExecutionPct"),
        ),
        unresolvedVendorDataAtGate: Number(
          form.get("unresolvedVendorDataAtGate"),
        ),
        commissioningDefects: Number(form.get("commissioningDefects")),
        startupDelayDays: Number(form.get("startupDelayDays")),
        safetyIncidentRate: Number(form.get("safetyIncidentRate")),
        startupReliabilityPct: Number(form.get("startupReliabilityPct")),
        engineeringHours: Number(form.get("engineeringHours")),
      });
      setMessage(
        "Verified completed-project outcome added to the governed reference corpus.",
      );
      await refresh();
      formElement.reset();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Outcome could not be recorded",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="space-y-4 rounded-2xl border border-violet-400/20 bg-violet-400/[0.035] p-5"
      data-testid="project-assurance"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <ChartNoAxesCombined className="h-5 w-5 text-violet-300" />
            Project assurance & reference class
          </h2>
          <p className="mt-1 max-w-4xl text-sm text-slate-300">
            Compare a live forecast with verified outcomes from comparable
            completed projects, normalized to each project&apos;s original
            baseline.
          </p>
        </div>
        <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100">
          Advisory—not authorization
        </span>
      </header>
      {workspace?.decisionBoundary && (
        <p className="rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-xs text-slate-300">
          {workspace.decisionBoundary}
        </p>
      )}
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-4">
        <Select
          name="caseId"
          label="Active project"
          options={(workspace?.cases ?? [])
            .filter((c) => !["completed", "cancelled"].includes(c.status))
            .map((c) => ({
              value: c.id,
              label: `${c.title} · ${c.lifecycleType.replaceAll("_", " ")}`,
            }))}
        />
        <Field
          name="baselineCost"
          label="Original cost baseline"
          type="number"
        />
        <Field
          name="forecastCost"
          label="Current cost forecast"
          type="number"
        />
        <Field
          name="baselineDurationDays"
          label="Original duration (days)"
          type="number"
        />
        <Field
          name="forecastDurationDays"
          label="Current duration forecast (days)"
          type="number"
        />
        <Field name="complexityRating" label="Complexity (1–5)" type="number" />
        <Field name="geography" label="Geography / region" />
        <Field
          name="technologyNoveltyRating"
          label="Technology novelty (1–5)"
          type="number"
        />
        <Field name="executionStrategy" label="Execution strategy" />
        <Field name="currency" label="Currency" value="CAD" />
        <Select
          name="evidenceItemId"
          label="Verified forecast evidence"
          options={(workspace?.verifiedEvidence ?? []).map((e) => ({
            value: e.id,
            label: e.description,
          }))}
        />
        <button
          disabled={busy}
          className="md:col-span-4 rounded-lg bg-violet-300 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50"
        >
          Run governed comparison
        </button>
      </form>
      <details className="rounded-xl border border-white/8 bg-black/20 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-white">
          <DatabaseZap className="mr-2 inline h-4 w-4 text-violet-300" />
          Add a verified completed-project outcome
        </summary>
        <form
          onSubmit={recordOutcome}
          className="mt-4 grid gap-3 md:grid-cols-4"
        >
          <Select
            name="outcomeCaseId"
            label="Completed project"
            options={(workspace?.cases ?? [])
              .filter((c) => c.status === "completed" && !c.outcomeRecorded)
              .map((c) => ({ value: c.id, label: c.title }))}
          />
          <Select
            name="outcomeEvidenceId"
            label="Verified outcome evidence"
            options={(workspace?.verifiedEvidence ?? []).map((e) => ({
              value: e.id,
              label: e.description,
            }))}
          />
          <Field name="outcomeCurrency" label="Currency" value="CAD" />
          <span />
          <Field
            name="baselineCost"
            label="Original cost baseline"
            type="number"
          />
          <Field name="actualCost" label="Verified actual cost" type="number" />
          <Field
            name="baselineDurationDays"
            label="Original duration baseline (days)"
            type="number"
          />
          <Field
            name="actualDurationDays"
            label="Verified actual duration (days)"
            type="number"
          />
          <Field
            name="outcomeComplexityRating"
            label="Complexity (1–5)"
            type="number"
          />
          <Field name="outcomeGeography" label="Geography / region" />
          <Field
            name="outcomeTechnologyNoveltyRating"
            label="Technology novelty (1–5)"
            type="number"
          />
          <Field name="outcomeExecutionStrategy" label="Execution strategy" />
          <Field
            name="engineeringMaturityAtExecutionPct"
            label="Engineering maturity at execution (%)"
            type="number"
          />
          <Field
            name="unresolvedVendorDataAtGate"
            label="Unresolved vendor data at gate"
            type="number"
          />
          <Field
            name="commissioningDefects"
            label="Commissioning defects"
            type="number"
          />
          <Field
            name="startupDelayDays"
            label="Startup delay (days)"
            type="number"
          />
          <Field
            name="safetyIncidentRate"
            label="Safety incident rate"
            type="number"
          />
          <Field
            name="startupReliabilityPct"
            label="Startup reliability (%)"
            type="number"
          />
          <Field
            name="engineeringHours"
            label="Engineering hours"
            type="number"
          />
          <button
            disabled={busy}
            className="md:col-span-4 rounded-lg border border-violet-300/30 px-3 py-2 text-xs font-semibold text-violet-100 hover:bg-violet-300/10"
          >
            Record immutable outcome
          </button>
        </form>
      </details>
      {message && (
        <p role="alert" className="text-sm text-red-200">
          {message}
        </p>
      )}
      {run?.status === "refused" && (
        <div className="flex gap-2 rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100">
          <ShieldAlert className="h-5 w-5 shrink-0" />
          <div>
            <strong>Insufficient project history</strong>
            <p>{run.refusals.join(" ")}</p>
          </div>
        </div>
      )}
      {run && run.status !== "refused" && run.referenceForecast && (
        <div className="grid gap-3 md:grid-cols-3">
          <Result
            title="Reference-class forecast"
            body={`Team forecast: ${number(run.referenceForecast.teamCostGrowthPct, 1)}% cost growth and ${number(run.referenceForecast.teamDurationGrowthPct, 1)}% duration growth. Reference cost P50 ${number(run.referenceForecast.costP50)} · P80 ${number(run.referenceForecast.costP80)}; duration P50 ${number(run.referenceForecast.durationDaysP50, 1)} days · P80 ${number(run.referenceForecast.durationDaysP80, 1)} days.`}
          />
          <Result
            title="Normalized benchmark"
            body={`Team cost forecast percentile ${number(run.normalizedBenchmark?.teamForecastCostPercentile, 1)}; duration percentile ${number(run.normalizedBenchmark?.teamForecastDurationPercentile, 1)}. Median startup delay ${number(run.normalizedBenchmark?.medianStartupDelayDays, 1)} days; defects ${number(run.normalizedBenchmark?.medianCommissioningDefects, 1)}; startup reliability ${number(run.normalizedBenchmark?.medianStartupReliabilityPct, 1)}%.`}
          />
          <Result
            title="Evidence boundary"
            body={`${run.sampleSize} completed same-tenant projects. ${run.method}`}
          />
          <div className="md:col-span-3 space-y-2">
            {run.assurancePatterns?.map((pattern) => (
              <Pattern key={pattern.signal} pattern={pattern} />
            ))}
            {run.patternRefusals?.map((refusal) => (
              <p
                key={refusal}
                className="rounded-lg border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100"
              >
                {refusal}
              </p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Field({
  name,
  label,
  type = "text",
  value,
}: {
  name: string;
  label: string;
  type?: string;
  value?: string;
}) {
  return (
    <label className="text-xs text-slate-300">
      {label}
      <input
        required
        name={name}
        type={type}
        defaultValue={value}
        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
      />
    </label>
  );
}
function Select({
  name,
  label,
  options,
}: {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="text-xs text-slate-300">
      {label}
      <select
        required
        name={name}
        defaultValue=""
        className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2"
      >
        <option value="" disabled>
          Select…
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
function Result({ title, body }: { title: string; body: string }) {
  return (
    <article className="rounded-xl border border-white/8 bg-black/20 p-4">
      <h3 className="font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm text-slate-300">{body}</p>
    </article>
  );
}
function Pattern({
  pattern,
}: {
  pattern: Record<string, string | number | boolean>;
}) {
  const body =
    pattern.signal === "engineering_maturity_at_execution"
      ? `Below 80% engineering maturity: ${pattern.lowerMaturityMeanScheduleGrowthPct}% mean schedule growth (${pattern.lowerMaturitySample} projects); at or above 80%: ${pattern.higherMaturityMeanScheduleGrowthPct}% (${pattern.higherMaturitySample}).`
      : `Unresolved vendor data: ${pattern.exposedMeanCommissioningDefects} mean commissioning defects (${pattern.exposedSample} projects); clear at gate: ${pattern.clearMeanCommissioningDefects} (${pattern.clearSample}).`;
  return (
    <p className="rounded-lg border border-white/8 bg-black/20 p-3 text-sm text-slate-200">
      <strong className="text-white">Observed association—not causation</strong>{" "}
      · {body}
    </p>
  );
}
