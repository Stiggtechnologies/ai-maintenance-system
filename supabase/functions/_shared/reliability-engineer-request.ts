import type { PublicDecisionCaseContext } from "./decision-case-chat.ts";
import { buildDecisionCaseChatPrompts } from "./decision-case-chat.ts";
import {
  buildSpecialistBrief,
  selectReliabilitySpecialists,
} from "./reliability-specialists.ts";

export interface ReliabilityEngineerRequest {
  agentType: "ReliabilityAgent";
  industry: string;
  depth: "standard" | "deliverable";
  requiresApproval: true;
  publicOnly: true;
  maxOutputTokens: number;
  query: string;
}

const DELIVERABLE_PATTERN =
  /\b(complete|produce|create|build|generate|develop|prepare|draft|perform)\b[\s\S]{0,140}\b(fmea|rca|fracas|rcm|register|assessment|analysis|packet|report|plan|study|review)\b/i;
const ASSET_ONBOARDING_PATTERN =
  /\b(onboard|commission|accept|handover|introduce)\b[\s\S]{0,120}\b(asset|equipment|machine|pump|compressor|crusher|conveyor|truck|haul truck|shovel|mill|turbine|generator|transformer|production line)\b/i;
const SUBJECT_BOUNDARY_PATTERN =
  /\b(onboard|different asset|new asset|another asset|different subject|new subject|different topic|new topic|something else|look at a different)\b/i;

function recentSubjectConversation(
  messages: PublicDecisionCaseContext["recentMessages"],
): string {
  const bounded = messages.slice(-10);
  let start = -1;
  for (let index = bounded.length - 1; index >= 0; index -= 1) {
    const message = bounded[index];
    if (
      message.role === "user" &&
      SUBJECT_BOUNDARY_PATTERN.test(message.text)
    ) {
      start = index;
    }
  }
  const relevant = bounded.slice(
    start >= 0 ? start : Math.max(0, bounded.length - 4),
  );
  return relevant
    .map((message) => `${message.role.toUpperCase()}: ${message.text}`)
    .join("\n");
}

function requestDepth(value: string): "standard" | "deliverable" {
  return DELIVERABLE_PATTERN.test(value) || ASSET_ONBOARDING_PATTERN.test(value)
    ? "deliverable"
    : "standard";
}

function onboardingSuccessContract(value: string): string {
  if (!ASSET_ONBOARDING_PATTERN.test(value)) return "";
  return [
    "ASSET ONBOARDING WORK-PRODUCT CONTRACT",
    "Treat onboarding as governed asset acceptance, commissioning, maintenance readiness, operational readiness, and reliability growth, not delivery plus a generic checklist.",
    "Produce a complete phase-and-gate summary first, then enough engineering detail to be usable. Cover: duty profile and measurable requirements; exact serialized configuration and approved documentation; OEM, regulatory, and site-standard gap assessment; hazardous-energy isolation and safety-critical controls; Day-0 structural, mechanical, electrical, fluid, contamination, and condition baselines; CMMS hierarchy, PM/CBM, failure coding, component-life and FRACAS setup; spares, tooling, infrastructure and competency readiness; static, empty, partial-load and representative loaded commissioning; controlled production ramp-up and reliability-growth reviews; deficiency closure; and final Operations, Maintenance, Reliability, HSE, and technical-authority handover.",
    "For each gate, name the accountable owner, evidence required, acceptance or stop criteria, approval authority, and consequence of premature release. Clearly separate confirmed legal/OEM requirements from recommended engineering practice and site-dependent controls. Do not invent current regulations, OEM limits, contractual targets, or site standards.",
    "Complete every lifecycle gate and the final handover before expanding any one section. Keep the answer within roughly 1,800 to 2,400 words. Use the gate table as the authoritative core and do not repeat every gate in a gate-by-gate essay. After the table, use only concise sections for: regulatory/OEM/site boundaries; Day-0 baseline; CMMS, maintenance and logistics readiness; staged commissioning and stop conditions; reliability growth and handover; and the next governed artifact. The answer is invalid if it ends before final handover and the next artifact.",
    "End with the concrete artifact SyncAI should create next, such as a governed onboarding and commissioning checklist with responsibilities, evidence fields, acceptance criteria, and gate sign-offs.",
  ].join("\n");
}

export function buildReliabilityEngineerRequest(
  context: PublicDecisionCaseContext,
  question: string,
): ReliabilityEngineerRequest {
  const normalizedQuestion = question.trim();

  if (context.questionScope === "provisional_new_subject") {
    const conversation = recentSubjectConversation(context.recentMessages);
    const combinedRequest = `${conversation}\n${normalizedQuestion}`;
    const specialists = selectReliabilitySpecialists(combinedRequest);
    return {
      agentType: "ReliabilityAgent",
      industry: context.industry || "asset-intensive reliability engineering",
      depth: requestDepth(combinedRequest),
      requiresApproval: true,
      publicOnly: true,
      maxOutputTokens: 5600,
      query: [
        "COWORK RELIABILITY ENGINEER REQUEST",
        "Question scope: PROVISIONAL NEW SUBJECT",
        `The active Decision Case ${context.caseNumber} for ${context.asset} remains unchanged and its technical facts are excluded from this analysis.`,
        "Use the recent thread only to resolve conversational intent and references. Do not treat earlier assistant statements or active-case facts as evidence for the new subject.",
        conversation
          ? `Recent subject-changing conversation:\n${conversation}`
          : "Recent subject-changing conversation: none retained.",
        `Current user request: ${normalizedQuestion}`,
        `Selected Reliability Engineer lenses:\n${buildSpecialistBrief(specialists)}`,
        onboardingSuccessContract(combinedRequest),
        "Continue the conversation naturally. Do not ask the user to repeat an asset, objective, industry, or instruction that is already present in the recent thread. If evidence is missing, still provide the useful engineering framework or next steps now, then ask only the smallest necessary follow-up.",
        "Treat the analysis as provisional until a separate governed Decision Case is created.",
      ].join("\n\n"),
    };
  }

  const prompts = buildDecisionCaseChatPrompts(context, normalizedQuestion, "");
  const specialists = selectReliabilitySpecialists(
    `${normalizedQuestion} ${context.objective}`,
  );
  return {
    agentType: "ReliabilityAgent",
    industry: context.industry || "asset-intensive reliability engineering",
    depth: requestDepth(normalizedQuestion),
    requiresApproval: true,
    publicOnly: true,
    maxOutputTokens: 5600,
    query: [
      "COWORK RELIABILITY ENGINEER REQUEST",
      prompts.userContent,
      `Selected Reliability Engineer lenses:\n${buildSpecialistBrief(specialists)}`,
      onboardingSuccessContract(normalizedQuestion),
      "Answer the current request using the existing Reliability Engineer contract. Preserve the deterministic case record, identify uncertainty, and keep human technical authority explicit.",
    ].join("\n\n"),
  };
}
