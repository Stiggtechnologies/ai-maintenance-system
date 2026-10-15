import { beforeEach, expect, it } from "vitest";
import { stageEvaluationAssistantHandoff } from "./evaluation-assistant-handoff";
import { buildSpineDecisionCase } from "./decision-case-spine";
import {
  getPublicDecisionCaseStorageKey,
  normalizeDecisionIndustry,
} from "../decision-case";
beforeEach(() => sessionStorage.clear());
it("preserves question, intent and evidence across explicit handoff and refresh without duplicating a case", () => {
  const decision = buildSpineDecisionCase({
    question: "Review the evidence for this pump reliability decision",
    intent: "solve",
  });
  const key = getPublicDecisionCaseStorageKey(
    normalizeDecisionIndustry(decision.industry),
  );
  const path = stageEvaluationAssistantHandoff(
    decision,
    "?entry=reliability&source=site&campaign=launch&role=admin",
    sessionStorage,
  );
  expect(path).toContain(`/workspace/cases/${decision.id}?`);
  expect(path).toContain("origin=evaluation");
  expect(path).toContain("entry=reliability");
  expect(path).not.toContain("role=");
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual([decision]);
  stageEvaluationAssistantHandoff(decision, "", sessionStorage);
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual([decision]);
});
it("refuses to navigate when browser storage cannot preserve the case", () => {
  const decision = buildSpineDecisionCase({
    question: "Review the evidence for this pump reliability decision",
    intent: "solve",
  });
  expect(() =>
    stageEvaluationAssistantHandoff(decision, "", {
      getItem: () => null,
      setItem: () => {
        throw Error("storage unavailable");
      },
    } as unknown as Storage),
  ).toThrow("storage unavailable");
});
it.each(["oil-gas", "mining", "manufacturing"] as const)(
  "uses the %s case industry despite conflicting acquisition input",
  (industry) => {
    const decision = {
      ...buildSpineDecisionCase({
        question: "Review the evidence for this pump reliability decision",
        intent: "solve",
      }),
      industry,
    };
    const path = stageEvaluationAssistantHandoff(
      decision,
      "?industry=wrong&source=marketplace",
      sessionStorage,
    );
    expect(new URL(path, "https://app.test").searchParams.get("industry")).toBe(
      industry,
    );
    expect(
      JSON.parse(
        sessionStorage.getItem(getPublicDecisionCaseStorageKey(industry))!,
      ),
    ).toEqual([decision]);
  },
);
