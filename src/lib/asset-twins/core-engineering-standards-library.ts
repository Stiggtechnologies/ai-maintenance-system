import type { EngineeringStandardReference } from "./core-engineering-standards";

const governed = (
  entry: Omit<
    EngineeringStandardReference,
    | "requiresIndependentVerification"
    | "permitsAutonomousOperationalAction"
    | "reviewState"
    | "sourcePolicy"
    | "standards"
  > & { requiresIndependentVerification?: boolean; standards?: string[] },
): EngineeringStandardReference => ({
  ...entry,
  requiresIndependentVerification: entry.requiresIndependentVerification ?? true,
  permitsAutonomousOperationalAction: false,
  reviewState: "draft",
  sourcePolicy: "approved_source_required",
  standards: entry.standards ?? ["ISO 55000"],
});

export const coreEngineeringStandardsLibrary: EngineeringStandardReference[] = [
  governed({
    code: "FM-FATIGUE",
    category: "failure_mechanism",
    name: "Fatigue",
    description: "Progressive damage caused by repeated or fluctuating loading.",
    aliases: ["fatigue cracking", "cyclic fatigue"],
    applicableAssetFamilies: ["mobile_mining_loading", "mobile_mining_haulage", "fixed_material_handling"],
  }),
  governed({
    code: "FM-WEAR",
    category: "failure_mechanism",
    name: "Wear",
    description: "Progressive material loss or surface deterioration caused by contact and motion.",
    aliases: ["abrasive wear", "adhesive wear"],
    applicableAssetFamilies: ["all"],
  }),
  governed({
    code: "FM-CORROSION",
    category: "failure_mechanism",
    name: "Corrosion",
    description: "Material degradation caused by chemical or electrochemical interaction with the environment.",
    aliases: ["oxidation", "corrosive attack"],
    applicableAssetFamilies: ["all"],
  }),
  governed({
    code: "DET-RGB-VISUAL",
    category: "detection_method",
    name: "RGB visual inspection",
    description: "Visible-spectrum image or video inspection used to identify observable condition indicators.",
    aliases: ["visual inspection", "optical inspection"],
    applicableAssetFamilies: ["all"],
  }),
  governed({
    code: "DET-THERMAL",
    category: "detection_method",
    name: "Thermal imaging",
    description: "Infrared imaging used to identify governed temperature patterns and anomalies.",
    aliases: ["infrared thermography", "thermal inspection"],
    applicableAssetFamilies: ["all"],
  }),
  governed({
    code: "DET-VIBRATION",
    category: "detection_method",
    name: "Vibration monitoring",
    description: "Measurement and analysis of machine vibration for condition assessment.",
    aliases: ["vibration analysis", "condition vibration"],
    applicableAssetFamilies: ["rotating_equipment", "mobile_mining_loading", "mobile_mining_haulage"],
  }),
  governed({
    code: "VER-ENGINEER-VISUAL",
    category: "verification_method",
    name: "Qualified engineer visual verification",
    description: "Independent visual assessment by an authorized and competent engineering reviewer.",
    aliases: ["engineer visual", "qualified visual review"],
    applicableAssetFamilies: ["all"],
  }),
  governed({
    code: "VER-NDT",
    category: "verification_method",
    name: "Non-destructive testing",
    description: "Approved non-destructive examination selected for the material, geometry and suspected mechanism.",
    aliases: ["NDT", "NDE"],
    applicableAssetFamilies: ["all"],
  }),
  governed({
    code: "MS-CONDITION-BASED",
    category: "maintenance_strategy",
    name: "Condition-based maintenance",
    description: "Maintenance initiated from governed evidence of asset condition rather than a universal interval.",
    aliases: ["CBM", "condition directed maintenance"],
    applicableAssetFamilies: ["all"],
  }),
  governed({
    code: "MS-PROTECTIVE-TASK",
    category: "maintenance_strategy",
    name: "Protective function task",
    description: "Inspection or test used to confirm a protective function remains available and effective.",
    aliases: ["failure finding", "protective device test"],
    applicableAssetFamilies: ["all"],
  }),
  governed({
    code: "RISK-SAFETY-CRITICAL",
    category: "risk_class",
    name: "Safety critical",
    description: "A governed risk class for conditions that may materially affect personnel or public safety.",
    aliases: ["critical safety risk"],
    applicableAssetFamilies: ["all"],
  }),
  governed({
    code: "EVID-PRIMARY",
    category: "evidence_class",
    name: "Primary engineering evidence",
    description: "Direct approved evidence such as controlled OEM data, authorized measurements or signed engineering records.",
    aliases: ["primary source"],
    applicableAssetFamilies: ["all"],
    requiresIndependentVerification: false,
  }),
];
