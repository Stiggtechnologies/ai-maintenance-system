import { supabase } from "../lib/supabase";

type RpcEnvelope = { error?: unknown };

const REQUEST_ITEM_CEILING = 40;

async function callRpc<T>(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const body = data as (T & RpcEnvelope) | null;
  if (body && typeof body.error === "string") throw new Error(body.error);
  if (body == null) throw new Error(`${name} returned nothing`);
  return body;
}

export interface RegulatoryRequirementRow {
  layerId: string;
  layerVersion: number;
  layerTitle: string;
  jurisdiction: string;
  key: string;
  title: string;
  requirementClass: "regulatory" | "statutory";
  applicability: "applicable" | "not_applicable" | "undetermined";
  obligation: "advisory" | "mandatory" | "not_applicable";
  authorityReference: string;
  posture:
    | "covered"
    | "assembled_unreleased"
    | "gap"
    | "not_required"
    | "applicability_undetermined";
}

export interface RegulatoryVerifiedEvidence {
  id: string;
  description: string | null;
  sourceSystem: string | null;
  verifiedBy: string;
  verifiedAt: string;
}

export interface RegulatoryEvidenceCitation {
  id: string;
  evidenceItemId: string;
  description: string | null;
  citationBasis: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

export interface RegulatoryEvidenceDossier {
  id: string;
  version: number;
  status: "assembled" | "released" | "withdrawn";
  layerId: string;
  layerVersion: number;
  requirementKey: string;
  jurisdiction: string;
  title: string;
  purpose: string;
  assembledBy: string;
  assembledAt: string;
  releasedBy: string | null;
  releasedAt: string | null;
  releaseBasis: string | null;
  withdrawnBy: string | null;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
  supersedesId: string | null;
  stale: boolean;
  current: boolean;
  items: RegulatoryEvidenceCitation[];
}

export interface RegulatoryEvidenceWorkspace {
  requirements: RegulatoryRequirementRow[];
  dossiers: RegulatoryEvidenceDossier[];
  verifiedEvidence: RegulatoryVerifiedEvidence[];
  coverage: {
    mandatoryApplicable: number;
    covered: number;
    assembledUnreleased: number;
    gaps: number;
  };
  jurisdiction: string | null;
  decisionBoundary: string;
  legalComplianceDetermined: false;
  workAuthorized: false;
  riskAccepted: false;
  operatingLimitChanged: false;
  returnToServiceAuthorized: false;
}

export interface RegulatoryEvidenceCitationInput {
  evidenceItemId: string;
  citationBasis: string;
}

export interface AssembleRegulatoryEvidenceInput {
  capabilityPackLayerId: string;
  expectedLayerVersion: number;
  requirementKey: string;
  title: string;
  purpose: string;
  supersedesId?: string | null;
  items: RegulatoryEvidenceCitationInput[];
}

export interface RegulatoryEvidenceActResult {
  id: string;
  status: "assembled" | "released" | "withdrawn";
  version: number;
  idempotent?: boolean;
  revised?: boolean;
  legalComplianceDetermined: false;
  workAuthorized: false;
  riskAccepted: false;
  operatingLimitChanged: false;
  returnToServiceAuthorized: false;
}

function assertText(value: string, minimum: number, message: string) {
  if (value.trim().length < minimum) throw new Error(message);
}

export function assertAssembleInput(input: AssembleRegulatoryEvidenceInput) {
  if (!input.capabilityPackLayerId.trim() || !input.requirementKey.trim()) {
    throw new Error("Choose an adopted jurisdiction requirement.");
  }
  if (
    !Number.isInteger(input.expectedLayerVersion) ||
    input.expectedLayerVersion <= 0
  ) {
    throw new Error(
      "The jurisdiction layer version must be a positive integer.",
    );
  }
  assertText(
    input.title,
    5,
    "Give the dossier a title of at least 5 characters.",
  );
  assertText(
    input.purpose,
    20,
    "State the inspection purpose in at least 20 characters.",
  );
  if (input.items.length < 1) {
    throw new Error("Cite at least one independently verified evidence item.");
  }
  if (input.items.length > REQUEST_ITEM_CEILING) {
    throw new Error("Cite at most 40 evidence items per dossier request.");
  }
  const seen = new Set<string>();
  for (const item of input.items) {
    const id = item.evidenceItemId.trim();
    if (!id)
      throw new Error("Choose independently verified canonical evidence.");
    if (seen.has(id)) throw new Error("Each evidence item can be cited once.");
    seen.add(id);
    assertText(
      item.citationBasis,
      20,
      "Each citation needs a 20 character basis written for this requirement.",
    );
  }
}

export async function getRegulatoryEvidenceWorkspace() {
  return callRpc<RegulatoryEvidenceWorkspace>(
    "get_regulatory_evidence_workspace",
  );
}

export async function assembleRegulatoryEvidencePack(
  input: AssembleRegulatoryEvidenceInput,
) {
  assertAssembleInput(input);
  return callRpc<RegulatoryEvidenceActResult>(
    "assemble_regulatory_evidence_pack",
    {
      p_pack: {
        capability_pack_layer_id: input.capabilityPackLayerId.trim(),
        expected_layer_version: input.expectedLayerVersion,
        requirement_key: input.requirementKey.trim(),
        title: input.title.trim(),
        purpose: input.purpose.trim(),
        supersedes_id: input.supersedesId ?? null,
        items: input.items.map((item) => ({
          evidence_item_id: item.evidenceItemId.trim(),
          citation_basis: item.citationBasis.trim(),
        })),
      },
    },
  );
}

export async function releaseRegulatoryEvidencePack(input: {
  dossierId: string;
  expectedVersion: number;
  releaseBasis: string;
}) {
  if (!input.dossierId.trim()) throw new Error("Choose a dossier to release.");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion <= 0) {
    throw new Error("The dossier version must be a positive integer.");
  }
  assertText(
    input.releaseBasis,
    20,
    "State the inspection basis in at least 20 characters.",
  );
  return callRpc<RegulatoryEvidenceActResult>(
    "release_regulatory_evidence_pack",
    {
      p_release: {
        dossier_id: input.dossierId.trim(),
        expected_version: input.expectedVersion,
        release_basis: input.releaseBasis.trim(),
      },
    },
  );
}

export async function withdrawRegulatoryEvidencePack(input: {
  dossierId: string;
  expectedVersion: number;
  reason: string;
}) {
  if (!input.dossierId.trim()) throw new Error("Choose a dossier to withdraw.");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion <= 0) {
    throw new Error("The dossier version must be a positive integer.");
  }
  assertText(
    input.reason,
    20,
    "State the withdrawal reason in at least 20 characters.",
  );
  return callRpc<RegulatoryEvidenceActResult>(
    "withdraw_regulatory_evidence_pack",
    {
      p_withdrawal: {
        dossier_id: input.dossierId.trim(),
        expected_version: input.expectedVersion,
        reason: input.reason.trim(),
      },
    },
  );
}
