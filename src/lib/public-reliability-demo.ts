import {
  generateReliabilityReport,
  type ReliabilityInputs,
  type ReliabilityReport,
} from "./reliability-report-engine";

export const PUBLIC_DEMO_STORAGE_KEY = "syncai-public-reliability-demo-v1";
export const PUBLIC_DEMO_FREE_RUN_LIMIT = 1;

export type PublicReliabilityScenarioId =
  "pump-seal" | "conveyor-mistracking" | "compressor-vibration";

export interface PublicReliabilityHypothesis {
  hypothesis: string;
  whyItFits: string;
  validation: string;
}

export interface PublicReliabilityScenario {
  id: PublicReliabilityScenarioId;
  asset: string;
  industry: string;
  label: string;
  shortLabel: string;
  question: string;
  signal: string;
  csvText: string;
  inputs: ReliabilityInputs;
  hypotheses: PublicReliabilityHypothesis[];
}

export interface PublicReliabilityDemoResult {
  scenario: PublicReliabilityScenario;
  userQuestion: string;
  report: ReliabilityReport;
  patternSummary: string;
  immediateContainment: string;
  recurrenceCheck: string;
}

export interface PublicDemoUsage {
  runCount: number;
  scenarioId: PublicReliabilityScenarioId;
  completedAt: string;
  question?: string;
}

type UsageStorage = Pick<Storage, "getItem" | "setItem">;

const scenarioRows: Record<PublicReliabilityScenarioId, string[]> = {
  "pump-seal": [
    "asset_id,failure_mode,event_date,downtime_hours,repair_hours,maintenance_cost,description",
    "P-101,Seal leak,2026-01-12,18,6,4200,Mechanical seal leak caused an unplanned shutdown",
    "P-101,Seal leak,2026-02-26,22,7,5100,Repeat seal leak after restart",
    "P-101,Bearing temperature,2026-03-14,9,4,1800,High bearing temperature alarm",
    "P-101,Seal leak,2026-04-09,14,4,3400,Product found at seal drain",
    "P-101,Seal leak,2026-05-02,16,5,3900,Seal leak found during operator round",
    "P-101,Seal leak,2026-06-21,19,6,4700,Repeat leakage following seal replacement",
    "P-102,Cavitation,2026-03-03,10,3,1700,Suction instability and cavitation noise",
    "P-102,Cavitation,2026-06-07,8,3,1450,Low suction pressure during high-rate operation",
  ],
  "conveyor-mistracking": [
    "asset_id,failure_mode,event_date,downtime_hours,repair_hours,maintenance_cost,description",
    "CV-204,Belt mistracking,2026-01-08,7,3,900,Spillage at transfer point and belt edge contact",
    "CV-204,Belt mistracking,2026-02-03,11,4,1250,Repeat mistracking after idler adjustment",
    "CV-204,Carryback buildup,2026-02-22,5,2,650,Material buildup observed on return idlers",
    "CV-204,Belt mistracking,2026-03-19,13,5,1600,Belt drift tripped pull-cord inspection",
    "CV-204,Belt mistracking,2026-04-26,9,3,1100,Mistracking recurred under wet feed conditions",
    "CV-205,Skirt wear,2026-02-14,4,2,500,Worn skirt rubber caused localized spillage",
    "CV-205,Idler seizure,2026-05-11,6,3,850,Return idler bearing seized",
  ],
  "compressor-vibration": [
    "asset_id,failure_mode,event_date,downtime_hours,repair_hours,maintenance_cost,description",
    "C-330,High vibration,2026-01-17,21,8,6400,Drive-end vibration alarm caused a controlled shutdown",
    "C-330,High vibration,2026-02-28,31,12,8600,Compressor tripped on high radial vibration",
    "C-330,Coupling wear,2026-03-06,12,6,4300,Coupling insert wear found during inspection",
    "C-330,High vibration,2026-04-12,26,10,7200,Vibration increased after process rate change",
    "C-330,High vibration,2026-05-29,24,9,6900,Repeat drive-end vibration excursion",
    "C-331,Lube oil pressure,2026-03-23,8,3,2100,Low lube oil pressure alarm investigated",
    "C-331,Lube oil pressure,2026-06-04,7,3,1900,Intermittent pressure transmitter reading",
  ],
};

