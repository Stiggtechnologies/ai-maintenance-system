import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function write(path, value) { fs.writeFileSync(path, value); }
function replaceOnce(value, needle, replacement, label) {
  if (!value.includes(needle)) throw new Error(`Missing patch anchor: ${label}`);
  return value.replace(needle, replacement);
}
function replaceRegex(value, regex, replacement, label) {
  if (!regex.test(value)) throw new Error(`Missing regex patch anchor: ${label}`);
  return value.replace(regex, replacement);
}

const processorPath = "supabase/functions/ai-agent-processor/index.ts";
let processor = read(processorPath);
processor = replaceOnce(
  processor,
  'import { retrieveReliabilityContext } from "../_shared/reliability-context.ts";\n',
  'import { retrieveReliabilityContext } from "../_shared/reliability-context.ts";\nimport {\n  RELIABILITY_PROMPT_VERSION,\n  appendApprovedReliabilityContext,\n  buildReliabilityEngineerPrompt,\n} from "../_shared/reliability-engineer-core.ts";\n',
  "processor core import",
);
processor = replaceOnce(
  processor,
  'const MODEL_STRUCTURED = Deno.env.get("MODEL_STRUCTURED") ?? "gpt-5.6-luna";\n',
  'const MODEL_STRUCTURED = Deno.env.get("MODEL_STRUCTURED") ?? "gpt-5.6-luna";\nconst MODEL_RELIABILITY = Deno.env.get("MODEL_RELIABILITY") ?? MODEL_DELIVERABLE;\n',
  "reliability model",
);
processor = replaceOnce(
  processor,
  'function gatewayTierFor(directModel: string): string {\n  if (directModel === MODEL_DELIVERABLE) return TIER_DELIVERABLE;\n',
  'function gatewayTierFor(directModel: string): string {\n  if (directModel === MODEL_RELIABILITY) return TIER_DELIVERABLE;\n  if (directModel === MODEL_DELIVERABLE) return TIER_DELIVERABLE;\n',
  "gateway tier",
);
processor = replaceRegex(
  processor,
  /function buildLegacyPrompt\([\s\S]*?\n}\n\nasync function logToSir/,
  `function buildLegacyPrompt(\n  agentType: string,\n  industry?: string,\n  deliverable = false,\n  accessMode: "public" | "authenticated" = "authenticated",\n): string {\n  if (agentType === "ReliabilityAgent") {\n    return buildReliabilityEngineerPrompt({\n      industry,\n      accessMode,\n      deliverable,\n    });\n  }\n\n  const purpose =\n    AGENT_PURPOSE[agentType] ?? AGENT_PURPOSE.CentralCoordinationAgent;\n  let prompt = \`You are SyncAI's senior industrial AI specialist for \${purpose}\${industry ? \` in \${industry}\` : ""}.\nUse only supplied facts and clearly label assumptions. Distinguish symptoms, mechanisms, causes and systemic causes. Quantify deviations where data permits. Recommend reversible field verification before permanent changes. Every material recommendation must name an owner role, time window, verification metric, consequence of being wrong, and whether qualified human approval is required. Never advise bypassing safety, regulatory, OEM, change-management or operational approvals. End with a concise bottom line.\`;\n\n  if (deliverable) {\n    prompt += \`\\nThe user requested a complete work product. Produce the artifact now rather than a methodology outline. For an FMEA, include at least 20 scored failure-mode rows plus scoring scales, assumptions, a prioritized action plan, regulatory applicability, method references and a bottom line. For RCA, FRACAS, RCM, risk or planning requests, provide the corresponding complete professional artifact.\`;\n  }\n  return prompt;\n}\n\nasync function logToSir`,
  "buildLegacyPrompt",
);
processor = replaceOnce(
  processor,
  `  const model = body.publicOnly\n    ? deliverable\n      ? MODEL_PUBLIC_FRONTIER\n      : MODEL_CHAT\n    : deliverable\n      ? MODEL_DELIVERABLE\n      : MODEL_CHAT;`,
  `  const model = agentType === "ReliabilityAgent"\n    ? body.publicOnly\n      ? MODEL_PUBLIC_FRONTIER\n      : MODEL_RELIABILITY\n    : body.publicOnly\n      ? deliverable\n        ? MODEL_PUBLIC_FRONTIER\n        : MODEL_CHAT\n      : deliverable\n        ? MODEL_DELIVERABLE\n        : MODEL_CHAT;`,
  "legacy model selection",
);
processor = replaceOnce(
  processor,
  '  const systemPrompt = `${buildLegacyPrompt(agentType, body.industry, deliverable)}${kb.promptContext ? `\\n\\nApproved reliability reference passages:\\n${kb.promptContext}\\nUse only the exact bracket labels supplied for citations.` : ""}`;\n',
  '  const basePrompt = buildLegacyPrompt(\n    agentType,\n    body.industry,\n    deliverable,\n    body.publicOnly ? "public" : "authenticated",\n  );\n  const systemPrompt = agentType === "ReliabilityAgent"\n    ? appendApprovedReliabilityContext(basePrompt, kb.promptContext)\n    : `${basePrompt}${kb.promptContext ? `\\n\\nApproved reliability reference passages:\\n${kb.promptContext}\\nUse only the exact bracket labels supplied for citations.` : ""}`;\n',
  "legacy prompt assembly",
);
processor = replaceOnce(
  processor,
  '    knowledgeBaseUsed: kb.knowledgeBaseUsed,\n    citations: kb.citations.map((citation) => ({\n',
  '    promptVersion: agentType === "ReliabilityAgent" ? RELIABILITY_PROMPT_VERSION : undefined,\n    knowledgeBaseUsed: kb.knowledgeBaseUsed,\n    citations: kb.citations.map((citation) => ({\n',
  "legacy response metadata",
);
processor = replaceRegex(
  processor,
  /function buildTypedPrompts\([\s\S]*?\n}\n\nasync function handleTyped/,
  `function buildTypedPrompts(\n  body: TypedAgentRequest,\n  workOrder: Record<string, unknown>,\n  asset: Record<string, unknown>,\n  knowledgeContext = "",\n) {\n  const context = \`Work order: \${workOrder.title}\\nDescription: \${workOrder.description ?? "not supplied"}\\nPriority: \${workOrder.priority ?? "unspecified"}\\nStatus: \${workOrder.status ?? "unspecified"}\\nType: \${workOrder.type ?? "unspecified"}\\n\\nAsset: \${asset.name}\\nTag: \${asset.tag ?? "not supplied"}\\nCriticality: \${asset.criticality ?? "unspecified"}\\nStatus: \${asset.status ?? "unspecified"}\\nManufacturer/model: \${asset.manufacturer ?? "unknown"} \${asset.model ?? ""}\\nTrigger: \${body.input.trigger_reason}\`;\n  const reliabilityPrompt = appendApprovedReliabilityContext(\n    buildReliabilityEngineerPrompt({\n      accessMode: "authenticated",\n      structuredOutput: true,\n    }),\n    knowledgeContext,\n  );\n\n  if (body.task_code === "classify_failure_mode") {\n    return {\n      system: \`${reliabilityPrompt}\\nReturn strict JSON with failure_mode, failure_mode_family, likely_cause_family, recommended_next_diagnostic_step, risk_level, evidence, summary, confidence (0-1), and requires_human_review.\`,\n      user: \`Classify the likely failure mode:\\n\\n\${context}\`,\n    };\n  }\n  if (body.task_code === "draft_reliability_assessment") {\n    return {\n      system: \`${reliabilityPrompt}\\nReturn strict JSON with likely_causes, recommended_actions, risk_level, evidence, summary, confidence (0-1), and requires_human_review.\`,\n      user: \`Draft a reliability assessment:\\n\\n\${context}\`,\n    };\n  }\n  throw new Error("unsupported_task_code");\n}\n\nasync function handleTyped`,
  "typed prompt builder",
);
processor = replaceOnce(
  processor,
  `    if (!workOrderResult.data || !assetResult.data)\n      throw new Error("scoped_context_not_found");\n\n    const prompts = buildTypedPrompts(\n      body,\n      workOrderResult.data,\n      assetResult.data,\n    );`,
  `    if (!workOrderResult.data || !assetResult.data)\n      throw new Error("scoped_context_not_found");\n\n    const typedQuery = [\n      workOrderResult.data.title,\n      workOrderResult.data.description,\n      assetResult.data.name,\n      assetResult.data.manufacturer,\n      assetResult.data.model,\n      body.input.trigger_reason,\n    ].filter(Boolean).join(" ");\n    const kb = await retrieveReliabilityContext(admin, typedQuery, {\n      organizationId,\n    });\n    const prompts = buildTypedPrompts(\n      body,\n      workOrderResult.data,\n      assetResult.data,\n      kb.promptContext,\n    );`,
  "typed retrieval",
);
processor = replaceOnce(
  processor,
  '      output_schema_version: "1.0.0",\n      confidence,\n',
  '      output_schema_version: "1.0.0",\n      prompt_version: RELIABILITY_PROMPT_VERSION,\n      model_used: answeredBy,\n      knowledge_base_used: kb.knowledgeBaseUsed,\n      citations: kb.citations.map((citation) => ({\n        title: citation.title,\n        pageRange: citation.pageRange,\n        documentClass: citation.documentClass,\n        label: citation.label,\n      })),\n      confidence,\n',
  "typed response metadata",
);
write(processorPath, processor);

