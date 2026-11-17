import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, ShieldCheck } from "lucide-react";
import {
  getEnvironmentalEvidenceWorkspace,
  recordEnvironmentalEvidence,
  type EnvironmentalActivityInput,
  type EnvironmentalEvidenceKind,
  type EnvironmentalEvidenceWorkspace,
  type HazardousInventoryInput,
} from "../services/environmentalEvidenceService";

const fieldClass =
  "mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none focus:border-signal-cyan/60";

const modes: Array<{ value: EnvironmentalEvidenceKind; label: string }> = [
  { value: "efficiency_baseline", label: "Efficiency baseline" },
  { value: "efficiency_reading", label: "Efficiency reading" },
  {
    value: "environmental_activity",
    label: "Environmental activity or loss",
  },
  { value: "emission_factor", label: "Emission factor" },
  {
    value: "hazardous_inventory",
    label: "Hazardous material or battery",
  },
];

function numberValue(form: FormData, name: string) {
  const raw = String(form.get(name) ?? "").trim();
  return raw === "" ? null : Number(raw);
}

function requiredNumberValue(form: FormData, name: string, label: string) {
  const value = numberValue(form, name);
  if (value == null || !Number.isFinite(value)) {
    throw new Error(`${label} is required and must be a finite number.`);
  }
  return value;
}

