import {
  getGeospatialOperationalWorkspace,
  getGeospatialReferences,
} from "./geospatialOperationalIntelligenceService";
import { getSyncContextSnapshot } from "./syncContextService";

export async function loadGeospatialPanelData(
  loaders = {
    workspace: getGeospatialOperationalWorkspace,
    references: getGeospatialReferences,
    context: getSyncContextSnapshot,
  },
) {
  const [workspace, references, context] = await Promise.allSettled([
    loaders.workspace(),
    loaders.references(),
    loaders.context(),
  ]);
  return {
    workspace: workspace.status === "fulfilled" ? workspace.value : null,
    references: references.status === "fulfilled" ? references.value : null,
    context: context.status === "fulfilled" ? context.value : null,
    incomplete:
      workspace.status === "rejected" ||
      references.status === "rejected" ||
      context.status === "rejected",
  };
}
