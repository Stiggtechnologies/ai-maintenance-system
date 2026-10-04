import { useCallback, useEffect, useMemo, useState } from "react";
import { FileCheck2, ShieldCheck, TriangleAlert } from "lucide-react";
import { useAuth } from "./AuthProvider";
import {
  getSafetyCriticalRegulatoryWorkspace,
  linkSafetyCriticalRegulatoryObligation,
  recordSafetyCriticalElement,
  type SafetyCriticalElement,
  type SafetyCriticalRegulatoryWorkspace,
} from "../services/safetyCriticalRegulatoryService";

const EDITOR_ROLES = new Set([
  "admin",
  "executive",
  "maintenance_manager",
  "reliability_engineer",
]);

const control =
  "mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-2 text-sm text-slate-100";

function dateValue(value: string | null | undefined) {
  return value?.slice(0, 10) ?? "";
}

function noAuthority(result: {
  complianceEstablished: boolean;
  workAuthorized: boolean;
  riskAccepted: boolean;
  operatingLimitChanged: boolean;
  returnToServiceAuthorized: boolean;
}) {
  if (
    result.complianceEstablished !== false ||
    result.workAuthorized !== false ||
    result.riskAccepted !== false ||
    result.operatingLimitChanged !== false ||
    result.returnToServiceAuthorized !== false
  )
    throw new Error("Unexpected authority response from the governed writer.");
}

