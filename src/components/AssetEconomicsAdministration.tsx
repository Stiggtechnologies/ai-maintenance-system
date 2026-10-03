import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeDollarSign, ExternalLink, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import {
  getAssetEconomicsWorkspace,
  recordAssetEconomics,
  type AssetEconomicsSnapshot,
  type AssetEconomicsWorkspace,
} from "../services/assetEconomicsService";

function optionalNumber(values: FormData, name: string) {
  const raw = String(values.get(name) ?? "").trim();
  return raw === "" ? null : Number(raw);
}

function amount(value: number | null, suffix = " USD") {
  return value == null
    ? "Unknown"
    : `${new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 }).format(value)}${suffix}`;
}

function dateInput(value: string | null | undefined) {
  return value?.slice(0, 10) ?? "";
}

const economicFields = [
  ["replacementValueUsd", "Replacement value (USD)", "1"],
  ["annualMaintenanceCostUsd", "Annual maintenance cost (USD)", "1"],
  ["downtimeCostPerHourUsd", "Downtime cost per hour (USD)", "0.01"],
  ["expectedRepairCostUsd", "Expected repair cost (USD)", "1"],
  ["expectedRepairHours", "Expected repair hours", "0.1"],
  ["expectedRemainingLifeYears", "Expected remaining life (years)", "0.1"],
] as const;

