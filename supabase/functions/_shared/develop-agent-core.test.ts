/**
 * Sync Develop Slice 3D — the three agents' deterministic halves.
 *
 * The cases that matter are the REFUSALS. An agent that produces a confident
 * answer from a bad model response is the failure mode §70 is written against,
 * so every parser here is tested for what it declines to accept.
 */
import { describe, expect, it } from "vitest";
import {
  buildGatePrompts,
  buildMethodologyPrompts,
  buildRiskPrompts,
  extractJsonObject,
  finiteOrNull,
  locateWorkflowStep,
  parseFrameworkProposal,
  parseTreatmentAdvice,
  readGateReadiness,
  treatmentCandidates,
  type RiskView,
} from "./develop-agent-core";

const STAGE_KEYS = ["identify", "select", "define", "execute", "operate"];

const proposal = (over: Record<string, unknown> = {}) => ({
  name: "Capital Delivery Framework",
  basis: "Drawn from sections 3 and 4 of the customer's project delivery manual.",
  summary: "A four-stage model with a decision gate at the end of each stage.",
  stages: [
    { stage_key: "identify", sequence: 1, display_name: "Identify" },
    { stage_key: "select", sequence: 2, display_name: "Select" },
  ],
  gates: [{ stage_key: "identify", name: "G1", sequence: 1, decision_type: "gate" }],
  requirements: [{ gate: "G1", criterion: "Problem statement is agreed with operations" }],
  ...over,
});

describe("extractJsonObject", () => {
  it("finds the object inside a fenced, prefixed model response", () => {
    const raw = 'Here you go:\n```json\n{"name":"x","n":1}\n```\nHope that helps.';
    expect(extractJsonObject(raw)).toEqual({ name: "x", n: 1 });
  });

  it("does not truncate on a brace inside a string literal", () => {
    const raw = '{"criterion":"Cost model {P50} approved","ok":true}';
    expect(extractJsonObject(raw)).toEqual({
      criterion: "Cost model {P50} approved",
      ok: true,
    });
  });

  it("survives an escaped quote before a brace", () => {
    const raw = '{"note":"he said \\"done {now}\\"","ok":true}';
    expect(extractJsonObject(raw)).toEqual({ note: 'he said "done {now}"', ok: true });
  });

  it("returns null when there is no object at all", () => {
    expect(extractJsonObject("I could not find a framework in that document.")).toBeNull();
  });
});

describe("finiteOrNull", () => {
  it("refuses NaN, Infinity and the empty string rather than coercing them", () => {
    expect(finiteOrNull(Number.NaN)).toBeNull();
    expect(finiteOrNull(Number.POSITIVE_INFINITY)).toBeNull();
    expect(finiteOrNull("")).toBeNull();
    expect(finiteOrNull("   ")).toBeNull();
    expect(finiteOrNull(null)).toBeNull();
    // The trap: Number("") is 0, so an unguarded cast turns "no answer" into
    // an answer of zero.
    expect(finiteOrNull(0)).toBe(0);
    expect(finiteOrNull("42.5")).toBe(42.5);
  });
});

