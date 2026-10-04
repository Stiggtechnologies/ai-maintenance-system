import { supabase } from "../lib/supabase";

export interface SupplierGovernanceWorkspace {
  answered: boolean;
  refusal?: string;
  boundary: string;
  suppliers: {
    id: number;
    supplierCode: string;
    name: string;
    kind: string;
    approvedVendor: boolean;
  }[];
  materials: { id: string; materialCode: string; description: string }[];
  evidence: { id: string; description: string }[];
  deliveries: {
    id: number;
    deliveryReference: string;
    supplierId: number;
    supplier: string;
    materialId: string | null;
    materialCode: string | null;
    promisedOn: string;
    receivedOn: string;
    onTime: boolean;
    qualityOutcome: string;
    basis: string;
    evidenceItemId: string;
  }[];
  suspectCases: {
    id: number;
    caseReference: string;
    materialId: string;
    materialCode: string;
    supplierId: number | null;
    supplier: string | null;
    detectedOn: string;
    detectionMethod: string | null;
    concern: string;
    status: "open" | "investigating" | "confirmed" | "cleared" | "closed";
    version: number;
    quarantined: boolean;
    unitsAlreadyInstalled: number;
    affectedAssetsIdentified: boolean;
    reportedExternally: boolean;
    outcome: string | null;
    basis: string;
    evidenceItemId: string;
  }[];
  advisories: {
    id: number;
    advisoryReference: string;
    supplierId: number;
    supplier: string;
    issuedOn: string;
    title: string;
    kind: string;
    manufacturer: string | null;
    model: string | null;
    mandatory: boolean;
    requiredBy: string | null;
    assessmentStatus: "unassessed" | "not_applicable" | "planned" | "complete";
    disposition: string | null;
    version: number;
    basis: string;
    evidenceItemId: string;
  }[];
  contractPackages: {
    id: number;
    packageCode: string;
    title: string;
    developmentCaseId: string | null;
    supplierId: number | null;
    scopeComplete: boolean;
    scopeGaps: Record<string, string>;
  }[];
  performancePeriods: {
    id: number;
    packageId: number | null;
    packageCode: string | null;
    supplierId: number;
    supplier: string;
    periodStart: string;
    periodEnd: string;
    plannedHours: number | null;
    actualHours: number | null;
    reworkEvents: number;
    safetyIncidents: number;
    qualityEscapes: number;
    basis: string | null;
  }[];
  warranties: {
    id: number;
    warrantyReference: string | null;
    supplierId: number | null;
    supplier: string | null;
    startsOn: string;
    endsOn: string | null;
    claimWindowDays: number | null;
    basis: string | null;
    claims: {
      id: number;
      claimReference: string | null;
      status: string;
      claimValue: number | null;
      recoveredValue: number | null;
      currency: string | null;
    }[];
  }[];
}

export interface SupplierGovernanceReceipt {
  answered?: boolean;
  refusal?: string;
  error?: string;
  note?: string;
  status?: string;
  version?: number;
  deliveryId?: number;
  suspectPartId?: number;
  advisoryId?: number;
}

function unwrap<
  T extends { answered?: boolean; refusal?: string; error?: string },
>(data: unknown, error: { message: string } | null, fallback: string): T {
  if (error) throw new Error(error.message);
  const result = data as T | null;
  if (!result) throw new Error(fallback);
  if (result.answered === false || result.error) {
    throw new Error(result.refusal ?? result.error ?? fallback);
  }
  return result;
}

export async function getSupplierGovernanceWorkspace(): Promise<SupplierGovernanceWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_supplier_governance_workspace",
  );
  return unwrap<SupplierGovernanceWorkspace>(
    data,
    error,
    "The supplier governance workspace returned no result.",
  );
}

export async function recordSupplierDelivery(input: {
  deliveryReference: string;
  supplierId: string;
  materialId?: string;
  orderedOn: string;
  promisedOn: string;
  receivedOn: string;
  quantity?: string;
  qualityOutcome: string;
  note?: string;
  basis: string;
  evidenceItemId: string;
}): Promise<SupplierGovernanceReceipt> {
  const { data, error } = await supabase.rpc("record_supplier_delivery", {
    p_payload: input,
  });
  return unwrap(data, error, "Supplier delivery was not recorded.");
}

export async function recordSuspectPartCase(input: {
  caseReference: string;
  materialId: string;
  supplierId?: string;
  detectedOn: string;
  detectionMethod?: string;
  concern: string;
  quantityAffected?: string;
  unitsAlreadyInstalled: string;
  affectedAssetsIdentified: boolean;
  quarantined: boolean;
  reportedExternally: boolean;
  outcome?: string;
  status: "open" | "investigating" | "confirmed" | "cleared" | "closed";
  expectedVersion?: number;
  basis: string;
  evidenceItemId: string;
}): Promise<SupplierGovernanceReceipt> {
  const { data, error } = await supabase.rpc("record_suspect_part_case", {
    p_payload: input,
  });
  return unwrap(data, error, "Suspect-part case was not recorded.");
}

export async function recordVendorAdvisory(input: {
  advisoryReference: string;
  supplierId: string;
  issuedOn: string;
  title: string;
  advisoryKind: string;
  appliesToManufacturer?: string;
  appliesToModel?: string;
  mandatory: boolean;
  requiredBy?: string;
  basis: string;
  evidenceItemId: string;
}): Promise<SupplierGovernanceReceipt> {
  const { data, error } = await supabase.rpc("record_vendor_advisory", {
    p_payload: input,
  });
  return unwrap(data, error, "Vendor advisory was not recorded.");
}

export async function assessVendorAdvisory(input: {
  advisoryId: number;
  expectedVersion: number;
  status: "not_applicable" | "planned" | "complete";
  disposition: string;
  basis: string;
  evidenceItemId: string;
}): Promise<SupplierGovernanceReceipt> {
  const { data, error } = await supabase.rpc("assess_vendor_advisory", {
    p_advisory_id: input.advisoryId,
    p_expected_version: input.expectedVersion,
    p_status: input.status,
    p_disposition: input.disposition,
    p_basis: input.basis,
    p_evidence_item_id: input.evidenceItemId,
  });
  return unwrap(data, error, "Vendor advisory assessment was not recorded.");
}
