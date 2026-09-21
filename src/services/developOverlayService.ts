import { supabase } from "../lib/supabase";

export interface EngineOverlay {
  key:
    | "risk"
    | "quality"
    | "sustainability"
    | "hop"
    | "stakeholders"
    | "evidence"
    | "ai";
  label: string;
  count: number;
  attentionCount: number;
  state: "recorded" | "attention" | "missing";
  basis: string;
  anchor: string;
}

export interface DevelopEngineOverlay {
  key:
    | "frame"
    | "value"
    | "govern"
    | "design"
    | "control"
    | "deliver"
    | "ready"
    | "realize";
  label: string;
  focus: string;
  anchor: string;
  overlays: EngineOverlay[];
}

export interface CaseEngineOverlays {
  caseId: string;
  caseTitle: string;
  engines: DevelopEngineOverlay[];
  overlayKeys: string[];
  composition: string;
  authorityBoundary: string;
}

export async function getCaseEngineOverlays(
  caseId: string,
): Promise<CaseEngineOverlays> {
  const { data, error } = await supabase.rpc("get_case_engine_overlays", {
    p_case_id: caseId,
  });
  if (error) throw new Error(error.message);
  const payload = data as CaseEngineOverlays | { error?: string };
  if ("error" in payload && payload.error) throw new Error(payload.error);
  return payload as CaseEngineOverlays;
}
