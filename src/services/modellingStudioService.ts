import type { ModellingStudioAnalysis } from "../lib/modelling/studio";
import { supabase } from "../lib/supabase";

export type ModellingStudioResult = ModellingStudioAnalysis & {
  posture: Record<string, unknown> | null;
  lineage: {
    trees: Array<{ subjectId: string; runId: string }>;
    schedules: Array<{ subjectId: string; runId: string }>;
    rbdRunId: string;
    simulationRunId: string;
    forecastRunId: string;
  };
  governance: {
    advisory: true;
    operationalAuthorization: false;
    humanApprovalRequired: true;
    note: string;
  };
};

export async function runModellingStudio(): Promise<ModellingStudioResult> {
  const { data, error } =
    await supabase.functions.invoke<ModellingStudioResult>(
      "calculation-service",
      { body: { action: "modelling_studio" } },
    );
  if (error) throw new Error(error.message);
  if (!data)
    throw new Error("The calculation service returned no model result.");
  return data;
}
