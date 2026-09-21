import { useEffect, useState } from "react";
import { Calculator, Save, Send } from "lucide-react";
import {
  PORTFOLIO_CATEGORIES,
  PORTFOLIO_DIMENSIONS,
  configurePortfolioCandidate,
  configurePortfolioCandidateDimensions,
  getEnterprisePortfolioFrontier,
  getEnterprisePortfolioWorkspace,
  proposeEnterprisePortfolioFrontier,
  proposeEnterprisePortfolioPlan,
  runEnterprisePortfolioFrontier,
  runEnterprisePortfolioOptimization,
  type PortfolioCandidate,
  type PortfolioCategory,
  type PortfolioDimensionKey,
  type PortfolioDimensions,
  type PortfolioFrontierRun,
  type PortfolioRun,
  type PortfolioWorkspace,
} from "../services/enterprisePortfolioOptimizationService";

const currentYear = new Date().getUTCFullYear();

const DIMENSION_LABELS: Record<PortfolioDimensionKey, string> = {
  regulatory_necessity: "Regulatory necessity",
  safety_risk: "Safety risk reduction",
  production_benefit: "Production benefit",
  reliability: "Reliability",
  npv: "NPV",
  asset_life: "Asset life",
  sustainability: "Sustainability",
  resource_demand: "Resource demand (lower is better)",
  execution_risk: "Execution risk (lower is better)",
};

function numeric(value: string): number {
  return Number(value.replaceAll(",", ""));
}

function money(value: number, currency: string): string {
  return `${new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 }).format(value)} ${currency}`;
}

function label(value: string): string {
  return value.replaceAll("_", " ");
}

