import { CONTEXT_SOURCE_CLASSES } from "./contracts";
import { validCanvasView, type CanvasView } from "./coordinate-canvas";
import type { OperatingSiteScope } from "../../components/sync-context/OperatingSiteScope";
import type { SyncContextOperatingPicture } from "./operating-picture";
export interface ContextViewPreferences {
  version: 1;
  selectedId: string | null;
  sourceClass: "all" | (typeof CONTEXT_SOURCE_CLASSES)[number];
  hiddenLayers: string[];
  viewport: CanvasView | null;
}
export const DEFAULT_CONTEXT_VIEW: ContextViewPreferences = {
  version: 1,
  selectedId: null,
  sourceClass: "all",
  hiddenLayers: [],
  viewport: null,
};
/** The storage getter itself can throw when browser privacy policy blocks it. */
export function contextSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
export function contextViewKey(scope: OperatingSiteScope) {
  return `syncai-context-view:v1:${encodeURIComponent(scope.actorId)}:${encodeURIComponent(scope.organizationId)}:${encodeURIComponent(scope.siteId ?? "all")}`;
}
/** Fresh server response is required before trusting any restored identity. */
export function restoreContextView(
  storage: Storage | null,
  scope: OperatingSiteScope,
  picture: SyncContextOperatingPicture,
): ContextViewPreferences {
  if (
    picture.organizationId !== scope.organizationId ||
    picture.scope.siteId !== scope.siteId
  )
    return { ...DEFAULT_CONTEXT_VIEW };
  try {
    const text = storage?.getItem(contextViewKey(scope));
    if (!text || text.length > 4096) return { ...DEFAULT_CONTEXT_VIEW };
    const value = JSON.parse(text);
    if (value?.version !== 1) return { ...DEFAULT_CONTEXT_VIEW };
    return {
      version: 1,
      selectedId:
        typeof value.selectedId === "string" &&
        picture.objects.some((o) => o.id === value.selectedId)
          ? value.selectedId
          : null,
      sourceClass: CONTEXT_SOURCE_CLASSES.includes(value.sourceClass)
        ? value.sourceClass
        : "all",
      hiddenLayers: Array.isArray(value.hiddenLayers)
        ? picture.layers
            .filter((l) => value.hiddenLayers.includes(l.id))
            .map((l) => l.id)
        : [],
      viewport:
        value.viewport && validCanvasView(value.viewport)
          ? value.viewport
          : null,
    };
  } catch {
    return { ...DEFAULT_CONTEXT_VIEW };
  }
}
export function saveContextView(
  storage: Storage | null,
  scope: OperatingSiteScope,
  view: ContextViewPreferences,
) {
  try {
    // Explicit projection prevents accidental snapshot/source/evidence caching.
    storage?.setItem(
      contextViewKey(scope),
      JSON.stringify({
        version: 1,
        selectedId: view.selectedId,
        sourceClass: view.sourceClass,
        hiddenLayers: view.hiddenLayers,
        viewport:
          view.viewport && validCanvasView(view.viewport)
            ? {
                x: view.viewport.x,
                y: view.viewport.y,
                width: view.viewport.width,
                height: view.viewport.height,
              }
            : null,
      }),
    );
  } catch {
    /* Storage blocked/full: the live workspace remains usable. */
  }
}
