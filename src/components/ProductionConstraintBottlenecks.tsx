import { useEffect, useState } from "react";
import { GitBranch, ShieldCheck } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  CONSTRAINT_KINDS,
  studyInputError,
  type ConstraintKind,
  type StudyDraft,
} from "../lib/production-constraints/bottleneck";
import {
  listConstraintAssets,
  loadProductionConstraintWorkspace,
  recordProductionConstraintStudy,
  type ConstraintAssetOption,
  type ConstraintLimitInput,
  type ProductionConstraintStudy,
  type ProductionConstraintWorkspace,
} from "../services/productionConstraintService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const REASON_TEXT: Record<string, string> = {
  no_limits_declared: "No limit was declared. That is not spare capacity.",
  mixed_units: "Limits use more than one unit, so none of them were ranked.",
  unquantified_limit:
    "A declared limit has no quantity, so none of the limits were ranked.",
};

const emptyLimit = (unit: string): ConstraintLimitInput => ({
  key: "",
  kind: "equipment",
  availableQuantity: "",
  unitOfMeasure: unit,
  basis: "",
  assetId: null,
  constraintSignalId: null,
});

function toIso(localValue: string): string {
  const parsed = new Date(localValue);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : localValue;
}

export function ProductionConstraintBottlenecks() {
  const { data, loading, error, refetch } =
    useAsyncData<ProductionConstraintWorkspace>(
      loadProductionConstraintWorkspace,
      [],
      { isEmpty: () => false },
    );
  const [title, setTitle] = useState("");
  const [siteId, setSiteId] = useState("");
  const [horizonStart, setHorizonStart] = useState("");
  const [horizonEnd, setHorizonEnd] = useState("");
  const [requiredQuantity, setRequiredQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [basis, setBasis] = useState("");
  const [limits, setLimits] = useState<ConstraintLimitInput[]>([
    emptyLimit(""),
  ]);
  const [assets, setAssets] = useState<ConstraintAssetOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!siteId) {
      setAssets([]);
      return;
    }
    let cancelled = false;
    listConstraintAssets(siteId)
      .then((rows) => {
        if (!cancelled) setAssets(rows);
      })
      .catch(() => {
        if (!cancelled) setAssets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [siteId]);

  if (loading)
    return <LoadingState label="Loading production constraint studies" />;
  if (error || !data)
    return (
      <ErrorState message={error ?? "No study response."} onRetry={refetch} />
    );

  const updateLimit = (index: number, patch: Partial<ConstraintLimitInput>) => {
    setLimits((current) =>
      current.map((limit, position) =>
        position === index ? { ...limit, ...patch } : limit,
      ),
    );
  };

  const submit = async () => {
    const draft: StudyDraft = {
      title,
      siteId,
      horizonStart: horizonStart ? toIso(horizonStart) : "",
      horizonEnd: horizonEnd ? toIso(horizonEnd) : "",
      requiredQuantity,
      unitOfMeasure: unit,
      basis,
      limits: limits.map((limit) => ({
        ...limit,
        availableQuantity: limit.availableQuantity?.trim()
          ? limit.availableQuantity
          : null,
      })),
    };
    const problem = studyInputError(draft);
    if (problem) {
      setFlash(problem);
      return;
    }
    setBusy(true);
    setFlash(null);
    try {
      const saved = await recordProductionConstraintStudy({
        ...draft,
        horizonStart: draft.horizonStart,
        horizonEnd: draft.horizonEnd,
        limits: draft.limits,
      });
      setFlash(
        saved.idempotent
          ? "This exact study was already recorded. The original snapshot is unchanged."
          : saved.study.assessable
            ? "Study recorded. The bottleneck is the lowest declared limit, not a sum."
            : "Study recorded as not assessable. Missing or conflicting limits were not treated as spare capacity.",
      );
      setTitle("");
      setBasis("");
      setLimits([emptyLimit(unit)]);
      refetch();
    } catch (cause) {
      setFlash(
        cause instanceof Error ? cause.message : "The study was refused.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="production-constraint-heading"
      className="space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3
            id="production-constraint-heading"
            className="flex items-center gap-2 text-base font-semibold text-white"
          >
            <GitBranch className="h-4.5 w-4.5 text-signal-cyan" aria-hidden />
            Production constraints and bottlenecks
            <span className="font-mono text-[10px] text-slate-600">E3.04</span>
          </h3>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-slate-400">
            {data.method} Demonstrated production is shown as coverage and is
            never used as the limit. No operating limit is invented.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-teal-500/20 bg-teal-500/5 px-2.5 py-1 text-xs text-teal-300">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Named human · no release
        </span>
      </div>

      {flash && (
        <p
          role="status"
          className="rounded-lg border border-white/10 bg-overlook-deep/60 px-3 py-2 text-xs text-slate-300"
        >
          {flash}
        </p>
      )}

      {data.studies.length === 0 ? (
        <p className="text-sm text-slate-400">
          No production-constraint study has been recorded for this tenant.
        </p>
      ) : (
        <ul className="space-y-3">
          {data.studies.map((study) => (
            <StudyCard key={study.id} study={study} />
          ))}
        </ul>
      )}

      <form
        className="space-y-3 rounded-xl border border-white/10 bg-white/2 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h4 className="text-sm font-medium text-white">
          Record a constraint study
        </h4>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block text-xs text-slate-400">
            Study title
            <input
              className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-white"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="block text-xs text-slate-400">
            Site
            <select
              className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-white"
              value={siteId}
              onChange={(event) => setSiteId(event.target.value)}
            >
              <option value="">Choose a site</option>
              {data.sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-slate-400">
            Horizon start
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-white"
              value={horizonStart}
              onChange={(event) => setHorizonStart(event.target.value)}
            />
          </label>
          <label className="block text-xs text-slate-400">
            Horizon end
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-white"
              value={horizonEnd}
              onChange={(event) => setHorizonEnd(event.target.value)}
            />
          </label>
          <label className="block text-xs text-slate-400">
            Required quantity
            <input
              inputMode="decimal"
              className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-white"
              value={requiredQuantity}
              onChange={(event) => setRequiredQuantity(event.target.value)}
            />
          </label>
          <label className="block text-xs text-slate-400">
            Unit of measure
            <input
              className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-white"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
            />
          </label>
        </div>
        <label className="block text-xs text-slate-400">
          Evidence basis
          <textarea
            className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-white"
            rows={2}
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
          />
        </label>

        <div className="space-y-3">
          {limits.map((limit, index) => (
            <fieldset
              key={index}
              className="space-y-2 rounded-lg border border-white/8 p-3"
            >
              <legend className="px-1 text-xs text-slate-300">
                Limit {index + 1}
              </legend>
              <div className="grid gap-2 md:grid-cols-3">
                <label className="block text-xs text-slate-400">
                  Constraint key
                  <input
                    aria-label={`Constraint key ${index + 1}`}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-white"
                    value={limit.key}
                    onChange={(event) =>
                      updateLimit(index, { key: event.target.value })
                    }
                  />
                </label>
                <label className="block text-xs text-slate-400">
                  Kind
                  <select
                    aria-label={`Constraint kind ${index + 1}`}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-white"
                    value={limit.kind}
                    onChange={(event) =>
                      updateLimit(index, {
                        kind: event.target.value as ConstraintKind,
                      })
                    }
                  >
                    {CONSTRAINT_KINDS.map(([kind, label]) => (
                      <option key={kind} value={kind}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-slate-400">
                  Available quantity
                  <input
                    aria-label={`Available quantity ${index + 1}`}
                    inputMode="decimal"
                    placeholder="Blank if unknown"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-white"
                    value={limit.availableQuantity ?? ""}
                    onChange={(event) =>
                      updateLimit(index, {
                        availableQuantity: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="block text-xs text-slate-400">
                  Limit unit
                  <input
                    aria-label={`Limit unit ${index + 1}`}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-white"
                    value={limit.unitOfMeasure}
                    onChange={(event) =>
                      updateLimit(index, { unitOfMeasure: event.target.value })
                    }
                  />
                </label>
                <label className="block text-xs text-slate-400">
                  Asset
                  <select
                    aria-label={`Asset ${index + 1}`}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-white"
                    value={limit.assetId ?? ""}
                    onChange={(event) =>
                      updateLimit(index, {
                        assetId: event.target.value || null,
                      })
                    }
                  >
                    <option value="">Site level</option>
                    {assets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.assetTag ? `${asset.assetTag} · ` : ""}
                        {asset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-slate-400">
                  Signal id
                  <input
                    aria-label={`Signal id ${index + 1}`}
                    placeholder="Optional provenance"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-white"
                    value={limit.constraintSignalId ?? ""}
                    onChange={(event) =>
                      updateLimit(index, {
                        constraintSignalId: event.target.value || null,
                      })
                    }
                  />
                </label>
              </div>
              <label className="block text-xs text-slate-400">
                Limit basis
                <textarea
                  aria-label={`Limit basis ${index + 1}`}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-overlook-deep px-3 py-2 text-sm text-white"
                  rows={2}
                  value={limit.basis}
                  onChange={(event) =>
                    updateLimit(index, { basis: event.target.value })
                  }
                />
              </label>
              <button
                type="button"
                className="text-xs text-slate-400 underline"
                onClick={() =>
                  setLimits((current) =>
                    current.filter((_, position) => position !== index),
                  )
                }
              >
                Remove limit {index + 1}
              </button>
            </fieldset>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200"
            onClick={() =>
              setLimits((current) => [...current, emptyLimit(unit)])
            }
          >
            Add limit
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-signal-cyan/20 px-3 py-2 text-xs font-medium text-cyan-100 disabled:opacity-50"
          >
            Record constraint study
          </button>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">
          A signal id cites canonical operational-constraint evidence. Its
          available or unavailable state is not turned into a quantity.{" "}
          {data.authority}
        </p>
      </form>
    </section>
  );
}

function StudyCard({ study }: { study: ProductionConstraintStudy }) {
  const result = study.result;
  const headroom = result.headroom;
  const headroomLabel =
    headroom === null
      ? null
      : headroom.startsWith("-")
        ? `${headroom.slice(1)} ${study.unitOfMeasure} short`
        : `${headroom} ${study.unitOfMeasure} of room`;
  return (
    <li className="rounded-xl border border-white/10 bg-white/2 p-4 text-sm text-slate-200">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-medium text-white">{study.title}</h4>
        <span className="text-xs text-slate-400">{study.siteName}</span>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Required {study.requiredQuantity} {study.unitOfMeasure}
        {study.assessable && result.primaryKey
          ? ` · bottleneck ${result.primaryKey}`
          : " · not assessable"}
        {result.binding === true ? " · binding" : ""}
        {result.binding === false ? " · covers the requirement" : ""}
        {headroomLabel ? ` · ${headroomLabel}` : ""}
      </p>
      {!study.assessable && (
        <ul className="mt-2 list-disc pl-4 text-xs text-amber-200/90">
          {result.reasons.map((reason) => (
            <li key={reason}>{REASON_TEXT[reason] ?? reason}</li>
          ))}
        </ul>
      )}
      {study.assessable && result.bottleneckKeys.length > 1 && (
        <p className="mt-2 text-xs text-slate-300">
          Tied bottlenecks: {result.bottleneckKeys.join(", ")}
        </p>
      )}
      <p className="mt-2 text-xs text-slate-500">
        {result.demonstratedRecordCount > 0
          ? `${result.demonstratedOutput} ${study.unitOfMeasure} recorded in this horizon across ${result.demonstratedRecordCount} production records. That figure is not the capacity.`
          : "No production record in this unit covers the horizon. Capacity is only the human-stated limit."}
      </p>
      {study.constraints.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-slate-400">
          {study.constraints.map((limit) => (
            <li key={limit.id}>
              {limit.key} ({limit.kind}
              {limit.assetTag ? `, ${limit.assetTag}` : ""}):{" "}
              {limit.availableQuantity === null
                ? "quantity not stated"
                : `${limit.availableQuantity} ${limit.unitOfMeasure}`}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
