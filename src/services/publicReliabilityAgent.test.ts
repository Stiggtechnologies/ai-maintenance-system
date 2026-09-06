import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHonestEmptyDecisionCase } from "../lib/decision-case-honesty";
import {
  runPublicDecisionCaseAgent,
  runPublicReliabilityAgent,
} from "./publicReliabilityAgent";

vi.mock("../lib/supabase-config", () => ({
  supabaseUrl: "https://syncai-test.supabase.co",
  supabasePublicKey: "test-publishable-key",
}));

describe("publicReliabilityAgent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("uses a dedicated bounded request instead of the shared database timeout", async () => {
    const analysis = {
      executiveSummary: "Inspect before changing the interval.",
      observedPattern: "Startup-linked failures",
      ramInterpretation: "Exposure is incomplete.",
      riskExposure: "High",
      financialImpact: "Not yet verified",
      confidence: "medium",
      hypotheses: [],
      actions: [],
      evidenceGaps: [],
      bottomLine: "Run the evidence plan.",
      citations: [],
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ success: true, analysis, modelUsed: "stigg/agent" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const result = await runPublicReliabilityAgent({
      scenarioId: "pump-seal",
      question: "Assess the failure pattern.",
    });

    expect(result).toMatchObject({ status: "success", analysis });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://syncai-test.supabase.co/functions/v1/public-reliability-agent",
    );
    expect(request).toMatchObject({
      method: "POST",
      headers: {
        apikey: "test-publishable-key",
        authorization: "Bearer test-publishable-key",
      },
    });
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns a useful fallback when the expert endpoint rejects the request", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Gateway unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await runPublicReliabilityAgent({
      scenarioId: "pump-seal",
      question: "Assess the failure pattern.",
    });

    expect(result).toEqual({
      status: "fallback",
      error: "Gateway unavailable",
    });
  });
});

describe("runPublicDecisionCaseAgent unbound context", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("sends a sanitized provisional context and does not leak leftover seed plant facts", async () => {
    const empty = createHonestEmptyDecisionCase("Reliability Engineer");
    const leftover = {
      ...empty,
      organization: "North Ridge Energy",
      site: "Fort McMurray",
      recommendation: "Do not approve the yearly inspection interval",
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          response: "Provisional haul-truck availability framing.",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await runPublicDecisionCaseAgent(
      leftover,
      "HMER haul truck availability optimization",
      { questionScope: "provisional_new_subject", bound: false },
    );

    expect(result.status).toBe("success");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.mode).toBe("decision_case_chat");
    expect(body.caseContext.questionScope).toBe("provisional_new_subject");
    expect(body.caseContext.asset).toBe("Decision scope not yet defined");
    expect(body.caseContext.organization).toBe("");
    expect(body.caseContext.site).toBe("");
    expect(body.caseContext.recommendation).toBe("");
    expect(body.caseContext.evidence).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/P-101|Fort McMurray|North Ridge/i);
  });
});
