import { useState } from "react";
import { Factory, ShieldCheck } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  FORECAST_AUTHORITY,
  PLAN_ROLLUP_BASIS,
  POINT_BASIS,
} from "../lib/production-plan/forecast";
import {
  SAP_PLANNED_ORDER_FIXTURE,
  parseSapPlannedOrderPayload,
  sha256Hex,
} from "../lib/production-plan/sapPlannedOrder";
import {
  listAssetsForContext,
  listSites,
  type AssetOption,
} from "../services/reliabilityCallers";
import {
  forecastProductionPlanLoss,
  getProductionPlanLossForecast,
  recordProductionPlan,
  reviewProductionPlanForecast,
  verifyProductionPlanForecast,
  type ProductionPlanLossPayload,
  type ProductionPlanView,
} from "../services/productionPlanForecastService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const inputClass =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text outline-none focus:border-teal-500";

interface DraftLine {
  key: string;
  assetId: string;
  plannedQuantity: string;
  unitOfMeasure: string;
  windowStart: string;
  windowEnd: string;
  sourceExternalId: string | null;
  material: string | null;
  plant: string | null;
}

function localToIso(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Enter a window start and end.");
  }
  return parsed.toISOString();
}

function formatQuantity(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

export function ProductionPlanLossForecast() {
  const { data, loading, error, refetch } = useAsyncData(async () => {
    const [plans, assets, sites] = await Promise.all([
      getProductionPlanLossForecast(),
      listAssetsForContext(),
      listSites(),
    ]);
    return { plans, assets, sites };
  }, []);
  const [sourceKind, setSourceKind] = useState<
    "human_record" | "sap_s4_planned_order"
  >("human_record");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [sapCanonical, setSapCanonical] = useState<string | null>(null);
  const [planKey, setPlanKey] = useState("");
  const [title, setTitle] = useState("");
  const [basis, setBasis] = useState("");
  const [siteId, setSiteId] = useState("");
  const [historyDays, setHistoryDays] = useState("180");
  const [humanQuantity, setHumanQuantity] = useState("");
  const [humanUnit, setHumanUnit] = useState("");
  const [humanAssetId, setHumanAssetId] = useState("");
  const [humanStart, setHumanStart] = useState("");
  const [humanEnd, setHumanEnd] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  if (loading) return <LoadingState label="Loading production-plan forecast" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return null;

  const loadMockSap = () => {
    const parsed = parseSapPlannedOrderPayload(SAP_PLANNED_ORDER_FIXTURE);
    if (!parsed.ok) {
      setFlash(parsed.error);
      return;
    }
    setSourceKind("sap_s4_planned_order");
    setSapCanonical(parsed.canonical);
    setPlanKey(`sap-${parsed.orders[0]?.plannedOrder ?? "plan"}`);
    setTitle("Reviewed SAP planned-order sample");
    setLines(
      parsed.orders.map((order) => ({
        key: order.plannedOrder,
        assetId: "",
        plannedQuantity: String(order.totalQuantity),
        unitOfMeasure: order.baseUnit,
        windowStart: order.windowStart,
        windowEnd: order.windowEnd,
        sourceExternalId: order.plannedOrder,
        material: order.material,
        plant: order.productionPlant,
      })),
    );
    setFlash(
      "Loaded a local mock of API_PLANNED_ORDERS / A_PlannedOrder. Nothing is sent to SAP. Assign each order to a canonical asset before recording.",
    );
  };

  const addHumanLine = () => {
    if (sourceKind === "sap_s4_planned_order") {
      setFlash(
        "Record the SAP document as its own plan. A human line is a separate plan.",
      );
      return;
    }
    const quantity = Number(humanQuantity);
    if (!humanAssetId || !Number.isFinite(quantity) || quantity <= 0) {
      setFlash("Choose an asset and a positive planned quantity.");
      return;
    }
    if (humanUnit.trim().length < 1 || humanUnit.trim().length > 32) {
      setFlash("Enter the plan's own unit of measure.");
      return;
    }
    let windowStart: string;
    let windowEnd: string;
    try {
      windowStart = localToIso(humanStart);
      windowEnd = localToIso(humanEnd);
    } catch (cause) {
      setFlash((cause as Error).message);
      return;
    }
    if (Date.parse(windowEnd) <= Date.parse(windowStart)) {
      setFlash("The line window end must be after its start.");
      return;
    }
    setLines((current) => [
      ...current,
      {
        key: `${humanAssetId}-${windowStart}`,
        assetId: humanAssetId,
        plannedQuantity: String(quantity),
        unitOfMeasure: humanUnit.trim(),
        windowStart,
        windowEnd,
        sourceExternalId: null,
        material: null,
        plant: null,
      },
    ]);
    setHumanQuantity("");
    setFlash(null);
  };

  const record = async () => {
    if (lines.length === 0) {
      setFlash("Add at least one plan line.");
      return;
    }
    if (lines.some((line) => line.assetId === "")) {
      setFlash("Every planned order still needs a canonical asset.");
      return;
    }
    if (basis.trim().length < 20) {
      setFlash("Record an evidence basis of at least 20 characters.");
      return;
    }
    if (planKey.trim().length < 2 || title.trim().length < 3) {
      setFlash("A plan key and title are required.");
      return;
    }
    setBusy(true);
    setFlash(null);
    try {
      const payloadSha =
        sourceKind === "sap_s4_planned_order" && sapCanonical
          ? await sha256Hex(sapCanonical)
          : null;
      const result = await recordProductionPlan({
        planKey: planKey.trim(),
        title: title.trim(),
        siteId: siteId || null,
        sourceKind,
        payloadSha256: payloadSha,
        basis: basis.trim(),
        lines: lines.map((line) => ({
          assetId: line.assetId,
          plannedQuantity: Number(line.plannedQuantity),
          unitOfMeasure: line.unitOfMeasure,
          windowStart: line.windowStart,
          windowEnd: line.windowEnd,
          sourceExternalId: line.sourceExternalId,
          material: line.material,
          plant: line.plant,
        })),
      });
      setLines([]);
      setSapCanonical(null);
      setSourceKind("human_record");
      setBasis("");
      setFlash(
        result.idempotent === true
          ? "This SAP document was already recorded. The existing plan was kept."
          : "Production plan recorded. It does not release work or book a loss.",
      );
      refetch();
    } catch (cause) {
      setFlash((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const forecast = async (planId: string) => {
    const days = Number(historyDays);
    if (!Number.isInteger(days) || days < 30 || days > 730) {
      setFlash(
        "History days stay between 30 and 730, the existing planning bound.",
      );
      return;
    }
    setBusy(true);
    setFlash(null);
    try {
      await forecastProductionPlanLoss(planId, days);
      setFlash(
        "Draft forecast recorded. It stays counterfactual until the horizon ends and actual production covers every forecasted line.",
      );
      refetch();
    } catch (cause) {
      setFlash((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const review = async (forecastId: string) => {
    const note = (reviewNotes[forecastId] ?? "").trim();
    if (note.length < 20) {
      setFlash("A review note of at least 20 characters is required.");
      return;
    }
    setBusy(true);
    try {
      await reviewProductionPlanForecast(forecastId, note);
      setReviewNotes((current) => ({ ...current, [forecastId]: "" }));
      setFlash(
        "Review recorded. The forecast is still counterfactual, and no work was released.",
      );
      refetch();
    } catch (cause) {
      setFlash((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (forecastId: string) => {
    setBusy(true);
    try {
      const result = await verifyProductionPlanForecast(forecastId);
      setFlash(
        typeof result.refusal === "string"
          ? result.refusal
          : "Verification recorded against actual production. No monetary value was booked.",
      );
      refetch();
    } catch (cause) {
      setFlash((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="production-plan-forecast-heading"
      className="space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3
            id="production-plan-forecast-heading"
            className="flex items-center gap-2 text-base font-semibold text-white"
          >
            <Factory className="h-4 w-4 text-signal-cyan" aria-hidden />
            Production-plan loss forecast
            <span className="font-mono text-[10px] text-slate-600">E3.07</span>
          </h3>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-slate-400">
            {POINT_BASIS} {PLAN_ROLLUP_BASIS}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-teal-500/20 bg-teal-500/5 px-2.5 py-1 text-xs text-teal-300">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Counterfactual until verified
        </span>
      </div>
      <p className="text-xs text-slate-400">
        {FORECAST_AUTHORITY} Nothing is sent to SAP.
      </p>

      {flash && (
        <p
          role="status"
          className="rounded-lg border border-white/10 bg-overlook-deep/60 px-3 py-2 text-xs text-slate-300"
        >
          {flash}
        </p>
      )}

      <div className="rounded-xl border border-white/10 p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-teal-500/30 px-3 py-2 text-sm text-teal-200"
            onClick={loadMockSap}
          >
            Load mocked SAP planned-order sample
          </button>
          <button
            type="button"
            className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300"
            onClick={() => {
              setSourceKind("human_record");
              setLines([]);
              setSapCanonical(null);
              setFlash(null);
            }}
          >
            Record a human plan
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-xs text-slate-400">
            Plan key
            <input
              className={`${inputClass} mt-1`}
              value={planKey}
              onChange={(event) => setPlanKey(event.target.value)}
            />
          </label>
          <label className="text-xs text-slate-400">
            Plan title
            <input
              className={`${inputClass} mt-1`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="text-xs text-slate-400">
            Site
            <select
              className={`${inputClass} mt-1`}
              value={siteId}
              onChange={(event) => setSiteId(event.target.value)}
            >
              <option value="">No site boundary</option>
              {data.sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400 md:col-span-2">
            Evidence basis
            <textarea
              className={`${inputClass} mt-1 min-h-20`}
              value={basis}
              onChange={(event) => setBasis(event.target.value)}
            />
          </label>
        </div>

        {sourceKind === "human_record" && (
          <div className="grid gap-3 md:grid-cols-5">
            <AssetSelect
              assets={data.assets}
              value={humanAssetId}
              label="Asset for the human line"
              onChange={setHumanAssetId}
            />
            <label className="text-xs text-slate-400">
              Planned quantity
              <input
                className={`${inputClass} mt-1`}
                value={humanQuantity}
                onChange={(event) => setHumanQuantity(event.target.value)}
              />
            </label>
            <label className="text-xs text-slate-400">
              Unit
              <input
                className={`${inputClass} mt-1`}
                value={humanUnit}
                onChange={(event) => setHumanUnit(event.target.value)}
              />
            </label>
            <label className="text-xs text-slate-400">
              Window start
              <input
                type="datetime-local"
                className={`${inputClass} mt-1`}
                value={humanStart}
                onChange={(event) => setHumanStart(event.target.value)}
              />
            </label>
            <label className="text-xs text-slate-400">
              Window end
              <input
                type="datetime-local"
                className={`${inputClass} mt-1`}
                value={humanEnd}
                onChange={(event) => setHumanEnd(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 md:col-span-5"
              onClick={addHumanLine}
            >
              Add human line
            </button>
          </div>
        )}

        {lines.length > 0 && (
          <ul className="space-y-2">
            {lines.map((line) => (
              <li
                key={line.key}
                className="grid gap-2 rounded-lg border border-white/10 p-3 md:grid-cols-2"
              >
                <div className="text-sm text-slate-200">
                  {line.sourceExternalId
                    ? `Planned order ${line.sourceExternalId}`
                    : "Human line"}
                  <span className="mt-1 block text-xs text-slate-400">
                    {line.material ? `${line.material} · ` : ""}
                    {line.plant ? `plant ${line.plant} · ` : ""}
                    {line.plannedQuantity} {line.unitOfMeasure}
                  </span>
                </div>
                <AssetSelect
                  assets={data.assets}
                  value={line.assetId}
                  label={
                    line.sourceExternalId
                      ? `Asset for planned order ${line.sourceExternalId}`
                      : "Asset for this line"
                  }
                  onChange={(assetId) =>
                    setLines((current) =>
                      current.map((item) =>
                        item.key === line.key ? { ...item, assetId } : item,
                      ),
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          className="rounded-lg bg-teal-600 px-3 py-2 text-sm text-white disabled:opacity-50"
          disabled={busy}
          onClick={() => void record()}
        >
          Record production plan
        </button>
      </div>

      <PlanList
        payload={data.plans}
        historyDays={historyDays}
        reviewNotes={reviewNotes}
        busy={busy}
        onHistoryDays={setHistoryDays}
        onReviewNote={(forecastId, note) =>
          setReviewNotes((current) => ({ ...current, [forecastId]: note }))
        }
        onForecast={(planId) => void forecast(planId)}
        onReview={(forecastId) => void review(forecastId)}
        onVerify={(forecastId) => void verify(forecastId)}
      />
    </section>
  );
}

function AssetSelect({
  assets,
  value,
  label,
  onChange,
}: {
  assets: AssetOption[];
  value: string;
  label: string;
  onChange: (assetId: string) => void;
}) {
  return (
    <label className="text-xs text-slate-400">
      {label}
      <select
        className={`${inputClass} mt-1`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select a canonical asset</option>
        {assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.asset_tag ? `${asset.asset_tag} · ` : ""}
            {asset.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function PlanList({
  payload,
  historyDays,
  reviewNotes,
  busy,
  onHistoryDays,
  onReviewNote,
  onForecast,
  onReview,
  onVerify,
}: {
  payload: ProductionPlanLossPayload;
  historyDays: string;
  reviewNotes: Record<string, string>;
  busy: boolean;
  onHistoryDays: (value: string) => void;
  onReviewNote: (forecastId: string, note: string) => void;
  onForecast: (planId: string) => void;
  onReview: (forecastId: string) => void;
  onVerify: (forecastId: string) => void;
}) {
  if (payload.plans.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No production plan has been recorded for this tenant.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <label className="block max-w-xs text-xs text-slate-400">
        History days
        <input
          className={`${inputClass} mt-1`}
          value={historyDays}
          onChange={(event) => onHistoryDays(event.target.value)}
        />
      </label>
      {payload.plans.map((plan) => (
        <PlanCard
          key={plan.planId}
          plan={plan}
          note={reviewNotes[plan.forecast?.forecastId ?? ""] ?? ""}
          busy={busy}
          onNote={(note) =>
            plan.forecast && onReviewNote(plan.forecast.forecastId, note)
          }
          onForecast={() => onForecast(plan.planId)}
          onReview={() => plan.forecast && onReview(plan.forecast.forecastId)}
          onVerify={() => plan.forecast && onVerify(plan.forecast.forecastId)}
        />
      ))}
    </div>
  );
}

function PlanCard({
  plan,
  note,
  busy,
  onNote,
  onForecast,
  onReview,
  onVerify,
}: {
  plan: ProductionPlanView;
  note: string;
  busy: boolean;
  onNote: (note: string) => void;
  onForecast: () => void;
  onReview: () => void;
  onVerify: () => void;
}) {
  const forecast = plan.forecast;
  return (
    <article className="rounded-xl border border-white/10 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-white">{plan.title}</h4>
          <p className="text-xs text-slate-400">
            {plan.planKey} ·{" "}
            {plan.sourceKind === "sap_s4_planned_order"
              ? "Reviewed SAP document"
              : "Human record"}
            {plan.superseded ? " · superseded" : ""}
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50"
          disabled={busy || plan.superseded}
          onClick={onForecast}
        >
          Forecast plan loss
        </button>
      </div>
      {forecast ? (
        <div className="space-y-2">
          <p className="text-xs text-teal-200">
            {forecast.verificationState === "verified"
              ? "Verified against actual production"
              : "Counterfactual until verified"}
            {" · "}
            {forecast.planStatus}
            {" · "}
            No monetary value is calculated
          </p>
          <ul className="space-y-1">
            {forecast.byUnit.map((unit) => (
              <li key={unit.unitOfMeasure} className="text-sm text-slate-200">
                {unit.unitOfMeasure}: {formatQuantity(unit.expectedUnitsAtRisk)}{" "}
                at risk of {formatQuantity(unit.plannedQuantityForecast)}{" "}
                planned
                {unit.complete ? "" : " · partial, refused lines excluded"}
              </li>
            ))}
          </ul>
          <ul className="space-y-1">
            {forecast.lines.map((line) => (
              <li key={line.lineNo} className="text-xs text-slate-400">
                {line.assetTag ?? line.assetName ?? line.assetId}:{" "}
                {line.status === "forecast"
                  ? `${formatQuantity(line.expectedUnitsAtRisk)} ${line.unitOfMeasure} at risk`
                  : line.refusal}
                {line.historicalEventLossP50 == null
                  ? ` · P50/P80 withheld (${line.percentileSample} events)`
                  : ` · historical event P50 ${formatQuantity(line.historicalEventLossP50)} / P80 ${formatQuantity(line.historicalEventLossP80)}`}
              </li>
            ))}
          </ul>
          <label className="block text-xs text-slate-400">
            Review note
            <textarea
              className={`${inputClass} mt-1 min-h-16`}
              value={note}
              onChange={(event) => onNote(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50"
              disabled={busy}
              onClick={onReview}
            >
              Review forecast
            </button>
            <button
              type="button"
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-50"
              disabled={busy || forecast.verificationState === "verified"}
              onClick={onVerify}
            >
              Verify against actual production
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-400">
          No forecast has been run for this plan.
        </p>
      )}
    </article>
  );
}
