import { supabase } from "../lib/supabase";

type RpcEnvelope = { error?: unknown };

async function callRpc<T>(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const body = data as (T & RpcEnvelope) | null;
  if (body && typeof body.error === "string") throw new Error(body.error);
  if (body == null) throw new Error(`${name} returned nothing`);
  return body;
}

export type EnvironmentalEvidenceKind =
  | "emission_factor"
  | "efficiency_baseline"
  | "efficiency_reading"
  | "environmental_activity"
  | "hazardous_inventory";

export interface EnvironmentalAsset {
  id: string;
  name: string;
  assetClass: string | null;
}

export interface EnvironmentalSite {
  id: string;
  name: string;
}

export interface EnvironmentalEvidenceReference {
  id: string;
  description: string | null;
  sourceSystem: string | null;
  assetId: string | null;
  verifiedBy: string;
  verifiedAt: string;
}

export interface EnvironmentalFactor {
  id: number;
  factorKey: string;
  label: string;
  activityUnit: string;
  factor: number;
  factorUnit: string;
  source: string;
  validFrom: string;
  gwp: number | null;
  evidenceItemId: string | null;
}

export interface EnvironmentalBaseline {
  id: number;
  assetId: string;
  assetName: string;
  metric: string;
  unit: string;
  designValue: number;
  establishedOn: string;
  interventionCost: number | null;
  energyCostPerDay: number | null;
  evidenceItemId: string | null;
  basis: string | null;
  sourceReference: string | null;
  version: number;
}

export interface HazardousInventoryItem {
  id: number;
  inventoryRef: string;
  version: number;
  assetId: string | null;
  assetName: string | null;
  substance: string;
  category: string;
  quantity: number | null;
  unit: string | null;
  location: string | null;
  handlingRequirements: string;
  emergencyResponseReference: string | null;
  regulatoryReference: string | null;
  disposalRouteRequired: string | null;
  endOfLifePlanned: boolean;
  evidenceItemId: string;
  basis: string;
  sourceReference: string;
  recordedAt: string;
}

export interface EnvironmentalEvidenceWorkspace {
  canRecord: boolean;
  requiredAal: "aal2";
  assets: EnvironmentalAsset[];
  sites: EnvironmentalSite[];
  verifiedEvidence: EnvironmentalEvidenceReference[];
  emissionFactors: EnvironmentalFactor[];
  baselines: EnvironmentalBaseline[];
  hazardousInventory: HazardousInventoryItem[];
  decisionBoundary: string;
}

interface CommonEvidenceInput {
  basis: string;
  sourceReference: string;
  evidenceItemId: string;
}

export interface EmissionFactorInput extends CommonEvidenceInput {
  factorKey: string;
  label: string;
  activityUnit: string;
  factor: number;
  factorUnit: string;
  validFrom: string;
  gwp?: number | null;
}

export interface EfficiencyBaselineInput extends CommonEvidenceInput {
  assetId: string;
  metric: string;
  unit: string;
  designValue: number;
  establishedOn: string;
  interventionCost?: number | null;
  energyCostPerDay?: number | null;
  expectedVersion: number;
}

export interface EfficiencyReadingInput extends CommonEvidenceInput {
  baselineId: number;
  measuredOn: string;
  value: number;
}

export interface EnvironmentalActivityInput extends CommonEvidenceInput {
  siteId?: string | null;
  assetId?: string | null;
  activityKind:
    | "fuel_burn"
    | "electricity"
    | "flaring"
    | "venting"
    | "fugitive_methane"
    | "water_withdrawal"
    | "water_discharge"
    | "waste_generated"
    | "hazardous_waste"
    | "lubricant_loss"
    | "chemical_loss";
  periodStart: string;
  periodEnd: string;
  quantity: number;
  unit: string;
  substance?: string | null;
  factorKey?: string | null;
  scope?: "scope_1" | "scope_2" | "scope_3" | null;
  maintenanceAttributable?: boolean | null;
  note?: string | null;
}

export interface HazardousInventoryInput extends CommonEvidenceInput {
  inventoryRef: string;
  expectedVersion: number;
  assetId?: string | null;
  substance: string;
  category:
    | "battery"
    | "refrigerant"
    | "solvent"
    | "lubricant"
    | "reagent"
    | "radioactive_source"
    | "asbestos"
    | "other";
  quantity?: number | null;
  unit?: string | null;
  location?: string | null;
  handlingRequirements: string;
  emergencyResponseReference?: string | null;
  regulatoryReference?: string | null;
  disposalRouteRequired?: string | null;
  endOfLifePlanned: boolean;
}

export type EnvironmentalEvidenceInputByKind = {
  emission_factor: EmissionFactorInput;
  efficiency_baseline: EfficiencyBaselineInput;
  efficiency_reading: EfficiencyReadingInput;
  environmental_activity: EnvironmentalActivityInput;
  hazardous_inventory: HazardousInventoryInput;
};

export interface EnvironmentalEvidenceReceipt {
  id: number;
  kind: EnvironmentalEvidenceKind;
  version?: number;
  status: "recorded";
  complianceCertified: false;
  workAuthorized: false;
  riskAccepted: false;
  returnToServiceAuthorized: false;
  reportableInventory: false;
}

