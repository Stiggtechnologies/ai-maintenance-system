import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isSeedDecisionCaseId } from "../decision-case-honesty";
import {
  CONNECTION_FAILURE_FALLBACKS,
  EVIDENCE_KINDS,
  SPINE_DISPOSITIONS,
  SPINE_STAGES,
  STAGE_HELP,
  activeSpineStage,
  applyDisposition,
  applyInvite,
  applyVerificationPlan,
  attachSpineEvidence,
  buildProofSummary,
  buildSpineDecisionCase,
  classifySpineCase,
  computeConfidencePct,
  describeUploadedFile,
  dispositionFromCase,
  expiryFromCase,
  interpretConnectionAttempt,
  inviteCopy,
  lineageFromCase,
  noConnectedDataHonesty,
  outcomeAttribution,
  policyAdvisory,
  proofDownloadName,
  provenanceFromCase,
  readinessFromCase,
  spineStageIndex,
  stageHelpFor,
  stageHelpSlug,
  unknownsFromCase,
} from "./decision-case-spine";

const people = {
  decisionOwner: "Ada",
  recommendationAuthor: "SyncAI",
  requiredApprover: "Kai",
  verificationOwner: "Ada",
};

describe("P0.2 Decision Case spine", () => {
  it("keeps the seven-stage loop and type-first evidence, with connection fallbacks", () => {
    expect([...SPINE_STAGES]).toEqual([
      "QUESTION",
      "EVIDENCE",
      "RECOMMENDATION",
      "HUMAN DECISION",
      "ACTION",
      "VERIFICATION",
      "LEARNING",
    ]);
    expect(EVIDENCE_KINDS.map((item) => item.id)).toEqual([
      "work_history",
      "condition",
      "documents",
      "inspection",
      "schedule_cost",
    ]);
    expect(CONNECTION_FAILURE_FALLBACKS).toEqual([
      "upload_file",
      "paste_data",
      "manual",
      "ask_admin",
    ]);
    expect(SPINE_DISPOSITIONS.map((item) => item.id)).toEqual([
      "accept",
      "reject",
      "need_more_evidence",
      "park",
      "escalate",
    ]);
  });

  it("auto-builds an honest empty case — no seed plant, no asset-specific rec", () => {
    const built = buildSpineDecisionCase({
      question:
        "Should we hold or change the current inspection interval on this rotating asset?",
      intent: "solve",
    });
    expect(isSeedDecisionCaseId(built.id)).toBe(false);
    expect(built.organization).toBe("");
    expect(built.site).toBe("");
    expect(built.recommendation).toMatch(/No asset-specific recommendation/);
    expect(built.recommendationDetail).toBe(noConnectedDataHonesty());
    expect(built.evidence.every((item) => item.quality === "missing")).toBe(
      true,
    );
    expect(JSON.stringify(built)).not.toMatch(/Fort McMurray|P-101|dc-1048/i);
    expect(built.workPackage.status).toBe("locked");
    expect(policyAdvisory(built.authorityRole)).toMatch(/current policy/);
  });

  it("refuses empty or banned seed subjects", () => {
    expect(() =>
      buildSpineDecisionCase({ question: "too short", intent: "solve" }),
    ).toThrow(/real question/i);
    expect(() =>
      buildSpineDecisionCase({
        question: "What about P-101 at Fort McMurray today?",
        intent: "solve",
      }),
    ).toThrow(/Seed plant/i);
  });

  it("raises confidence when evidence is attached and keeps plant execute locked", () => {
    const built = buildSpineDecisionCase({
      question: "Why does this gearbox keep failing after repair work?",
      intent: "solve",
    });
    const before = computeConfidencePct(built.evidence);
    const next = attachSpineEvidence(
      built,
      "work_history",
      "paste_data",
      "Two unplanned repairs in 90 days. Failure code blank.",
    );
    expect(computeConfidencePct(next.evidence)).toBeGreaterThan(before);
    expect(next.recommendation).toMatch(/not authorization/i);
    const accepted = applyDisposition(
      next,
      "accept",
      "Hold interval pending vibration.",
      people,
      {
        counterfactual:
          "A named vibration set that contradicts the hold would change it.",
      },
    );
    expect(accepted.workPackage.status).toBe("locked");
    expect(accepted.workPackage.targetSystem).toMatch(
      /plant execute disabled/i,
    );
  });

  it("requires rationale, schedules verification, and invites required authority", () => {
    const built = buildSpineDecisionCase({
      question: "Can this mill run to the next planned outage window?",
      intent: "coordinate",
    });
    expect(() => applyDisposition(built, "accept", "  ", people)).toThrow(
      /rationale/i,
    );
    expect(inviteCopy(built.authorityRole)).toMatch(/Invite them now/);
    const invited = applyInvite(built, {
      name: "Jordan Lee",
      email: "jordan@example.com",
      authority: built.authorityRole,
    });
    expect(invited.approvals[0]?.name).toBe("Jordan Lee");
    const scheduled = applyVerificationPlan(built, {
      question: "How will we know this worked?",
      expected: "No repeat trip before the outage date",
      actual: "",
      evidence: "",
      scheduledFor: "2026-09-21",
      effectiveness: "",
    });
    expect(scheduled.statusLabel).toMatch(/scheduled/i);
  });

  it("scores Stage-1 from loop maturity, not checklist ticks", () => {
    const built = buildSpineDecisionCase({
      question: "Which PM tasks can we extend on this production line?",
      intent: "solve",
    });
    const empty = readinessFromCase(built, { saved: false });
    expect(empty.metCount).toBe(0);
    expect(empty.headline).toMatch(/not onboarding-screen ticks/);
    const withEvidence = attachSpineEvidence(
      built,
      "documents",
      "upload_file",
      "PM task list exported from the planner, not a live CMMS feed.",
    );
    const decided = applyDisposition(
      withEvidence,
      "need_more_evidence",
      "Need vibration before extending any interval.",
      people,
    );
    const verified = applyVerificationPlan(decided, {
      question: "How will we know this worked?",
      expected: "Named vibration set attached before the next review",
      actual: "",
      evidence: "",
      scheduledFor: "2026-09-14",
      effectiveness: "",
    });
    const invited = applyInvite(verified, {
      name: "Kai",
      email: "kai@example.com",
      authority: verified.authorityRole,
    });
    const ready = readinessFromCase(invited, {
      saved: true,
      disposition: "need_more_evidence",
      verification: {
        question: "How will we know this worked?",
        expected: "Named vibration set attached before the next review",
        actual: "",
        evidence: "",
        scheduledFor: "2026-09-14",
        effectiveness: "",
      },
      invited: true,
      manualEvidencePath: true,
    });
    expect(ready.metCount).toBe(ready.total);
    expect(lineageFromCase(built).honesty).toBe(noConnectedDataHonesty());
  });

  it("advances the visible stage when evidence is attached and names unknowns", () => {
    const built = buildSpineDecisionCase({
      question: "Why does this gearbox keep failing after repair work?",
      intent: "solve",
    });
    expect(spineStageIndex(built.stage)).toBe(1);
    const next = attachSpineEvidence(
      built,
      "condition",
      "paste_data",
      "No vibration route is attached. Manual note only.",
    );
    expect(spineStageIndex(next.stage)).toBe(2);
    expect(unknownsFromCase(built).join(" ")).toMatch(
      /No connected operating data/,
    );
    expect(unknownsFromCase(built).join(" ")).toMatch(
      /Work history is not attached/,
    );
  });

  it("describes an upload without inventing readings and reports a failed connection", () => {
    expect(
      describeUploadedFile({
        name: "export.csv",
        type: "text/csv",
        size: 12,
        text: "tag,value\n",
      }),
    ).toMatch(/export\.csv/);
    expect(
      describeUploadedFile({
        name: "scan.pdf",
        type: "application/pdf",
        size: 40,
        text: null,
      }),
    ).toMatch(/No readings were invented/);
    expect(interpretConnectionAttempt([], undefined).ok).toBe(false);
    expect(interpretConnectionAttempt(null, "permission denied").ok).toBe(
      false,
    );
    const listed = interpretConnectionAttempt(
      [{ name: "Site historian", status: "healthy" }],
      undefined,
    );
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.note).toMatch(/does not pull tags/);
    }
  });
});

