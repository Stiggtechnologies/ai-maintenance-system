import { supabase } from "../lib/supabase";

export interface MissionOutcomeItem {
  code: string;
  name: string;
}

export interface MissionOutcomeTemplate {
  organizationType: string;
  title: string;
  missionPattern: string;
  outcomes: MissionOutcomeItem[];
  measures: MissionOutcomeItem[];
  consequenceDimensions: string[];
  evidenceRequirements: string[];
  limitations: string;
  version: number;
}

export interface MissionOutcomeModel extends Omit<
  MissionOutcomeTemplate,
  "missionPattern" | "limitations"
> {
  id: string;
  templateVersion: number;
  missionStatement: string;
  evidenceBasis: string;
  applicabilityNotes: string;
  status: "draft" | "adopted" | "rejected" | "superseded";
  version: number;
  createdBy: string | null;
  createdAt: string;
  approvalId: string;
  approvalStatus: string;
  adoptedBy: string | null;
  adoptedAt: string | null;
  decisionNote: string | null;
  isOwnDraft: boolean;
}

export interface MissionOutcomeWorkspace {
  templates: MissionOutcomeTemplate[];
  models: MissionOutcomeModel[];
  callerRole: string;
  canApprove: boolean;
  control: string;
}

async function rpc<T>(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const result = data as T & { error?: string };
  if (result?.error) throw new Error(result.error);
  return result;
}

export function getMissionOutcomeWorkspace() {
  return rpc<MissionOutcomeWorkspace>("get_mission_outcome_workspace", {});
}

export function authorMissionOutcomeModel(input: {
  template: MissionOutcomeTemplate;
  title: string;
  missionStatement: string;
  evidenceBasis: string;
  applicabilityNotes: string;
}) {
  return rpc<{ model_id: string; approval_id: string; status: "draft" }>(
    "author_mission_outcome_model",
    {
      p_model: {
        organization_type: input.template.organizationType,
        title: input.title,
        mission_statement: input.missionStatement,
        outcomes: input.template.outcomes,
        measures: input.template.measures,
        consequence_dimensions: input.template.consequenceDimensions,
        evidence_requirements: input.template.evidenceRequirements,
        evidence_basis: input.evidenceBasis,
        applicability_notes: input.applicabilityNotes,
      },
    },
  );
}

export function decideMissionOutcomeModel(
  modelId: string,
  outcome: "approved" | "rejected",
  note: string,
) {
  return rpc<{ model_id: string; approval_id: string; status: string }>(
    "decide_mission_outcome_model",
    { p_id: modelId, p_outcome: outcome, p_note: note },
  );
}
