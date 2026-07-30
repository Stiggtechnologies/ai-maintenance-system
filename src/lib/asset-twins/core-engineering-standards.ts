export type EngineeringStandardCategory =
  | "failure_mechanism"
  | "detection_method"
  | "verification_method"
  | "maintenance_strategy"
  | "risk_class"
  | "evidence_class";

export type EngineeringStandardReviewState = "draft" | "reviewed" | "approved" | "retired";

export interface EngineeringStandardReference {
  code: string;
  category: EngineeringStandardCategory;
  name: string;
  description: string;
  aliases: string[];
  applicableAssetFamilies: string[];
  requiresIndependentVerification: boolean;
  permitsAutonomousOperationalAction: false;
  reviewState: EngineeringStandardReviewState;
  sourcePolicy: "approved_source_required";
  standards: string[];
}

export interface EngineeringStandardsValidationIssue {
  path: string;
  message: string;
}

export function validateEngineeringStandardsLibrary(
  entries: EngineeringStandardReference[],
): EngineeringStandardsValidationIssue[] {
  const issues: EngineeringStandardsValidationIssue[] = [];
  const codes = new Set<string>();

  for (const [index, entry] of entries.entries()) {
    const path = `entries[${index}]`;
    if (!entry.code.trim()) issues.push({ path: `${path}.code`, message: "Code is required." });
    if (codes.has(entry.code)) issues.push({ path: `${path}.code`, message: `Duplicate code ${entry.code}.` });
    codes.add(entry.code);

    if (!entry.name.trim()) issues.push({ path: `${path}.name`, message: "Name is required." });
    if (!entry.description.trim()) {
      issues.push({ path: `${path}.description`, message: "Description is required." });
    }
    if (entry.sourcePolicy !== "approved_source_required") {
      issues.push({
        path: `${path}.sourcePolicy`,
        message: "Engineering standards must require an approved source.",
      });
    }
    if (entry.permitsAutonomousOperationalAction !== false) {
      issues.push({
        path: `${path}.permitsAutonomousOperationalAction`,
        message: "Autonomous operational action is prohibited.",
      });
    }
    if (new Set(entry.aliases).size !== entry.aliases.length) {
      issues.push({ path: `${path}.aliases`, message: "Aliases must be unique." });
    }
  }

  return issues;
}

export function getEngineeringStandard(
  entries: EngineeringStandardReference[],
  code: string,
): EngineeringStandardReference | undefined {
  return entries.find((entry) => entry.code === code);
}

export function getEngineeringStandardsByCategory(
  entries: EngineeringStandardReference[],
  category: EngineeringStandardCategory,
): EngineeringStandardReference[] {
  return entries.filter((entry) => entry.category === category);
}
