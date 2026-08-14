import type { DecisionCase, DecisionIndustryId } from "./decision-case";

export type DecisionQuestionScope = "active_case" | "provisional_new_subject";

export type ReliabilityBenchmarkRoute =
  | "local_conversation"
  | "local_clarification"
  | "active_case_trace"
  | "agent_active_case"
  | "agent_new_subject";

export interface ReliabilityAgentBenchmark {
  id: string;
  industry: DecisionIndustryId;
  capability: string;
  prompt: string;
  expectedRoute: ReliabilityBenchmarkRoute;
  requiredBehaviors: string[];
}

const TOPIC_CHANGE_PATTERN =
  /\b(set (?:this|the current|the active) case aside|set the [\w-]+ case aside|not (?:about|for) (?:this|the)|new (?:asset|case|subject|topic)|different (?:asset|case|subject|topic)|another (?:asset|case|subject|topic)|separate (?:asset|case|analysis)|outside (?:this|the) case)\b/i;
const EQUIPMENT_PATTERN =
  /\b(pump|compressor|crusher|conveyor|gearbox|motor|turbine|boiler|furnace|press|stamping press|fan|blower|valve|pipeline|vessel|transformer|generator|truck|haul truck|shovel|mill|kiln|screen|feeder|robot|robotic|weld cell|packaging line|production line)\b/gi;
const NON_ASSET_PREFIXES = new Set([
  "API",
  "DC",
  "FMEA",
  "FRACAS",
  "IEC",
  "ISO",
  "MOC",
  "NPSH",
  "OEM",
  "PFD",
  "PFT",
  "PM",
  "PO",
  "RCA",
  "RCM",
  "RAM",
  "WO",
  "WP",
]);

function normalizedAssetIdentifiers(value: string): Set<string> {
  const matches =
    value.toUpperCase().match(/\b[A-Z]{1,6}[- ]?\d{2,6}\b/g) || [];
  return new Set(
    matches
      .filter((match) => {
        const prefix = match.match(/^[A-Z]+/)?.[0] || "";
        return !NON_ASSET_PREFIXES.has(prefix);
      })
      .map((match) => match.replace(/[- ]/g, "")),
  );
}

function equipmentKinds(value: string): Set<string> {
  return new Set(
    [...value.toLowerCase().matchAll(EQUIPMENT_PATTERN)].map((match) =>
      match[0].replace(/\s+/g, " "),
    ),
  );
}

export function classifyDecisionQuestionScope(
  decisionCase: Pick<DecisionCase, "asset" | "assetContext" | "title">,
  prompt: string,
): DecisionQuestionScope {
  const question = prompt.trim();
  if (!question) return "active_case";
  if (TOPIC_CHANGE_PATTERN.test(question)) return "provisional_new_subject";

  const activeText = `${decisionCase.asset} ${decisionCase.assetContext} ${decisionCase.title}`;
  const activeIds = normalizedAssetIdentifiers(activeText);
  const questionIds = normalizedAssetIdentifiers(question);
  if ([...questionIds].some((identifier) => !activeIds.has(identifier))) {
    return "provisional_new_subject";
  }

  const activeKinds = equipmentKinds(activeText);
  const questionKinds = equipmentKinds(question);
  if (
    question.split(/\s+/).length >= 7 &&
    [...questionKinds].some((kind) => !activeKinds.has(kind))
  ) {
    return "provisional_new_subject";
  }

  return "active_case";
}

export function isActiveCaseTraceRequest(
  decisionCase: Pick<DecisionCase, "asset" | "assetContext" | "title">,
  prompt: string,
): boolean {
  if (classifyDecisionQuestionScope(decisionCase, prompt) !== "active_case") {
    return false;
  }
  const asksToTrace =
    /\b(show|explain|audit|trace|reconcile|verify|walk me through|where did|which record|cite)\b/i.test(
      prompt,
    );
  const traceObject =
    /\b(calculation|calculations|formula|source record|source records|exact source|lineage|input|inputs|assumption|assumptions)\b/i.test(
      prompt,
    );
  return asksToTrace && traceObject;
}

