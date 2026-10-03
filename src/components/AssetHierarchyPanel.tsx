import { useEffect, useMemo, useState, type FormEvent } from "react";
import { GitBranch, Link2, ShieldCheck } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  bindFailureModeToComponent,
  getAssetHierarchyWorkspace,
  recordComponentHierarchyNode,
  type PhysicalHierarchyLevel,
} from "../services/assetHierarchyService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const fieldClass =
  "mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white disabled:opacity-45";

export function AssetHierarchyPanel() {
  const workspace = useAsyncData(getAssetHierarchyWorkspace, []);
  const [assetId, setAssetId] = useState("");
  const [componentId, setComponentId] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [level, setLevel] = useState<PhysicalHierarchyLevel>("assembly");
  const [parentId, setParentId] = useState("");
  const [basis, setBasis] = useState("");
  const [evidenceId, setEvidenceId] = useState("");
  const [failureModeId, setFailureModeId] = useState("");
  const [failureComponentId, setFailureComponentId] = useState("");
  const [failureBasis, setFailureBasis] = useState("");
  const [failureEvidenceId, setFailureEvidenceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const asset = workspace.data?.assets.find((item) => item.id === assetId);
  const evidence = useMemo(
    () =>
      (workspace.data?.evidence ?? []).filter(
        (item) => item.assetId === null || item.assetId === assetId,
      ),
    [assetId, workspace.data],
  );
  const parentLevel =
    level === "maintainable_item"
      ? "assembly"
      : level === "component"
        ? "maintainable_item"
        : null;
  const parentOptions = (asset?.components ?? []).filter(
    (item) => item.level === parentLevel && item.recordedAt,
  );
  const governedComponents = (asset?.components ?? []).filter(
    (item) => item.level === "component" && item.recordedAt,
  );
  const fmmEaModes = (asset?.failureModes ?? []).filter(
    (item) => item.mechanism,
  );

  useEffect(() => {
    setComponentId("");
    setName("");
    setType("");
    setLevel("assembly");
    setParentId("");
    setEvidenceId("");
    setFailureModeId("");
    setFailureComponentId("");
    setFailureEvidenceId("");
  }, [assetId]);

  useEffect(() => {
    setParentId("");
  }, [level]);

  if (workspace.loading)
    return <LoadingState label="Loading canonical asset hierarchy" />;
  if (workspace.error)
    return <ErrorState message={workspace.error} onRetry={workspace.refetch} />;

  function chooseExisting(nextId: string) {
    setComponentId(nextId);
    const existing = asset?.components.find((item) => item.id === nextId);
    if (!existing) {
      setName("");
      setType("");
      setLevel("assembly");
      setParentId("");
      setBasis("");
      setEvidenceId("");
      return;
    }
    setName(existing.name);
    setType(existing.type ?? "");
    setLevel(existing.level);
    setParentId(existing.parentComponentId ?? "");
    setBasis(existing.basis ?? "");
    setEvidenceId(existing.evidenceItemId ?? "");
  }

  async function saveNode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await recordComponentHierarchyNode({
        assetId,
        componentId: componentId || null,
        name,
        type: type || null,
        hierarchyLevel: level,
        parentComponentId: parentId || null,
        basis,
        evidenceItemId: evidenceId,
      });
      setMessage(
        "Hierarchy node recorded with verified evidence. No engineering or operating determination was inferred.",
      );
      await workspace.refetch();
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Could not record node",
      );
    } finally {
      setBusy(false);
    }
  }

  async function bindMode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await bindFailureModeToComponent({
        failureModeId,
        componentId: failureComponentId,
        basis: failureBasis,
        evidenceItemId: failureEvidenceId,
      });
      setMessage(
        "Existing governed FMMEA identity bound to its component. Occurrence, condition and maintenance need remain separate evidence-backed determinations.",
      );
      await workspace.refetch();
    } catch (caught) {
      setMessage(
        caught instanceof Error
          ? caught.message
          : "Could not bind failure mode",
      );
    } finally {
      setBusy(false);
    }
  }

  const summary = workspace.data?.summary;

  return (
    <section
      aria-labelledby="canonical-asset-hierarchy-heading"
      className="rounded-2xl border border-cyan-400/15 bg-cyan-400/4 p-5"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-cyan-400/10 p-2 text-cyan-300">
          <GitBranch className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h3
            id="canonical-asset-hierarchy-heading"
            className="text-sm font-semibold text-white"
          >
            Canonical asset hierarchy
          </h3>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-slate-400">
            Enterprise → verified service → system → location → asset → assembly
            → maintainable item → component → governed FMMEA failure mode. Every
            layer reuses its canonical record; missing layers stay visible
            rather than being filled by inference.
          </p>
        </div>
      </div>

      {summary ? (
        <div className="mt-4 rounded-xl border border-white/8 bg-black/10 p-4 text-xs text-slate-300">
          <p>
            {summary.completePaths} of {summary.assets} bounded asset path(s)
            are complete.
          </p>
          <p className="mt-1 text-slate-500">{summary.basis}</p>
        </div>
      ) : null}

      {message ? (
        <p className="mt-4 rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3 text-xs text-slate-200">
          {message}
        </p>
      ) : null}

      <label className="mt-4 block text-xs font-semibold text-slate-300">
        Canonical asset for hierarchy authoring
        <select
          value={assetId}
          onChange={(event) => setAssetId(event.target.value)}
          className={fieldClass}
        >
          <option value="">Select an asset</option>
          {(workspace.data?.assets ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.tag ? `${item.tag} · ` : ""}
              {item.name} · {item.complete ? "complete" : "gaps remain"}
            </option>
          ))}
        </select>
      </label>

      {asset ? (
        <>
          <div className="mt-4 rounded-xl border border-white/8 bg-black/10 p-4">
            <div className="flex flex-wrap gap-2 text-[11px]">
              {[
                asset.enterprise,
                asset.service,
                asset.system,
                asset.location,
                asset.name,
              ]
                .filter(Boolean)
                .map((value, index) => (
                  <span
                    key={`${value}-${index}`}
                    className="rounded-full border border-white/10 bg-white/4 px-2.5 py-1 text-slate-200"
                  >
                    {value}
                  </span>
                ))}
              {asset.components.map((item) => (
                <span
                  key={item.id}
                  className={`rounded-full border px-2.5 py-1 ${item.recordedAt ? "border-cyan-400/25 bg-cyan-400/8 text-cyan-100" : "border-amber-400/25 bg-amber-400/8 text-amber-100"}`}
                >
                  {item.level.replaceAll("_", " ")}: {item.name}
                </span>
              ))}
            </div>
            {asset.gaps.length ? (
              <p className="mt-3 text-xs text-amber-200">
                Missing: {asset.gaps.join(" · ")}
              </p>
            ) : (
              <p className="mt-3 text-xs text-emerald-300">
                Complete governed path, including a component-bound FMMEA
                failure mode.
              </p>
            )}
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <form className="space-y-3" onSubmit={saveNode}>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-200">
                Physical breakdown
              </h4>
              <label className="block text-xs text-slate-300">
                Existing component record (optional)
                <select
                  aria-label="Existing hierarchy node"
                  value={componentId}
                  onChange={(event) => chooseExisting(event.target.value)}
                  className={fieldClass}
                >
                  <option value="">Create a new canonical component row</option>
                  {asset.components.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.level.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-slate-300">
                  Node name
                  <input
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="text-xs text-slate-300">
                  Component type
                  <input
                    value={type}
                    onChange={(event) => setType(event.target.value)}
                    className={fieldClass}
                  />
                </label>
              </div>
              <label className="block text-xs text-slate-300">
                Physical level
                <select
                  value={level}
                  onChange={(event) =>
                    setLevel(event.target.value as PhysicalHierarchyLevel)
                  }
                  className={fieldClass}
                >
                  <option value="assembly">Assembly</option>
                  <option value="maintainable_item">Maintainable item</option>
                  <option value="component">Component</option>
                </select>
              </label>
              {parentLevel ? (
                <label className="block text-xs text-slate-300">
                  Exact parent
                  <select
                    required
                    value={parentId}
                    onChange={(event) => setParentId(event.target.value)}
                    className={fieldClass}
                  >
                    <option value="">
                      Select {parentLevel.replaceAll("_", " ")}
                    </option>
                    {parentOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="block text-xs text-slate-300">
                Verified hierarchy evidence
                <select
                  required
                  value={evidenceId}
                  onChange={(event) => setEvidenceId(event.target.value)}
                  className={fieldClass}
                >
                  <option value="">Select verified evidence</option>
                  {evidence.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.evidenceClass ?? "UNCLASSIFIED"} ·{" "}
                      {item.description}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-slate-300">
                Parentage basis and limitations
                <textarea
                  required
                  minLength={20}
                  value={basis}
                  onChange={(event) => setBasis(event.target.value)}
                  className={`${fieldClass} min-h-24`}
                />
              </label>
              <button
                type="submit"
                disabled={
                  busy ||
                  !name ||
                  !evidenceId ||
                  basis.trim().length < 20 ||
                  Boolean(parentLevel && !parentId)
                }
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950 disabled:opacity-45"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden />
                Record hierarchy node
              </button>
            </form>

            <form className="space-y-3" onSubmit={bindMode}>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-200">
                Failure-mode leaf
              </h4>
              <p className="text-xs leading-relaxed text-slate-500">
                Only an existing FMMEA row already bound to this canonical asset
                and mechanism can become a hierarchy leaf.
              </p>
              <label className="block text-xs text-slate-300">
                Governed FMMEA failure mode
                <select
                  required
                  value={failureModeId}
                  onChange={(event) => setFailureModeId(event.target.value)}
                  className={fieldClass}
                >
                  <option value="">Select failure mode</option>
                  {fmmEaModes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.failureMode} · {item.mechanism}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-slate-300">
                Governed component leaf
                <select
                  required
                  value={failureComponentId}
                  onChange={(event) =>
                    setFailureComponentId(event.target.value)
                  }
                  className={fieldClass}
                >
                  <option value="">Select component</option>
                  {governedComponents.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-slate-300">
                Verified binding evidence
                <select
                  required
                  value={failureEvidenceId}
                  onChange={(event) => setFailureEvidenceId(event.target.value)}
                  className={fieldClass}
                >
                  <option value="">Select verified evidence</option>
                  {evidence.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.evidenceClass ?? "UNCLASSIFIED"} ·{" "}
                      {item.description}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-slate-300">
                Component-binding basis and limitations
                <textarea
                  required
                  minLength={20}
                  value={failureBasis}
                  onChange={(event) => setFailureBasis(event.target.value)}
                  className={`${fieldClass} min-h-24`}
                />
              </label>
              <button
                type="submit"
                disabled={
                  busy ||
                  !failureModeId ||
                  !failureComponentId ||
                  !failureEvidenceId ||
                  failureBasis.trim().length < 20
                }
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/30 px-4 py-2 text-xs font-semibold text-cyan-100 disabled:opacity-45"
              >
                <Link2 className="h-4 w-4" aria-hidden />
                Bind failure mode to component
              </button>
            </form>
          </div>
        </>
      ) : null}

      <p className="mt-5 border-t border-white/8 pt-4 text-[11px] leading-relaxed text-slate-500">
        {workspace.data?.authority}
      </p>
    </section>
  );
}