const question =
  "Should we hold or change the current inspection interval on this rotating asset?";

describe("P1 Decision Case trust", () => {
  it("keeps Accept unlocked until a counterfactual is stated", () => {
    const built = buildSpineDecisionCase({ question, intent: "solve" });
    expect(() =>
      applyDisposition(built, "accept", "Hold the interval.", people),
    ).toThrow(/what would change this recommendation/i);
    expect(() =>
      applyDisposition(built, "park", "Waiting on the outage window.", people),
    ).not.toThrow();
    const accepted = applyDisposition(
      built,
      "accept",
      "Hold the interval.",
      people,
      {
        counterfactual: "A vibration route that contradicts the hold.",
        expiresOn: "2026-12-01",
      },
    );
    expect(
      accepted.comments.find((item) => item.id === "counterfactual")?.text,
    ).toMatch(/vibration route/);
    expect(expiryFromCase(accepted)).toBe("2026-12-01");
    expect(dispositionFromCase(accepted)).toBe("accept");
    expect(accepted.messages.at(-1)?.text).toMatch(/does not auto-revoke/);
    expect(accepted.workPackage.status).toBe("locked");
    expect(() =>
      applyDisposition(built, "accept", "Hold the interval.", people, {
        counterfactual: "A later inspection finding.",
        expiresOn: "tomorrow",
      }),
    ).toThrow(/date or left blank/i);
  });

  it("cites only evidence already on the case", () => {
    const built = buildSpineDecisionCase({ question, intent: "solve" });
    expect(provenanceFromCase(built).cites).toEqual([]);
    expect(provenanceFromCase(built).note).toMatch(/cannot cite a source/i);
    const next = attachSpineEvidence(
      built,
      "condition",
      "paste_data",
      "Manual note: no vibration route is attached.",
    );
    const cites = provenanceFromCase(next).cites;
    expect(cites).toHaveLength(1);
    expect(cites[0]?.title).toBe("Condition");
    expect(cites[0]?.sourceSystem).toBe("Manual / file");
    expect(cites.some((cite) => cite.quality === "missing")).toBe(false);
  });

  it("classifies from intent, evidence types, and disposition without plant criticality", () => {
    const solve = buildSpineDecisionCase({ question, intent: "solve" });
    expect(classifySpineCase(solve, "").id).toBe("review");
    expect(classifySpineCase(solve, "").basis).toMatch(
      /Criticality, duty, consequence/,
    );
    expect(classifySpineCase(solve, "").basis).not.toMatch(
      /criticality is (high|loaded|known)/i,
    );
    const withCondition = attachSpineEvidence(
      solve,
      "condition",
      "paste_data",
      "Manual note only. No route file.",
    );
    expect(classifySpineCase(withCondition, "accept").id).toBe("advisory");
    expect(classifySpineCase(withCondition, "need_more_evidence").id).toBe(
      "review",
    );
    const coordinate = buildSpineDecisionCase({
      question: "Can the crew release this job before the planned window?",
      intent: "coordinate",
    });
    expect(classifySpineCase(coordinate, "").id).toBe("ops");
    expect(classifySpineCase(coordinate, "escalate").id).toBe("review");
    const scheduleOnly = attachSpineEvidence(
      solve,
      "schedule_cost",
      "paste_data",
      "Outage window named by the planner. No cost figure invented.",
    );
    expect(classifySpineCase(scheduleOnly, "accept").id).toBe("ops");
    expect(unknownsFromCase(solve).join(" ")).toMatch(
      /Criticality, duty, and consequence are not stated/,
    );
    expect(unknownsFromCase(solve).join(" ")).toMatch(
      /No approval-policy record is loaded/,
    );
  });

  it("links Actual and Evidence to the named Verification Owner", () => {
    const built = buildSpineDecisionCase({ question, intent: "solve" });
    expect(
      outcomeAttribution({ actual: "", evidence: "" }, people.verificationOwner)
        .line,
    ).toMatch(/Effectiveness alone is not attribution/);
    expect(
      outcomeAttribution(
        { actual: "No repeat trip", evidence: "Operator log" },
        "",
      ).attributed,
    ).toBe(false);
    const recorded = applyVerificationPlan(built, {
      question: "How will we know this worked?",
      expected: "No repeat trip before the outage date",
      actual: "No repeat trip",
      evidence: "Operator log excerpt",
      scheduledFor: "2026-09-21",
      effectiveness: "effective",
      attributedTo: "Ada",
    });
    expect(recorded.messages.at(-1)?.author).toBe("Ada");
    expect(recorded.messages.at(-1)?.text).toMatch(
      /linked to Verification Owner Ada/,
    );
    expect(recorded.learningRecord?.summary).toMatch(/Verification Owner Ada/);
    const unowned = applyVerificationPlan(built, {
      question: "How will we know this worked?",
      expected: "No repeat trip before the outage date",
      actual: "No repeat trip",
      evidence: "",
      scheduledFor: "2026-09-21",
      effectiveness: "",
      attributedTo: "",
    });
    expect(unowned.messages.at(-1)?.author).toBe("Verification");
    expect(unowned.messages.at(-1)?.text).toMatch(
      /not linked to a Verification Owner/,
    );
  });

  it("builds a replayable proof summary from the case without a new vault", () => {
    const built = buildSpineDecisionCase({ question, intent: "solve" });
    const withEvidence = attachSpineEvidence(
      built,
      "documents",
      "paste_data",
      "Planner export excerpt, not a live CMMS feed.",
    );
    const accepted = applyDisposition(
      withEvidence,
      "accept",
      "Hold the interval.",
      people,
      { counterfactual: "A vibration route that contradicts the hold." },
    );
    const markdown = buildProofSummary({
      decisionCase: accepted,
      disposition: "",
      rationale: "",
      counterfactual: "",
      expiresOn: "",
      people: {
        decisionOwner: "",
        recommendationAuthor: "",
        requiredApprover: "",
        verificationOwner: "",
      },
      verification: {
        question: "",
        expected: "",
        actual: "",
        evidence: "",
        scheduledFor: "",
        effectiveness: "",
      },
    });
    expect(markdown).toMatch(/## Ask/);
    expect(markdown).toMatch(/## Evidence/);
    expect(markdown).toMatch(/## Recommendation/);
    expect(markdown).toMatch(/## Human decision/);
    expect(markdown).toMatch(/## Verification/);
    expect(markdown).toMatch(/vibration route/);
    expect(markdown).toMatch(/Decision Owner: Ada/);
    expect(markdown).toMatch(/Class: Advisory/);
    expect(markdown).toMatch(/not a development case/i);
    expect(markdown).not.toMatch(/Fort McMurray|P-101|dc-1048/i);
    expect(proofDownloadName(accepted.caseNumber)).toMatch(/-proof\.md$/);
    const source = readFileSync(
      "src/lib/onboarding/decision-case-spine.ts",
      "utf8",
    );
    expect(source).not.toMatch(/create_case_decision/);
  });
});

describe("P3 Decision Case stage help", () => {
  it("has short Help for every spine stage, including locked action", () => {
    expect(STAGE_HELP.map((item) => item.stage)).toEqual([...SPINE_STAGES]);
    for (const stage of SPINE_STAGES) {
      const help = stageHelpFor(stage);
      expect(help.doThis.trim().length).toBeGreaterThan(20);
      expect(help.willNot).toMatch(/^Sync will not /);
      expect(stageHelpSlug(stage)).toMatch(/^[a-z0-9-]+$/);
      expect(`${help.label} ${help.doThis} ${help.willNot}`).not.toMatch(
        /Fort McMurray|P-101|dc-1048|self-guided onboarding is live/i,
      );
    }
    expect(stageHelpFor("ACTION").label).toBe("ACTION · locked");
    expect(stageHelpFor("RECOMMENDATION").willNot).toMatch(/not authorize/);
    expect(stageHelpFor("ACTION").willNot).toMatch(/not write a work order/);
    expect(stageHelpFor("QUESTION").willNot).toMatch(/not invent a plant/);
    expect(stageHelpFor("EVIDENCE").willNot).toMatch(/not invent readings/);
    const source = readFileSync(
      "src/lib/onboarding/decision-case-spine.ts",
      "utf8",
    );
    expect(source).not.toMatch(/create_case_decision/);
    expect(source).not.toMatch(/start-here-role-pick/);
  });

  it("follows the case stage and never marks locked action as the writable stage", () => {
    const built = buildSpineDecisionCase({
      question:
        "Should we hold or change the current inspection interval on this rotating asset?",
      intent: "solve",
    });
    expect(activeSpineStage(built.stage)).toBe("EVIDENCE");
    const accepted = applyDisposition(
      built,
      "accept",
      "Hold the interval.",
      people,
      { counterfactual: "A vibration route that contradicts the hold." },
    );
    expect(activeSpineStage(accepted.stage)).toBe("VERIFICATION");
    const learned = applyVerificationPlan(accepted, {
      question: "How will we know this worked?",
      expected: "Interval revisited",
      actual: "Still held",
      evidence: "Planner note",
      scheduledFor: "2026-12-01",
      effectiveness: "inconclusive",
      attributedTo: "Ada",
    });
    expect(activeSpineStage(learned.stage)).toBe("LEARNING");
    expect(activeSpineStage("execution")).toBe("ACTION");
    expect(stageHelpFor("ACTION").label).toMatch(/locked/);
  });
});