const publicPath = "supabase/functions/public-reliability-agent/index.ts";
let publicAgent = read(publicPath);
publicAgent = replaceOnce(
  publicAgent,
  'import { retrieveReliabilityContext } from "../_shared/reliability-context.ts";\n',
  'import { retrieveReliabilityContext } from "../_shared/reliability-context.ts";\nimport {\n  RELIABILITY_PROMPT_VERSION,\n  appendApprovedReliabilityContext,\n  buildReliabilityEngineerPrompt,\n  sanitizeReliabilityCitations,\n} from "../_shared/reliability-engineer-core.ts";\n',
  "public core import",
);
publicAgent = replaceRegex(
  publicAgent,
  /  const instructions = `You are SyncAI's senior Reliability Engineer\.[\s\S]*?Return the required JSON only\.`;\n/,
  `  const instructions = appendApprovedReliabilityContext(\n    \`${buildReliabilityEngineerPrompt({\n      industry: "asset-intensive reliability engineering",\n      accessMode: "public",\n      structuredOutput: true,\n    })}\\nProduce a concise, board-ready but field-usable assessment. Retrieved passages support authorized general claims, not observations about the demonstrated asset. Return the required JSON only.\`,\n    knowledge.promptContext,\n  );\n`,
  "public instructions",
);
publicAgent = replaceOnce(
  publicAgent,
  '    const analysis = JSON.parse(text);\n',
  '    const analysis = JSON.parse(text) as Record<string, unknown>;\n    analysis.citations = sanitizeReliabilityCitations(\n      analysis.citations,\n      knowledge.citations,\n    );\n',
  "public citation sanitize",
);
publicAgent = replaceOnce(
  publicAgent,
  '        modelUsed: MODEL,\n        knowledgeBaseUsed: knowledge.knowledgeBaseUsed,\n        resetsAt,\n',
  '        modelUsed: MODEL,\n        promptVersion: RELIABILITY_PROMPT_VERSION,\n        knowledgeBaseUsed: knowledge.knowledgeBaseUsed,\n        retrievedSources: knowledge.citations.map((citation) => ({\n          title: citation.title,\n          pageRange: citation.pageRange,\n          documentClass: citation.documentClass,\n          label: citation.label,\n        })),\n        resetsAt,\n',
  "public response metadata",
);
write(publicPath, publicAgent);