function textValue(form: FormData, name: string) {
  return String(form.get(name) ?? "").trim();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function EnvironmentalEvidenceManagement() {
  const [workspace, setWorkspace] =
    useState<EnvironmentalEvidenceWorkspace | null>(null);
  const [mode, setMode] = useState<EnvironmentalEvidenceKind>(
    "efficiency_baseline",
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setWorkspace(await getEnvironmentalEvidenceWorkspace());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The environmental evidence workspace could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const latestHazards = useMemo(
    () =>
      new Map(
        (workspace?.hazardousInventory ?? []).map((row) => [
          row.inventoryRef,
          row,
        ]),
      ),
    [workspace],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const basis = textValue(form, "basis");
    const sourceReference = textValue(form, "sourceReference");
    const evidenceItemId = textValue(form, "evidenceItemId");
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      let receipt;
      if (mode === "emission_factor") {
        receipt = await recordEnvironmentalEvidence(mode, {
          factorKey: textValue(form, "factorKey"),
          label: textValue(form, "label"),
          activityUnit: textValue(form, "activityUnit"),
          factor: requiredNumberValue(form, "factor", "Emission factor"),
          factorUnit: textValue(form, "factorUnit"),
          validFrom: textValue(form, "validFrom"),
          gwp: numberValue(form, "gwp"),
          basis,
          sourceReference,
          evidenceItemId,
        });
      } else if (mode === "efficiency_baseline") {
        const assetId = textValue(form, "assetId");
        const metric = textValue(form, "metric");
        const existing = (workspace?.baselines ?? []).find(
          (row) =>
            row.assetId === assetId &&
            row.metric.toLowerCase() === metric.toLowerCase(),
        );
        receipt = await recordEnvironmentalEvidence(mode, {
          assetId,
          metric,
          unit: textValue(form, "unit"),
          designValue: requiredNumberValue(form, "designValue", "Design value"),
          establishedOn: textValue(form, "establishedOn"),
          interventionCost: numberValue(form, "interventionCost"),
          energyCostPerDay: numberValue(form, "energyCostPerDay"),
          expectedVersion: existing?.version ?? 0,
          basis,
          sourceReference,
          evidenceItemId,
        });
      } else if (mode === "efficiency_reading") {
        receipt = await recordEnvironmentalEvidence(mode, {
          baselineId: Number(textValue(form, "baselineId")),
          measuredOn: textValue(form, "measuredOn"),
          value: requiredNumberValue(form, "value", "Measured value"),
          basis,
          sourceReference,
          evidenceItemId,
        });
      } else if (mode === "environmental_activity") {
        const attributable = textValue(form, "maintenanceAttributable");
        receipt = await recordEnvironmentalEvidence(mode, {
          activityKind: textValue(
            form,
            "activityKind",
          ) as EnvironmentalActivityInput["activityKind"],
          siteId: textValue(form, "siteId") || null,
          assetId: textValue(form, "assetId") || null,
          periodStart: textValue(form, "periodStart"),
          periodEnd: textValue(form, "periodEnd"),
          quantity: requiredNumberValue(form, "quantity", "Activity quantity"),
          unit: textValue(form, "unit"),
          substance: textValue(form, "substance") || null,
          factorKey: textValue(form, "factorKey") || null,
          scope: (textValue(form, "scope") || null) as
            "scope_1" | "scope_2" | "scope_3" | null,
          maintenanceAttributable:
            attributable === "true"
              ? true
              : attributable === "false"
                ? false
                : null,
          note: textValue(form, "note") || null,
          basis,
          sourceReference,
          evidenceItemId,
        });
      } else {
        const inventoryRef = textValue(form, "inventoryRef");
        receipt = await recordEnvironmentalEvidence(mode, {
          inventoryRef,
          expectedVersion: latestHazards.get(inventoryRef)?.version ?? 0,
          assetId: textValue(form, "assetId") || null,
          substance: textValue(form, "substance"),
          category: textValue(
            form,
            "category",
          ) as HazardousInventoryInput["category"],
          quantity: numberValue(form, "quantity"),
          unit: textValue(form, "unit") || null,
          location: textValue(form, "location"),
          handlingRequirements: textValue(form, "handlingRequirements"),
          emergencyResponseReference: textValue(
            form,
            "emergencyResponseReference",
          ),
          regulatoryReference: textValue(form, "regulatoryReference"),
          disposalRouteRequired: textValue(form, "disposalRouteRequired"),
          endOfLifePlanned: form.get("endOfLifePlanned") === "on",
          basis,
          sourceReference,
          evidenceItemId,
        });
      }
      if (
        receipt.complianceCertified !== false ||
        receipt.reportableInventory !== false ||
        receipt.workAuthorized !== false ||
        receipt.riskAccepted !== false ||
        receipt.returnToServiceAuthorized !== false
      ) {
        throw new Error(
          "Unexpected authority response from environmental writer.",
        );
      }
      setNotice(
        "Environmental evidence recorded. No compliance, reporting, work, risk or return-to-service authority was granted.",
      );
      event.currentTarget.reset();
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The environmental evidence could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="environmental-evidence-title"
      className="rounded-xl border border-white/8 bg-white/[0.02] p-4"
    >
      <div className="flex items-start gap-3">
        <ClipboardCheck
          className="mt-0.5 h-5 w-5 shrink-0 text-signal-cyan"
          aria-hidden
        />
        <div>
          <h3
            id="environmental-evidence-title"
            className="font-semibold text-white"
          >
            Governed environmental evidence
          </h3>
          <p className="mt-1 max-w-4xl text-sm text-slate-400">
            Record verified baselines, readings, factors, losses and hazardous
            materials in the canonical registers. Unknowns stay unknown and
            every accepted record retains its source and independent evidence.
          </p>
        </div>
      </div>

      {loading && (
        <p className="mt-4 text-sm text-slate-400">
          Loading evidence controls…
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-500/30 p-3 text-sm text-red-200"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-emerald-500/30 p-3 text-sm text-emerald-200"
        >
          {notice}
        </p>
      )}

      {!loading && workspace && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              ["Efficiency baselines", workspace.baselines.length],
              ["Emission-factor versions", workspace.emissionFactors.length],
              ["Current hazardous items", workspace.hazardousInventory.length],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-white/8 p-3">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 font-mono text-xl text-white">{value}</p>
              </div>
            ))}
          </div>

          <p className="mt-4 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-100">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {workspace.decisionBoundary}
          </p>

          {!workspace.canRecord ? (
            <p className="mt-4 text-sm text-slate-400">
              An AAL2 named-human session is required to record environmental
              evidence. This read view remains available without write
              authority.
            </p>
          ) : (
            <form onSubmit={submit} className="mt-4 grid gap-4 lg:grid-cols-2">
              <label className="text-xs text-slate-400 lg:col-span-2">
                Evidence record type
                <select
                  className={fieldClass}
                  value={mode}
                  onChange={(event) => {
                    setMode(event.target.value as EnvironmentalEvidenceKind);
                    setError(null);
                    setNotice(null);
                  }}
                >
                  {modes.map((candidate) => (
                    <option key={candidate.value} value={candidate.value}>
                      {candidate.label}
                    </option>
                  ))}
                </select>
              </label>

              {mode === "emission_factor" && (
                <>
                  <TextField name="factorKey" label="Factor key" required />
                  <TextField name="label" label="Factor label" required />
                  <TextField
                    name="activityUnit"
                    label="Activity unit"
                    required
                  />
                  <NumberField name="factor" label="Factor" positive required />
                  <TextField name="factorUnit" label="Factor unit" required />
                  <DateField name="validFrom" label="Valid from" required />
                  <NumberField name="gwp" label="GWP (optional)" positive />
                </>
              )}

              {mode === "efficiency_baseline" && (
                <>
                  <AssetField assets={workspace.assets} />
                  <TextField name="metric" label="Efficiency metric" required />
                  <TextField name="unit" label="Unit" required />
                  <NumberField
                    name="designValue"
                    label="Design or clean-condition value"
                    positive
                    required
                  />
                  <DateField
                    name="establishedOn"
                    label="Established on"
                    required
                  />
                  <NumberField
                    name="interventionCost"
                    label="Intervention cost (optional)"
                  />
                  <NumberField
                    name="energyCostPerDay"
                    label="Energy cost per day (optional)"
                  />
                </>
              )}

              {mode === "efficiency_reading" && (
                <>
                  <label className="text-xs text-slate-400">
                    Efficiency baseline
                    <select className={fieldClass} name="baselineId" required>
                      <option value="">Choose a baseline</option>
                      {workspace.baselines.map((baseline) => (
                        <option key={baseline.id} value={baseline.id}>
                          {baseline.assetName} · {baseline.metric} (
                          {baseline.unit})
                        </option>
                      ))}
                    </select>
                  </label>
                  <DateField
                    name="measuredOn"
                    label="Measurement date"
                    required
                  />
                  <NumberField
                    name="value"
                    label="Measured value"
                    positive
                    required
                  />
                </>
              )}

              {mode === "environmental_activity" && (
                <>
                  <label className="text-xs text-slate-400">
                    Activity type
                    <select className={fieldClass} name="activityKind" required>
                      {[
                        "fuel_burn",
                        "electricity",
                        "flaring",
                        "venting",
                        "fugitive_methane",
                        "water_withdrawal",
                        "water_discharge",
                        "waste_generated",
                        "hazardous_waste",
                        "lubricant_loss",
                        "chemical_loss",
                      ].map((value) => (
                        <option key={value} value={value}>
                          {value.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-slate-400">
                    Site (optional)
                    <select className={fieldClass} name="siteId">
                      <option value="">No site selected</option>
                      {workspace.sites.map((site) => (
                        <option key={site.id} value={site.id}>
                          {site.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <AssetField assets={workspace.assets} optional />
                  <DateField name="periodStart" label="Period start" required />
                  <DateField name="periodEnd" label="Period end" required />
                  <NumberField name="quantity" label="Quantity" required />
                  <TextField name="unit" label="Unit" required />
                  <TextField
                    name="substance"
                    label="Substance or product"
                    placeholder="Required for lubricant or chemical loss"
                  />
                  <label className="text-xs text-slate-400">
                    Emission factor (optional)
                    <select className={fieldClass} name="factorKey">
                      <option value="">No emissions claim</option>
                      {workspace.emissionFactors.map((factor) => (
                        <option key={factor.id} value={factor.factorKey}>
                          {factor.label} · {factor.validFrom}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-slate-400">
                    Scope (required with factor)
                    <select className={fieldClass} name="scope">
                      <option value="">No scope</option>
                      <option value="scope_1">Scope 1</option>
                      <option value="scope_2">Scope 2</option>
                      <option value="scope_3">Scope 3</option>
                    </select>
                  </label>
                  <label className="text-xs text-slate-400">
                    Maintenance attribution
                    <select
                      className={fieldClass}
                      name="maintenanceAttributable"
                    >
                      <option value="">Undetermined</option>
                      <option value="true">Maintenance-attributable</option>
                      <option value="false">
                        Not maintenance-attributable
                      </option>
                    </select>
                  </label>
                  <TextField name="note" label="Observation note (optional)" />
                </>
              )}

              {mode === "hazardous_inventory" && (
                <>
                  <TextField
                    name="inventoryRef"
                    label="Inventory reference"
                    required
                  />
                  <AssetField assets={workspace.assets} optional />
                  <TextField
                    name="substance"
                    label="Substance or material"
                    required
                  />
                  <label className="text-xs text-slate-400">
                    Category
                    <select className={fieldClass} name="category" required>
                      {[
                        "battery",
                        "refrigerant",
                        "solvent",
                        "lubricant",
                        "reagent",
                        "radioactive_source",
                        "asbestos",
                        "other",
                      ].map((value) => (
                        <option key={value} value={value}>
                          {value.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <NumberField
                    name="quantity"
                    label="Quantity (optional)"
                    positive
                  />
                  <TextField name="unit" label="Unit (with quantity)" />
                  <TextField
                    name="location"
                    label="Controlled location"
                    required
                  />
                  <TextField
                    name="handlingRequirements"
                    label="Handling requirements"
                    required
                  />
                  <TextField
                    name="emergencyResponseReference"
                    label="Emergency-response reference"
                    required
                  />
                  <TextField
                    name="regulatoryReference"
                    label="Regulatory reference"
                    required
                  />
                  <TextField
                    name="disposalRouteRequired"
                    label="Required disposal route"
                    required
                  />
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    <input type="checkbox" name="endOfLifePlanned" />
                    End-of-life route is planned
                  </label>
                </>
              )}

              <label className="text-xs text-slate-400 lg:col-span-2">
                Evidence basis
                <textarea
                  className={`${fieldClass} min-h-24`}
                  name="basis"
                  minLength={20}
                  required
                />
              </label>
              <TextField
                name="sourceReference"
                label="Source reference"
                required
              />
              <label className="text-xs text-slate-400">
                Verified evidence
                <select className={fieldClass} name="evidenceItemId" required>
                  <option value="">
                    Choose independently verified evidence
                  </option>
                  {workspace.verifiedEvidence.map((evidence) => (
                    <option key={evidence.id} value={evidence.id}>
                      {evidence.description ?? evidence.id} ·{" "}
                      {evidence.sourceSystem ?? "source unspecified"}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={busy || workspace.verifiedEvidence.length === 0}
                className="rounded-lg bg-signal-cyan px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50 lg:col-span-2"
              >
                {busy ? "Recording…" : "Record evidence"}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

function TextField({
  name,
  label,
  required = false,
  placeholder,
}: {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="text-xs text-slate-400">
      {label}
      <input
        className={fieldClass}
        name={name}
        required={required}
        placeholder={placeholder}
      />
    </label>
  );
}

function NumberField({
  name,
  label,
  required = false,
  positive = false,
}: {
  name: string;
  label: string;
  required?: boolean;
  positive?: boolean;
}) {
  return (
    <label className="text-xs text-slate-400">
      {label}
      <input
        className={fieldClass}
        name={name}
        type="number"
        step="any"
        min={positive ? "0.000000001" : "0"}
        required={required}
      />
    </label>
  );
}

function DateField({
  name,
  label,
  required = false,
}: {
  name: string;
  label: string;
  required?: boolean;
}) {
  return (
    <label className="text-xs text-slate-400">
      {label}
      <input
        className={fieldClass}
        name={name}
        type="date"
        max={today()}
        defaultValue={today()}
        required={required}
      />
    </label>
  );
}

function AssetField({
  assets,
  optional = false,
}: {
  assets: EnvironmentalEvidenceWorkspace["assets"];
  optional?: boolean;
}) {
  return (
    <label className="text-xs text-slate-400">
      {optional ? "Asset (optional)" : "Asset"}
      <select className={fieldClass} name="assetId" required={!optional}>
        <option value="">
          {optional ? "No asset selected" : "Choose an asset"}
        </option>
        {assets.map((asset) => (
          <option key={asset.id} value={asset.id}>
            {asset.name} {asset.assetClass ? `· ${asset.assetClass}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
