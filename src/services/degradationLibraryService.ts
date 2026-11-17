import { supabase } from "../lib/supabase";

export type DegradationFamilyKey =
  | "corrosion"
  | "fatigue"
  | "creep"
  | "erosion"
  | "wear"
  | "embrittlement"
  | "chemical"
  | "concrete"
  | "timber"
  | "insulation_ageing"
  | "battery"
  | "cable"
  | "semiconductor"
  | "lubricant"
  | "coating"
  | "soil_foundation";

export interface DegradationTechnique {
  techniqueKey: string;
  techniqueName: string;
  detectability: "primary" | "secondary";
  typicalWarning: "long" | "medium" | "short" | "none";
  basis: string;
}

export interface DegradationLinkedModel {
  modelRegisterId: number;
  modelKey: string;
  version: string;
  lifecycleState: string;
  productionEligible: boolean;
  applicabilityReviewStatus: "not_reviewed" | "approved" | "rejected";
}

export interface DegradationProfileFamily {
  familyKey: DegradationFamilyKey;
  mechanismId: string;
  mechanismKey: string;
  mechanismName: string;
  mechanismDescription: string;
  profileId: string;
  version: number;
  title: string;
  description: string;
  stressorRequirements: string[];
  damageStateRequirements: string[];
  observationRequirements: string[];
  candidateModelKinds: string[];
  applicabilityQuestions: string[];
  limitations: string;
  status:
    | "reference_draft"
    | "pending_review"
    | "approved"
    | "rejected";
  sourceEvidenceItemId: string | null;
  authorId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  detectability: DegradationTechnique[];
  linkedModels: DegradationLinkedModel[];
  operationalAuthorization: false;
}

export interface DegradationLibraryWorkspace {
  families: DegradationProfileFamily[];
  coverage: {
    requiredFamilies: 16;
    representedFamilies: number;
    approvedFamilies: number;
    familiesWithLinkedModels: number;
  };
  boundary: string;
}

interface RpcResult {
  error?: string;
  [key: string]: unknown;
}

function assertRpc(data: unknown, fallback: string): RpcResult {
  const result = (data ?? {}) as RpcResult;
  if (result.error) throw new Error(result.error);
  if (!data) throw new Error(fallback);
  return result;
}

export async function getDegradationLibraryWorkspace(): Promise<DegradationLibraryWorkspace> {
  const { data, error } = await supabase.rpc(
    "get_degradation_library_workspace",
  );
  if (error) throw new Error(error.message);
  return assertRpc(
    data,
    "Degradation library returned no data.",
  ) as unknown as DegradationLibraryWorkspace;
}

export async function proposeDegradationProfileRevision(input: {
  familyKey: DegradationFamilyKey;
  title: string;
  description: string;
  stressorRequirements: string[];
  damageStateRequirements: string[];
  observationRequirements: string[];
  candidateModelKinds: string[];
  applicabilityQuestions: string[];
  limitations: string;
  evidenceItemId: string;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc(
    "propose_degradation_profile_revision",
    {
      p_family_key: input.familyKey,
      p_title: input.title,
      p_description: input.description,
      p_stressor_requirements: input.stressorRequirements,
      p_damage_state_requirements: input.damageStateRequirements,
      p_observation_requirements: input.observationRequirements,
      p_candidate_model_kinds: input.candidateModelKinds,
      p_applicability_questions: input.applicabilityQuestions,
      p_limitations: input.limitations,
      p_evidence_item_id: input.evidenceItemId,
    },
  );
  if (error) throw new Error(error.message);
  return assertRpc(data, "Profile proposal returned no data.");
}

export async function reviewDegradationProfile(input: {
  profileId: string;
  decision: "approved" | "rejected";
  reviewNote: string;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("review_degradation_profile", {
    p_profile_id: input.profileId,
    p_decision: input.decision,
    p_review_note: input.reviewNote,
  });
  if (error) throw new Error(error.message);
  return assertRpc(data, "Profile review returned no data.");
}
