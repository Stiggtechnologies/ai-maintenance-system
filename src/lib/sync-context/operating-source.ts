import { canDisplaySourceAsLive, type ContextSource } from "./contracts";

export interface ContextSourceEmission {
  canEmit: boolean;
  displayAsLive: boolean;
  degraded: boolean;
  demoOnly: boolean;
  reason: "source_rights" | "source_health" | null;
}

/**
 * Renderer defense in depth. Never substitutes for server authorization or
 * source-health filtering. Authoring/verification workspaces may retain records
 * that cannot emit on the customer operating picture.
 */
export function contextSourceEmission(
  source: ContextSource,
): ContextSourceEmission {
  const rightsPermit =
    (source.class === "customer_operational" &&
      source.rightsState === "customer_authorized") ||
    (source.class === "live_external" &&
      ["demo_approved", "production_approved"].includes(source.rightsState)) ||
    (source.class === "simulated_industrial" &&
      source.rightsState === "not_required");
  const healthPermit =
    source.class === "simulated_industrial"
      ? source.state === "simulated"
      : [
          "connected",
          "live",
          "stale",
          "throttled",
          "delayed",
          "conflicting",
          "partial_coverage",
          "clock_skew",
        ].includes(source.state);
  const canEmit = rightsPermit && healthPermit;
  return {
    canEmit,
    displayAsLive: canEmit && canDisplaySourceAsLive(source),
    degraded:
      canEmit &&
      [
        "stale",
        "throttled",
        "delayed",
        "conflicting",
        "partial_coverage",
        "clock_skew",
      ].includes(source.state),
    demoOnly:
      source.class === "simulated_industrial" ||
      (source.class === "live_external" &&
        source.rightsState === "demo_approved"),
    reason: !rightsPermit
      ? "source_rights"
      : !healthPermit
        ? "source_health"
        : null,
  };
}