export function EnterprisePortfolioOptimizationPanel() {
  const [year, setYear] = useState(currentYear);
  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState("CAD");
  const [workspace, setWorkspace] = useState<PortfolioWorkspace | null>(null);
  const [editing, setEditing] = useState<PortfolioCandidate | null>(null);
  const [run, setRun] = useState<PortfolioRun | null>(null);
  const [frontierRun, setFrontierRun] = useState<PortfolioFrontierRun | null>(null);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null);
  const [rationale, setRationale] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh(targetYear = year) {
    setBusy(true);
    setMessage(null);
    try {
      const next = await getEnterprisePortfolioWorkspace(targetYear);
      setWorkspace(next);
      const latestFrontier = await getEnterprisePortfolioFrontier(targetYear);
      if (latestFrontier) {
        const restored = {
          ...latestFrontier.outputs,
          calculationRunId: latestFrontier.id,
          refusals: latestFrontier.refusals,
        } as PortfolioFrontierRun;
        setFrontierRun(restored);
        setSelectedPortfolioId(restored.frontier[0]?.portfolioId ?? null);
      } else {
        setFrontierRun(null);
        setSelectedPortfolioId(null);
      }
      if (next.latestRun) {
        setRun({
          ...next.latestRun.outputs,
          calculationRunId: next.latestRun.id,
          refusals: next.latestRun.refusals,
        } as PortfolioRun);
      } else setRun(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Portfolio workspace unavailable");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh(year);
    // The year switch below explicitly refreshes; mount once to avoid duplicate requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveCandidate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage(null);
    try {
      await configurePortfolioCandidate({
        developmentCaseId: editing.developmentCaseId,
        planYear: year,
        category: form.get("category"),
        currency: String(form.get("currency") ?? "").toUpperCase(),
        cost: numeric(String(form.get("cost") ?? "")),
        costLow: numeric(String(form.get("costLow") ?? "")),
        costHigh: numeric(String(form.get("costHigh") ?? "")),
        benefit: numeric(String(form.get("benefit") ?? "")),
        benefitLow: numeric(String(form.get("benefitLow") ?? "")),
        benefitHigh: numeric(String(form.get("benefitHigh") ?? "")),
        benefitProbability: numeric(String(form.get("benefitProbability") ?? "")),
        riskReductionValue: numeric(String(form.get("riskReductionValue") ?? "")),
        mandatory: form.get("mandatory") === "on",
        mandatoryBasis: form.get("mandatoryBasis"),
        earliestStart: form.get("earliestStart"),
        latestStart: form.get("latestStart"),
        durationMonths: numeric(String(form.get("durationMonths") ?? "")),
        evidenceItemId: form.get("evidenceItemId"),
        constraintNote: form.get("constraintNote"),
      });
      const dimensions = Object.fromEntries(
        PORTFOLIO_DIMENSIONS.map((key) => [
          key,
          {
            score: numeric(String(form.get(`${key}Score`) ?? "")),
            basis: String(form.get(`${key}Basis`) ?? ""),
          },
        ]),
      ) as PortfolioDimensions;
      await configurePortfolioCandidateDimensions({
        developmentCaseId: editing.developmentCaseId,
        planYear: year,
        dimensions,
        calibrationNote: String(form.get("dimensionCalibrationNote") ?? ""),
      });
      setEditing(null);
      setMessage("Candidate inputs saved with their evidence reference.");
      await refresh(year);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Candidate could not be saved");
    } finally {
      setBusy(false);
    }
  }

  async function optimize() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await runEnterprisePortfolioOptimization({
        planYear: year,
        budget: numeric(budget),
        currency: currency.toUpperCase(),
      });
      setRun(result);
      setMessage("A governed calculation run was recorded. No funding or sanction occurred.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Optimization could not run");
    } finally {
      setBusy(false);
    }
  }

  async function buildFrontier() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await runEnterprisePortfolioFrontier({
        planYear: year,
        budget: numeric(budget),
        currency: currency.toUpperCase(),
      });
      setFrontierRun(result);
      setSelectedPortfolioId(result.frontier[0]?.portfolioId ?? null);
      setMessage(
        result.frontierCount >= 2
          ? "A governed non-dominated frontier was recorded. No funding or sanction occurred."
          : "The calculation was recorded, but the evidence did not support a multi-portfolio frontier.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Frontier could not run");
    } finally {
      setBusy(false);
    }
  }

  async function propose() {
    if (!run) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await proposeEnterprisePortfolioPlan(run.calculationRunId, rationale);
      setMessage(`Recommendation ${result.recommendationId} is pending human review; no funds were committed.`);
      setRationale("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proposal could not be recorded");
    } finally {
      setBusy(false);
    }
  }

  async function proposeFrontier() {
    if (!frontierRun || !selectedPortfolioId) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await proposeEnterprisePortfolioFrontier(
        frontierRun.calculationRunId,
        selectedPortfolioId,
        rationale,
      );
      setMessage(
        `Portfolio ${result.portfolioId} is pending human review; no funds were committed.`,
      );
      setRationale("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Frontier proposal could not be recorded");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.035] p-5" data-testid="enterprise-portfolio-optimization">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Calculator className="h-5 w-5 text-signal-cyan" aria-hidden />
            Enterprise portfolio optimization
          </h2>
          <p className="mt-1 max-w-4xl text-sm text-slate-300">
            Compare all eleven capital and asset-life categories against one stated budget, recorded timing constraints and evidence-backed uncertainty ranges.
          </p>
        </div>
        <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100">
          Not a funding decision
        </span>
      </header>

      <div className="grid gap-3 md:grid-cols-[9rem_12rem_8rem_auto]">
        <label className="text-xs text-slate-300">Plan year
          <input className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2" type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} />
        </label>
        <label className="text-xs text-slate-300">Portfolio budget
          <input className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2" inputMode="decimal" value={budget} onChange={(event) => setBudget(event.target.value)} placeholder="25000000" />
        </label>
        <label className="text-xs text-slate-300">Currency
          <input className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 uppercase" maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value)} />
        </label>
        <div className="flex items-end gap-2">
          <button className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/5" disabled={busy} onClick={() => void refresh(year)}>Load year</button>
          <button className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200 disabled:opacity-50" disabled={busy || numeric(budget) <= 0} onClick={() => void optimize()}>Run governed optimization</button>
          <button className="rounded-lg bg-signal-cyan px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-50" disabled={busy || numeric(budget) <= 0} onClick={() => void buildFrontier()}>Build nine-dimension frontier</button>
        </div>
      </div>

      {message && <p role="status" className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-200">{message}</p>}

      <div className="overflow-x-auto rounded-xl border border-white/8">
        <table className="min-w-[70rem] text-left text-xs">
          <thead className="border-b border-white/8 bg-white/[0.03] text-slate-400">
            <tr><th className="px-3 py-2">Candidate</th><th>Category</th><th>Cost range</th><th>Benefit range</th><th>Timing</th><th>Evidence</th><th /></tr>
          </thead>
          <tbody>
            {(workspace?.candidates ?? []).map((candidate) => (
              <tr key={candidate.developmentCaseId} className="border-b border-white/6 text-slate-200 last:border-0">
                <td className="px-3 py-2 font-medium">{candidate.title}</td>
                <td>{candidate.category ? label(candidate.category) : "Not configured"}</td>
                <td>{candidate.costLow == null ? "—" : `${candidate.costLow}–${candidate.costHigh} ${candidate.currency}`}</td>
                <td>{candidate.benefitLow == null ? "—" : `${candidate.benefitLow}–${candidate.benefitHigh} ${candidate.currency}`}</td>
                <td>{candidate.earliestStart ?? "—"} → {candidate.latestStart ?? "—"}</td>
                <td className="font-mono text-[10px]">{candidate.evidenceItemId ?? "missing"}</td>
                <td className="px-3 py-2 text-right"><button className="text-signal-cyan hover:underline" onClick={() => setEditing(candidate)}>Configure</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <form onSubmit={saveCandidate} className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-4 md:grid-cols-4">
          <h3 className="md:col-span-4 font-semibold text-white">Configure {editing.title}</h3>
          <Select name="category" label="Category" value={editing.category ?? ""} options={PORTFOLIO_CATEGORIES} />
          <Field name="currency" label="Currency" value={editing.currency ?? currency} />
          <Field name="cost" label="Base cost" value={editing.cost} />
          <Field name="costLow" label="Low cost" value={editing.costLow} />
          <Field name="costHigh" label="High cost" value={editing.costHigh} />
          <Field name="benefit" label="Base benefit PV" value={editing.benefit} />
          <Field name="benefitLow" label="Low benefit PV" value={editing.benefitLow} />
          <Field name="benefitHigh" label="High benefit PV" value={editing.benefitHigh} />
          <Field name="benefitProbability" label="Benefit probability (0–1)" value={editing.benefitProbability} />
          <Field name="riskReductionValue" label="Risk reduction value" value={editing.riskReductionValue} />
          <Field name="earliestStart" label="Earliest start" value={editing.earliestStart} type="date" />
          <Field name="latestStart" label="Latest start" value={editing.latestStart} type="date" />
          <Field name="durationMonths" label="Duration months" value={editing.durationMonths} />
          <Field name="evidenceItemId" label="Verified evidence UUID" value={editing.evidenceItemId} />
          <label className="text-xs text-slate-300">Mandatory
            <input className="ml-2" name="mandatory" type="checkbox" defaultChecked={editing.mandatory ?? false} />
          </label>
          <Field name="mandatoryBasis" label="Mandatory basis" value={editing.mandatoryBasis} />
          <div className="space-y-3 md:col-span-4 rounded-lg border border-cyan-300/15 p-3">
            <div>
              <h4 className="text-sm font-semibold text-white">Nine evidence-backed decision dimensions</h4>
              <p className="mt-1 text-xs text-slate-400">Use one documented 0–100 calibration across every candidate. Higher is better except resource demand and execution risk. Scores are never invented or auto-normalized.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {PORTFOLIO_DIMENSIONS.map((key) => (
                <div key={key} className="space-y-2 rounded-lg border border-white/8 p-3">
                  <Field name={`${key}Score`} label={`${DIMENSION_LABELS[key]} score`} value={editing.portfolioDimensions?.[key]?.score ?? null} type="number" />
                  <label className="block text-xs text-slate-300">{DIMENSION_LABELS[key]} basis
                    <textarea className="mt-1 min-h-20 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2" name={`${key}Basis`} defaultValue={editing.portfolioDimensions?.[key]?.basis ?? ""} required />
                  </label>
                </div>
              ))}
            </div>
            <label className="block text-xs text-slate-300">Dimension calibration note
              <textarea className="mt-1 min-h-20 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2" name="dimensionCalibrationNote" defaultValue={editing.dimensionCalibrationNote ?? ""} required placeholder="Explain who calibrated the common scale, for what decision horizon, and how unlike measures were translated." />
            </label>
          </div>
          <label className="text-xs text-slate-300 md:col-span-4">Constraint note
            <textarea className="mt-1 min-h-20 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2" name="constraintNote" defaultValue={editing.constraintNote ?? ""} required />
          </label>
          <div className="flex gap-2 md:col-span-4">
            <button className="inline-flex items-center gap-2 rounded-lg bg-signal-cyan px-3 py-2 text-xs font-semibold text-slate-950" disabled={busy}><Save className="h-4 w-4" />Save evidence-backed inputs</button>
            <button type="button" className="px-3 py-2 text-xs text-slate-300" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}

      {run && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Metric label="Selected" value={`${run.selectedCount}/${run.candidateCount}`} />
            <Metric label="Base cost" value={money(run.cost.base, run.currency)} />
            <Metric label="High-cost exposure" value={money(run.cost.high, run.currency)} />
            <Metric label="Remaining budget" value={money(run.remainingBudget, run.currency)} />
          </div>
          <p className="text-xs text-slate-400">{run.method}</p>
          <p className="text-xs font-medium text-amber-200">Transparent constrained heuristic; it explicitly does not claim a global mathematical optimum.</p>
          {run.refusals.length > 0 && <ul className="list-disc pl-5 text-xs text-red-200">{run.refusals.map((item) => <li key={item}>{item}</li>)}</ul>}
          <div className="grid gap-4 lg:grid-cols-2">
            <ResultList title="Selected scenario" rows={run.selected.map((item) => `${item.title} · ${label(item.category)} · ${money(item.cost, run.currency)}`)} />
            <ResultList title="Deferred with reason" rows={run.deferred.map((item) => `${item.title} · ${item.reason}`)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <input className="min-w-[20rem] flex-1 rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-xs" value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="Explain the trade-off and why this scenario should enter human review…" />
            <button className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/30 px-3 py-2 text-xs text-cyan-100 disabled:opacity-50" disabled={busy || rationale.trim().length < 30} onClick={() => void propose()}><Send className="h-4 w-4" />Propose for human review</button>
          </div>
        </div>
      )}

      {frontierRun && (
        <div className="space-y-4 rounded-xl border border-cyan-300/20 bg-black/20 p-4" data-testid="portfolio-frontier">
          <div>
            <h3 className="font-semibold text-white">Nine-dimension efficient frontier</h3>
            <p className="mt-1 text-xs text-slate-400">{frontierRun.method}</p>
            <p className="mt-1 text-xs font-medium text-amber-200">Bounded, non-exhaustive decision support. No funding, sanction, risk acceptance or work authorization is created.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Candidates" value={String(frontierRun.candidateCount)} />
            <Metric label="Feasible portfolios sampled" value={String(frontierRun.feasiblePortfolioCount)} />
            <Metric label="Non-dominated frontier" value={String(frontierRun.frontierCount)} />
          </div>
          {frontierRun.refusals.length > 0 && <ul className="list-disc pl-5 text-xs text-red-200">{frontierRun.refusals.map((item) => <li key={item}>{item}</li>)}</ul>}
          <div className="grid gap-3 xl:grid-cols-2">
            {frontierRun.frontier.map((portfolio) => (
              <article key={portfolio.portfolioId} className={`rounded-xl border p-4 ${selectedPortfolioId === portfolio.portfolioId ? "border-cyan-300/50 bg-cyan-300/[0.06]" : "border-white/10"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div><h4 className="font-semibold text-white">{label(portfolio.objective)} portfolio</h4><p className="text-[10px] font-mono text-slate-500">{portfolio.portfolioId}</p></div>
                  <button className="rounded-lg border border-cyan-300/30 px-3 py-1.5 text-xs text-cyan-100" onClick={() => setSelectedPortfolioId(portfolio.portfolioId)}>Choose this portfolio for human review</button>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <Metric label="Projects" value={String(portfolio.selectedCount)} />
                  <Metric label="Base cost" value={money(portfolio.cost.base, frontierRun.currency)} />
                  <Metric label="Risk-adjusted value" value={money(portfolio.riskAdjustedValue.base, frontierRun.currency)} />
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-slate-300">
                  {Object.entries(portfolio.dimensions).map(([key, value]) => <div key={key}><dt className="text-slate-500">{label(key)}</dt><dd>{value}</dd></div>)}
                </dl>
                <ResultList title="Included evidence-backed cases" rows={portfolio.selected.map((item) => `${item.title} · ${money(item.cost, frontierRun.currency)}`)} />
              </article>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <input className="min-w-[20rem] flex-1 rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-xs" value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="Explain the selected frontier trade-off and evidence reviewed…" />
            <button className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/30 px-3 py-2 text-xs text-cyan-100 disabled:opacity-50" disabled={busy || !selectedPortfolioId || rationale.trim().length < 30 || frontierRun.frontierCount < 2} onClick={() => void proposeFrontier()}><Send className="h-4 w-4" />Propose chosen frontier portfolio</button>
          </div>
        </div>
      )}

      <footer className="text-xs text-cyan-50">{workspace?.decisionBoundary ?? "Funding, sanction, risk acceptance and operational authorization remain named-human decisions."}</footer>
    </section>
  );
}

function Field({ name, label: title, value, type = "text" }: { name: string; label: string; value: string | number | null; type?: string }) {
  return <label className="text-xs text-slate-300">{title}<input className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2" name={name} type={type} defaultValue={value ?? ""} required /></label>;
}

function Select({ name, label: title, value, options }: { name: string; label: string; value: string; options: readonly PortfolioCategory[] }) {
  return <label className="text-xs text-slate-300">{title}<select className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2" name={name} defaultValue={value} required><option value="" disabled>Select…</option>{options.map((option) => <option key={option} value={option}>{label(option)}</option>)}</select></label>;
}

function Metric({ label: title, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] uppercase tracking-wide text-slate-500">{title}</p><p className="mt-1 font-semibold text-white">{value}</p></div>;
}

function ResultList({ title, rows }: { title: string; rows: string[] }) {
  return <div><h3 className="text-xs font-semibold text-slate-200">{title}</h3>{rows.length === 0 ? <p className="mt-1 text-xs text-slate-500">None</p> : <ul className="mt-1 space-y-1 text-xs text-slate-300">{rows.map((row) => <li key={row}>{row}</li>)}</ul>}</div>;
}
