import type { FailureModeTemplate } from "./types";

/**
 * Draft failure-mode builder shared by the critical power and cooling classes
 * (standby generator, UPS, transfer switch, chiller). Every mode starts as a
 * draft with no evidence and no recommended action: limits, intervals and
 * actions come only from an approved source and a named engineer.
 */
export const draftCriticalFacilityFailure = (
  code: string,
  componentCode: string,
  name: string,
  mechanism: string,
  causes: string[],
  effects: string[],
  detectableBy: string[],
  verificationMethods: string[],
  severity: 1 | 2 | 3 | 4 | 5,
): FailureModeTemplate => ({
  code,
  componentCode,
  name,
  mechanism,
  causes,
  effects,
  detectableBy,
  verificationMethods,
  recommendedActions: [],
  severity,
  evidence: [],
  reviewState: "draft",
});