export function AssetEconomicsAdministration({
  canEdit,
}: {
  canEdit: boolean;
}) {
  const [workspace, setWorkspace] = useState<AssetEconomicsWorkspace | null>(
    null,
  );
  const [scope, setScope] = useState<"asset" | "asset_class">("asset");
  const [assetId, setAssetId] = useState("");
  const [assetClass, setAssetClass] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setWorkspace(await getAssetEconomicsWorkspace());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The asset economics workspace could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const assetClasses = useMemo(
    () =>
      [...new Set((workspace?.assets ?? []).map((asset) => asset.assetClass))]
        .filter((value): value is string => Boolean(value))
        .sort(),
    [workspace],
  );

  const selectedSnapshot = useMemo(
    () =>
      (workspace?.economics ?? []).find((snapshot) =>
        scope === "asset"
          ? snapshot.assetId === assetId
          : snapshot.assetId == null &&
            snapshot.assetClass?.toLowerCase() === assetClass.toLowerCase(),
      ) ?? null,
    [assetClass, assetId, scope, workspace],
  );

  const applicableEvidence = useMemo(() => {
    const assets = new Map(
      (workspace?.assets ?? []).map((asset) => [asset.id, asset]),
    );
    return (workspace?.verifiedEvidence ?? []).filter((evidence) => {
      if (evidence.assetId == null) return true;
      if (scope === "asset") return evidence.assetId === assetId;
      return (
        assets.get(evidence.assetId)?.assetClass?.toLowerCase() ===
        assetClass.toLowerCase()
      );
    });
  }, [assetClass, assetId, scope, workspace]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await recordAssetEconomics({
        assetId: scope === "asset" ? assetId : null,
        assetClass: scope === "asset_class" ? assetClass : null,
        replacementValueUsd: optionalNumber(values, "replacementValueUsd"),
        annualMaintenanceCostUsd: optionalNumber(
          values,
          "annualMaintenanceCostUsd",
        ),
        downtimeCostPerHourUsd: optionalNumber(
          values,
          "downtimeCostPerHourUsd",
        ),
        expectedRepairCostUsd: optionalNumber(values, "expectedRepairCostUsd"),
        expectedRepairHours: optionalNumber(values, "expectedRepairHours"),
        expectedRemainingLifeYears: optionalNumber(
          values,
          "expectedRemainingLifeYears",
        ),
        basis: String(values.get("basis") ?? ""),
        sourceSystem: String(values.get("sourceSystem") ?? ""),
        evidenceItemId: String(values.get("evidenceItemId") ?? ""),
        effectiveFrom: String(values.get("effectiveFrom") ?? ""),
        reviewDue: String(values.get("reviewDue") ?? "") || null,
        expectedVersion: selectedSnapshot?.version ?? 0,
      });
      if (
        result.expenditureAuthorized !== false ||
        result.projectSanctioned !== false ||
        result.workAuthorized !== false ||
        result.riskAccepted !== false ||
        result.returnToServiceAuthorized !== false
      ) {
        throw new Error("Unexpected authority response from economics writer.");
      }
      setNotice(
        `Economic snapshot version ${result.version} recorded in USD. No expenditure, project, work, risk or return-to-service authority was granted.`,
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The economics snapshot could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  }

  const coverage = workspace?.coverage;

  return (
    <section
      aria-labelledby="asset-economics-title"
      className="space-y-5 rounded-xl border border-white/8 bg-white/[0.02] p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="asset-economics-title"
            className="flex items-center gap-2 text-lg font-semibold text-white"
          >
            <BadgeDollarSign className="h-5 w-5 text-signal-cyan" aria-hidden />
            Asset economics and lifecycle capital plans
          </h2>
          <p className="mt-1 max-w-4xl text-sm text-slate-300">
            Record sourced economic inputs against the canonical asset or class.
            Missing figures remain unknown and dependent options stay unpriced.
          </p>
        </div>
        <Link
          to="/develop/portfolio"
          className="inline-flex items-center gap-1 rounded-lg border border-signal-cyan/30 px-3 py-1.5 text-sm text-signal-cyan hover:bg-signal-cyan/10"
        >
          Open governed capital planning
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      {loading && <p className="text-sm text-slate-400">Loading economics…</p>}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-500/30 p-3 text-sm text-red-200"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-lg border border-emerald-500/30 p-3 text-sm text-emerald-200"
        >
          {notice}
        </p>
      )}

      {!loading && workspace && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ["Assets", coverage?.assets ?? 0],
              ["With economics", coverage?.assetsWithEconomics ?? 0],
              [
                "Complete snapshots",
                coverage?.assetsWithCompleteEconomics ?? 0,
              ],
              ["Overdue reviews", coverage?.overdueReviews ?? 0],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-white/8 p-3">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 font-mono text-xl text-white">{value}</p>
              </div>
            ))}
          </div>

          <p className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-100/80">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {workspace.decisionBoundary}
          </p>

          {canEdit && (
            <form
              key={`${scope}:${assetId}:${assetClass}:${selectedSnapshot?.version ?? 0}`}
              onSubmit={submit}
              className="space-y-4 rounded-xl border border-white/8 p-4"
            >
              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-xs text-slate-400">
                  Scope
                  <select
                    value={scope}
                    onChange={(event) => {
                      setScope(event.target.value as "asset" | "asset_class");
                      setAssetId("");
                      setAssetClass("");
                    }}
                    className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-2 text-sm text-white"
                  >
                    <option value="asset">Exact asset</option>
                    <option value="asset_class">Asset-class fallback</option>
                  </select>
                </label>
                {scope === "asset" ? (
                  <label className="text-xs text-slate-400 md:col-span-2">
                    Asset
                    <select
                      required
                      value={assetId}
                      onChange={(event) => setAssetId(event.target.value)}
                      className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-2 text-sm text-white"
                    >
                      <option value="">Choose an asset</option>
                      {workspace.assets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.name}{" "}
                          {asset.assetClass ? `· ${asset.assetClass}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="text-xs text-slate-400 md:col-span-2">
                    Asset class
                    <select
                      required
                      value={assetClass}
                      onChange={(event) => setAssetClass(event.target.value)}
                      className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-2 text-sm text-white"
                    >
                      <option value="">Choose an asset class</option>
                      {assetClasses.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {economicFields.map(([name, label, step]) => (
                  <label key={name} className="text-xs text-slate-400">
                    {label}
                    <input
                      name={name}
                      type="number"
                      min="0"
                      step={step}
                      defaultValue={selectedSnapshot?.[name] ?? ""}
                      placeholder="Unknown"
                      className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-2 text-sm text-white"
                    />
                  </label>
                ))}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-xs text-slate-400">
                  Source system or reference
                  <input
                    name="sourceSystem"
                    required
                    maxLength={200}
                    defaultValue={selectedSnapshot?.sourceSystem ?? ""}
                    className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-2 text-sm text-white"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Independently verified evidence
                  <select
                    name="evidenceItemId"
                    required
                    defaultValue={selectedSnapshot?.evidenceItemId ?? ""}
                    className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-2 text-sm text-white"
                  >
                    <option value="">Choose verified evidence</option>
                    {applicableEvidence.map((evidence) => (
                      <option key={evidence.id} value={evidence.id}>
                        {evidence.description ??
                          evidence.sourceSystem ??
                          evidence.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  Effective from
                  <input
                    name="effectiveFrom"
                    type="date"
                    required
                    defaultValue={
                      dateInput(selectedSnapshot?.effectiveFrom) ||
                      new Date().toISOString().slice(0, 10)
                    }
                    className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-2 text-sm text-white"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Review due
                  <input
                    name="reviewDue"
                    type="date"
                    defaultValue={dateInput(selectedSnapshot?.reviewDue)}
                    className="mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-2 text-sm text-white"
                  />
                </label>
              </div>
              <label className="block text-xs text-slate-400">
                Economic basis
                <textarea
                  name="basis"
                  required
                  minLength={20}
                  maxLength={4000}
                  defaultValue={selectedSnapshot?.basis ?? ""}
                  className="mt-1 min-h-20 w-full rounded border border-white/10 bg-overlook-deep px-2 py-2 text-sm text-white"
                />
              </label>
              <button
                type="submit"
                disabled={busy || (scope === "asset" ? !assetId : !assetClass)}
                className="rounded-lg bg-signal-cyan px-3 py-2 text-sm font-semibold text-overlook-deep disabled:opacity-50"
              >
                {busy
                  ? "Recording…"
                  : selectedSnapshot
                    ? `Record version ${selectedSnapshot.version + 1}`
                    : "Record economics snapshot"}
              </button>
              <p className="text-xs text-slate-500">
                Inputs are USD because the canonical fields and lifecycle engine
                are explicitly USD. Missing fields remain null, never zero.
              </p>
            </form>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            {workspace.economics.length ? (
              workspace.economics.map((snapshot: AssetEconomicsSnapshot) => (
                <article
                  key={snapshot.id}
                  className="rounded-lg border border-white/8 p-3 text-xs"
                >
                  <div className="flex justify-between gap-3">
                    <strong className="text-slate-100">
                      {snapshot.assetName ?? `${snapshot.assetClass} class`}
                    </strong>
                    <span className="text-slate-500">v{snapshot.version}</span>
                  </div>
                  <p className="mt-2 text-slate-300">
                    Replacement {amount(snapshot.replacementValueUsd)} · annual
                    maintenance {amount(snapshot.annualMaintenanceCostUsd)}
                  </p>
                  <p className="mt-1 text-slate-400">
                    Repair {amount(snapshot.expectedRepairCostUsd)} /{" "}
                    {amount(snapshot.expectedRepairHours, " h")} · remaining
                    life {amount(snapshot.expectedRemainingLifeYears, " yr")}
                  </p>
                  <p className="mt-1 text-slate-400">
                    Downtime {amount(snapshot.downtimeCostPerHourUsd, " USD/h")}
                  </p>
                  <p className="mt-2 text-slate-500">
                    {snapshot.sourceSystem ?? "Legacy source not recorded"} ·{" "}
                    {snapshot.evidenceDescription ??
                      "legacy evidence not linked"}
                  </p>
                </article>
              ))
            ) : (
              <p className="text-sm text-slate-500">
                No tenant economics are recorded.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-white/8 p-3">
            <h3 className="text-sm font-semibold text-white">
              Lifecycle capital-plan visibility
            </h3>
            {workspace.capitalPlans.length ? (
              <ul className="mt-2 space-y-1 text-xs text-slate-300">
                {workspace.capitalPlans.map((plan) => (
                  <li key={plan.planYear}>
                    {plan.planYear}: {plan.itemCount} item(s),{" "}
                    {plan.mandatoryCount} mandatory,{" "}
                    {plan.governedCandidateCount} evidence-backed development
                    candidate(s), {amount(plan.totalCost)} total recorded cost
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                No lifecycle capital-plan items are recorded.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