export const RELIABILITY_AGENT_BENCHMARKS: ReliabilityAgentBenchmark[] = [
  {
    id: "conversation-greeting",
    industry: "mining",
    capability: "Natural conversation",
    prompt: "Hi",
    expectedRoute: "local_conversation",
    requiredBehaviors: [
      "respond naturally",
      "retain the active case",
      "ask what to work on",
    ],
  },
  {
    id: "conversation-capabilities",
    industry: "mining",
    capability: "Capability discovery",
    prompt: "What are your capabilities?",
    expectedRoute: "local_conversation",
    requiredBehaviors: [
      "describe broad reliability engineering capability",
      "give concrete example requests",
      "retain but do not force the active case",
    ],
  },
  {
    id: "conversation-vague-follow-up",
    industry: "oil-gas",
    capability: "Ambiguity handling",
    prompt: "Tell me more",
    expectedRoute: "local_clarification",
    requiredBehaviors: [
      "ask one focused clarification",
      "do not dump case metrics",
    ],
  },
  {
    id: "conversation-topic-change",
    industry: "manufacturing",
    capability: "Topic change",
    prompt: "I want you to look at something else",
    expectedRoute: "local_clarification",
    requiredBehaviors: ["request the new subject", "preserve the active case"],
  },
  {
    id: "audit-case-calculations",
    industry: "oil-gas",
    capability: "Deterministic traceability",
    prompt: "Show the calculations and exact source records for this case.",
    expectedRoute: "active_case_trace",
    requiredBehaviors: [
      "use canonical calculations",
      "show assumptions",
      "show source lineage",
    ],
  },
  {
    id: "mining-rca",
    industry: "mining",
    capability: "RCA and protection decision",
    prompt:
      "A primary crusher has seven low-lube-pressure trips after startup and conflicting pressure calibration. Should we lower the trip setpoint or replace the bearings?",
    expectedRoute: "agent_active_case",
    requiredBehaviors: [
      "lead with a decision",
      "separate facts from hypotheses",
      "preserve protection",
    ],
  },
  {
    id: "manufacturing-pm-interval",
    industry: "manufacturing",
    capability: "RCM and PM optimization",
    prompt:
      "Set this case aside. A safety-critical stamping press has no failures in two years, 62% weekly inspection completion, and no validated P-F interval. Can we move to annual inspection?",
    expectedRoute: "agent_new_subject",
    requiredBehaviors: [
      "reject the no-failure fallacy",
      "quantify only defensible facts",
      "require safety approval",
    ],
  },
  {
    id: "oil-gas-fracas",
    industry: "oil-gas",
    capability: "FRACAS recurrence control",
    prompt:
      "For this case, build a FRACAS closure plan that prevents recurrence and defines effectiveness checks.",
    expectedRoute: "agent_active_case",
    requiredBehaviors: [
      "define owners",
      "define closure evidence",
      "define recurrence window",
    ],
  },
  {
    id: "ram-missing-exposure",
    industry: "manufacturing",
    capability: "RAM calculation discipline",
    prompt:
      "Calculate MTBF and availability for a packaging line with four failures, but I do not have operating hours or valid repair durations.",
    expectedRoute: "agent_new_subject",
    requiredBehaviors: [
      "refuse invalid MTBF",
      "name missing denominators",
      "offer valid next calculations",
    ],
  },
  {
    id: "new-asset-calculation",
    industry: "mining",
    capability: "Cross-asset isolation",
    prompt:
      "Calculate MTBF for haul truck HT-240 from 7,100 operating hours and 7 chargeable failures, and state the assumptions.",
    expectedRoute: "agent_new_subject",
    requiredBehaviors: [
      "do the math",
      "state assumptions",
      "do not use crusher facts",
    ],
  },
  {
    id: "fmea-rcm-strategy",
    industry: "manufacturing",
    capability: "FMEA and RCM strategy",
    prompt:
      "Develop failure-mode-specific maintenance options for a robotic weld cell and explain when condition-based work is technically applicable.",
    expectedRoute: "agent_new_subject",
    requiredBehaviors: [
      "identify functions and failure modes",
      "compare policy options",
      "state evidence needs",
    ],
  },
  {
    id: "evidence-conflict",
    industry: "oil-gas",
    capability: "Conflicting evidence",
    prompt:
      "The approved drawing conflicts with the field configuration in this case. What does that block and who resolves it?",
    expectedRoute: "agent_active_case",
    requiredBehaviors: [
      "preserve both evidence states",
      "identify authority",
      "avoid false certainty",
    ],
  },
  {
    id: "value-verification",
    industry: "mining",
    capability: "Risk-to-value verification",
    prompt:
      "Challenge the business case for this recommendation and define how avoided downtime value will be verified after execution.",
    expectedRoute: "agent_active_case",
    requiredBehaviors: [
      "separate estimated and realized value",
      "define baseline",
      "include finance verification",
    ],
  },
  {
    id: "safety-change-control",
    industry: "oil-gas",
    capability: "Safety and MOC boundary",
    prompt:
      "Can operations temporarily bypass the protective trip while we collect evidence on this asset?",
    expectedRoute: "agent_active_case",
    requiredBehaviors: [
      "protect the safety boundary",
      "identify MOC authority",
      "state stop conditions",
    ],
  },
  {
    id: "lifecycle-spares",
    industry: "mining",
    capability: "Lifecycle and spares decision",
    prompt:
      "Should we hold a complete spare gearbox for conveyor CV-880 or rely on component spares and expedited repair?",
    expectedRoute: "agent_new_subject",
    requiredBehaviors: [
      "compare consequence and lead time",
      "quantify uncertainty",
      "define a decision gate",
    ],
  },
  {
    id: "mro-inventory-policy",
    industry: "manufacturing",
    capability: "MRO inventory optimization",
    prompt:
      "Review a repairable critical motor with intermittent demand, 14-month supplier lead time, two installed positions, one serviceable spare, and no validated repair turnaround. Should min/max increase, decrease, or stay unchanged?",
    expectedRoute: "agent_new_subject",
    requiredBehaviors: [
      "separate insurance-spare logic from consumable demand",
      "quantify stockout and working-capital tradeoffs",
      "identify repair-loop evidence and decision gates",
    ],
  },
  {
    id: "planning-schedule-readiness",
    industry: "oil-gas",
    capability: "Maintenance planning and scheduling",
    prompt:
      "Build a 6-week lookahead from a 200-work-order backlog. Separate risk priority from Ready-to-Schedule status, identify material and isolation blockers, and level-load mechanical and electrical craft demand.",
    expectedRoute: "agent_new_subject",
    requiredBehaviors: [
      "separate priority from readiness",
      "identify materials, permits, isolation, and resource blockers",
      "produce a governed lookahead and frozen-schedule gate",
    ],
  },
];

export const RELIABILITY_AGENT_REQUIRED_DIMENSIONS = [
  "answer the actual request",
  "separate facts, assertions, hypotheses, and engineering judgement",
  "state what can and cannot be calculated",
  "identify missing evidence and what each gap blocks",
  "recommend the lowest-regret next action",
  "name owners, timing, stop conditions, and effectiveness checks",
  "preserve approval and change-control boundaries",
  "verify realized value without hiding transferred risk",
  "isolate a new subject from the active case",
] as const;
