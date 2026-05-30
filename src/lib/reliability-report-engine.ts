import {
  calculateAvailability,
  costOfUnreliability,
  exponentialReliability,
  failureRate,
} from "./reliability-calculations";
import {
  retrieveReliabilityKnowledge,
  type KnowledgeCitation,
} from "./reliability-knowledge-base";

export type CopilotMode =
  | "RCA"
  | "FRACAS"
  | "FMEA"
  | "RCM"
  | "RAM"
  | "PM Optimization"
  | "Executive Brief";

export interface ReliabilityInputs {
  operatingHours: number;
  failures: number;
  repairHours: number;
  repairEvents: number;
  missionTimeHours: number;
}

export interface WorkOrderRecord {
  assetId: string;
  failureMode?: string;
  eventDate?: string;
  downtimeHours: number;
  repairHours: number;
  maintenanceCost: number;
  description?: string;
  priority?: string;
  workType?: string;
}

export interface BadActor {
  assetId: string;
  failures: number;
  downtimeHours: number;
  repairHours: number;
  maintenanceCost: number;
  topFailureMode: string;
}

export interface DataQualityFinding {
  severity: "low" | "medium" | "high";
  issue: string;
  impact: string;
  nextAction: string;
}

export interface GovernedRecommendation {
  recommendation: string;
  evidenceUsed: string[];
  assumptions: string[];
  confidence: "low" | "medium" | "high";
  consequenceOfBeingWrong: string;
  requiredValidation: string;
  ownerRole: string;
  approvalRequirement: string;
}

export interface ReliabilityReport {
  title: string;
  generatedAt: string;
  mode: CopilotMode;
  riskLevel: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  metrics: {
    mtbf: number;
    mttr: number;
    inherentAvailability: number;
    failureRate: number;
    missionReliability: number;
    costOfUnreliability: number;
  };
  dataSummary: {
    recordCount: number;
    uniqueAssets: number;
    totalDowntimeHours: number;
    totalRepairHours: number;
    totalMaintenanceCost: number;
    uncodedFailureModes: number;
    missingEventDates: number;
  };
  badActors: BadActor[];
  recommendations: string[];
  governedRecommendations: GovernedRecommendation[];
  evidenceGaps: string[];
  dataQualityFindings: DataQualityFinding[];
  assumptions: string[];
  sources: KnowledgeCitation[];
  actions: string[];
  approvalBoundary: string[];
  markdown: string;
}

const DEFAULT_EVIDENCE_GAPS = [
  "Asset hierarchy and operating context",
  "Failure dates, symptoms, failure modes, and downtime",
  "Repair durations, parts replaced, and labor hours",
  "Current PM tasks, inspection results, and condition-monitoring trends",
  "Photos, operator notes, OEM limits, and site standards where relevant",
];

const APPROVAL_BOUNDARY = [
  "Safety-critical recommendations require qualified engineering approval.",
  "PM interval changes require owner approval and evidence of residual risk.",
  "OEM-limit, operating-envelope, regulatory, protection-setting, shutdown, and startup changes must not be auto-approved.",
];

function csvSplitLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getCell(
  row: Record<string, string>,
  headers: string[],
  fallback = "",
): string {
  for (const header of headers) {
    const value = row[normalizeHeader(header)];
    if (value !== undefined && value !== "") return value;
  }
  return fallback;
}

