export type EvidenceSource =
  | "oem_manual"
  | "standard"
  | "customer_document"
  | "historian"
  | "inspection"
  | "drone_rgb"
  | "drone_thermal"
  | "drone_lidar"
  | "work_order"
  | "sme"
  | "derived";

export type ReviewState =
  | "draft"
  | "ai_extracted"
  | "engineer_reviewed"
  | "field_validated"
  | "approved";

export interface EvidenceReference {
  id: string;
  source: EvidenceSource;
  title: string;
  locator?: string;
  licence?: string;
  retrievedAt?: string;
  confidence: number;
}

export interface FailureModeTemplate {
  code: string;
  componentCode: string;
  name: string;
  mechanism: string;
  causes: string[];
  effects: string[];
  detectableBy: string[];
  verificationMethods: string[];
  recommendedActions: string[];
  severity: 1 | 2 | 3 | 4 | 5;
  evidence: EvidenceReference[];
  reviewState: ReviewState;
}

export interface ComponentTemplate {
  code: string;
  name: string;
  parentCode?: string;
  functions: string[];
  telemetryConcepts: string[];
  inspectionZones: string[];
  failureModes: FailureModeTemplate[];
}

export interface AssetClassTemplate {
  schemaVersion: string;
  code: string;
  name: string;
  family: string;
  description: string;
  functions: string[];
  operatingStates: string[];
  components: ComponentTemplate[];
  standards: string[];
  reviewState: ReviewState;
}

export interface OemModelOverlay {
  schemaVersion: string;
  assetClassCode: string;
  manufacturer: string;
  model: string;
  aliases?: string[];
  componentOverrides: Record<string, Partial<ComponentTemplate>>;
  telemetryAliases: Record<string, string[]>;
  evidence: EvidenceReference[];
  reviewState: ReviewState;
}

export interface CustomerAssetTwinInstance {
  assetId: string;
  assetClassCode: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  siteId: string;
  operatingContext: Record<string, unknown>;
  telemetryMap: Record<string, string>;
  customerOverrides: Record<string, unknown>;
  baselineStatus: "not_started" | "learning" | "established";
}
