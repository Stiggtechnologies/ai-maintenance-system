import { describe, expect, it } from "vitest";
import { isSeedDecisionCaseId } from "../decision-case-honesty";
import {
  CONNECTION_FAILURE_FALLBACKS,
  EVIDENCE_KINDS,
  SPINE_DISPOSITIONS,
  SPINE_STAGES,
  applyDisposition,
  applyInvite,
  applyVerificationPlan,
  attachSpineEvidence,
  buildSpineDecisionCase,
  computeConfidencePct,
  describeUploadedFile,
  interpretConnectionAttempt,
  inviteCopy,
  lineageFromCase,
  noConnectedDataHonesty,
  policyAdvisory,
  readinessFromCase,
  spineStageIndex,
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