function textValue(value: unknown, label: string, minimum = 1) {
  if (typeof value !== "string" || value.trim().length < minimum) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function finiteNumber(
  value: unknown,
  label: string,
  options: { positive?: boolean } = {},
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (options.positive ? value <= 0 : value < 0)
  ) {
    throw new Error(
      `${label} must be ${options.positive ? "positive" : "zero or greater"}.`,
    );
  }
  return value;
}

function optionalFiniteNumber(
  value: unknown,
  label: string,
  options: { positive?: boolean } = {},
) {
  if (value == null) return null;
  return finiteNumber(value, label, options);
}

function cleanCommon<T extends CommonEvidenceInput>(input: T) {
  return {
    ...input,
    basis: textValue(input.basis, "A substantive evidence basis", 20),
    sourceReference: textValue(input.sourceReference, "Source reference", 2),
    evidenceItemId: textValue(
      input.evidenceItemId,
      "Independently verified evidence",
      1,
    ),
  };
}

export async function getEnvironmentalEvidenceWorkspace() {
  return callRpc<EnvironmentalEvidenceWorkspace>(
    "get_environmental_evidence_workspace",
  );
}

export async function recordEnvironmentalEvidence<
  K extends EnvironmentalEvidenceKind,
>(kind: K, raw: EnvironmentalEvidenceInputByKind[K]) {
  const common = cleanCommon(raw);
  let record: Record<string, unknown>;

  switch (kind) {
    case "emission_factor": {
      const input = common as EmissionFactorInput;
      record = {
        ...input,
        factorKey: textValue(input.factorKey, "Factor key", 3),
        label: textValue(input.label, "Factor label", 3),
        activityUnit: textValue(input.activityUnit, "Activity unit"),
        factor: finiteNumber(input.factor, "Emission factor", {
          positive: true,
        }),
        factorUnit: textValue(input.factorUnit, "Factor unit"),
        validFrom: textValue(input.validFrom, "Valid-from date"),
        gwp: optionalFiniteNumber(input.gwp, "Global warming potential", {
          positive: true,
        }),
      };
      break;
    }
    case "efficiency_baseline": {
      const input = common as EfficiencyBaselineInput;
      if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0)
        throw new Error("Expected version must be a non-negative integer.");
      record = {
        ...input,
        assetId: textValue(input.assetId, "Asset"),
        metric: textValue(input.metric, "Efficiency metric", 2),
        unit: textValue(input.unit, "Efficiency unit"),
        designValue: finiteNumber(input.designValue, "Design value", {
          positive: true,
        }),
        establishedOn: textValue(input.establishedOn, "Established-on date"),
        interventionCost: optionalFiniteNumber(
          input.interventionCost,
          "Intervention cost",
        ),
        energyCostPerDay: optionalFiniteNumber(
          input.energyCostPerDay,
          "Energy cost per day",
        ),
      };
      break;
    }
    case "efficiency_reading": {
      const input = common as EfficiencyReadingInput;
      if (!Number.isInteger(input.baselineId) || input.baselineId <= 0)
        throw new Error("Choose an efficiency baseline.");
      record = {
        ...input,
        measuredOn: textValue(input.measuredOn, "Measurement date"),
        value: finiteNumber(input.value, "Measured value", { positive: true }),
      };
      break;
    }
    case "environmental_activity": {
      const input = common as EnvironmentalActivityInput;
      const loss = ["lubricant_loss", "chemical_loss"].includes(
        input.activityKind,
      );
      if (loss && !input.substance?.trim())
        throw new Error("Loss records require the substance or product name.");
      if (input.factorKey && !input.scope)
        throw new Error(
          "An activity with an emission factor requires a scope.",
        );
      record = {
        ...input,
        siteId: input.siteId?.trim() || null,
        assetId: input.assetId?.trim() || null,
        periodStart: textValue(input.periodStart, "Period start"),
        periodEnd: textValue(input.periodEnd, "Period end"),
        quantity: finiteNumber(input.quantity, "Activity quantity"),
        unit: textValue(input.unit, "Activity unit"),
        substance: input.substance?.trim() || null,
        factorKey: input.factorKey?.trim() || null,
        scope: input.scope ?? null,
        maintenanceAttributable: input.maintenanceAttributable ?? null,
        note: input.note?.trim() || null,
      };
      break;
    }
    case "hazardous_inventory": {
      const input = common as HazardousInventoryInput;
      if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0)
        throw new Error("Expected version must be a non-negative integer.");
      const quantity = optionalFiniteNumber(
        input.quantity,
        "Inventory quantity",
        { positive: true },
      );
      if ((quantity == null) !== !input.unit?.trim())
        throw new Error(
          "Inventory quantity and unit must be recorded together.",
        );
      record = {
        ...input,
        inventoryRef: textValue(input.inventoryRef, "Inventory reference", 2),
        assetId: input.assetId?.trim() || null,
        substance: textValue(input.substance, "Substance", 2),
        quantity,
        unit: input.unit?.trim() || null,
        location: input.location?.trim() || null,
        handlingRequirements: textValue(
          input.handlingRequirements,
          "Handling requirements",
          20,
        ),
        emergencyResponseReference:
          input.emergencyResponseReference?.trim() || null,
        regulatoryReference: input.regulatoryReference?.trim() || null,
        disposalRouteRequired: input.disposalRouteRequired?.trim() || null,
      };
      break;
    }
    default:
      throw new Error("Unsupported environmental evidence kind.");
  }

  return callRpc<EnvironmentalEvidenceReceipt>(
    "record_environmental_evidence",
    { p_kind: kind, p_record: record },
  );
}