const servicePath = "src/services/publicReliabilityAgent.ts";
let service = read(servicePath);
service = replaceOnce(
  service,
  'export interface PublicExpertCitation {\n  title: string;\n  pageRange: string;\n}\n',
  'export interface PublicExpertCitation {\n  title: string;\n  pageRange: string;\n}\n\nexport interface PublicRetrievedSource extends PublicExpertCitation {\n  documentClass: string;\n  label: string;\n}\n',
  "frontend retrieved source type",
);
service = replaceOnce(
  service,
  '  | { status: "success"; analysis: PublicExpertAnalysis; modelUsed?: string }\n',
  '  | {\n      status: "success";\n      analysis: PublicExpertAnalysis;\n      modelUsed?: string;\n      promptVersion?: string;\n      knowledgeBaseUsed: boolean;\n      retrievedSources: PublicRetrievedSource[];\n    }\n',
  "frontend expert result type",
);
service = replaceOnce(
  service,
  '      analysis: data.analysis as PublicExpertAnalysis,\n      modelUsed: data.modelUsed,\n',
  '      analysis: data.analysis as PublicExpertAnalysis,\n      modelUsed: data.modelUsed,\n      promptVersion: data.promptVersion,\n      knowledgeBaseUsed: data.knowledgeBaseUsed === true,\n      retrievedSources: Array.isArray(data.retrievedSources)\n        ? data.retrievedSources as PublicRetrievedSource[]\n        : [],\n',
  "frontend expert metadata parse",
);
write(servicePath, service);

console.log("Reliability core integration applied successfully.");