export const PUBLIC_RELIABILITY_SCENARIOS: PublicReliabilityScenario[] = [
  {
    id: "pump-seal",
    asset: "P-101 process pump",
    industry: "Process industries",
    label: "Chronic pump seal failures",
    shortLabel: "Pump seals",
    question:
      "Why does P-101 keep leaking after seal replacement, and what should the team verify before changing the maintenance strategy?",
    signal: "5 repeat seal events in 6 months",
    csvText: scenarioRows["pump-seal"].join("\n"),
    inputs: {
      operatingHours: 8_760,
      failures: 8,
      repairHours: 38,
      repairEvents: 8,
      missionTimeHours: 168,
    },
    hypotheses: [
      {
        hypothesis: "Pipe strain or alignment is loading the seal faces",
        whyItFits: "Leakage recurs after replacement rather than aging out.",
        validation:
          "Cold/hot alignment check, soft-foot check, and pipe-strain measurement before disturbance.",
      },
      {
        hypothesis: "Seal support or flush conditions are intermittent",
        whyItFits:
          "Events cluster around restart and changing operating conditions.",
        validation:
          "Trend flush pressure/flow and inspect the seal plan through startup and steady state.",
      },
      {
        hypothesis: "The installed seal/material combination does not fit duty",
        whyItFits: "Multiple replacements have not prevented recurrence.",
        validation:
          "Confirm fluid properties, temperature, solids, faces, elastomers, and OEM duty limits.",
      },
    ],
  },
  {
    id: "conveyor-mistracking",
    asset: "CV-204 conveyor",
    industry: "Mining and bulk materials",
    label: "Recurring conveyor mistracking",
    shortLabel: "Conveyor",
    question:
      "What is driving CV-204 belt mistracking, and how do we stop adjusting symptoms instead of removing the mechanism?",
    signal: "4 mistracking events plus carryback",
    csvText: scenarioRows["conveyor-mistracking"].join("\n"),
    inputs: {
      operatingHours: 6_200,
      failures: 7,
      repairHours: 22,
      repairEvents: 7,
      missionTimeHours: 120,
    },
    hypotheses: [
      {
        hypothesis:
          "Off-centre loading at the transfer point is steering the belt",
        whyItFits: "Spillage and repeat drift originate near the loading zone.",
        validation:
          "Observe loading profile at low/high rate and measure chute-to-belt centreline.",
      },
      {
        hypothesis: "Carryback is changing return-side tracking geometry",
        whyItFits: "Buildup is recorded between mistracking events.",
        validation:
          "Map buildup, scraper condition, seized idlers, and tracking response after cleaning.",
      },
      {
        hypothesis:
          "Structural or pulley misalignment remains after local adjustment",
        whyItFits: "Idler adjustment produces only temporary recovery.",
        validation:
          "Survey pulley, stringer, and idler alignment before making another tracking change.",
      },
    ],
  },
  {
    id: "compressor-vibration",
    asset: "C-330 compressor",
    industry: "Energy and processing",
    label: "Repeat compressor vibration trips",
    shortLabel: "Compressor",
    question:
      "What evidence should we collect around C-330's repeat vibration trips before authorizing a permanent mechanical change?",
    signal: "4 high-vibration events and 102 downtime hours",
    csvText: scenarioRows["compressor-vibration"].join("\n"),
    inputs: {
      operatingHours: 7_100,
      failures: 7,
      repairHours: 51,
      repairEvents: 7,
      missionTimeHours: 168,
    },
    hypotheses: [
      {
        hypothesis:
          "Alignment or coupling condition changes across operating states",
        whyItFits:
          "Coupling wear and repeat drive-end vibration appear in the same period.",
        validation:
          "Compare cold/hot alignment, coupling inspection, phase, and spectrum before teardown.",
      },
      {
        hypothesis: "Process excitation is crossing a mechanical response band",
        whyItFits: "One excursion followed a process-rate change.",
        validation:
          "Correlate speed, load, pressure, flow, and vibration spectrum across the operating map.",
      },
      {
        hypothesis: "Support looseness or soft foot is amplifying vibration",
        whyItFits: "Repeat corrective work has not eliminated the symptom.",
        validation:
          "Check hold-down torque, soft foot, base condition, piping strain, and phase response.",
      },
    ],
  },
];