function toNumber(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/[$,%\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseWorkOrderCsv(csvText: string): WorkOrderRecord[] {
  const rows = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (rows.length < 2) return [];

  const headers = csvSplitLine(rows[0]).map(normalizeHeader);

  return rows
    .slice(1)
    .map((line) => {
      const values = csvSplitLine(line);
      const row = headers.reduce<Record<string, string>>((acc, header, index) => {
        acc[header] = values[index] ?? "";
        return acc;
      }, {});

      return {
        assetId: getCell(row, [
          "asset",
          "asset id",
          "asset_id",
          "equipment",
          "equipment id",
          "functional location",
          "functional_location",
        ]),
        failureMode: getCell(row, [
          "failure mode",
          "failure_mode",
          "problem code",
          "problem",
          "mode",
        ]),
        eventDate: getCell(row, ["date", "event date", "failure date"]),
        downtimeHours: toNumber(
          getCell(row, ["downtime", "downtime hours", "downtime_hours"]),
        ),
        repairHours: toNumber(
          getCell(row, [
            "repair hours",
            "repair_hours",
            "labor hours",
            "duration",
          ]),
        ),
        maintenanceCost: toNumber(
          getCell(row, ["cost", "maintenance cost", "maintenance_cost"]),
        ),
        description: getCell(row, [
          "description",
          "work order description",
          "notes",
          "summary",
        ]),
        priority: getCell(row, ["priority", "work priority", "urgency"]),
        workType: getCell(row, [
          "work type",
          "work_type",
          "maintenance type",
          "maintenance_type",
          "order type",
        ]),
      };
    })
    .filter((record) => record.assetId);
}

export function summarizeBadActors(records: WorkOrderRecord[]): BadActor[] {
  const grouped = new Map<
    string,
    BadActor & { failureModes: Map<string, number> }
  >();

  for (const record of records) {
    const current =
      grouped.get(record.assetId) ??
      ({
        assetId: record.assetId,
        failures: 0,
        downtimeHours: 0,
        repairHours: 0,
        maintenanceCost: 0,
        topFailureMode: "Uncoded",
        failureModes: new Map<string, number>(),
      } satisfies BadActor & { failureModes: Map<string, number> });

    current.failures += 1;
    current.downtimeHours += record.downtimeHours;
    current.repairHours += record.repairHours;
    current.maintenanceCost += record.maintenanceCost;

    const mode = record.failureMode?.trim() || "Uncoded";
    current.failureModes.set(mode, (current.failureModes.get(mode) ?? 0) + 1);
    grouped.set(record.assetId, current);
  }

  return [...grouped.values()]
    .map((actor) => {
      const topFailureMode =
        [...actor.failureModes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
        "Uncoded";

      return {
        assetId: actor.assetId,
        failures: actor.failures,
        downtimeHours: round(actor.downtimeHours),
        repairHours: round(actor.repairHours),
        maintenanceCost: round(actor.maintenanceCost),
        topFailureMode,
      };
    })
    .sort(
      (a, b) =>
        b.downtimeHours - a.downtimeHours ||
        b.failures - a.failures ||
        b.maintenanceCost - a.maintenanceCost,
    );
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
  }).format(value);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function inferRiskLevel(
  availability: number,
  records: WorkOrderRecord[],
): ReliabilityReport["riskLevel"] {
  const totalDowntime = records.reduce(
    (sum, record) => sum + record.downtimeHours,
    0,
  );
  if (availability < 0.95 || totalDowntime >= 100) return "high";
  if (availability < 0.985 || totalDowntime >= 25) return "medium";
  return "low";
}

function inferConfidence(records: WorkOrderRecord[]): ReliabilityReport["confidence"] {
  if (records.length >= 20) return "high";
  if (records.length >= 5) return "medium";
  return "low";
}

function assessDataQuality(records: WorkOrderRecord[]): DataQualityFinding[] {
  if (records.length === 0) {
    return [
      {
        severity: "high",
        issue: "No structured failure-history rows were supplied.",
        impact:
          "The report can only provide a bounded starter analysis and cannot rank bad actors from customer evidence.",
        nextAction:
          "Upload or paste work orders, failure events, downtime logs, or a CMMS export.",
      },
    ];
  }

  const findings: DataQualityFinding[] = [];
  const missingModes = records.filter((record) => !record.failureMode).length;
  const missingDates = records.filter((record) => !record.eventDate).length;
  const missingDowntime = records.filter(
    (record) => record.downtimeHours <= 0,
  ).length;
  const missingRepairTime = records.filter(
    (record) => record.repairHours <= 0,
  ).length;
  const missingCost = records.filter(
    (record) => record.maintenanceCost <= 0,
  ).length;

  if (missingModes > 0) {
    findings.push({
      severity: "high",
      issue: `${missingModes} record(s) have no failure mode.`,
      impact:
        "RCA, FRACAS, FMEA, RCM, and PM optimization will be weaker because failure modes cannot be grouped cleanly.",
      nextAction:
        "Normalize problem/failure-mode codes before using this data for permanent strategy changes.",
    });
  }

  if (missingDates > 0) {
    findings.push({
      severity: "medium",
      issue: `${missingDates} record(s) have no event date.`,
      impact:
        "Trend, recurrence, and reliability-growth analysis cannot be trusted for those records.",
      nextAction:
        "Backfill event or failure dates from notifications, downtime logs, historian events, or work order history.",
    });
  }

  if (missingDowntime > 0) {
    findings.push({
      severity: "medium",
      issue: `${missingDowntime} record(s) have zero or missing downtime.`,
      impact:
        "Bad actor ranking by downtime may understate the business impact of those failures.",
      nextAction:
        "Confirm downtime definition and backfill production-impact hours where available.",
    });
  }

  if (missingRepairTime > 0) {
    findings.push({
      severity: "medium",
      issue: `${missingRepairTime} record(s) have zero or missing repair time.`,
      impact:
        "MTTR and maintainability decisions may be biased or understated.",
      nextAction:
        "Separate active repair time from waiting time and record repair-event boundaries.",
    });
  }

  if (missingCost > 0) {
    findings.push({
      severity: "low",
      issue: `${missingCost} record(s) have zero or missing maintenance cost.`,
      impact:
        "Cost-of-unreliability estimates will omit some labor, material, contractor, or production-loss impact.",
      nextAction:
        "Attach labor, material, contractor, and production-loss estimates to high-value events.",
    });
  }

  return findings;
}

function recommendationsForMode(
  mode: CopilotMode,
  badActors: BadActor[],
  prompt: string,
): string[] {
  const topActor = badActors[0];
  const target = topActor
    ? `${topActor.assetId} (${topActor.topFailureMode})`
    : "the target asset or system";

  const shared = [
    `Focus the first review on ${target}; it is the highest-value reliability opportunity in the current data set.`,
    "Normalize failure coding before making permanent strategy changes.",
    "Separate immediate containment from permanent corrective action.",
  ];

  const byMode: Record<CopilotMode, string[]> = {
    RCA: [
      "Create a bounded RCA around one repeated failure mode, not a broad asset-health discussion.",
      "Build a timeline, evidence table, failure hypotheses, and verification plan before declaring root cause.",
    ],
    FRACAS: [
      "Open a FRACAS case for the top recurring failure mode and assign an owner, due date, verification method, and recurrence check.",
      "Track corrective action effectiveness after return to service.",
    ],
    FMEA: [
      "Convert the top bad actor into an FMEA row set: function, functional failure, failure mode, local effect, system effect, controls, and recommended action.",
      "Score residual risk only after current controls and detection methods are verified.",
    ],
    RCM: [
      "Link every PM task to a failure mode and consequence category.",
      "Remove or rewrite PMs that do not detect, prevent, or mitigate a credible failure mode.",
    ],
    RAM: [
      "Use the current MTBF, MTTR, failure rate, and availability as the baseline for reliability improvement.",
      "Validate exposure hours and repair-event boundaries before using the metrics contractually.",
    ],
    "PM Optimization": [
      "Prioritize PM changes against the top failure mode and evidence of preventability or detectability.",
      "Do not extend intervals until failure behavior, condition indicators, and consequence risk are validated.",
    ],
    "Executive Brief": [
      "Frame the opportunity as downtime risk, corrective-action discipline, and decision velocity.",
      "Ask leadership for owners, validation support, and permission to standardize the failure taxonomy.",
    ],
  };

  const promptSpecific =
    prompt.trim().length > 0
      ? [`User objective captured: ${prompt.trim()}`]
      : [];

  return [...promptSpecific, ...shared, ...byMode[mode]];
}

function actionsForMode(mode: CopilotMode): string[] {
  const byMode: Record<CopilotMode, string[]> = {
    RCA: [
      "Confirm problem statement and event boundary.",
      "Collect failed parts, photos, trends, work orders, and operator notes.",
      "Run 5-Why or cause map facilitation with maintenance, operations, and reliability.",
      "Verify corrective action effectiveness after the next operating cycle.",
    ],
    FRACAS: [
      "Create failure event intake.",
      "Code functional failure, failure mode, mechanism, immediate cause, and root cause.",
      "Assign corrective and preventive actions with owners and due dates.",
      "Schedule recurrence review.",
    ],
    FMEA: [
      "Define asset functions and functional failures.",
      "List failure modes, local effects, system effects, and end consequences.",
      "Document current prevention and detection controls.",
      "Create recommended actions for unacceptable residual risk.",
    ],
    RCM: [
      "Classify failure consequences.",
      "Select applicable and effective tasks.",
      "Justify intervals from evidence or conservative engineering judgment.",
      "Route strategy changes for approval.",
    ],
    RAM: [
      "Validate exposure hours and failure definitions.",
      "Confirm repair-event boundaries and downtime inclusions.",
      "Trend MTBF, MTTR, and availability monthly.",
      "Use the results as baseline metrics for improvement cases.",
    ],
    "PM Optimization": [
      "Map each PM task to a failure mode.",
      "Identify duplicate, low-value, missing, or intrusive PMs.",
      "Convert calendar tasks to condition-based tasks where evidence supports it.",
      "Approve interval changes through reliability governance.",
    ],
    "Executive Brief": [
      "Align on top three reliability opportunities.",
      "Assign executive owner and site owner.",
      "Fund the data cleanup and corrective-action sprint.",
      "Review progress at 30, 60, and 90 days.",
    ],
  };

  return byMode[mode];
}

function assumptionsForReport(
  records: WorkOrderRecord[],
  dataQualityFindings: DataQualityFinding[],
): string[] {
  const assumptions = [
    "Operating hours, failure count, repair hours, and repair events describe the same asset boundary and time period.",
    "Failure rows represent corrective or failure-related work, not routine PM tasks unless explicitly coded otherwise.",
    "Downtime and repair-hour definitions are consistent across the uploaded records.",
  ];

  if (records.length === 0) {
    assumptions.push(
      "No customer failure-history records were available; recommendations are method guidance until source evidence is supplied.",
    );
  }

  if (dataQualityFindings.some((finding) => finding.severity === "high")) {
    assumptions.push(
      "High-severity data quality findings are resolved before changing PM intervals or asset strategies.",
    );
  }

  return assumptions;
}

function buildGovernedRecommendations({
  recommendations,
  confidence,
  badActors,
  dataQualityFindings,
  sources,
  assumptions,
  mode,
}: {
  recommendations: string[];
  confidence: ReliabilityReport["confidence"];
  badActors: BadActor[];
  dataQualityFindings: DataQualityFinding[];
  sources: KnowledgeCitation[];
  assumptions: string[];
  mode: CopilotMode;
}): GovernedRecommendation[] {
  const topActor = badActors[0];
  const evidenceUsed = [
    topActor
      ? `Failure-history aggregation identified ${topActor.assetId} as the top bad actor.`
      : "No structured failure-history rows were available.",
    ...sources.slice(0, 2).map((source) => `${source.source}: ${source.title}`),
  ];
  const qualityAssumption =
    dataQualityFindings.length > 0
      ? dataQualityFindings[0].nextAction
      : "Failure modes, downtime, repair hours, and maintenance costs are representative.";

  return recommendations.slice(0, 5).map((recommendation, index) => ({
    recommendation,
    evidenceUsed,
    assumptions: [assumptions[index % assumptions.length], qualityAssumption],
    confidence,
    consequenceOfBeingWrong:
      mode === "Executive Brief"
        ? "Leadership may fund the wrong opportunity or miss the highest-risk failure pattern."
        : "The team may change maintenance strategy, spend effort, or accept risk without sufficient evidence.",
    requiredValidation:
      "Review source work orders, operating context, SME input, and field evidence before implementation.",
    ownerRole:
      index === 0
        ? "Reliability engineer"
        : mode === "Executive Brief"
          ? "Plant manager or reliability leader"
          : "Maintenance or asset owner",
    approvalRequirement:
      "Qualified engineering approval required before safety, environmental, regulatory, OEM-limit, PM interval, shutdown/startup, or production-critical changes.",
  }));
}

function formatQualityFinding(finding: DataQualityFinding): string {
  return `${finding.severity.toUpperCase()}: ${finding.issue} Impact: ${
    finding.impact
  } Next action: ${finding.nextAction}`;
}

function buildMarkdown(report: Omit<ReliabilityReport, "markdown">): string {
  const topBadActors = report.badActors.slice(0, 5);
  const badActorRows = topBadActors.length
    ? topBadActors
        .map(
          (actor, index) =>
            `${index + 1}. ${actor.assetId}: ${formatNumber(
              actor.downtimeHours,
            )} downtime hours, ${actor.failures} failures, ${formatCurrency(
              actor.maintenanceCost,
            )}, top mode: ${actor.topFailureMode}`,
        )
        .join("\n")
    : "No structured failure-history rows were provided.";
  const governedRecommendationRows = report.governedRecommendations
    .map(
      (item, index) =>
        `${index + 1}. ${item.recommendation}\n   - Evidence used: ${item.evidenceUsed.join("; ")}\n   - Assumptions: ${item.assumptions.join("; ")}\n   - Confidence: ${item.confidence}\n   - Consequence of being wrong: ${item.consequenceOfBeingWrong}\n   - Required validation: ${item.requiredValidation}\n   - Owner role: ${item.ownerRole}\n   - Approval requirement: ${item.approvalRequirement}`,
    )
    .join("\n");
  const sourceRows = report.sources.length
    ? report.sources
        .map(
          (source) =>
            `- ${source.source} (${source.pageRange}) - ${source.title}. Confidence: ${source.confidence}. ${source.summary}`,
        )
        .join("\n")
    : "- No source matched the report context. Treat the output as general engineering guidance.";
  const qualityRows = report.dataQualityFindings.length
    ? report.dataQualityFindings.map(formatQualityFinding).join("\n")
    : "- No high-impact data quality issues were detected in the supplied rows.";

  return [
    `# ${report.title}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Workflow: ${report.mode}`,
    `Risk level: ${report.riskLevel}`,
    `Confidence: ${report.confidence}`,
    "",
    "## RAM Baseline",
    "",
    `- MTBF: ${formatNumber(report.metrics.mtbf)} hours`,
    `- MTTR: ${formatNumber(report.metrics.mttr)} hours`,
    `- Inherent availability: ${formatPercent(
      report.metrics.inherentAvailability,
    )}`,
    `- Failure rate: ${formatNumber(report.metrics.failureRate, 6)} failures/hour`,
    `- Mission reliability: ${formatPercent(report.metrics.missionReliability)}`,
    `- Cost of unreliability captured: ${formatCurrency(
      report.metrics.costOfUnreliability,
    )}`,
    "",
    "## Failure Data Summary",
    "",
    `- Records parsed: ${report.dataSummary.recordCount}`,
    `- Unique assets: ${report.dataSummary.uniqueAssets}`,
    `- Total downtime: ${formatNumber(
      report.dataSummary.totalDowntimeHours,
    )} hours`,
    `- Total repair time: ${formatNumber(
      report.dataSummary.totalRepairHours,
    )} hours`,
    `- Maintenance cost captured: ${formatCurrency(
      report.dataSummary.totalMaintenanceCost,
    )}`,
    `- Uncoded failure modes: ${report.dataSummary.uncodedFailureModes}`,
    `- Missing event dates: ${report.dataSummary.missingEventDates}`,
    "",
    "## Bad Actors",
    "",
    badActorRows,
    "",
    "## Governed Recommendations",
    "",
    governedRecommendationRows,
    "",
    "## Source Grounding",
    "",
    sourceRows,
    "",
    "## Assumptions",
    "",
    report.assumptions.map((item) => `- ${item}`).join("\n"),
    "",
    "## Data Quality Findings",
    "",
    qualityRows,
    "",
    "## Evidence Gaps",
    "",
    report.evidenceGaps.map((item) => `- ${item}`).join("\n"),
    "",
    "## Next Actions",
    "",
    report.actions.map((item) => `- ${item}`).join("\n"),
    "",
    "## Approval Boundary",
    "",
    report.approvalBoundary.map((item) => `- ${item}`).join("\n"),
  ].join("\n");
}

export function generateReliabilityReport({
  mode,
  prompt,
  csvText,
  inputs,
  now = new Date(),
}: {
  mode: CopilotMode;
  prompt: string;
  csvText: string;
  inputs: ReliabilityInputs;
  now?: Date;
}): ReliabilityReport {
  const records = parseWorkOrderCsv(csvText);
  const availability = calculateAvailability(
    inputs.operatingHours,
    inputs.failures,
    inputs.repairHours,
    inputs.repairEvents,
  );
  const lambda = failureRate(inputs.failures, inputs.operatingHours);
  const missionReliability = exponentialReliability(
    lambda,
    inputs.missionTimeHours,
  );
  const badActors = summarizeBadActors(records);
  const dataQualityFindings = assessDataQuality(records);
  const assumptions = assumptionsForReport(records, dataQualityFindings);
  const sources = retrieveReliabilityKnowledge(`${mode} ${prompt}`, 3);
  const capturedCostOfUnreliability = costOfUnreliability({
    downtimeHours: records.reduce((sum, record) => sum + record.downtimeHours, 0),
    productionLossPerHour: 0,
    maintenanceCost: records.reduce(
      (sum, record) => sum + record.maintenanceCost,
      0,
    ),
  });
  const dataSummary = {
    recordCount: records.length,
    uniqueAssets: new Set(records.map((record) => record.assetId)).size,
    totalDowntimeHours: round(
      records.reduce((sum, record) => sum + record.downtimeHours, 0),
    ),
    totalRepairHours: round(
      records.reduce((sum, record) => sum + record.repairHours, 0),
    ),
    totalMaintenanceCost: round(
      records.reduce((sum, record) => sum + record.maintenanceCost, 0),
    ),
    uncodedFailureModes: records.filter((record) => !record.failureMode).length,
    missingEventDates: records.filter((record) => !record.eventDate).length,
  };
  const recommendations = recommendationsForMode(mode, badActors, prompt);

  const reportWithoutMarkdown: Omit<ReliabilityReport, "markdown"> = {
    title: `${mode} Reliability Analysis`,
    generatedAt: now.toISOString(),
    mode,
    riskLevel: inferRiskLevel(availability.inherentAvailability, records),
    confidence: inferConfidence(records),
    metrics: {
      mtbf: round(availability.mtbf),
      mttr: round(availability.mttr),
      inherentAvailability: round(availability.inherentAvailability, 6),
      failureRate: round(lambda, 8),
      missionReliability: round(missionReliability, 6),
      costOfUnreliability: round(capturedCostOfUnreliability),
    },
    dataSummary,
    badActors,
    recommendations,
    governedRecommendations: buildGovernedRecommendations({
      recommendations,
      confidence: inferConfidence(records),
      badActors,
      dataQualityFindings,
      sources,
      assumptions,
      mode,
    }),
    evidenceGaps:
      records.length > 0
        ? [
            "Confirm failure codes and failure modes with site SMEs.",
            "Confirm downtime and repair-hour definitions are consistent.",
            "Attach source work orders, photos, trends, and inspection notes to each high-value case.",
        ]
        : DEFAULT_EVIDENCE_GAPS,
    dataQualityFindings,
    assumptions,
    sources,
    actions: actionsForMode(mode),
    approvalBoundary: APPROVAL_BOUNDARY,
  };

  return {
    ...reportWithoutMarkdown,
    markdown: buildMarkdown(reportWithoutMarkdown),
  };
}

export const SAMPLE_FAILURE_HISTORY_CSV = [
  "asset_id,failure_mode,event_date,downtime_hours,repair_hours,maintenance_cost,description",
  "P-101,Seal leak,2026-01-12,18,6,4200,Mechanical seal leak caused unplanned shutdown",
  "P-101,Seal leak,2026-02-26,22,7,5100,Repeat seal leak after restart",
  "P-101,Bearing temperature,2026-03-14,9,4,1800,High bearing temperature alarm",
  "CV-204,Belt mistracking,2026-02-03,7,3,900,Conveyor belt mistracking and cleanup",
  "CV-204,Belt mistracking,2026-04-19,11,4,1250,Repeat mistracking event",
  "C-330,High vibration,2026-03-28,31,12,8600,Compressor trip on high vibration",
  "P-101,Seal leak,2026-05-02,16,5,3900,Seal leak found during operator round",
].join("\n");
