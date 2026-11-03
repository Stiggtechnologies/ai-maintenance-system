/**
 * E9.04 — record a maintenance budget and forecast it from recorded spend.
 *
 * The page submits the budget and its basis. Actuals and the forecast are
 * computed in the database from labour hours and issued material quantities.
 * The browser never supplies the forecast number.
 */
import { useState, type FormEvent } from "react";
import { Calculator } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getMaintenanceBudgetWorkspace,
  recordMaintenanceBudgetLine,
  refreshMaintenanceBudgetForecast,
  type BudgetLine,
  type BudgetPreview,
} from "../services/maintenanceBudgetService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const CATEGORIES = [
  "labour",
  "materials",
  "contract",
  "capital",
  "overhaul",
  "other",
] as const;

function money(value: number | null, currency: string | null): string {
  if (value === null || !Number.isFinite(value)) return "not forecast";
  const rendered = value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${rendered} ${currency}` : rendered;
}

function PreviewCard({ preview }: { preview: BudgetPreview }) {
  return (
    <article className="rounded-xl border border-white/6 p-3">
      <h4 className="text-sm font-medium capitalize text-white">
        {preview.category}
      </h4>
      <p className="mt-1 font-mono text-sm tabular-nums text-slate-200">
        {preview.forecastable
          ? money(preview.forecast, preview.currency)
          : "Forecast refused"}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">
        {preview.basis}
      </p>
    </article>
  );
}

export function MaintenanceBudgetForecast() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [siteId, setSiteId] = useState("");
  const [category, setCategory] =
    useState<(typeof CATEGORIES)[number]>("labour");
  const [budgeted, setBudgeted] = useState("");
  const [budgetBasis, setBudgetBasis] = useState("");
  const [committed, setCommitted] = useState("0");
  const [committedBasis, setCommittedBasis] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const scope = siteId === "" ? null : siteId;
  const { data, loading, error, refetch } = useAsyncData(
    () => getMaintenanceBudgetWorkspace(year, scope),
    [year, siteId],
  );

  const existing = data?.lines.find(
    (line) => line.category === category && (line.siteId ?? "") === siteId,
  );

  async function onRecord(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setNotice(null);
    const budgetValue = Number(budgeted);
    const committedValue = committed.trim() === "" ? 0 : Number(committed);
    if (!Number.isFinite(budgetValue) || budgetValue < 0) {
      setFormError("Enter a non-negative budgeted amount.");
      return;
    }
    if (budgetBasis.trim().length < 20) {
      setFormError(
        "Describe where the budget figure comes from (20 characters minimum).",
      );
      return;
    }
    setSaving(true);
    try {
      const saved = await recordMaintenanceBudgetLine({
        year,
        category,
        siteId: scope,
        budgeted: budgetValue,
        budgetBasis,
        committed: committedValue,
        committedBasis,
        expectedVersion: existing?.version ?? 0,
      });
      setNotice(
        saved.forecastable
          ? `Recorded version ${saved.version}. Forecast ${money(saved.forecast, saved.currency)}.`
          : `Recorded version ${saved.version}. The forecast was refused and no number was stored.`,
      );
      refetch();
    } catch (caught) {
      setFormError(
        caught instanceof Error
          ? caught.message
          : "The budget was not recorded.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function onRefresh(line: BudgetLine) {
    setFormError(null);
    setNotice(null);
    setSaving(true);
    try {
      const saved = await refreshMaintenanceBudgetForecast({
        year: line.budgetYear,
        category: line.category,
        siteId: line.siteId,
        expectedVersion: line.version,
      });
      setNotice(
        saved.forecastable
          ? `Forecast refreshed to version ${saved.version}.`
          : `Version ${saved.version} records the refusal. No forecast number was stored.`,
      );
      refetch();
    } catch (caught) {
      setFormError(
        caught instanceof Error
          ? caught.message
          : "The forecast was not refreshed.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="budget-forecast-heading" className="space-y-4">
      <div>
        <h3
          id="budget-forecast-heading"
          className="flex items-center gap-2 text-sm font-semibold text-white"
        >
          <Calculator className="h-4 w-4 text-signal-cyan" aria-hidden />
          Maintenance budget forecast
        </h3>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          Record the budget, then forecast labour from completed labour hours
          times the tenant labour-rate assumption and materials from issued
          quantity times recorded unit cost. Categories without a currency-safe
          actual stream are refused. This does not authorize expenditure,
          approve the budget, release work, or read SAP or any other external
          financial system.
        </p>
      </div>

      {loading && <LoadingState label="Loading maintenance budget" />}
      {error && <ErrorState message={error} onRetry={refetch} />}

      {data && (
        <>
          <p className="rounded-xl border border-signal-cyan/20 bg-signal-cyan/5 p-3 text-xs leading-relaxed text-slate-300">
            {data.authority.note}
          </p>

          <div className="flex flex-wrap gap-3">
            <label className="text-xs uppercase tracking-wide text-slate-400">
              Year
              <input
                type="number"
                min={1990}
                max={2100}
                value={year}
                onChange={(event) => setYear(Number(event.target.value))}
                className="mt-1 block w-28 rounded border border-white/10 bg-overlook-deep px-2 py-1 font-mono text-sm text-slate-200"
              />
            </label>
            <label className="text-xs uppercase tracking-wide text-slate-400">
              Scope
              <select
                aria-label="Budget scope"
                value={siteId}
                onChange={(event) => setSiteId(event.target.value)}
                className="mt-1 block rounded border border-white/10 bg-overlook-deep px-2 py-1 text-sm text-slate-200"
              >
                <option value="">Entire organization</option>
                {data.sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {data.previews.map((preview) => (
              <PreviewCard key={preview.category} preview={preview} />
            ))}
          </div>

          <form
            onSubmit={onRecord}
            className="space-y-3 rounded-xl border border-white/6 p-4"
          >
            <h4 className="text-sm font-medium text-white">
              Record budget line
            </h4>
            <div className="flex flex-wrap gap-3">
              <label className="text-xs uppercase tracking-wide text-slate-400">
                Category
                <select
                  aria-label="Budget category"
                  value={category}
                  onChange={(event) =>
                    setCategory(
                      event.target.value as (typeof CATEGORIES)[number],
                    )
                  }
                  className="mt-1 block rounded border border-white/10 bg-overlook-deep px-2 py-1 text-sm capitalize text-slate-200"
                >
                  {CATEGORIES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs uppercase tracking-wide text-slate-400">
                Budgeted
                <input
                  aria-label="Budgeted amount"
                  inputMode="decimal"
                  value={budgeted}
                  onChange={(event) => setBudgeted(event.target.value)}
                  className="mt-1 block w-36 rounded border border-white/10 bg-overlook-deep px-2 py-1 font-mono text-sm text-slate-200"
                />
              </label>
              <label className="text-xs uppercase tracking-wide text-slate-400">
                Committed
                <input
                  aria-label="Committed amount"
                  inputMode="decimal"
                  value={committed}
                  onChange={(event) => setCommitted(event.target.value)}
                  className="mt-1 block w-36 rounded border border-white/10 bg-overlook-deep px-2 py-1 font-mono text-sm text-slate-200"
                />
              </label>
            </div>
            <label className="block text-xs uppercase tracking-wide text-slate-400">
              Budget basis
              <textarea
                aria-label="Budget basis"
                value={budgetBasis}
                onChange={(event) => setBudgetBasis(event.target.value)}
                rows={3}
                className="mt-1 block w-full rounded border border-white/10 bg-overlook-deep px-2 py-1 text-sm normal-case text-slate-200"
              />
            </label>
            <label className="block text-xs uppercase tracking-wide text-slate-400">
              Commitment basis
              <textarea
                aria-label="Commitment basis"
                value={committedBasis}
                onChange={(event) => setCommittedBasis(event.target.value)}
                rows={2}
                className="mt-1 block w-full rounded border border-white/10 bg-overlook-deep px-2 py-1 text-sm normal-case text-slate-200"
              />
            </label>
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-signal-cyan/20 px-3 py-1.5 text-sm text-signal-cyan disabled:opacity-50"
            >
              Record budget and forecast
            </button>
          </form>

          {data.lines.length > 0 && (
            <ul className="space-y-2">
              {data.lines.map((line) => (
                <li
                  key={line.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/6 px-3 py-2 text-sm"
                >
                  <span className="capitalize text-slate-200">
                    {line.category}
                    {line.siteName ? ` · ${line.siteName}` : " · organization"}
                    {" · "}
                    {line.actualMeasured
                      ? `actual ${line.actual}`
                      : "actual not measured by this forecast"}
                    {" · "}
                    {line.forecast === null
                      ? "no stored forecast"
                      : `forecast ${line.forecast}`}
                  </span>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => onRefresh(line)}
                    className="rounded border border-white/10 px-2 py-1 text-xs text-slate-300"
                  >
                    Refresh forecast
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {formError && (
        <p role="alert" className="text-sm text-amber-200">
          {formError}
        </p>
      )}
      {notice && <p className="text-sm text-slate-300">{notice}</p>}
    </section>
  );
}
