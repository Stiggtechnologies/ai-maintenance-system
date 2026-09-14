import { useState } from "react";
import { CheckCircle2, FilePenLine, ShieldCheck } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { useAuth } from "./AuthProvider";
import { ErrorState, LoadingState } from "./ui/AsyncStates";
import {
  CONFIGURATION_AUTHOR_ROLES,
  CONFIGURATION_REVIEWER_ROLES,
  decideConfigurationAuthority,
  getConfigurationAuthoringWorkspace,
  proposeConfigurationAuthority,
  recordConfigurationBaseline,
  recordConfigurationReconciliation,
  recordModelVariant,
  recordRedLine,
} from "../services/configurationManagement";

type Mode =
  | "baseline"
  | "variant"
  | "substitution"
  | "interchangeability"
  | "red_line"
  | "reconciliation";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-industrial-black px-3 py-2 text-sm text-slate-200";
const actionClass =
  "rounded-lg border border-signal-cyan/35 bg-signal-cyan/10 px-3 py-2 text-sm font-medium text-signal-cyan disabled:opacity-40";

const EMPTY = {
  assetId: "",
  baselineKind: "as_maintained" as const,
  sourceReference: "",
  evidenceBasis: "",
  changeReference: "",
  positionRef: "",
  partNumber: "",
  serialNumber: "",
  firmwareVersion: "",
  softwareVersion: "",
  quantity: "1",
  safetyCritical: false,
  safetyBasis: "",
  manufacturer: "",
  model: "",
  variantCode: "",
  attributes: "",
  fromId: "",
  toId: "",
  conditions: "",
  expiresAt: "",
  interchangeKind: "conditional" as const,
  drawingReference: "",
  drawingRevision: "",
  description: "",
  trigger: "outage" as const,
  differences: "0",
  safetyDifferences: "0",
};

