export type ReliabilityToolId =
  | "calculateAvailability"
  | "calculateExponentialReliability"
  | "calculateMaintenanceExecutionKpis"
  | "calculateRiskPriorityNumber"
  | "estimateCostOfUnreliability"
  | "createBadActorPareto"
  | "startAssetOnboarding"
  | "updateAssetOnboardingStep"
  | "exportAssetOnboardingPackage"
  | "createRcaDraft"
  | "createFracasCase";

type JsonSchemaType = "array" | "integer" | "number" | "object" | "string";

interface ToolParameterProperty {
  type: JsonSchemaType;
  description: string;
  minimum?: number;
  enum?: string[];
}

interface ToolParameters {
  type: "object";
  required: string[];
  properties: Record<string, ToolParameterProperty>;
}

export interface ReliabilityToolDefinition {
  id: ReliabilityToolId;
  name: string;
  description: string;
  approval: "not-required" | "review-recommended" | "engineer-review-required";
  parameters: ToolParameters;
}

export const RELIABILITY_TOOL_DEFINITIONS: ReliabilityToolDefinition[] = [
  {
    id: "calculateAvailability",
    name: "Calculate MTBF, MTTR, and inherent availability",
    description:
      "Uses operating hours, failure count, total repair hours, and repair events to calculate standard RAM metrics.",
    approval: "not-required",
    parameters: {
      type: "object",
      required: [
        "operatingHours",
        "failures",
        "totalRepairHours",
        "repairEvents",
      ],
      properties: {
        operatingHours: {
          type: "number",
          description: "Operating time or exposure time in hours.",
          minimum: 0,
        },
        failures: {
          type: "integer",
          description: "Number of failures observed during the exposure time.",
          minimum: 1,
        },
        totalRepairHours: {
          type: "number",
          description: "Total repair time in hours.",
          minimum: 0,
        },
        repairEvents: {
          type: "integer",
          description: "Number of repair events included in total repair time.",
          minimum: 1,
        },
      },
    },
  },
  {
    id: "calculateExponentialReliability",
    name: "Calculate exponential reliability",
    description:
      "Calculates reliability over a mission time using R(t) = e^(-lambda t).",
    approval: "not-required",
    parameters: {
      type: "object",
      required: ["failureRate", "missionTimeHours"],
      properties: {
        failureRate: {
          type: "number",
          description: "Failure rate lambda in failures per hour.",
          minimum: 0,
        },
        missionTimeHours: {
          type: "number",
          description: "Mission duration in hours.",
          minimum: 0,
        },
      },
    },
  },
  {
    id: "calculateMaintenanceExecutionKpis",
    name: "Calculate maintenance execution KPIs",
    description:
      "Calculates PM compliance, schedule compliance, break-in work percentage, emergency work percentage, and planned work percentage.",
    approval: "not-required",
    parameters: {
      type: "object",
      required: [
        "completedPmCount",
        "scheduledPmCount",
        "completedAsScheduledCount",
        "scheduledWorkCount",
        "breakInWorkCount",
        "emergencyWorkCount",
        "plannedWorkCount",
        "totalWorkCount",
      ],
      properties: {
        completedPmCount: {
          type: "integer",
          description: "Number of PMs completed in the period.",
          minimum: 0,
        },
        scheduledPmCount: {
          type: "integer",
          description: "Number of PMs scheduled in the period.",
          minimum: 1,
        },
        completedAsScheduledCount: {
          type: "integer",
          description: "Number of scheduled jobs completed as scheduled.",
          minimum: 0,
        },
        scheduledWorkCount: {
          type: "integer",
          description: "Number of scheduled jobs in the period.",
          minimum: 1,
        },
        breakInWorkCount: {
          type: "integer",
          description: "Number of jobs that broke into the schedule.",
          minimum: 0,
        },
        emergencyWorkCount: {
          type: "integer",
          description: "Number of jobs classified as emergency work.",
          minimum: 0,
        },
        plannedWorkCount: {
          type: "integer",
          description: "Number of jobs classified as planned work.",
          minimum: 0,
        },
        totalWorkCount: {
          type: "integer",
          description: "Total work orders or jobs in the period.",
          minimum: 1,
        },
      },
    },
  },
  {
    id: "estimateCostOfUnreliability",
    name: "Estimate cost of unreliability",
    description:
      "Combines downtime cost, maintenance cost, quality cost, and safety/environmental cost into a bounded cost-of-unreliability estimate.",
    approval: "review-recommended",
    parameters: {
      type: "object",
      required: ["downtimeHours", "productionLossPerHour"],
      properties: {
        downtimeHours: {
          type: "number",
          description: "Downtime hours included in the estimate.",
          minimum: 0,
        },
        productionLossPerHour: {
          type: "number",
          description: "Estimated production or margin loss per downtime hour.",
          minimum: 0,
        },
        maintenanceCost: {
          type: "number",
          description: "Labor, material, contractor, and repair cost.",
          minimum: 0,
        },
        qualityCost: {
          type: "number",
          description: "Scrap, rework, or quality-related cost.",
          minimum: 0,
        },
        safetyEnvironmentalCost: {
          type: "number",
          description: "Safety, environmental, cleanup, or compliance cost.",
          minimum: 0,
        },
      },
    },
  },
  {
    id: "calculateRiskPriorityNumber",
    name: "Calculate risk priority number",
    description:
      "Calculates FMEA-style RPN from severity, occurrence, and detection scores.",
    approval: "review-recommended",
    parameters: {
      type: "object",
      required: ["severity", "occurrence", "detection"],
      properties: {
        severity: {
          type: "integer",
          description: "Severity score on a 1-10 scale.",
          minimum: 1,
        },
        occurrence: {
          type: "integer",
          description: "Occurrence score on a 1-10 scale.",
          minimum: 1,
        },
        detection: {
          type: "integer",
          description: "Detection score on a 1-10 scale.",
          minimum: 1,
        },
      },
    },
  },
  {
    id: "createBadActorPareto",
    name: "Create bad actor Pareto",
    description:
      "Ranks assets or failure modes by downtime, failure count, maintenance cost, or risk score.",
    approval: "review-recommended",
    parameters: {
      type: "object",
      required: ["rankingMetric", "records"],
      properties: {
        rankingMetric: {
          type: "string",
          description: "Metric used to rank bad actors.",
          enum: [
            "downtimeHours",
            "failureCount",
            "maintenanceCost",
            "riskScore",
          ],
        },
        records: {
          type: "array",
          description: "Normalized work-order, downtime, or failure records.",
        },
      },
    },
  },
  {
    id: "startAssetOnboarding",
    name: "Start guided asset onboarding",
    description:
      "Starts a one-command guided workflow that turns an asset into a reliability-ready digital profile for RCA, FMEA, PM optimization, FRACAS, RAM, criticality, spares, and lifecycle planning.",
    approval: "review-recommended",
    parameters: {
      type: "object",
      required: ["command"],
      properties: {
        command: {
          type: "string",
          description:
            "Slash command such as /onboard asset, /onboard pump P-101, /onboard from SAP export, or /onboard fleet conveyors.",
        },
        mode: {
          type: "string",
          description: "Onboarding depth.",
          enum: ["quick", "standard", "deep", "regulatory", "fleet"],
        },
        source: {
          type: "string",
          description: "Initial data source.",
          enum: [
            "manual",
            "file",
            "sap_export",
            "maximo_export",
            "pid",
            "oem_manual",
            "work_order_history",
          ],
        },
      },
    },
  },
  {
    id: "updateAssetOnboardingStep",
    name: "Update asset onboarding step",
    description:
      "Records a user answer for the current onboarding step, updates completion score, and advances the guided workflow.",
    approval: "review-recommended",
    parameters: {
      type: "object",
      required: ["sessionId", "stepId", "answer"],
      properties: {
        sessionId: {
          type: "string",
          description: "Asset onboarding session identifier.",
        },
        stepId: {
          type: "string",
          description: "Current onboarding step identifier.",
        },
        answer: {
          type: "string",
          description: "User answer or imported data summary for the step.",
        },
      },
    },
  },
  {
    id: "exportAssetOnboardingPackage",
    name: "Export asset onboarding package",
    description:
      "Exports the reliability-ready asset package as Markdown, Word HTML, PDF HTML, Excel CSV, JSON, CMMS import CSV, Power BI dataset JSON, or API payload JSON.",
    approval: "review-recommended",
    parameters: {
      type: "object",
      required: ["sessionId", "format"],
      properties: {
        sessionId: {
          type: "string",
          description: "Asset onboarding session identifier.",
        },
        format: {
          type: "string",
          description: "Requested export format.",
          enum: [
            "markdown",
            "json",
            "wordHtml",
            "pdfHtml",
            "excelWorkbookCsv",
            "cmmsImportCsv",
            "powerBiDatasetJson",
            "apiPayloadJson",
          ],
        },
      },
    },
  },
  {
    id: "createRcaDraft",
    name: "Create RCA draft",
    description:
      "Creates a review-ready RCA starter pack from failure context, event timeline, and evidence.",
    approval: "engineer-review-required",
    parameters: {
      type: "object",
      required: ["problemStatement", "assetContext", "evidence"],
      properties: {
        problemStatement: {
          type: "string",
          description: "Bounded failure problem statement.",
        },
        assetContext: {
          type: "string",
          description: "Asset, operating context, service, and duty cycle.",
        },
        evidence: {
          type: "array",
          description:
            "Evidence items such as work orders, photos, trends, and inspection notes.",
        },
        requestedMethod: {
          type: "string",
          description: "Preferred RCA method.",
          enum: ["fiveWhy", "causeMap", "fishbone", "faultTree"],
        },
      },
    },
  },
  {
    id: "createFracasCase",
    name: "Create FRACAS case",
    description:
      "Creates a FRACAS case draft with failure event, taxonomy, evidence, owner, verification, and status fields.",
    approval: "engineer-review-required",
    parameters: {
      type: "object",
      required: ["assetId", "eventDatetime", "failureSymptom"],
      properties: {
        assetId: {
          type: "string",
          description: "Customer asset identifier or functional location.",
        },
        eventDatetime: {
          type: "string",
          description: "Failure event date/time in ISO 8601 format.",
        },
        failureSymptom: {
          type: "string",
          description: "Observed symptom that triggered the investigation.",
        },
        operatingContext: {
          type: "string",
          description: "Operating condition at time of failure.",
        },
        evidenceSummary: {
          type: "string",
          description: "Short evidence summary supporting the case.",
        },
      },
    },
  },
];

export function getReliabilityToolDefinition(
  id: ReliabilityToolId,
): ReliabilityToolDefinition {
  const definition = RELIABILITY_TOOL_DEFINITIONS.find(
    (tool) => tool.id === id,
  );
  if (!definition) {
    throw new Error(`Unknown reliability tool: ${id}`);
  }
  return definition;
}
