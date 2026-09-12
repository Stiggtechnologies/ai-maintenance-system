import { useMemo, useState } from "react";
import { CheckCircle2, Layers3, ShieldCheck } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { useAuth } from "./AuthProvider";
import { ErrorState, LoadingState } from "./ui/AsyncStates";
import {
  adoptCapabilityPackLayer,
  authorCapabilityPackLayer,
  canApprovePackOverride,
  canAuthorPack,
  decideCapabilityPackOverride,
  getCapabilityPackWorkspace,
  resolveCapabilityPackStack,
  type CapabilityPackLayerKind,
  type CapabilityPackWorkspace,
  type ResolvedCapabilityPackStack,
} from "../services/layeredCapabilityPacks";

const LAYERS: Array<{ key: CapabilityPackLayerKind; label: string }> = [
  { key: "universal_core", label: "Universal core" },
  { key: "sector", label: "Sector" },
  { key: "jurisdiction", label: "Jurisdiction" },
  { key: "enterprise", label: "Enterprise" },
  { key: "business_unit", label: "Business unit" },
  { key: "site", label: "Site" },
  { key: "asset", label: "Asset" },
];

const inputClass =
  "w-full rounded-lg border border-white/10 bg-industrial-black px-3 py-2 text-sm text-slate-200";
const actionClass =
  "rounded-lg border border-signal-cyan/35 bg-signal-cyan/10 px-3 py-1.5 text-sm font-medium text-signal-cyan disabled:opacity-40";

function parseValue(value: string): unknown {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) return Number(trimmed);
  return trimmed;
}

