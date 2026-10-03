import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  GitBranch,
  Loader2,
  Plus,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  createSubOrganization,
  getOrganizationGovernanceWorkspace,
  ORGANIZATION_LEVELS,
  setOrganizationGovernanceProfile,
  updateOrganizationNode,
  type OrganizationLevel,
} from "../services/organizationGovernanceService";

const LEVEL_LABELS: Record<OrganizationLevel, string> = {
  enterprise: "Enterprise",
  business_unit: "Business unit",
  site: "Site",
  area: "Area",
  system: "System",
};

const inputClass =
  "w-full rounded-lg border border-industrial-border bg-industrial-black px-3 py-2 text-sm text-industrial-text placeholder:text-slate-600 focus:border-signal-cyan focus:outline-none";

export function OrganizationGovernanceWorkspace() {
  const workspace = useAsyncData(getOrganizationGovernanceWorkspace, [], {
    isEmpty: (data) => !data?.root,
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [createName, setCreateName] = useState("");
  const [createLevel, setCreateLevel] =
    useState<OrganizationLevel>("business_unit");
  const [createParentId, setCreateParentId] = useState("");
  const [createJurisdiction, setCreateJurisdiction] = useState("");
  const [editLevel, setEditLevel] = useState<OrganizationLevel>("enterprise");
  const [editJurisdiction, setEditJurisdiction] = useState("");
  const [frameworkId, setFrameworkId] = useState("");
  const [governanceNote, setGovernanceNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  const selectedNode = useMemo(
    () =>
      workspace.data?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [selectedNodeId, workspace.data?.nodes],
  );

  const eligibleFrameworks = useMemo(() => {
    if (!workspace.data || !selectedNode) return [];
    return workspace.data.frameworks.filter((framework) =>
      framework.eligibleNodeIds.includes(selectedNode.id),
    );
  }, [selectedNode, workspace.data]);

  useEffect(() => {
    const data = workspace.data;
    if (!data) return;
    if (
      !selectedNodeId ||
      !data.nodes.some((node) => node.id === selectedNodeId)
    ) {
      setSelectedNodeId(data.root.id);
    }
    if (
      !createParentId ||
      !data.nodes.some((node) => node.id === createParentId)
    ) {
      setCreateParentId(data.root.id);
    }
  }, [createParentId, selectedNodeId, workspace.data]);

  useEffect(() => {
    if (!selectedNode) return;
    setEditLevel(selectedNode.orgLevel);
    setEditJurisdiction(selectedNode.jurisdiction ?? "");
    setFrameworkId(selectedNode.attachedProfile?.id ?? "");
    setGovernanceNote("");
  }, [selectedNode]);

  async function run(
    key: string,
    action: () => Promise<unknown>,
    success: string,
  ) {
    setBusy(key);
    setNotice(null);
    try {
      await action();
      setNotice({ kind: "success", text: success });
      workspace.refetch();
      return true;
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error ? error.message : "The change was refused.",
      });
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (workspace.loading) {
    return (
      <div className="flex min-h-40 items-center justify-center text-sm text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin text-signal-cyan" />
        Loading organization governance…
      </div>
    );
  }

  if (workspace.error || !workspace.data) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">
        {workspace.error ?? "Organization governance is unavailable."}
      </div>
    );
  }

  const data = workspace.data;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
        <section className="glass rounded-xl border border-white/6 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-signal-cyan">
                <Building2 className="h-4 w-4" /> Organization root
              </div>
              <h2 className="mt-2 text-lg font-semibold text-industrial-text">
                {data.root.name}
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                {LEVEL_LABELS[data.root.orgLevel]}
                {data.root.jurisdiction
                  ? ` · ${data.root.jurisdiction}`
                  : " · jurisdiction not recorded"}
              </p>
            </div>
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-slate-300">
              {data.nodes.length} node{data.nodes.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-4 grid gap-2 text-xs text-slate-400 sm:grid-cols-3">
            <p className="rounded-lg border border-white/6 bg-black/15 p-3">
              {data.governance.writes}
            </p>
            <p className="rounded-lg border border-white/6 bg-black/15 p-3">
              {data.governance.inheritance}
            </p>
            <p className="rounded-lg border border-white/6 bg-black/15 p-3">
              {data.governance.automation}
            </p>
          </div>
        </section>

        <section className="glass rounded-xl border border-white/6 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-industrial-text">
            <ShieldCheck className="h-4 w-4 text-signal-gold" /> Authority
            boundary
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            You are signed in as{" "}
            <span className="text-slate-200">
              {data.actorRole ?? "unassigned"}
            </span>
            .
            {data.canManage
              ? " You may propose tree and profile changes; the server records every accepted act."
              : " This workspace is read-only for your role. An executive or administrator must make governance changes."}
          </p>
        </section>
      </div>

      {notice && (
        <div
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${
            notice.kind === "error"
              ? "border-red-500/20 bg-red-500/5 text-red-300"
              : "border-emerald-500/20 bg-emerald-500/5 text-emerald-300"
          }`}
        >
          {notice.text}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
        <section className="glass rounded-xl border border-white/6 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-industrial-text">
            <GitBranch className="h-4 w-4 text-signal-cyan" /> Five-level tree
          </div>
          <div className="mt-4 space-y-2">
            {data.nodes.map((node) => {
              const active = node.id === selectedNodeId;
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => setSelectedNodeId(node.id)}
                  aria-pressed={active}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    active
                      ? "border-signal-cyan/40 bg-signal-cyan/5"
                      : "border-white/6 bg-black/10 hover:border-white/15"
                  }`}
                  style={{ paddingLeft: `${12 + node.depth * 18}px` }}
                >
                  <span className="block text-sm font-medium text-slate-100">
                    {node.name}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {LEVEL_LABELS[node.orgLevel]} ·{" "}
                    {node.jurisdiction || "No jurisdiction"}
                  </span>
                  <span className="mt-2 block text-xs text-slate-400">
                    {node.resolvedProfile
                      ? `${node.resolvedProfile.name} v${node.resolvedProfile.version} · from ${node.resolvedProfile.sourceNodeName}`
                      : "No adopted governance profile resolves here"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <div className="space-y-5">
          {data.canManage && (
            <section className="glass rounded-xl border border-white/6 p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-industrial-text">
                <Plus className="h-4 w-4 text-signal-cyan" /> Add organization
                node
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Nodes must descend in order from enterprise toward system. The
                server refuses inverted or cyclic structures.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-xs text-slate-400">
                  Name
                  <input
                    aria-label="New organization node name"
                    className={`${inputClass} mt-1`}
                    value={createName}
                    onChange={(event) => setCreateName(event.target.value)}
                    placeholder="North operations"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  Parent node
                  <select
                    aria-label="New organization parent"
                    className={`${inputClass} mt-1`}
                    value={createParentId}
                    onChange={(event) => setCreateParentId(event.target.value)}
                  >
                    {data.nodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {node.name} — {LEVEL_LABELS[node.orgLevel]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  Level
                  <select
                    aria-label="New organization level"
                    className={`${inputClass} mt-1`}
                    value={createLevel}
                    onChange={(event) =>
                      setCreateLevel(event.target.value as OrganizationLevel)
                    }
                  >
                    {ORGANIZATION_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {LEVEL_LABELS[level]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  Jurisdiction
                  <input
                    aria-label="New organization jurisdiction"
                    className={`${inputClass} mt-1`}
                    value={createJurisdiction}
                    onChange={(event) =>
                      setCreateJurisdiction(event.target.value)
                    }
                    placeholder="Alberta, Canada"
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={
                  busy !== null || !createName.trim() || !createParentId
                }
                onClick={() =>
                  run(
                    "create",
                    () =>
                      createSubOrganization({
                        name: createName,
                        orgLevel: createLevel,
                        parentId: createParentId,
                        jurisdiction: createJurisdiction || null,
                      }),
                    "Organization node created and written to the audit trail.",
                  ).then((accepted) => {
                    if (accepted) {
                      setCreateName("");
                      setCreateJurisdiction("");
                    }
                  })
                }
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-signal-cyan px-4 py-2 text-sm font-medium text-overlook-void disabled:opacity-40"
              >
                {busy === "create" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Create node
              </button>
            </section>
          )}

          {selectedNode && (
            <section className="glass rounded-xl border border-white/6 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-signal-cyan">
                    Selected node
                  </p>
                  <h3 className="mt-1 text-lg font-semibold text-industrial-text">
                    {selectedNode.name}
                  </h3>
                </div>
                {!data.canManage && (
                  <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
                    Read only
                  </span>
                )}
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-xs text-slate-400">
                  Level
                  <select
                    aria-label="Selected organization level"
                    className={`${inputClass} mt-1`}
                    value={editLevel}
                    disabled={!data.canManage}
                    onChange={(event) =>
                      setEditLevel(event.target.value as OrganizationLevel)
                    }
                  >
                    {ORGANIZATION_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {LEVEL_LABELS[level]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  Jurisdiction
                  <input
                    aria-label="Selected organization jurisdiction"
                    className={`${inputClass} mt-1`}
                    value={editJurisdiction}
                    disabled={!data.canManage}
                    onChange={(event) =>
                      setEditJurisdiction(event.target.value)
                    }
                    placeholder="Record the governing jurisdiction"
                  />
                </label>
              </div>
              {data.canManage && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    run(
                      "update",
                      () =>
                        updateOrganizationNode({
                          nodeId: selectedNode.id,
                          orgLevel: editLevel,
                          jurisdiction: editJurisdiction || null,
                        }),
                      "Organization node updated and written to the audit trail.",
                    )
                  }
                  className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-slate-200 hover:border-white/20 disabled:opacity-40"
                >
                  {busy === "update" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  Save node
                </button>
              )}

              <div className="my-5 border-t border-white/6" />

              <div className="flex items-center gap-2 text-sm font-semibold text-industrial-text">
                <ShieldCheck className="h-4 w-4 text-signal-gold" /> Governance
                profile
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Only adopted profiles owned by this node or one of its visible
                ancestors are offered. Clearing an attachment restores
                inheritance from the nearest ancestor.
              </p>
              <div className="mt-4 grid gap-3">
                <label className="text-xs text-slate-400">
                  Attached profile
                  <select
                    aria-label="Organization governance profile"
                    className={`${inputClass} mt-1`}
                    value={frameworkId}
                    disabled={!data.canManage}
                    onChange={(event) => setFrameworkId(event.target.value)}
                  >
                    <option value="">Inherit / no direct attachment</option>
                    {eligibleFrameworks.map((framework) => (
                      <option key={framework.id} value={framework.id}>
                        {framework.name} v{framework.version} —{" "}
                        {framework.organizationName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  Decision basis
                  <textarea
                    aria-label="Governance profile decision basis"
                    className={`${inputClass} mt-1 min-h-20`}
                    value={governanceNote}
                    disabled={!data.canManage}
                    onChange={(event) => setGovernanceNote(event.target.value)}
                    placeholder="Why this profile should govern this node and its descendants"
                  />
                </label>
              </div>
              {data.canManage && (
                <button
                  type="button"
                  disabled={busy !== null || governanceNote.trim().length < 10}
                  onClick={() =>
                    run(
                      "profile",
                      () =>
                        setOrganizationGovernanceProfile({
                          nodeId: selectedNode.id,
                          frameworkId: frameworkId || null,
                          note: governanceNote,
                        }),
                      frameworkId
                        ? "Governance profile attached and written to the audit trail."
                        : "Direct profile cleared; inherited governance now applies.",
                    )
                  }
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-signal-gold px-4 py-2 text-sm font-medium text-overlook-void disabled:opacity-40"
                >
                  {busy === "profile" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  Record profile decision
                </button>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
