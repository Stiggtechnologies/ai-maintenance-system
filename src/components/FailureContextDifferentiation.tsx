import { useEffect, useState } from "react";
import {
  FAILURE_CONTEXTS,
  type DifferentiationCheck,
} from "../lib/industry-profiles";
import {
  differentiateFailureContexts,
  listFailureContextAssets,
  listFailureContextBindings,
  recordFailureContextBinding,
  type FailureContextAsset,
  type FailureContextBinding,
} from "../services/failureContextRiskModelService";

const EXAMPLES = [
  {
    label: "Compressor trip versus haul truck",
    subject: "process_trip",
    contrast: "mobile_plant_failure",
  },
  {
    label: "Compressor trip versus weld defect",
    subject: "process_trip",
    contrast: "quality_loss",
  },
  {
    label: "Haul truck versus weld defect",
    subject: "mobile_plant_failure",
    contrast: "quality_loss",
  },
] as const;

const WORKFLOW_LABEL: Record<string, string> = {
  safety_investigation: "Safety investigation",
  reliability_analysis: "Reliability analysis",
  quality_containment: "Quality containment",
  capacity_restoration: "Capacity restoration",
};

function contextLabel(key: string): string {
  return FAILURE_CONTEXTS.find((context) => context.key === key)?.label ?? key;
}

function workflowLabel(workflow: string): string {
  return WORKFLOW_LABEL[workflow] ?? workflow;
}