export function SafetyCriticalRegulatoryRegister() {
  const { profile } = useAuth();
  const [workspace, setWorkspace] =
    useState<SafetyCriticalRegulatoryWorkspace | null>(null);
  const [selectedElementId, setSelectedElementId] = useState("");
  const [draftAssetId, setDraftAssetId] = useState("");
  const [linkElementId, setLinkElementId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setWorkspace(await getSafetyCriticalRegulatoryWorkspace());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The safety-critical register could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const selectedElement = useMemo(
    () =>
      workspace?.elements.find(
        (element) => String(element.id) === selectedElementId,
      ) ?? null,
    [selectedElementId, workspace],
  );
  const linkElement = useMemo(
    () =>
      workspace?.elements.find(
        (element) => String(element.id) === linkElementId,
      ) ?? null,
    [linkElementId, workspace],
  );
  const mandatoryRequirements = useMemo(
    () =>
      (workspace?.regulatoryRequirements ?? []).filter(
        (requirement) =>
          requirement.applicability === "applicable" &&
          requirement.obligation === "mandatory",
      ),
    [workspace],
  );
  const evidenceForAsset = useCallback(
    (assetId: string | null | undefined) =>
      (workspace?.verifiedEvidence ?? []).filter(
        (evidence) => evidence.assetId == null || evidence.assetId === assetId,
      ),
    [workspace],
  );
  const canEdit = EDITOR_ROLES.has(profile?.role ?? "");

  async function submitElement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "").trim();
    const interval = value("testIntervalMonths");
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await recordSafetyCriticalElement({
        id: selectedElement?.id ?? null,
        assetId: value("assetId") || null,
        reference: value("reference"),
        label: value("label"),
        barrierKind: value(
          "barrierKind",
        ) as SafetyCriticalElement["barrierKind"],
        barrierRole: value(
          "barrierRole",
        ) as SafetyCriticalElement["barrierRole"],
        performanceStandard: value("performanceStandard"),
        testIntervalMonths: interval ? Number(interval) : null,
        lastTestedOn: value("lastTestedOn") || null,
        evidenceItemId: value("evidenceItemId"),
        effectiveFrom: value("effectiveFrom"),
        reviewDue: value("reviewDue") || null,
        expectedVersion: selectedElement?.version ?? 0,
      });
      noAuthority(result);
      setNotice(
        `Safety-critical element version ${result.version} recorded. No compliance or operational authority was granted.`,
      );
      await load();
      setSelectedElementId(String(result.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Recording failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const requirementValue = String(form.get("requirement") ?? "");
    const [layerId, requirementKey] = requirementValue.split("::", 2);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const selectedRequirement = mandatoryRequirements.find(
        (requirement) =>
          requirement.layerId === layerId &&
          requirement.key === requirementKey,
      );
      if (!linkElement || !selectedRequirement)
        throw new Error(
          "The selected element or requirement changed. Refresh before linking.",
        );
      const result = await linkSafetyCriticalRegulatoryObligation({
        safetyCriticalElementId: Number(linkElementId),
        expectedElementVersion: linkElement.version,
        capabilityPackLayerId: layerId,
        expectedLayerVersion: selectedRequirement.layerVersion,
        requirementKey,
        evidenceItemId: String(form.get("evidenceItemId") ?? ""),
        basis: String(form.get("basis") ?? ""),
      });
      noAuthority(result);
      setNotice(
        `Obligation linked to element version ${result.elementVersion} and jurisdiction layer version ${result.layerVersion}. This is not a compliance finding.`,
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Linking failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="safety-critical-regulatory-title"
      className="space-y-5 rounded-xl border border-white/8 bg-white/[0.02] p-4"
    >
      <div>
        <h3
          id="safety-critical-regulatory-title"
          className="flex items-center gap-2 text-sm font-semibold text-white"
        >
          <ShieldCheck className="h-4 w-4 text-signal-cyan" aria-hidden />
          Safety-critical equipment and regulatory obligations
        </h3>
        <p className="mt-1 max-w-4xl text-xs leading-relaxed text-slate-400">
          Control the element performance standard and bind it to an exact
          adopted jurisdiction requirement. Missing evidence and stale versions
          remain visible.
        </p>
      </div>

      {loading && <p className="text-xs text-slate-400">Loading register…</p>}
      {error && (
        <p
          role="alert"
          className="flex gap-2 rounded-lg border border-rose-500/30 p-3 text-xs text-rose-200"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-lg border border-emerald-500/30 p-3 text-xs text-emerald-200"
        >
          {notice}
        </p>
      )}

      {!loading && workspace && (
        <>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Elements", workspace.coverage.elements],
              [
                "Evidence-backed",
                workspace.coverage.elementsWithVerifiedEvidence,
              ],
              ["Overdue / untested", workspace.coverage.overdueOrUntested],
              [
                "Mandatory obligations",
                workspace.coverage.mandatoryRegulatoryObligations,
              ],
              ["Current links", workspace.coverage.currentBindings],
              ["Stale links", workspace.coverage.staleBindings],
            ].map(([label, count]) => (
              <div key={label} className="rounded-lg border border-white/8 p-2">
                <p className="text-[11px] text-slate-500">{label}</p>
                <p className="font-mono text-lg text-white">{count}</p>
              </div>
            ))}
          </div>

          <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-100/80">
            {workspace.decisionBoundary}
          </p>

          {canEdit && (
            <div className="grid gap-4 xl:grid-cols-2">
              <form
                key={`element:${selectedElement?.id ?? "new"}:${selectedElement?.version ?? 0}`}
                onSubmit={submitElement}
                className="space-y-3 rounded-lg border border-white/8 p-3"
              >
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                  Record or revise an element
                </h4>
                <label className="block text-xs text-slate-400">
                  Existing element
                  <select
                    value={selectedElementId}
                    onChange={(event) => {
                      setSelectedElementId(event.target.value);
                      setDraftAssetId("");
                    }}
                    className={control}
                  >
                    <option value="">Create a new element</option>
                    {workspace.elements.map((element) => (
                      <option key={element.id} value={element.id}>
                        {element.reference} · {element.label} · v
                        {element.version}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    name="reference"
                    label="Element reference"
                    value={selectedElement?.reference}
                    readOnly={Boolean(selectedElement)}
                  />
                  <Field
                    name="label"
                    label="Element label"
                    value={selectedElement?.label}
                  />
                  <label className="text-xs text-slate-400">
                    Asset (optional for non-equipment barriers)
                    <select
                      name="assetId"
                      value={selectedElement?.assetId ?? draftAssetId}
                      onChange={(event) => setDraftAssetId(event.target.value)}
                      disabled={Boolean(selectedElement)}
                      className={control}
                    >
                      <option value="">Organization-level barrier</option>
                      {workspace.assets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.tag ? `${asset.tag} · ` : ""}
                          {asset.name}
                        </option>
                      ))}
                    </select>
                    {selectedElement && (
                      <input
                        type="hidden"
                        name="assetId"
                        value={selectedElement.assetId ?? ""}
                      />
                    )}
                  </label>
                  <Choice
                    name="barrierKind"
                    label="Barrier kind"
                    value={selectedElement?.barrierKind}
                    options={[
                      "instrumented",
                      "mechanical",
                      "passive",
                      "procedural",
                      "human",
                      "structural",
                      "emergency_response",
                    ]}
                  />
                  <Choice
                    name="barrierRole"
                    label="Barrier role"
                    value={selectedElement?.barrierRole}
                    options={["preventive", "mitigative"]}
                  />
                  <Field
                    name="testIntervalMonths"
                    label="Approved test interval (months)"
                    type="number"
                    optional
                    value={selectedElement?.testIntervalMonths}
                  />
                  <Field
                    name="lastTestedOn"
                    label="Last tested on"
                    type="date"
                    optional
                    value={dateValue(selectedElement?.lastTestedOn)}
                  />
                  <Field
                    name="effectiveFrom"
                    label="Effective from"
                    type="date"
                    value={
                      dateValue(selectedElement?.effectiveFrom) ||
                      new Date().toISOString().slice(0, 10)
                    }
                  />
                  <Field
                    name="reviewDue"
                    label="Review due"
                    type="date"
                    optional
                    value={dateValue(selectedElement?.reviewDue)}
                  />
                </div>
                <label className="block text-xs text-slate-400">
                  Testable performance standard
                  <textarea
                    name="performanceStandard"
                    required
                    minLength={20}
                    maxLength={4000}
                    rows={3}
                    defaultValue={selectedElement?.performanceStandard ?? ""}
                    className={control}
                  />
                </label>
                <label className="block text-xs text-slate-400">
                  Independently verified evidence
                  <select
                    name="evidenceItemId"
                    required
                    defaultValue={selectedElement?.evidenceItemId ?? ""}
                    className={control}
                  >
                    <option value="">Choose verified evidence</option>
                    {evidenceForAsset(
                      (selectedElement?.assetId ?? draftAssetId) || null,
                    ).map((evidence) => (
                      <option key={evidence.id} value={evidence.id}>
                        {evidence.description ??
                          evidence.sourceSystem ??
                          evidence.id}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded bg-signal-cyan px-3 py-1.5 text-sm font-semibold text-slate-950 disabled:opacity-50"
                >
                  {busy
                    ? "Recording…"
                    : selectedElement
                      ? `Record version ${selectedElement.version + 1}`
                      : "Record safety-critical element"}
                </button>
              </form>

              <form
                onSubmit={submitLink}
                className="space-y-3 rounded-lg border border-white/8 p-3"
              >
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                  Link an exact regulatory obligation
                </h4>
                <label className="block text-xs text-slate-400">
                  Evidence-backed element
                  <select
                    required
                    value={linkElementId}
                    onChange={(event) => setLinkElementId(event.target.value)}
                    className={control}
                  >
                    <option value="">Choose an element</option>
                    {workspace.elements
                      .filter((element) => element.evidenceItemId)
                      .map((element) => (
                        <option key={element.id} value={element.id}>
                          {element.reference} · {element.label} · v
                          {element.version}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block text-xs text-slate-400">
                  Applicable mandatory requirement
                  <select name="requirement" required className={control}>
                    <option value="">Choose adopted requirement</option>
                    {mandatoryRequirements.map((requirement) => (
                      <option
                        key={`${requirement.layerId}:${requirement.key}`}
                        value={`${requirement.layerId}::${requirement.key}`}
                      >
                        {requirement.title} · {requirement.authorityReference} ·
                        v{requirement.layerVersion}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-slate-400">
                  Independently verified linkage evidence
                  <select name="evidenceItemId" required className={control}>
                    <option value="">Choose verified evidence</option>
                    {evidenceForAsset(linkElement?.assetId).map((evidence) => (
                      <option key={evidence.id} value={evidence.id}>
                        {evidence.description ??
                          evidence.sourceSystem ??
                          evidence.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-slate-400">
                  Applicability basis
                  <textarea
                    name="basis"
                    required
                    minLength={20}
                    maxLength={4000}
                    rows={4}
                    className={control}
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy || !linkElementId}
                  className="rounded bg-signal-cyan px-3 py-1.5 text-sm font-semibold text-slate-950 disabled:opacity-50"
                >
                  {busy ? "Linking…" : "Link obligation"}
                </button>
              </form>
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            {workspace.elements.map((element) => (
              <article
                key={element.id}
                className="rounded-lg border border-white/8 p-3 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-slate-100">
                    {element.reference} · {element.label}
                  </strong>
                  <span className="font-mono text-slate-500">
                    v{element.version}
                  </span>
                </div>
                <p className="mt-1 text-slate-400">
                  {element.assetName ?? "Organization-level barrier"} ·{" "}
                  {element.barrierKind.replaceAll("_", " ")} ·{" "}
                  {element.barrierRole}
                </p>
                <p className="mt-2 text-slate-300">
                  {element.performanceStandard}
                </p>
                <p className="mt-2 text-slate-500">
                  Test status: {element.testStatus.replaceAll("_", " ")} ·{" "}
                  {element.evidenceDescription ??
                    "Legacy element: verified evidence missing"}
                </p>
              </article>
            ))}
          </div>

          <div className="rounded-lg border border-white/8 p-3">
            <h4 className="text-sm font-semibold text-white">
              Adopted {workspace.jurisdiction ?? "tenant"} requirements
            </h4>
            {workspace.regulatoryRequirements.length ? (
              <ul className="mt-2 grid gap-2 lg:grid-cols-2">
                {workspace.regulatoryRequirements.map((requirement) => (
                  <li
                    key={`${requirement.layerId}:${requirement.key}`}
                    className="rounded border border-white/8 p-2 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-slate-200">
                        {requirement.title}
                      </strong>
                      <span className="font-mono text-slate-500">
                        v{requirement.layerVersion}
                      </span>
                    </div>
                    <p className="mt-1 text-slate-400">
                      {requirement.requirementClass} ·{" "}
                      {requirement.applicability.replaceAll("_", " ")} ·{" "}
                      {requirement.obligation.replaceAll("_", " ")}
                    </p>
                    <p className="mt-1 text-slate-500">
                      {requirement.authorityReference}
                    </p>
                    {requirement.applicability === "undetermined" && (
                      <p className="mt-2 text-amber-300">
                        Applicability is undetermined; named legal or regulatory
                        review remains open.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                No adopted regulatory or statutory requirements are resolved for
                the tenant’s current jurisdiction.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-white/8 p-3">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
              <FileCheck2 className="h-4 w-4 text-signal-cyan" aria-hidden />
              Exact-version obligation links
            </h4>
            {workspace.bindings.length ? (
              <ul className="mt-2 space-y-2 text-xs">
                {workspace.bindings.map((binding) => (
                  <li
                    key={binding.id}
                    className={`rounded border p-2 ${
                      binding.current
                        ? "border-emerald-500/20 text-slate-300"
                        : "border-amber-500/25 bg-amber-500/5 text-amber-100"
                    }`}
                  >
                    Element {binding.elementId} v{binding.elementVersion} →{" "}
                    {binding.requirementKey} · jurisdiction layer v
                    {binding.layerVersion} ·{" "}
                    {binding.current
                      ? "current exact-version link"
                      : `stale: element is now v${binding.currentElementVersion} or the jurisdiction layer was superseded`}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                No regulatory obligations are linked to safety-critical
                elements.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Field({
  name,
  label,
  type = "text",
  optional = false,
  value,
  readOnly = false,
}: {
  name: string;
  label: string;
  type?: string;
  optional?: boolean;
  value?: string | number | null;
  readOnly?: boolean;
}) {
  return (
    <label className="block text-xs text-slate-400">
      {label}
      <input
        name={name}
        type={type}
        required={!optional}
        min={type === "number" ? 1 : undefined}
        step={type === "number" ? 1 : undefined}
        readOnly={readOnly}
        defaultValue={value ?? ""}
        className={control}
      />
    </label>
  );
}

function Choice({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value?: string;
  options: string[];
}) {
  return (
    <label className="block text-xs text-slate-400">
      {label}
      <select
        name={name}
        defaultValue={value ?? options[0]}
        className={control}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );
}
