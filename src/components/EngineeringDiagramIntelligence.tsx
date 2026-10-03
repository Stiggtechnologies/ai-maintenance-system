import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GitBranch,
  ImageUp,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  dispatchEngineeringDiagramRun,
  getEngineeringDiagramWorkspace,
  proposeDiagramAssetMapping,
  publishDiagramDependencyCandidates,
  reviewDiagramAssetMapping,
  uploadAndCreateEngineeringDiagramRun,
  type DiagramWorkspace,
} from "../services/engineeringDiagramIntelligence";

const inputClass =
  "w-full rounded-lg border border-industrial-border bg-industrial-bg px-3 py-2 text-sm text-industrial-text outline-none focus:border-signal-cyan";

const dependencyKinds = [
  "topological",
  "functional",
  "utility",
  "control",
  "geographic",
  "logistical",
] as const;

export function EngineeringDiagramIntelligence({
  canControl,
  canReview,
}: {
  canControl: boolean;
  canReview: boolean;
}) {
  const [workspace, setWorkspace] = useState<DiagramWorkspace | null>(null);
  const [selectedDocument, setSelectedDocument] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [assetChoice, setAssetChoice] = useState<Record<string, string>>({});
  const [mappingBasis, setMappingBasis] = useState<Record<string, string>>({});
  const [reviewBasis, setReviewBasis] = useState<Record<string, string>>({});
  const [edgeKind, setEdgeKind] = useState<
    Record<string, (typeof dependencyKinds)[number]>
  >({});
  const [edgeDirection, setEdgeDirection] = useState<
    Record<string, "source" | "target">
  >({});
  const [edgeBasis, setEdgeBasis] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setWorkspace(await getEngineeringDiagramWorkspace());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Diagram workspace failed to load",
      );
    }
  }, []);

  useEffect(() => void load(), [load]);

  const latestExtractedRun = workspace?.runs.find(
    (run) => run.status === "extracted",
  );
  const runNodes = useMemo(
    () =>
      workspace?.nodes.filter(
        (node) => node.run_id === latestExtractedRun?.id,
      ) ?? [],
    [workspace, latestExtractedRun?.id],
  );
  const runEdges = useMemo(
    () =>
      workspace?.edges.filter(
        (edge) => edge.run_id === latestExtractedRun?.id,
      ) ?? [],
    [workspace, latestExtractedRun?.id],
  );
  const acceptedByNode = useMemo(() => {
    const result = new Map<string, string>();
    for (const mapping of workspace?.mappings ?? [])
      if (mapping.status === "accepted")
        result.set(mapping.node_id, mapping.asset_id);
    return result;
  }, [workspace]);

  async function perform(
    key: string,
    action: () => Promise<unknown>,
    message: string,
  ) {
    setWorking(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Diagram action failed",
      );
    } finally {
      setWorking(null);
    }
  }

  async function createRun() {
    if (!file || !selectedDocument) return;
    await perform(
      "create",
      async () => {
        const result = await uploadAndCreateEngineeringDiagramRun({
          documentId: selectedDocument,
          file,
        });
        await dispatchEngineeringDiagramRun(result.runId, "start");
      },
      "Diagram extraction was submitted. Graph construction is asynchronous; use Check result when it is ready.",
    );
  }

  if (!workspace) {
    return (
      <section className="mt-8 rounded-xl border border-industrial-border p-5 text-sm text-industrial-muted">
        Loading Diagram Intelligence…
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-xl border border-signal-cyan/25 bg-signal-cyan/[0.04] p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal-cyan">
            Controlled engineering evidence
          </p>
          <h2 className="mt-2 flex items-center gap-2 text-xl font-semibold text-industrial-text">
            <GitBranch className="h-5 w-5" /> Diagram Intelligence
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-industrial-muted">
            Extract symbols, tags and connectivity from an effective controlled
            P&amp;ID or drawing. Results are machine-generated candidates.
            Independent humans must map both endpoints, orient each relationship
            and review it again in the canonical dependency queue. This does not
            authorize plant work, change a limit or execute a control action.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-lg border border-industrial-border px-3 py-2 text-sm text-industrial-muted"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200"
        >
          {notice}
        </p>
      )}

      <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
        <select
          className={inputClass}
          value={selectedDocument}
          disabled={!canControl}
          onChange={(event) => setSelectedDocument(event.target.value)}
        >
          <option value="">
            Choose an effective controlled P&amp;ID or drawing
          </option>
          {workspace.documents.map((document) => (
            <option key={document.id} value={document.id}>
              {document.document_number} rev {document.revision_label} —{" "}
              {document.title}
            </option>
          ))}
        </select>
        <input
          className={inputClass}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={!canControl}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          disabled={
            !canControl || !selectedDocument || !file || working != null
          }
          onClick={() => void createRun()}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-signal-cyan px-4 py-2 text-sm font-semibold text-overlook-void disabled:opacity-40"
        >
          {working === "create" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImageUp className="h-4 w-4" />
          )}
          Extract sheet
        </button>
      </div>
      {workspace.documents.length === 0 && (
        <p className="mt-3 text-sm text-amber-200">
          No effective controlled diagram revision exists yet. Register and
          independently approve a drawing or P&amp;ID above before inference can
          start.
        </p>
      )}
      {!canControl && (
        <p className="mt-3 text-sm text-industrial-muted">
          Diagram evidence is visible to this tenant. A named engineering,
          maintenance, planning, or administrator human must perform controlled
          uploads, mapping proposals, and candidate publication.
        </p>
      )}

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {workspace.runs.map((run) => (
          <article
            key={run.id}
            className="rounded-lg border border-industrial-border bg-industrial-bg/60 p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-industrial-muted">
                {run.id.slice(0, 8)}
              </span>
              <span className="rounded-full border border-industrial-border px-2 py-0.5 text-xs text-industrial-text">
                {run.status}
              </span>
            </div>
            <p className="mt-2 text-sm text-industrial-text">
              {run.node_count} nodes · {run.edge_count} connections
            </p>
            <p
              className="mt-1 truncate font-mono text-[11px] text-industrial-muted"
              title={run.input_sha256}
            >
              input {run.input_sha256.slice(0, 14)}…
            </p>
            {run.error_detail && (
              <p className="mt-2 text-xs text-red-200">{run.error_detail}</p>
            )}
            {run.status === "awaiting_graph" && (
              <button
                type="button"
                disabled={working != null}
                onClick={() =>
                  void perform(
                    `poll-${run.id}`,
                    () => dispatchEngineeringDiagramRun(run.id, "poll"),
                    "Provider status checked and governed results retained when complete.",
                  )
                }
                className="mt-3 rounded-lg border border-signal-cyan/40 px-3 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-40"
              >
                Check result
              </button>
            )}
          </article>
        ))}
      </div>

      {latestExtractedRun && (
        <div className="mt-8 space-y-8">
          <div>
            <h3 className="flex items-center gap-2 font-semibold text-industrial-text">
              <ShieldCheck className="h-4 w-4 text-emerald-300" /> Asset mapping
              review
            </h3>
            <p className="mt-1 text-xs text-industrial-muted">
              A proposer selects the canonical asset; a different named human
              with AAL2 accepts or rejects it.
            </p>
            <div className="mt-3 space-y-3">
              {runNodes.map((node) => {
                const mappings = workspace.mappings.filter(
                  (mapping) => mapping.node_id === node.id,
                );
                const open = mappings.find(
                  (mapping) => mapping.status === "proposed",
                );
                const accepted = mappings.find(
                  (mapping) => mapping.status === "accepted",
                );
                return (
                  <div
                    key={node.id}
                    className="grid gap-3 rounded-lg border border-industrial-border bg-industrial-bg/50 p-3 xl:grid-cols-[1.2fr_1fr_1.4fr_auto] xl:items-end"
                  >
                    <div>
                      <p className="text-sm font-medium text-industrial-text">
                        {node.tag || node.label || `Symbol ${node.external_id}`}
                      </p>
                      <p className="text-xs text-industrial-muted">
                        {node.symbol_class} · confidence{" "}
                        {(Number(node.confidence) * 100).toFixed(0)}%
                      </p>
                    </div>
                    {accepted ? (
                      <p className="text-sm text-emerald-200">
                        Accepted →{" "}
                        {workspace.assets.find(
                          (asset) => asset.id === accepted.asset_id,
                        )?.name ?? accepted.asset_id}
                      </p>
                    ) : open ? (
                      <p className="text-sm text-amber-200">
                        Proposed →{" "}
                        {workspace.assets.find(
                          (asset) => asset.id === open.asset_id,
                        )?.name ?? open.asset_id}
                      </p>
                    ) : (
                      <select
                        className={inputClass}
                        value={assetChoice[node.id] ?? ""}
                        onChange={(event) =>
                          setAssetChoice((current) => ({
                            ...current,
                            [node.id]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Choose canonical asset</option>
                        {workspace.assets.map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {asset.tag ? `${asset.tag} — ` : ""}
                            {asset.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <textarea
                      className={inputClass}
                      rows={2}
                      value={
                        (open ? reviewBasis[open.id] : mappingBasis[node.id]) ??
                        ""
                      }
                      onChange={(event) =>
                        open
                          ? setReviewBasis((current) => ({
                              ...current,
                              [open.id]: event.target.value,
                            }))
                          : setMappingBasis((current) => ({
                              ...current,
                              [node.id]: event.target.value,
                            }))
                      }
                      placeholder={
                        open
                          ? "Independent review basis (20+ characters)"
                          : "Tag/drawing mapping basis (20+ characters)"
                      }
                      disabled={Boolean(accepted)}
                    />
                    {!accepted && !open && (
                      <button
                        type="button"
                        disabled={
                          !canControl ||
                          !assetChoice[node.id] ||
                          (mappingBasis[node.id]?.trim().length ?? 0) < 20 ||
                          working != null
                        }
                        onClick={() =>
                          void perform(
                            `map-${node.id}`,
                            () =>
                              proposeDiagramAssetMapping({
                                nodeId: node.id,
                                assetId: assetChoice[node.id],
                                basis: mappingBasis[node.id],
                              }),
                            "Asset mapping proposed for independent review.",
                          )
                        }
                        className="rounded-lg border border-signal-cyan/40 px-3 py-2 text-xs font-semibold text-signal-cyan disabled:opacity-40"
                      >
                        Propose
                      </button>
                    )}
                    {open && (
                      <div className="flex gap-2">
                        {(["accepted", "rejected"] as const).map((decision) => (
                          <button
                            key={decision}
                            type="button"
                            disabled={
                              !canReview ||
                              (reviewBasis[open.id]?.trim().length ?? 0) < 20 ||
                              working != null
                            }
                            onClick={() =>
                              void perform(
                                `review-${open.id}`,
                                () =>
                                  reviewDiagramAssetMapping({
                                    mappingId: open.id,
                                    decision,
                                    basis: reviewBasis[open.id],
                                  }),
                                `Mapping ${decision}.`,
                              )
                            }
                            className="rounded-lg border border-industrial-border px-2 py-2 text-xs text-industrial-text disabled:opacity-40"
                          >
                            {decision === "accepted" ? "Accept" : "Reject"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h3 className="font-semibold text-industrial-text">
              Publish an oriented relationship candidate
            </h3>
            <p className="mt-1 text-xs text-industrial-muted">
              Both endpoints must have accepted asset mappings. Publication
              still does not change the graph; a different AAL2 human must
              confirm it in Asset Interdependency.
            </p>
            <div className="mt-3 space-y-3">
              {runEdges.map((edge) => {
                const sourceAsset = acceptedByNode.get(edge.source_node_id);
                const targetAsset = acceptedByNode.get(edge.target_node_id);
                const sourceName = workspace.assets.find(
                  (asset) => asset.id === sourceAsset,
                )?.name;
                const targetName = workspace.assets.find(
                  (asset) => asset.id === targetAsset,
                )?.name;
                const direction = edgeDirection[edge.id] ?? "target";
                return (
                  <div
                    key={edge.id}
                    className="grid gap-3 rounded-lg border border-industrial-border bg-industrial-bg/50 p-3 xl:grid-cols-[1.2fr_1fr_1.4fr_auto] xl:items-end"
                  >
                    <div>
                      <p className="text-sm text-industrial-text">
                        {sourceName ?? "Unmapped source"} ↔{" "}
                        {targetName ?? "Unmapped target"}
                      </p>
                      <p className="text-xs text-industrial-muted">
                        Provider flow: {edge.flow_direction} · confidence{" "}
                        {(Number(edge.confidence) * 100).toFixed(0)}%
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        className={inputClass}
                        value={direction}
                        onChange={(event) =>
                          setEdgeDirection((current) => ({
                            ...current,
                            [edge.id]: event.target.value as
                              "source" | "target",
                          }))
                        }
                      >
                        <option value="target">Target depends on source</option>
                        <option value="source">Source depends on target</option>
                      </select>
                      <select
                        className={inputClass}
                        value={edgeKind[edge.id] ?? "topological"}
                        onChange={(event) =>
                          setEdgeKind((current) => ({
                            ...current,
                            [edge.id]: event.target
                              .value as (typeof dependencyKinds)[number],
                          }))
                        }
                      >
                        {dependencyKinds.map((kind) => (
                          <option key={kind} value={kind}>
                            {kind}
                          </option>
                        ))}
                      </select>
                    </div>
                    <textarea
                      className={inputClass}
                      rows={2}
                      value={edgeBasis[edge.id] ?? ""}
                      onChange={(event) =>
                        setEdgeBasis((current) => ({
                          ...current,
                          [edge.id]: event.target.value,
                        }))
                      }
                      placeholder="Human orientation and engineering basis (20+ characters)"
                    />
                    <button
                      type="button"
                      disabled={
                        !canControl ||
                        !sourceAsset ||
                        !targetAsset ||
                        (edgeBasis[edge.id]?.trim().length ?? 0) < 20 ||
                        working != null
                      }
                      onClick={() =>
                        void perform(
                          `publish-${edge.id}`,
                          () =>
                            publishDiagramDependencyCandidates({
                              runId: latestExtractedRun.id,
                              candidates: [
                                {
                                  edgeId: edge.id,
                                  dependentAssetId:
                                    direction === "target"
                                      ? targetAsset!
                                      : sourceAsset!,
                                  supplierAssetId:
                                    direction === "target"
                                      ? sourceAsset!
                                      : targetAsset!,
                                  dependencyKind:
                                    edgeKind[edge.id] ?? "topological",
                                  basis: edgeBasis[edge.id],
                                },
                              ],
                            }),
                          "Candidate published to the existing Asset Interdependency review queue.",
                        )
                      }
                      className="rounded-lg border border-signal-cyan/40 px-3 py-2 text-xs font-semibold text-signal-cyan disabled:opacity-40"
                    >
                      Publish candidate
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