export function FailureContextDifferentiation() {
  const [assets, setAssets] = useState<FailureContextAsset[]>([]);
  const [assetId, setAssetId] = useState("");
  const [contextKey, setContextKey] = useState("process_trip");
  const [comparisonKey, setComparisonKey] = useState("mobile_plant_failure");
  const [basis, setBasis] = useState("");
  const [preview, setPreview] = useState<DifferentiationCheck | null>(null);
  const [bindings, setBindings] = useState<FailureContextBinding[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subject = FAILURE_CONTEXTS.find(
    (context) => context.key === contextKey,
  );

  useEffect(() => {
    let cancelled = false;
    void listFailureContextAssets()
      .then((rows) => {
        if (!cancelled) setAssets(rows);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "Could not load assets",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingAssets(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!assetId) {
      setBindings([]);
      return;
    }
    let cancelled = false;
    void listFailureContextBindings(assetId)
      .then((rows) => {
        if (!cancelled) setBindings(rows);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load failure-context bindings",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  function choose(subjectKey: string, contrastKey: string) {
    setContextKey(subjectKey);
    setComparisonKey(contrastKey);
    setPreview(null);
    setError(null);
  }

  function previewDifferentiation() {
    setError(null);
    setPreview(differentiateFailureContexts(contextKey, comparisonKey));
  }

  async function record() {
    if (!assetId || !preview?.differentiated || basis.trim().length < 20)
      return;
    setBusy(true);
    setError(null);
    try {
      await recordFailureContextBinding({
        assetId,
        contextKey,
        comparisonKey,
        basis,
      });
      setBasis("");
      setBindings(await listFailureContextBindings(assetId));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The failure-context binding was refused.",
      );
    } finally {
      setBusy(false);
    }
  }

  const canRecord =
    Boolean(assetId) &&
    Boolean(preview?.differentiated) &&
    basis.trim().length >= 20 &&
    !busy;

  return (
    <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-5">
      <h2 className="text-lg font-bold text-white">
        Differentiated failure contexts
      </h2>
      <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">
        A compressor trip, a haul-truck failure, and a weld defect are different
        failure contexts. The binding records which canonical context applies to
        one asset and which contrasting context must not be analysed the same
        way. SyncAI does not invent a risk score, an interval, or a limit for
        either context.
      </p>
      <p className="mt-2 text-xs text-slate-500">
        Recording this binding does not approve work, accept risk, change an
        operating limit, or return equipment to service.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example.label}
            type="button"
            onClick={() => choose(example.subject, example.contrast)}
            className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/5"
          >
            {example.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <label className="text-xs font-semibold text-slate-300">
          Asset
          <select
            value={assetId}
            onChange={(event) => setAssetId(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#111C29] px-3 py-2 text-sm text-white"
          >
            <option value="">
              {loadingAssets ? "Loading assets…" : "Select an asset"}
            </option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.tag ? `${asset.tag} · ${asset.name}` : asset.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-300">
          Failure context
          <select
            value={contextKey}
            onChange={(event) => {
              setContextKey(event.target.value);
              setPreview(null);
            }}
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#111C29] px-3 py-2 text-sm text-white"
          >
            {FAILURE_CONTEXTS.map((context) => (
              <option key={context.key} value={context.key}>
                {context.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-300">
          Contrasting context
          <select
            value={comparisonKey}
            onChange={(event) => {
              setComparisonKey(event.target.value);
              setPreview(null);
            }}
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#111C29] px-3 py-2 text-sm text-white"
          >
            {FAILURE_CONTEXTS.map((context) => (
              <option key={context.key} value={context.key}>
                {context.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {subject && (
        <div className="mt-4 rounded-xl border border-white/7 p-3 text-xs text-slate-400">
          <p>
            Workflow for this context:{" "}
            <span className="text-slate-200">
              {workflowLabel(subject.workflow)}
            </span>
          </p>
          <p className="mt-2">
            Data required before this context can be analysed:
          </p>
          <ul className="mt-1 list-disc pl-4">
            {subject.requiredData.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <label className="mt-4 block text-xs font-semibold text-slate-300">
        Evidence basis
        <textarea
          value={basis}
          onChange={(event) => setBasis(event.target.value)}
          placeholder="Why this asset's failure is this context, and why the contrast is a different kind of failure. At least 20 characters."
          className="mt-1.5 min-h-20 w-full rounded-lg border border-white/10 bg-[#111C29] px-3 py-2 text-sm text-white"
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={previewDifferentiation}
          className="rounded-lg border border-teal-500/40 px-3 py-2 text-xs font-semibold text-teal-200"
        >
          Preview differentiation
        </button>
        <button
          type="button"
          onClick={() => void record()}
          disabled={!canRecord}
          className="rounded-lg bg-teal-400 px-3 py-2 text-xs font-bold text-black disabled:opacity-40"
        >
          {busy ? "Recording binding…" : "Record failure-context binding"}
        </button>
      </div>

      {preview && (
        <div
          className={`mt-4 rounded-xl border p-3 text-xs ${
            preview.differentiated
              ? "border-teal-500/25 bg-teal-500/6 text-slate-300"
              : "border-amber-500/25 bg-amber-500/6 text-amber-100"
          }`}
        >
          <p>{preview.reason}</p>
          {preview.differentiated && (
            <p className="mt-2 text-slate-400">
              The stored row is recomputed on the server from the canonical
              contexts. This preview is not the record.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 text-xs text-red-300" role="alert">
          {error}
        </p>
      )}

      <div className="mt-5">
        <h3 className="text-xs font-semibold text-slate-300">
          Recorded bindings for this asset
        </h3>
        {bindings.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            {assetId
              ? "No failure-context binding has been recorded for this asset."
              : "Select an asset to see its bindings."}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {bindings.map((binding) => (
              <li
                key={binding.id}
                className="rounded-lg border border-white/7 p-3 text-xs text-slate-400"
              >
                <p className="font-semibold text-slate-200">
                  {contextLabel(binding.context_key)} versus{" "}
                  {contextLabel(binding.comparison_context_key)}
                </p>
                <p className="mt-1">
                  {workflowLabel(binding.workflow)} versus{" "}
                  {workflowLabel(binding.comparison_workflow)}
                </p>
                <p className="mt-1">{binding.differentiation_reason}</p>
                <p className="mt-1 text-slate-500">
                  Work authorized: no. Risk accepted: no.
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
