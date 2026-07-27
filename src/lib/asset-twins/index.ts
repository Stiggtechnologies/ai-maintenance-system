import { miningAssetClassLibrary } from "./mining-library";
import type { AssetClassTemplate } from "./types";

export * from "./types";
export * from "./mining-library";
export * from "./oem-overlays";
export * from "./compiler";
export * from "./inspection-contracts";
export * from "./komatsu-4100xpc-inspections";
export * from "./inspection-findings";
export * from "./inspection-recommendations";

export interface LibraryValidationIssue {
  path: string;
  message: string;
}

export function validateAssetClassTemplate(
  template: AssetClassTemplate,
): LibraryValidationIssue[] {
  const issues: LibraryValidationIssue[] = [];
  const componentCodes = new Set<string>();
  const failureCodes = new Set<string>();

  if (!template.code.trim()) issues.push({ path: "code", message: "Asset class code is required." });
  if (!template.name.trim()) issues.push({ path: "name", message: "Asset class name is required." });
  if (template.functions.length === 0) {
    issues.push({ path: "functions", message: "At least one primary function is required." });
  }

  for (const [componentIndex, component] of template.components.entries()) {
    const componentPath = `components[${componentIndex}]`;
    if (componentCodes.has(component.code)) {
      issues.push({ path: `${componentPath}.code`, message: `Duplicate component code ${component.code}.` });
    }
    componentCodes.add(component.code);

    if (component.parentCode && !template.components.some((candidate) => candidate.code === component.parentCode)) {
      issues.push({
        path: `${componentPath}.parentCode`,
        message: `Unknown parent component ${component.parentCode}.`,
      });
    }

    for (const [failureIndex, failure] of component.failureModes.entries()) {
      const failurePath = `${componentPath}.failureModes[${failureIndex}]`;
      if (failure.componentCode !== component.code) {
        issues.push({
          path: `${failurePath}.componentCode`,
          message: `Failure mode ${failure.code} is assigned to the wrong component.`,
        });
      }
      if (failureCodes.has(failure.code)) {
        issues.push({ path: `${failurePath}.code`, message: `Duplicate failure code ${failure.code}.` });
      }
      failureCodes.add(failure.code);
      if (failure.detectableBy.length === 0) {
        issues.push({ path: `${failurePath}.detectableBy`, message: "At least one detection method is required." });
      }
      if (failure.verificationMethods.length === 0) {
        issues.push({
          path: `${failurePath}.verificationMethods`,
          message: "At least one independent verification method is required.",
        });
      }
    }
  }

  return issues;
}

export function getAssetClassTemplate(code: string): AssetClassTemplate | undefined {
  return miningAssetClassLibrary.find((template) => template.code === code);
}