describe("parseFrameworkProposal (D12.06 §56)", () => {
  it("accepts a well-formed proposal and drops nothing", () => {
    const result = parseFrameworkProposal(proposal(), STAGE_KEYS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dropped).toEqual([]);
    expect(result.proposal.stages).toHaveLength(2);
    expect(result.proposal.requirements[0].is_mandatory).toBe(false);
  });

  it("REFUSES a non-canonical stage key rather than mapping it", () => {
    const result = parseFrameworkProposal(
      proposal({ stages: [{ stage_key: "FEL-2", sequence: 1, display_name: "FEL-2" }] }),
      STAGE_KEYS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toContain("FEL-2");
    expect(result.refusal).toContain("canonical");
  });

  it("refuses a proposal with no basis — a framework nobody can check", () => {
    const result = parseFrameworkProposal(proposal({ basis: "from the doc" }), STAGE_KEYS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toContain("basis");
  });

  it("refuses a proposal with stages but no gate", () => {
    const result = parseFrameworkProposal(proposal({ gates: [] }), STAGE_KEYS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toContain("no usable gate");
  });

  it("refuses an empty model answer as a refusal, not as an empty framework", () => {
    const result = parseFrameworkProposal(
      { name: "", basis: "", summary: "", stages: [], gates: [], requirements: [] },
      STAGE_KEYS,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toContain("names no framework");
  });

  it("drops an orphan gate and an orphan requirement, and REPORTS both", () => {
    const result = parseFrameworkProposal(
      proposal({
        gates: [
          { stage_key: "identify", name: "G1", sequence: 1 },
          { stage_key: "operate", name: "G9", sequence: 2 },
        ],
        requirements: [
          { gate: "G1", criterion: "Problem statement agreed" },
          { gate: "G9", criterion: "Handover accepted by operations" },
        ],
      }),
      STAGE_KEYS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.gates).toHaveLength(1);
    expect(result.proposal.requirements).toHaveLength(1);
    expect(result.dropped.join(" ")).toContain("G9");
    expect(result.dropped.join(" ")).toContain("Handover accepted");
  });

  it("drops a duplicate stage sequence instead of renumbering the framework", () => {
    const result = parseFrameworkProposal(
      proposal({
        stages: [
          { stage_key: "identify", sequence: 1, display_name: "Identify" },
          { stage_key: "select", sequence: 1, display_name: "Select" },
        ],
      }),
      STAGE_KEYS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.stages).toHaveLength(1);
    expect(result.dropped.join(" ")).toContain("already taken");
  });

  it("keeps is_mandatory false unless the model says true explicitly", () => {
    const result = parseFrameworkProposal(
      proposal({
        requirements: [
          { gate: "G1", criterion: "HAZOP actions closed", is_mandatory: "yes" },
          { gate: "G1", criterion: "Cost estimate at P50", is_mandatory: true },
        ],
      }),
      STAGE_KEYS,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.requirements[0].is_mandatory).toBe(false);
    expect(result.proposal.requirements[1].is_mandatory).toBe(true);
  });

  it("parses a raw fenced string end to end", () => {
    const result = parseFrameworkProposal(
      "```json\n" + JSON.stringify(proposal()) + "\n```",
      STAGE_KEYS,
    );
    expect(result.ok).toBe(true);
  });
});

describe("buildMethodologyPrompts", () => {
  it("names the canonical vocabulary in the system prompt so the model cannot claim it was not told", () => {
    const p = buildMethodologyPrompts({
      documentTitle: "Delivery Manual",
      documentClass: "client_private",
      excerpts: ["Stage 1 is Identify."],
      canonicalStageKeys: STAGE_KEYS,
    });
    for (const key of STAGE_KEYS) expect(p.systemPrompt).toContain(key);
    expect(p.systemPrompt).toContain("not adopting");
    expect(p.userContent).toContain("Delivery Manual");
  });
});

describe("readGateReadiness (D12.08 §58)", () => {
  const view = {
    gateName: "G3 Sanction",
    blocked: true,
    readinessPct: 74,
    criteriaTotal: 12,
    mandatoryTotal: 8,
    mandatoryMet: 4,
    blockers: [
      { type: "mandatory_criterion", name: "Availability requirement supported", status: "not_met" },
      { type: "regulatory_condition", name: "AER-114 emissions report", overdue: true },
    ],
    projection: { available: true, projectedDate: "2026-10-14" },
  };

  it("passes every number through and never invents one", () => {
    const r = readGateReadiness(view);
    expect(r.headline).toContain("74%");
    expect(r.headline).toContain("BLOCKED");
    expect(r.headline).toContain("4 of 8");
    expect(r.headline).toContain("2 blocker(s)");
    expect(r.projectionLine).toContain("2026-10-14");
    expect(r.advisory).toBe(true);
  });

  it("says the gate defines nothing rather than printing 0% for a null readiness", () => {
    const r = readGateReadiness({ ...view, readinessPct: null, criteriaTotal: 0 });
    expect(r.headline).not.toContain("0%");
    expect(r.headline).toContain("no readiness percentage");
  });

  it("names each blocker family in words a reviewer can act on", () => {
    const r = readGateReadiness(view);
    expect(r.blockerLines[0]).toContain("Mandatory requirement not met");
    expect(r.blockerLines[1]).toContain("Outstanding permit condition");
    expect(r.blockerLines[1]).toContain("(overdue)");
  });

  it("states the projection refusal verbatim when there is no rate", () => {
    const r = readGateReadiness({
      ...view,
      projection: { available: false, reason: "only 2 of 3 closure events recorded" },
    });
    expect(r.projectionLine).toContain("2 of 3 closure events");
  });

  it("tells the model in its own system prompt that it may not recommend approval", () => {
    const p = buildGatePrompts(readGateReadiness(view));
    expect(p.systemPrompt).toContain("never state that a gate passes");
    expect(p.userContent).toContain("AER-114");
  });
});

describe("locateWorkflowStep + treatmentCandidates (D12.12 §62)", () => {
  const base: RiskView = {
    id: "r1",
    title: "Compressor delivery slips",
    eventDescription: "Long-lead compressor arrives after the tie-in window",
    currentRiskLevel: "High",
    currentRiskScore: 72,
    residualRiskLevel: "Medium",
    targetRiskScore: 30,
    status: "assessed",
    controlCount: 2,
    ineffectiveControlCount: 0,
    openTreatmentCount: 1,
    hasObjectiveLink: true,
    assumptionCount: 3,
    invalidatedAssumptionCount: 0,
  };

  it("puts a risk with no objective link at CONTEXT, whatever else is recorded", () => {
    const p = locateWorkflowStep({ ...base, hasObjectiveLink: false });
    expect(p.step).toBe("context");
    expect(p.reason).toContain("not linked to an objective");
  });

  it("puts an unrated risk at ANALYSIS", () => {
    expect(locateWorkflowStep({ ...base, currentRiskScore: null }).step).toBe("analysis");
    expect(locateWorkflowStep({ ...base, currentRiskLevel: null }).step).toBe("analysis");
  });

  it("returns to ANALYSIS when an assumption behind the risk has been invalidated", () => {
    const p = locateWorkflowStep({ ...base, invalidatedAssumptionCount: 2 });
    expect(p.step).toBe("analysis");
    expect(p.reason).toContain("no longer believed");
  });

  it("routes an ineffective control to ASSURANCE, not to more treatment", () => {
    expect(locateWorkflowStep({ ...base, ineffectiveControlCount: 1 }).step).toBe("assurance");
  });

  it("lands a rated, controlled, treated risk on MONITORING", () => {
    expect(locateWorkflowStep(base).step).toBe("monitoring");
  });

  it("offers avoid and remove_source only at High or Critical, and retain only below", () => {
    const high = treatmentCandidates(base).map((c) => c.strategy);
    expect(high).toContain("avoid");
    expect(high).toContain("remove_source");
    expect(high).not.toContain("retain");

    const low = treatmentCandidates({ ...base, currentRiskLevel: "Low" }).map((c) => c.strategy);
    expect(low).toContain("retain");
    expect(low).not.toContain("avoid");
  });

  it("says out loud that retaining is not accepting", () => {
    const retain = treatmentCandidates({ ...base, currentRiskLevel: "Low" }).find(
      (c) => c.strategy === "retain",
    );
    expect(retain?.reason).toContain("not accepting");
  });

  it("names the shortlist and the §70 boundary in the prompt", () => {
    const p = buildRiskPrompts({
      risk: base,
      position: locateWorkflowStep(base),
      candidates: treatmentCandidates(base),
    });
    expect(p.systemPrompt).toContain("never accept a risk");
    expect(p.userContent).toContain("Compressor delivery slips");
    expect(p.userContent).toContain("monitoring");
  });
});

describe("parseTreatmentAdvice (D12.12 §62)", () => {
  const base: RiskView = {
    id: "r1",
    title: "Compressor delivery slips",
    eventDescription: null,
    currentRiskLevel: "Critical",
    currentRiskScore: 88,
    residualRiskLevel: null,
    targetRiskScore: null,
    status: "assessed",
    controlCount: 0,
    ineffectiveControlCount: 0,
    openTreatmentCount: 0,
    hasObjectiveLink: true,
    assumptionCount: 0,
    invalidatedAssumptionCount: 0,
  };
  const candidates = treatmentCandidates(base);

  const good = {
    recommended_strategy: "remove_source",
    label: "Re-scope the tie-in to remove the compressor dependency",
    rationale: "Removing the long-lead item from the critical path eliminates the delivery exposure.",
    expected_residual: 20,
    expected_introduced: 5,
    limitations: "Assumes the alternative tie-in is technically feasible; no study exists yet.",
  };

  it("accepts a shortlisted strategy with a rationale and stated limitations", () => {
    const r = parseTreatmentAdvice(good, candidates);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.advice.recommended_strategy).toBe("remove_source");
    expect(r.advice.expected_introduced).toBe(5);
  });

  it("REFUSES a strategy the risk's recorded state does not support", () => {
    // 'retain' is enum-valid and shortlist-invalid for a Critical risk: the
    // enum alone would have let the model recommend doing nothing about the
    // worst risk on the project.
    const r = parseTreatmentAdvice({ ...good, recommended_strategy: "retain" }, candidates);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal).toContain("retain");
    expect(r.refusal).toContain("recorded state");
  });

  it("refuses advice with no stated limitations", () => {
    const r = parseTreatmentAdvice({ ...good, limitations: "none" }, candidates);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal).toContain("limitations");
  });

  it("refuses a non-finite or out-of-range residual", () => {
    for (const bad of [Number.NaN, "abc", -1, 101, null]) {
      const r = parseTreatmentAdvice({ ...good, expected_residual: bad }, candidates);
      expect(r.ok, `expected_residual=${String(bad)}`).toBe(false);
    }
  });

  it("defaults introduced risk to zero but refuses an out-of-range one", () => {
    const ok = parseTreatmentAdvice({ ...good, expected_introduced: undefined }, candidates);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.advice.expected_introduced).toBe(0);
    expect(parseTreatmentAdvice({ ...good, expected_introduced: 400 }, candidates).ok).toBe(false);
  });

  it("refuses prose that contains no object", () => {
    const r = parseTreatmentAdvice("I would suggest avoiding this risk entirely.", candidates);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.refusal).toContain("did not return a JSON object");
  });
});