export function ConfigurationAuthoring({ onSaved }: { onSaved?: () => void }) {
  const { profile } = useAuth();
  const role = profile?.role ?? "";
  const workspace = useAsyncData(getConfigurationAuthoringWorkspace, []);
  const [mode, setMode] = useState<Mode>("baseline");
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reviewNote, setReviewNote] = useState("");

  if (workspace.loading)
    return <LoadingState label="Loading configuration authoring controls" />;
  if (workspace.error)
    return <ErrorState message={workspace.error} onRetry={workspace.refetch} />;
  if (!(CONFIGURATION_AUTHOR_ROLES as readonly string[]).includes(role))
    return null;

  const data = workspace.data;
  const change = <K extends keyof typeof form>(
    key: K,
    value: (typeof form)[K],
  ) => setForm((current) => ({ ...current, [key]: value }));
  const run = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage("");
    try {
      await work();
      setMessage(success);
      setForm(EMPTY);
      await workspace.refetch();
      onSaved?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (mode === "baseline")
      return run(
        () =>
          recordConfigurationBaseline({
            assetId: form.assetId,
            baselineKind: form.baselineKind,
            sourceReference: form.sourceReference,
            evidenceBasis: form.evidenceBasis,
            engineeringChangeReference: form.changeReference || undefined,
            items: [
              {
                positionRef: form.positionRef,
                partNumber: form.partNumber || undefined,
                quantity: Number(form.quantity),
                serialNumber: form.serialNumber || undefined,
                firmwareVersion: form.firmwareVersion || undefined,
                softwareVersion: form.softwareVersion || undefined,
                safetyCritical: form.safetyCritical,
                safetyBasis: form.safetyBasis || undefined,
              },
            ],
          }),
        "Configuration baseline recorded with item and serial provenance.",
      );
    if (mode === "variant")
      return run(
        () =>
          recordModelVariant({
            manufacturer: form.manufacturer,
            model: form.model,
            variantCode: form.variantCode,
            distinguishingAttributes: form.attributes,
            evidenceBasis: form.evidenceBasis,
          }),
        "Controlled model variant recorded.",
      );
    if (mode === "substitution")
      return run(
        () =>
          proposeConfigurationAuthority("substitution", {
            specified_material_id: form.fromId,
            substitute_material_id: form.toId,
            conditions: form.conditions,
            expires_at: form.expiresAt,
            is_bidirectional: false,
            evidence_basis: form.evidenceBasis,
          }),
        "Substitution proposed and held for independent approval.",
      );
    if (mode === "interchangeability")
      return run(
        () =>
          proposeConfigurationAuthority("interchangeability", {
            from_variant_id: Number(form.fromId),
            to_variant_id: Number(form.toId),
            interchange_kind: form.interchangeKind,
            conditions: form.conditions,
            evidence_basis: form.evidenceBasis,
          }),
        "Interchangeability rule proposed and held for independent approval.",
      );
    if (mode === "red_line")
      return run(
        () =>
          recordRedLine({
            assetId: form.assetId || undefined,
            drawingReference: form.drawingReference,
            drawingRevision: form.drawingRevision || undefined,
            changeDescription: form.description,
            evidenceBasis: form.evidenceBasis,
          }),
        "Red-line recorded for controlled disposition.",
      );
    return run(
      () =>
        recordConfigurationReconciliation({
          assetId: form.assetId,
          trigger: form.trigger,
          differencesFound: Number(form.differences),
          safetyCriticalDifferences: Number(form.safetyDifferences),
          summary: form.description,
          evidenceBasis: form.evidenceBasis,
          engineeringChangeReference: form.changeReference || undefined,
        }),
      "Configuration reconciliation recorded; differences remain under change control.",
    );
  };

  const assetSelect = (
    <select
      aria-label="Configuration asset"
      className={inputClass}
      value={form.assetId}
      onChange={(event) => change("assetId", event.target.value)}
    >
      <option value="">Select asset</option>
      {(data?.assets ?? []).map((asset) => (
        <option key={asset.id} value={asset.id}>
          {asset.name} {asset.tag ? `— ${asset.tag}` : ""}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-4 rounded-xl border border-white/8 bg-overlook-deep/35 p-4">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <FilePenLine className="h-4 w-4 text-signal-cyan" aria-hidden />
          Record or propose a controlled configuration fact
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          {data?.controls.authority} {data?.controls.approval}
        </p>
      </div>

      {message && (
        <p className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-sm text-slate-200">
          {message}
        </p>
      )}

      <select
        aria-label="Configuration action"
        className={inputClass}
        value={mode}
        onChange={(event) => setMode(event.target.value as Mode)}
      >
        <option value="baseline">Baseline item and serial</option>
        <option value="variant">Product/model variant</option>
        <option value="substitution">Material substitution</option>
        <option value="interchangeability">Equipment interchangeability</option>
        <option value="red_line">Red-line drawing</option>
        <option value="reconciliation">Outage/project reconciliation</option>
      </select>

      <div className="grid gap-3 md:grid-cols-2">
        {(mode === "baseline" ||
          mode === "red_line" ||
          mode === "reconciliation") &&
          assetSelect}
        {mode === "baseline" && (
          <>
            <select
              aria-label="Baseline kind"
              className={inputClass}
              value={form.baselineKind}
              onChange={(event) =>
                change(
                  "baselineKind",
                  event.target.value as typeof form.baselineKind,
                )
              }
            >
              <option value="as_designed">As designed</option>
              <option value="as_built">As built</option>
              <option value="as_maintained">As maintained</option>
            </select>
            <input
              aria-label="Configuration source reference"
              className={inputClass}
              value={form.sourceReference}
              onChange={(event) =>
                change("sourceReference", event.target.value)
              }
              placeholder="Drawing, dossier, walkdown reference"
            />
            <input
              aria-label="Engineering change reference"
              className={inputClass}
              value={form.changeReference}
              onChange={(event) =>
                change("changeReference", event.target.value)
              }
              placeholder="MOC/change reference when revising"
            />
            <input
              aria-label="Configuration position"
              className={inputClass}
              value={form.positionRef}
              onChange={(event) => change("positionRef", event.target.value)}
              placeholder="Position (for example PLC slot 3)"
            />
            <input
              aria-label="Configuration part number"
              className={inputClass}
              value={form.partNumber}
              onChange={(event) => change("partNumber", event.target.value)}
              placeholder="Part number"
            />
            <input
              aria-label="Configuration serial number"
              className={inputClass}
              value={form.serialNumber}
              onChange={(event) => change("serialNumber", event.target.value)}
              placeholder="Serial number"
            />
            <input
              aria-label="Firmware version"
              className={inputClass}
              value={form.firmwareVersion}
              onChange={(event) =>
                change("firmwareVersion", event.target.value)
              }
              placeholder="Firmware version"
            />
            <input
              aria-label="Software version"
              className={inputClass}
              value={form.softwareVersion}
              onChange={(event) =>
                change("softwareVersion", event.target.value)
              }
              placeholder="Software version"
            />
            <input
              aria-label="Configuration quantity"
              className={inputClass}
              type="number"
              min="0.000001"
              step="any"
              value={form.quantity}
              onChange={(event) => change("quantity", event.target.value)}
            />
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={form.safetyCritical}
                onChange={(event) =>
                  change("safetyCritical", event.target.checked)
                }
              />{" "}
              Safety-critical position
            </label>
            {form.safetyCritical && (
              <input
                aria-label="Safety critical basis"
                className={inputClass}
                value={form.safetyBasis}
                onChange={(event) => change("safetyBasis", event.target.value)}
                placeholder="Why this position is safety critical"
              />
            )}
          </>
        )}
        {mode === "variant" && (
          <>
            <input
              aria-label="Variant manufacturer"
              className={inputClass}
              value={form.manufacturer}
              onChange={(event) => change("manufacturer", event.target.value)}
              placeholder="Manufacturer"
            />
            <input
              aria-label="Variant model"
              className={inputClass}
              value={form.model}
              onChange={(event) => change("model", event.target.value)}
              placeholder="Model"
            />
            <input
              aria-label="Variant code"
              className={inputClass}
              value={form.variantCode}
              onChange={(event) => change("variantCode", event.target.value)}
              placeholder="Variant code"
            />
            <input
              aria-label="Variant distinguishing attributes"
              className={inputClass}
              value={form.attributes}
              onChange={(event) => change("attributes", event.target.value)}
              placeholder="What differs from other variants"
            />
          </>
        )}
        {mode === "substitution" && (
          <>
            <select
              aria-label="Specified material"
              className={inputClass}
              value={form.fromId}
              onChange={(event) => change("fromId", event.target.value)}
            >
              <option value="">Specified material</option>
              {(data?.materials ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} — {m.description}
                </option>
              ))}
            </select>
            <select
              aria-label="Substitute material"
              className={inputClass}
              value={form.toId}
              onChange={(event) => change("toId", event.target.value)}
            >
              <option value="">Substitute material</option>
              {(data?.materials ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.code} — {m.description}
                </option>
              ))}
            </select>
            <input
              aria-label="Substitution expiry"
              className={inputClass}
              type="date"
              value={form.expiresAt}
              onChange={(event) => change("expiresAt", event.target.value)}
            />
          </>
        )}
        {mode === "interchangeability" && (
          <>
            <select
              aria-label="From variant"
              className={inputClass}
              value={form.fromId}
              onChange={(event) => change("fromId", event.target.value)}
            >
              <option value="">From variant</option>
              {(data?.variants ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.manufacturer} {v.model} — {v.variantCode}
                </option>
              ))}
            </select>
            <select
              aria-label="To variant"
              className={inputClass}
              value={form.toId}
              onChange={(event) => change("toId", event.target.value)}
            >
              <option value="">To variant</option>
              {(data?.variants ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.manufacturer} {v.model} — {v.variantCode}
                </option>
              ))}
            </select>
            <select
              aria-label="Interchangeability kind"
              className={inputClass}
              value={form.interchangeKind}
              onChange={(event) =>
                change(
                  "interchangeKind",
                  event.target.value as typeof form.interchangeKind,
                )
              }
            >
              <option value="conditional">Conditional</option>
              <option value="one_way">One way</option>
              <option value="full">Full</option>
            </select>
          </>
        )}
        {(mode === "substitution" || mode === "interchangeability") && (
          <input
            aria-label="Configuration authority conditions"
            className={inputClass}
            value={form.conditions}
            onChange={(event) => change("conditions", event.target.value)}
            placeholder="Conditions and operating boundary"
          />
        )}
        {mode === "red_line" && (
          <>
            <input
              aria-label="Drawing reference"
              className={inputClass}
              value={form.drawingReference}
              onChange={(event) =>
                change("drawingReference", event.target.value)
              }
              placeholder="Controlled drawing reference"
            />
            <input
              aria-label="Drawing revision"
              className={inputClass}
              value={form.drawingRevision}
              onChange={(event) =>
                change("drawingRevision", event.target.value)
              }
              placeholder="Current revision"
            />
          </>
        )}
        {mode === "reconciliation" && (
          <>
            <select
              aria-label="Reconciliation trigger"
              className={inputClass}
              value={form.trigger}
              onChange={(event) =>
                change("trigger", event.target.value as typeof form.trigger)
              }
            >
              <option value="outage">Outage</option>
              <option value="project">Project</option>
              <option value="audit">Audit</option>
              <option value="incident">Incident</option>
              <option value="scheduled">Scheduled</option>
              <option value="onboarding">Onboarding</option>
            </select>
            <input
              aria-label="Differences found"
              className={inputClass}
              type="number"
              min="0"
              value={form.differences}
              onChange={(event) => change("differences", event.target.value)}
            />
            <input
              aria-label="Safety critical differences"
              className={inputClass}
              type="number"
              min="0"
              value={form.safetyDifferences}
              onChange={(event) =>
                change("safetyDifferences", event.target.value)
              }
            />
            <input
              aria-label="Reconciliation change reference"
              className={inputClass}
              value={form.changeReference}
              onChange={(event) =>
                change("changeReference", event.target.value)
              }
              placeholder="MOC/change reference if differences exist"
            />
          </>
        )}
        {(mode === "red_line" || mode === "reconciliation") && (
          <input
            aria-label="Configuration description"
            className={inputClass}
            value={form.description}
            onChange={(event) => change("description", event.target.value)}
            placeholder={
              mode === "red_line"
                ? "Field change observed"
                : "Reconciliation summary"
            }
          />
        )}
        <textarea
          aria-label="Configuration evidence basis"
          className={`${inputClass} md:col-span-2`}
          value={form.evidenceBasis}
          onChange={(event) => change("evidenceBasis", event.target.value)}
          placeholder="Controlled evidence reviewed and applicability basis (20+ characters)"
        />
      </div>
      <button className={actionClass} disabled={busy} onClick={submit}>
        Save controlled record
      </button>

      {(data?.pendingAuthority.length ?? 0) > 0 && (
        <div className="space-y-2 border-t border-white/8 pt-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-white">
            <ShieldCheck className="h-4 w-4 text-amber-300" aria-hidden />{" "}
            Pending independent authority
          </h4>
          <textarea
            aria-label="Configuration review note"
            className={inputClass}
            value={reviewNote}
            onChange={(event) => setReviewNote(event.target.value)}
            placeholder="Independent review note (20+ characters)"
          />
          {(data?.pendingAuthority ?? []).map((item) => {
            const own = item.proposedBy === profile?.id;
            const mayReview =
              (CONFIGURATION_REVIEWER_ROLES as readonly string[]).includes(
                role,
              ) && !own;
            return (
              <div
                key={`${item.kind}-${item.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/8 p-3"
              >
                <div>
                  <p className="text-sm text-slate-200">{item.label}</p>
                  <p className="text-[11px] text-slate-500">
                    {item.kind} ·{" "}
                    {own ? "you proposed this" : "independent proposal"}
                  </p>
                </div>
                {mayReview && (
                  <div className="flex gap-2">
                    <button
                      className={actionClass}
                      disabled={busy || reviewNote.trim().length < 20}
                      onClick={() =>
                        run(
                          () =>
                            decideConfigurationAuthority(
                              item.kind,
                              item.id,
                              "approved",
                              reviewNote,
                            ),
                          "Configuration authority approved independently.",
                        )
                      }
                    >
                      <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />
                      Approve
                    </button>
                    <button
                      className="rounded-lg border border-rose-400/30 px-3 py-2 text-sm text-rose-300 disabled:opacity-40"
                      disabled={busy || reviewNote.trim().length < 20}
                      onClick={() =>
                        run(
                          () =>
                            decideConfigurationAuthority(
                              item.kind,
                              item.id,
                              "rejected",
                              reviewNote,
                            ),
                          "Configuration authority rejected with rationale.",
                        )
                      }
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
