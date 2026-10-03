import { supabase } from "../lib/supabase";

export const STAGE_DIMENSION_KEYS = [
  "objective",
  "value",
  "risk",
  "evidence",
  "decision",
  "configuration",
  "work",
  "outcome",
] as const;

export type StageDimensionKey = (typeof STAGE_DIMENSION_KEYS)[number];

export interface StageDimension {
  key: StageDimensionKey;
  label: string;
  count: number;
  state: "missing" | "attention" | "recorded";
  attentionCount: number;
  sourceTables: string[];
  basis: string;
}

export interface LifecycleStageDimensions {
  stageKey: string;
  stageName: string;
  sequence: number;
  progress: "completed" | "current" | "upcoming" | "unpositioned";
  gateReviewCount: number;
  dimensions: StageDimension[];
}

export interface CaseStageDimensionSubstrate {
  caseId: string;
  caseTitle: string;
  currentStageKey: string | null;
  dimensionKeys: StageDimensionKey[];
  stages: LifecycleStageDimensions[];
  composition: string;
  authorityBoundary: string;
}

export async function getCaseStageDimensions(
  caseId: string,
): Promise<CaseStageDimensionSubstrate> {
  const { data, error } = await supabase.rpc("get_case_stage_dimensions", {
    p_case_id: caseId,
  });
  if (error) throw new Error(error.message);
  return data as CaseStageDimensionSubstrate;
}