function formatValue(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

const EMPTY_DRAFT = {
  layerKind: "universal_core" as CapabilityPackLayerKind,
  title: "",
  industryCode: "",
  jurisdiction: "",
  organizationNodeId: "",
  siteId: "",
  assetId: "",
  evidenceBasis: "",
  values: [{ key: "", value: "" }],
};

export function LayeredCapabilityPacks() {
  const { profile } = useAuth();
  const role = profile?.role as string | undefined;
  const userId = profile?.id;
  const workspace = useAsyncData<CapabilityPackWorkspace>(
    getCapabilityPackWorkspace,
    [],
  );
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [selectedAsset, setSelectedAsset] = useState("");
  const [resolved, setResolved] =
    useState<ResolvedCapabilityPackStack | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const adoptedByLayer = useMemo(() => {
    const result = new Map<CapabilityPackLayerKind, number>();
    for (const layer of workspace.data?.layers ?? []) {
      if (layer.status === "adopted")
        result.set(layer.layer_kind, (result.get(layer.layer_kind) ?? 0) + 1);
    }
    return result;
  }, [workspace.data]);

  if (workspace.loading)
    return <LoadingState label="Loading capability pack layers" />;
  if (workspace.error)
    return <ErrorState message={workspace.error} onRetry={workspace.refetch} />;

  const data = workspace.data;
  const run = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      setMessage(success);
      setReviewNote("");
      setReviewing(null);
      await workspace.refetch();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That did not work.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitDraft = async () => {
    const configuration = Object.fromEntries(
      draft.values
        .filter((item) => item.key.trim() && item.value.trim())
        .map((item) => [item.key.trim(), parseValue(item.value)]),
    );
    const created = await run(
      () =>
        authorCapabilityPackLayer({
          layerKind: draft.layerKind,
          title: draft.title,
          industryCode: draft.industryCode || undefined,
          jurisdiction: draft.jurisdiction || undefined,
          organizationNodeId: draft.organizationNodeId || undefined,
          siteId: draft.siteId || undefined,
          assetId: draft.assetId || undefined,
          configuration,
          evidenceBasis: draft.evidenceBasis,
        }),
      "Draft captured. Any changed inherited values are now held for independent approval.",
    );
    if (created) setDraft(EMPTY_DRAFT);
  };

  return (
    <section aria-labelledby="pack-stack-heading" className="space-y-5">
      <div>
        <h2
          id="pack-stack-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Layers3 className="h-5 w-5 text-signal-cyan" aria-hidden />
          Layered capability packs
        </h2>
        <p className="mt-1 text-sm text-slate-300">
          See exactly which operating guidance applies from the common SyncAI
          core down to an individual asset—and which layer supplied each value.
        </p>
        <p
          data-testid="pack-stack-authority"
          className="mt-2 rounded-xl border border-white/8 bg-industrial-black/60 px-4 py-3 text-xs text-slate-400"
        >
          {data?.controls.precedence}. {data?.controls.override} {" "}
          {data?.controls.execution}
        </p>
      </div>

      {message && (
        <p className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-sm text-slate-200">
          {message}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-7">
        {LAYERS.map((layer, index) => (
          <div
            key={layer.key}
            className="relative rounded-xl border border-white/8 bg-overlook-deep/40 p-3"
          >
            <p className="text-[10px] uppercase tracking-wider text-slate-500">
              Layer {index + 1}
            </p>
            <p className="mt-1 text-xs font-medium text-slate-200">
              {layer.label}
            </p>
            <p className="mt-2 text-[11px] text-slate-400">
              {adoptedByLayer.get(layer.key) ?? 0} adopted
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-white/8 bg-overlook-deep/40 p-4">
        <h3 className="text-sm font-semibold text-slate-200">
          Resolve an asset&apos;s effective stack
        </h3>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select
            aria-label="Asset to resolve"
            className={inputClass}
            value={selectedAsset}
            onChange={(event) => setSelectedAsset(event.target.value)}
          >
            <option value="">Select an asset</option>
            {(data?.assets ?? []).map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name} {asset.asset_class ? `— ${asset.asset_class}` : ""}
              </option>
            ))}
          </select>
          <button
            className={actionClass}
            disabled={!selectedAsset || busy}
            onClick={async () => {
              setBusy(true);
              setMessage(null);
              try {
                setResolved(
                  await resolveCapabilityPackStack({ assetId: selectedAsset }),
                );
              } catch (error) {
                setMessage(
                  error instanceof Error ? error.message : "Unable to resolve stack.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Resolve stack
          </button>
        </div>
        {resolved && (
          <div className="mt-4 space-y-3" data-testid="resolved-pack-stack">
            <div className="flex flex-wrap gap-2">
              {resolved.stack.map((layer) => (
                <span
                  key={layer.id}
                  className="rounded-full border border-green-500/25 bg-green-500/8 px-2.5 py-1 text-[11px] text-green-300"
                >
                  {layer.layer.replace("_", " ")} · {layer.title}
                </span>
              ))}
              {resolved.missing_layers.map((layer) => (
                <span
                  key={layer}
                  className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-slate-500"
                >
                  {layer.replace("_", " ")} · not configured
                </span>
              ))}
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {Object.entries(resolved.value_sources).map(([key, source]) => (
                <div
                  key={key}
                  className="rounded-lg border border-white/6 bg-industrial-black/50 p-3"
                >
                  <p className="text-xs font-medium text-slate-200">{key}</p>
                  <p className="mt-1 text-xs text-slate-300">
                    {formatValue(source.value)}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Supplied by {source.layer.replace("_", " ")} · {source.title}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">{resolved.authority}</p>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {(data?.layers ?? []).map((layer) => {
          const needsApproval = layer.override_diff.length > 0;
          const canReview =
            canApprovePackOverride(role) && layer.created_by !== userId;
          return (
            <article
              key={layer.id}
              className="rounded-xl border border-white/8 bg-overlook-deep/40 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-200">{layer.title}</p>
                  <p className="text-[11px] text-slate-500">
                    {layer.layer_kind.replace("_", " ")} · {layer.scope_key} · v
                    {layer.version}
                  </p>
                </div>
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-slate-300">
                  {layer.status}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(layer.configuration).map(([key, value]) => (
                  <span
                    key={key}
                    className="rounded-lg bg-white/4 px-2 py-1 text-[11px] text-slate-300"
                  >
                    {key}: {formatValue(value)}
                  </span>
                ))}
              </div>
              {needsApproval && (
                <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                  <p className="text-xs font-medium text-amber-300">
                    Exact override review · {layer.approval_status}
                  </p>
                  {layer.override_diff.map((diff) => (
                    <p key={diff.key} className="mt-1 text-[11px] text-slate-400">
                      {diff.key}: {formatValue(diff.inherited)} → {formatValue(diff.proposed)}
                    </p>
                  ))}
                  {layer.status === "draft" && canReview && (
                    <button
                      className="mt-2 rounded-lg border border-amber-500/30 px-2.5 py-1 text-xs text-amber-300"
                      onClick={() => setReviewing(layer.id)}
                    >
                      Review exact override
                    </button>
                  )}
                  {layer.status === "draft" &&
                    canApprovePackOverride(role) &&
                    layer.created_by === userId && (
                      <p className="mt-2 text-[11px] text-slate-500">
                        A different authorized human must review this change.
                      </p>
                    )}
                </div>
              )}
              {layer.status === "draft" &&
                canAuthorPack(role) &&
                (!needsApproval || layer.approval_status === "approved") && (
                  <button
                    className="mt-3 rounded-lg border border-green-500/30 px-2.5 py-1 text-xs text-green-300"
                    onClick={() => setReviewing(layer.id)}
                  >
                    Review for adoption
                  </button>
                )}
            </article>
          );
        })}
      </div>

      {reviewing && (
        <div className="rounded-xl border border-signal-cyan/20 bg-signal-cyan/5 p-4">
          <label className="text-xs text-slate-300" htmlFor="pack-review-note">
            Human review note
          </label>
          <textarea
            id="pack-review-note"
            className={`${inputClass} mt-2`}
            value={reviewNote}
            onChange={(event) => setReviewNote(event.target.value)}
            placeholder="State the evidence checked and why this configuration is acceptable."
          />
          <div className="mt-3 flex flex-wrap gap-2">
            {(() => {
              const layer = data?.layers.find((item) => item.id === reviewing);
              if (!layer) return null;
              if (layer.override_diff.length > 0 && layer.approval_status !== "approved") {
                return (
                  <>
                    <button
                      className={actionClass}
                      disabled={busy || reviewNote.trim().length < 20}
                      onClick={() =>
                        run(
                          () =>
                            decideCapabilityPackOverride(
                              layer.id,
                              "approved",
                              reviewNote,
                            ),
                          "Exact override approved. The layer remains draft until separately adopted.",
                        )
                      }
                    >
                      Approve exact override
                    </button>
                    <button
                      className="rounded-lg border border-red-500/30 px-3 py-1.5 text-sm text-red-300 disabled:opacity-40"
                      disabled={busy || reviewNote.trim().length < 20}
                      onClick={() =>
                        run(
                          () =>
                            decideCapabilityPackOverride(
                              layer.id,
                              "rejected",
                              reviewNote,
                            ),
                          "Override rejected and the draft closed.",
                        )
                      }
                    >
                      Reject override
                    </button>
                  </>
                );
              }
              return (
                <button
                  className={actionClass}
                  disabled={busy || reviewNote.trim().length < 20}
                  onClick={() =>
                    run(
                      () => adoptCapabilityPackLayer(layer.id, reviewNote),
                      "Layer adopted into the governed resolution stack.",
                    )
                  }
                >
                  Adopt layer
                </button>
              );
            })()}
            <button
              className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400"
              onClick={() => setReviewing(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {canAuthorPack(role) && (
        <div className="rounded-xl border border-white/8 bg-overlook-deep/40 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
            <ShieldCheck className="h-4 w-4 text-signal-cyan" /> Author a pack layer
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            New values inherit freely. Changed inherited values automatically create an exact-diff approval hold.
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <select
              aria-label="Pack layer"
              className={inputClass}
              value={draft.layerKind}
              onChange={(event) =>
                setDraft({
                  ...EMPTY_DRAFT,
                  layerKind: event.target.value as CapabilityPackLayerKind,
                })
              }
            >
              {LAYERS.map((layer) => (
                <option key={layer.key} value={layer.key}>
                  {layer.label}
                </option>
              ))}
            </select>
            <input
              aria-label="Layer title"
              className={inputClass}
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="Layer title"
            />
            {draft.layerKind === "sector" && (
              <input
                aria-label="Industry code"
                className={inputClass}
                value={draft.industryCode}
                onChange={(event) =>
                  setDraft({ ...draft, industryCode: event.target.value })
                }
                placeholder="e.g. mining"
              />
            )}
            {draft.layerKind === "jurisdiction" && (
              <input
                aria-label="Jurisdiction"
                className={inputClass}
                value={draft.jurisdiction}
                onChange={(event) =>
                  setDraft({ ...draft, jurisdiction: event.target.value })
                }
                placeholder="e.g. Alberta"
              />
            )}
            {draft.layerKind === "business_unit" && (
              <select
                aria-label="Business unit"
                className={inputClass}
                value={draft.organizationNodeId}
                onChange={(event) =>
                  setDraft({ ...draft, organizationNodeId: event.target.value })
                }
              >
                <option value="">Select a business unit</option>
                {(data?.organization_nodes ?? [])
                  .filter((node) => node.org_level === "business_unit")
                  .map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name}
                    </option>
                  ))}
              </select>
            )}
            {draft.layerKind === "site" && (
              <select
                aria-label="Pack site"
                className={inputClass}
                value={draft.siteId}
                onChange={(event) => setDraft({ ...draft, siteId: event.target.value })}
              >
                <option value="">Select a site</option>
                {(data?.sites ?? []).map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            )}
            {draft.layerKind === "asset" && (
              <select
                aria-label="Pack asset"
                className={inputClass}
                value={draft.assetId}
                onChange={(event) => setDraft({ ...draft, assetId: event.target.value })}
              >
                <option value="">Select an asset</option>
                {(data?.assets ?? []).map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="mt-3 space-y-2">
            {draft.values.map((item, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input
                  aria-label={`Configuration key ${index + 1}`}
                  className={inputClass}
                  value={item.key}
                  onChange={(event) => {
                    const values = [...draft.values];
                    values[index] = { ...item, key: event.target.value };
                    setDraft({ ...draft, values });
                  }}
                  placeholder="configuration_key"
                />
                <input
                  aria-label={`Configuration value ${index + 1}`}
                  className={inputClass}
                  value={item.value}
                  onChange={(event) => {
                    const values = [...draft.values];
                    values[index] = { ...item, value: event.target.value };
                    setDraft({ ...draft, values });
                  }}
                  placeholder="Value"
                />
                <button
                  className="rounded-lg border border-white/10 px-3 text-xs text-slate-400 disabled:opacity-30"
                  disabled={draft.values.length === 1}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      values: draft.values.filter((_, itemIndex) => itemIndex !== index),
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              className="text-xs text-signal-cyan"
              onClick={() =>
                setDraft({
                  ...draft,
                  values: [...draft.values, { key: "", value: "" }],
                })
              }
            >
              + Add configuration value
            </button>
          </div>
          <textarea
            aria-label="Layer evidence basis"
            className={`${inputClass} mt-3`}
            value={draft.evidenceBasis}
            onChange={(event) =>
              setDraft({ ...draft, evidenceBasis: event.target.value })
            }
            placeholder="Evidence, source, validation state and limitations"
          />
          <button
            className={`${actionClass} mt-3`}
            disabled={busy}
            onClick={submitDraft}
          >
            <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> Save controlled draft
          </button>
        </div>
      )}
    </section>
  );
}