export function getPublicReliabilityScenario(
  id: PublicReliabilityScenarioId,
): PublicReliabilityScenario {
  return (
    PUBLIC_RELIABILITY_SCENARIOS.find((scenario) => scenario.id === id) ??
    PUBLIC_RELIABILITY_SCENARIOS[0]
  );
}

export function generatePublicReliabilityDemo(
  id: PublicReliabilityScenarioId,
  now = new Date(),
  question?: string,
): PublicReliabilityDemoResult {
  const scenario = getPublicReliabilityScenario(id);
  const userQuestion = question?.trim().slice(0, 600) || scenario.question;
  const report = generateReliabilityReport({
    mode: "RCA",
    prompt: userQuestion,
    csvText: scenario.csvText,
    inputs: scenario.inputs,
    now,
  });
  const topActor = report.badActors[0];

  return {
    scenario,
    userQuestion,
    report,
    patternSummary: topActor
      ? `${topActor.assetId} accounts for ${topActor.failures} coded events, ${topActor.downtimeHours} downtime hours, and $${topActor.maintenanceCost.toLocaleString("en-US")} in captured maintenance cost. ${topActor.topFailureMode} is the dominant repeat mode.`
      : "The supplied history does not contain enough structured evidence to rank a bad actor.",
    immediateContainment:
      "Preserve failed parts and pre-work evidence; verify current safeguards and operating limits before disturbing the asset.",
    recurrenceCheck:
      "Track the same failure-mode definition for 90 days after the approved action and reopen the case on the first recurrence.",
  };
}

export function parsePublicDemoUsage(
  raw: string | null,
): PublicDemoUsage | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<PublicDemoUsage>;
    const scenarioExists = PUBLIC_RELIABILITY_SCENARIOS.some(
      (scenario) => scenario.id === parsed.scenarioId,
    );
    if (
      !scenarioExists ||
      typeof parsed.runCount !== "number" ||
      parsed.runCount < 1 ||
      typeof parsed.completedAt !== "string"
    ) {
      return null;
    }
    return {
      runCount: Math.floor(parsed.runCount),
      scenarioId: parsed.scenarioId as PublicReliabilityScenarioId,
      completedAt: parsed.completedAt,
      ...(typeof parsed.question === "string" && parsed.question.trim()
        ? { question: parsed.question.trim().slice(0, 600) }
        : {}),
    };
  } catch {
    return null;
  }
}

export function readPublicDemoUsage(
  storage: UsageStorage,
): PublicDemoUsage | null {
  return parsePublicDemoUsage(storage.getItem(PUBLIC_DEMO_STORAGE_KEY));
}

export function recordPublicDemoRun(
  storage: UsageStorage,
  scenarioId: PublicReliabilityScenarioId,
  completedAt = new Date(),
  question?: string,
): PublicDemoUsage {
  const current = readPublicDemoUsage(storage);
  const usage: PublicDemoUsage = {
    runCount: (current?.runCount ?? 0) + 1,
    scenarioId,
    completedAt: completedAt.toISOString(),
    ...(question?.trim() ? { question: question.trim().slice(0, 600) } : {}),
  };
  storage.setItem(PUBLIC_DEMO_STORAGE_KEY, JSON.stringify(usage));
  return usage;
}

export function hasUsedPublicDemo(usage: PublicDemoUsage | null): boolean {
  return (usage?.runCount ?? 0) >= PUBLIC_DEMO_FREE_RUN_LIMIT;
}
